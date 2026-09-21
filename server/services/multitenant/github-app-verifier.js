import { createPrivateKey, sign as signBytes } from 'node:crypto';
import { ContractError } from './errors.js';

const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const INSTALLATION_ID_PATTERN = /^[1-9][0-9]{0,19}$/u;
const NUMERIC_ID_PATTERN = /^[1-9][0-9]{0,19}$/u;

function required(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function base64url(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function installationSnapshot(data, { installationId, appId, appSlug }) {
    const id = String(data?.id ?? '');
    const actualAppId = String(data?.app_id ?? '');
    const accountId = String(data?.account?.id ?? '');
    const login = data?.account?.login;
    const accountType = data?.account?.type;
    if (id !== installationId || actualAppId !== appId
        || typeof data?.app_slug !== 'string' || data.app_slug.toLowerCase() !== appSlug.toLowerCase()
        || !NUMERIC_ID_PATTERN.test(accountId)
        || typeof login !== 'string' || !/^[A-Za-z0-9-]{1,39}$/u.test(login)
        || typeof accountType !== 'string' || accountType.toLowerCase() !== 'organization'
        || (data?.suspended_at !== null && data?.suspended_at !== undefined)) {
        throw new ContractError('GITHUB_INSTALLATION_VERIFICATION_FAILED', {
            status: 502,
            fault_domain: 'external_provider'
        });
    }
    return {
        installation_id: id,
        app_id: actualAppId,
        app_slug: data.app_slug,
        account: { id: accountId, login, type: 'Organization' },
        permissions: data.permissions && typeof data.permissions === 'object' && !Array.isArray(data.permissions)
            ? data.permissions
            : {},
        suspended_at: null
    };
}

function parseCredentialDescriptor(value, { appId, installationId }) {
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 1024) return null;
    try {
        const descriptor = JSON.parse(value);
        const keys = Object.keys(descriptor ?? {}).sort();
        if (keys.join(',') !== 'app_id,installation_id,provider,version'
            || descriptor.provider !== 'github'
            || descriptor.version !== 1
            || String(descriptor.app_id) !== appId
            || String(descriptor.installation_id) !== installationId) return null;
        return descriptor;
    } catch {
        return null;
    }
}

/**
 * Builds a GitHub App installation verifier from server-only configuration.
 * Private key material is used only to mint short-lived App JWTs and is never
 * returned from the adapter or sent to the tenant credential store.
 */
export function createGitHubAppVerifierFromEnv({ env = process.env, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
    const appId = required(env?.GITHUB_APP_ID);
    const appSlug = required(env?.GITHUB_APP_SLUG);
    const privateKeyPem = required(env?.GITHUB_APP_PRIVATE_KEY)?.replaceAll('\\n', '\n');
    if (!appId || !NUMERIC_ID_PATTERN.test(appId) || !appSlug || !/^[A-Za-z0-9-]+$/u.test(appSlug)
        || !privateKeyPem || typeof fetchImpl !== 'function') return null;

    let privateKey;
    try {
        privateKey = createPrivateKey(privateKeyPem);
    } catch {
        return null;
    }
    if (privateKey.asymmetricKeyType !== 'rsa') return null;

    function appJwt() {
        const clock = now();
        if (!(clock instanceof Date) || Number.isNaN(clock.getTime())) {
            throw new ContractError('GITHUB_APP_CONNECTION_UNAVAILABLE', { status: 503, retryable: true });
        }
        const issuedAt = Math.floor(clock.getTime() / 1000) - 60;
        const unsigned = `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url({
            iss: appId,
            iat: issuedAt,
            exp: issuedAt + 540
        })}`;
        return `${unsigned}.${signBytes('RSA-SHA256', Buffer.from(unsigned, 'utf8'), privateKey).toString('base64url')}`;
    }

    async function readInstallation(installationId) {
        if (typeof installationId !== 'string' || !INSTALLATION_ID_PATTERN.test(installationId)) {
            throw new ContractError('GITHUB_INSTALLATION_VERIFICATION_FAILED', {
                status: 502,
                fault_domain: 'external_provider'
            });
        }
        let response;
        try {
            response = await fetchImpl(`${GITHUB_API_URL}/app/installations/${encodeURIComponent(installationId)}`, {
                method: 'GET',
                headers: {
                    accept: 'application/vnd.github+json',
                    authorization: `Bearer ${appJwt()}`,
                    'x-github-api-version': GITHUB_API_VERSION
                },
                signal: AbortSignal.timeout(10_000)
            });
        } catch {
            throw new ContractError('GITHUB_INSTALLATION_VERIFICATION_FAILED', {
                status: 502,
                retryable: true,
                fault_domain: 'external_provider'
            });
        }
        if (!response?.ok) {
            throw new ContractError('GITHUB_INSTALLATION_VERIFICATION_FAILED', {
                status: 502,
                retryable: response?.status === 429 || Number(response?.status) >= 500,
                fault_domain: 'external_provider'
            });
        }
        let body;
        try {
            body = await response.json();
        } catch {
            throw new ContractError('GITHUB_INSTALLATION_VERIFICATION_FAILED', {
                status: 502,
                fault_domain: 'external_provider'
            });
        }
        return installationSnapshot(body, { installationId, appId, appSlug });
    }

    async function readOrganizationInstallation(organizationLogin) {
        if (typeof organizationLogin !== 'string' || !/^[A-Za-z0-9-]{1,39}$/u.test(organizationLogin)) {
            throw new ContractError('GITHUB_INSTALLATION_VERIFICATION_FAILED', {
                status: 502,
                fault_domain: 'external_provider'
            });
        }
        let response;
        try {
            response = await fetchImpl(
                `${GITHUB_API_URL}/orgs/${encodeURIComponent(organizationLogin)}/installation`,
                {
                    method: 'GET',
                    headers: {
                        accept: 'application/vnd.github+json',
                        authorization: `Bearer ${appJwt()}`,
                        'x-github-api-version': GITHUB_API_VERSION
                    },
                    signal: AbortSignal.timeout(10_000)
                }
            );
        } catch {
            throw new ContractError('GITHUB_INSTALLATION_VERIFICATION_FAILED', {
                status: 502,
                retryable: true,
                fault_domain: 'external_provider'
            });
        }
        if (response?.status === 404) return null;
        if (!response?.ok) {
            throw new ContractError('GITHUB_INSTALLATION_VERIFICATION_FAILED', {
                status: 502,
                retryable: response?.status === 429 || Number(response?.status) >= 500,
                fault_domain: 'external_provider'
            });
        }
        let body;
        try {
            body = await response.json();
        } catch {
            throw new ContractError('GITHUB_INSTALLATION_VERIFICATION_FAILED', {
                status: 502,
                fault_domain: 'external_provider'
            });
        }
        const installationId = String(body?.id ?? '');
        const installation = installationSnapshot(body, { installationId, appId, appSlug });
        if (installation.account.login.toLowerCase() !== organizationLogin.toLowerCase()) {
            throw new ContractError('GITHUB_INSTALLATION_VERIFICATION_FAILED', {
                status: 502,
                fault_domain: 'external_provider'
            });
        }
        return installation;
    }

    function assertExpectedSlug(expectedAppSlug) {
        if (typeof expectedAppSlug !== 'string' || expectedAppSlug.toLowerCase() !== appSlug.toLowerCase()) {
            throw new ContractError('GITHUB_INSTALLATION_VERIFICATION_FAILED', {
                status: 502,
                fault_domain: 'external_provider'
            });
        }
    }

    return Object.freeze({
        async verifyOrganizationInstallation({
            organization_login: organizationLogin,
            expected_app_slug: expectedAppSlug
        } = {}) {
            assertExpectedSlug(expectedAppSlug);
            const installation = await readOrganizationInstallation(organizationLogin);
            if (!installation) return null;
            return {
                installation,
                credential_material: JSON.stringify({
                    version: 1,
                    provider: 'github',
                    app_id: appId,
                    installation_id: installation.installation_id
                })
            };
        },
        async verifyInstallation({ installation_id: installationId, expected_app_slug: expectedAppSlug } = {}) {
            assertExpectedSlug(expectedAppSlug);
            const installation = await readInstallation(installationId);
            return {
                installation,
                credential_material: JSON.stringify({
                    version: 1,
                    provider: 'github',
                    app_id: appId,
                    installation_id: installation.installation_id
                })
            };
        },
        async readInstallation({
            installation_id: installationId,
            credential_material: credentialMaterial,
            expected_app_slug: expectedAppSlug
        } = {}) {
            assertExpectedSlug(expectedAppSlug);
            if (!parseCredentialDescriptor(credentialMaterial, { appId, installationId })) {
                throw new ContractError('GITHUB_INSTALLATION_VERIFICATION_FAILED', {
                    status: 502,
                    fault_domain: 'external_provider'
                });
            }
            return { installation: await readInstallation(installationId) };
        }
    });
}

export { GITHUB_API_VERSION };
