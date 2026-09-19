import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';

import { ContractError } from '../services/multitenant/errors.js';
import { generateCanonicalId, isCanonicalId } from '../services/multitenant/ids.js';
import { createSlackInstallationAccessResolver } from '../services/multitenant/slack-installation-access.js';
import { validateSlackInstallationBinding } from '../services/multitenant/slack-installation-control-plane.js';

const ADMIN_ROLES = new Set(['admin', 'owner', 'tenant_admin', 'ceo', 'gm']);
const PROVIDERS = new Set(['slack', 'github']);
const GITHUB_STATE_TTL_MS = 10 * 60 * 1000;
const CREDENTIAL_MODES = new Set(['cloud_standard', 'customer_oauth', 'customer_api']);

function problem(res, status, code) {
    return res.status(status).type('application/problem+json').json({
        type: `https://brainbase.example/problems/${code.toLowerCase().replaceAll('_', '-')}`,
        status,
        code,
        title: '組織連携を確認できません',
        retryable: status >= 500,
        fault_domain: status >= 500 ? 'brainbase_cloud' : 'protocol',
        correlation_id: null
    });
}

function safeBody(req) {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const allowed = new Set(['expected_workspace_id', 'expected_enterprise_id', 'expected_connection_revision']);
    if (Object.keys(body).some((key) => !allowed.has(key))) {
        throw new ContractError('SCHEMA_INVALID', { status: 400, fault_domain: 'protocol' });
    }
    return body;
}

function cleanStatusRow(row) {
    const revoked = row?.status === 'revoked';
    return {
        status: revoked ? 'revoked' : 'unknown',
        connected: revoked ? false : null,
        account: {
            connection_id: typeof row?.connection_id === 'string' ? row.connection_id : null,
            provider_status: ['pending', 'active', 'revoked'].includes(row?.status) ? row.status : 'unknown',
            external_handle: row?.workspace_id || row?.installation_id || null,
            granted_scopes: Array.isArray(row?.granted_scopes) ? row.granted_scopes : [],
            installed_at: row?.installed_at ?? null
        }
    };
}

async function verifiedSlackStatus({ row, controlPlane, tenantId }) {
    if (row?.status === 'revoked') return cleanStatusRow(row);
    if (row?.status !== 'active' || typeof row?.credential_ref !== 'string'
        || !controlPlane?.credentialStore?.verify) return cleanStatusRow(row);
    const result = await controlPlane.credentialStore.verify({
        tenant_id: tenantId,
        connection_id: row.connection_id,
        connection_revision: String(row.connection_revision),
        provider: 'slack',
        credential_ref: row.credential_ref
    });
    if (result?.valid !== true) return cleanStatusRow(row);
    return { ...cleanStatusRow(row), status: 'connected', connected: true };
}

function digestState(state) {
    return createHash('sha256').update(state, 'utf8').digest('hex');
}

function stateRecord({ tenantId, personId, secret, now }) {
    if (typeof secret !== 'string' || secret.length < 32) return null;
    const issuedAt = now();
    if (!(issuedAt instanceof Date) || Number.isNaN(issuedAt.getTime())) return null;
    const expiresAt = new Date(issuedAt.getTime() + GITHUB_STATE_TTL_MS);
    const record = {
        provider: 'github',
        tenant_id: tenantId,
        person_id: personId,
        jti: randomUUID(),
        issued_at: issuedAt.toISOString(),
        expires_at: expiresAt.toISOString()
    };
    const payload = Buffer.from(JSON.stringify(record)).toString('base64url');
    const signature = createHmac('sha256', secret).update(payload).digest('base64url');
    const signedState = `${payload}.${signature}`;
    return {
        ...record,
        signed_state: signedState,
        state_digest: digestState(signedState)
    };
}

function parseCanonicalDate(value) {
    if (typeof value !== 'string') return null;
    const millis = Date.parse(value);
    if (!Number.isFinite(millis)) return null;
    const parsed = new Date(millis);
    return parsed.toISOString() === value ? parsed : null;
}

function verifySignedState(state, { secret, now }) {
    if (typeof state !== 'string' || state.length > 4096 || typeof secret !== 'string' || secret.length < 32) {
        return null;
    }
    const parts = state.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]
        || !/^[A-Za-z0-9_-]+$/u.test(parts[0]) || !/^[A-Za-z0-9_-]+$/u.test(parts[1])) return null;
    const suppliedSignature = Buffer.from(parts[1], 'base64url');
    if (suppliedSignature.toString('base64url') !== parts[1]) return null;
    const expectedSignature = createHmac('sha256', secret).update(parts[0]).digest();
    if (suppliedSignature.length !== expectedSignature.length
        || !timingSafeEqual(suppliedSignature, expectedSignature)) return null;

    const payloadBuffer = Buffer.from(parts[0], 'base64url');
    if (payloadBuffer.toString('base64url') !== parts[0]) return null;
    let payload;
    try {
        payload = JSON.parse(payloadBuffer.toString('utf8'));
    } catch {
        return null;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || payload.provider !== 'github' || !isCanonicalId(payload.tenant_id, 'ten')
        || !isCanonicalId(payload.person_id, 'per')
        || typeof payload.jti !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(payload.jti)) {
        return null;
    }
    const issuedAt = parseCanonicalDate(payload.issued_at);
    const expiresAt = parseCanonicalDate(payload.expires_at);
    const clock = now();
    if (!issuedAt || !expiresAt || !(clock instanceof Date) || Number.isNaN(clock.getTime())
        || issuedAt.getTime() > clock.getTime()
        || expiresAt.getTime() <= clock.getTime()
        || expiresAt.getTime() <= issuedAt.getTime()
        || expiresAt.getTime() - issuedAt.getTime() > GITHUB_STATE_TTL_MS) return null;
    return {
        provider: 'github',
        tenant_id: payload.tenant_id,
        person_id: payload.person_id,
        jti: payload.jti,
        issued_at: issuedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        state_digest: digestState(state)
    };
}

function validGitHubAppSlug(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9-]+$/u.test(value);
}

// These ports keep GitHub App credentials, durable state storage, and repository shape out of the route.
function hasGitHubConnectionPorts({ githubAppVerifier, githubCredentialStore, githubAuthorizationLedger, connectionRepository }) {
    return typeof githubAppVerifier?.verifyInstallation === 'function'
        && typeof githubAppVerifier?.readInstallation === 'function'
        && typeof githubCredentialStore?.store === 'function'
        && typeof githubCredentialStore?.verify === 'function'
        && typeof githubCredentialStore?.materialize === 'function'
        && typeof githubCredentialStore?.revoke === 'function'
        && typeof githubAuthorizationLedger?.issue === 'function'
        && typeof githubAuthorizationLedger?.consume === 'function'
        && typeof connectionRepository?.reserveGitHubInstallation === 'function'
        && typeof connectionRepository?.saveGitHubInstallation === 'function'
        && typeof connectionRepository?.cancelGitHubInstallationReservation === 'function';
}

function normalizeGitHubInstallation(value, { installationId, appSlug }) {
    const installation = value?.installation;
    const account = installation?.account;
    const expectedInstallationId = String(installationId);
    const actualInstallationId = String(installation?.installation_id ?? '');
    const accountId = String(account?.id ?? '');
    const appId = String(installation?.app_id ?? '');
    const login = account?.login;
    if (!installation || actualInstallationId !== expectedInstallationId
        || typeof installation.app_slug !== 'string'
        || installation.app_slug.toLowerCase() !== appSlug.toLowerCase()
        || !/^\d+$/u.test(accountId) || !/^\d+$/u.test(appId)
        || typeof login !== 'string' || !/^[A-Za-z0-9-]{1,39}$/u.test(login)
        || String(account?.type ?? '').toLowerCase() !== 'organization'
        || (installation.suspended_at !== null && installation.suspended_at !== undefined)) return null;
    return {
        installation_id: actualInstallationId,
        app_id: appId,
        app_slug: installation.app_slug,
        account: { id: accountId, login, type: 'Organization' },
        permissions: installation.permissions && typeof installation.permissions === 'object'
            && !Array.isArray(installation.permissions) ? installation.permissions : {},
        suspended_at: null
    };
}

function sameGitHubInstallation(expected, actual) {
    return Boolean(actual
        && expected.installation_id === actual.installation_id
        && expected.app_id === actual.app_id
        && expected.app_slug.toLowerCase() === actual.app_slug.toLowerCase()
        && expected.account.id === actual.account.id
        && expected.account.login.toLowerCase() === actual.account.login.toLowerCase()
        && actual.suspended_at === null);
}

function safeCallbackReturnPath(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')
        || value.includes('\\') || value.includes('?') || value.includes('#')
        || /[\u0000-\u001f\u007f]/u.test(value)) return null;
    return value;
}

async function verifiedGitHubStatus({
    row, tenantId, githubAppSlug, githubAppVerifier, githubCredentialStore
}) {
    if (row?.status === 'revoked') return cleanStatusRow(row);
    if (row?.status !== 'active' || typeof row?.credential_ref !== 'string'
        || !isCanonicalId(row?.connection_id, 'wsc')
        || !/^[1-9][0-9]*$/u.test(String(row?.connection_revision ?? ''))
        || !/^\d{1,20}$/u.test(String(row?.installation_id ?? ''))
        || !validGitHubAppSlug(githubAppSlug)
        || typeof githubAppVerifier?.readInstallation !== 'function'
        || typeof githubCredentialStore?.verify !== 'function'
        || typeof githubCredentialStore?.materialize !== 'function') return cleanStatusRow(row);

    const binding = {
        tenant_id: tenantId,
        connection_id: row.connection_id,
        connection_revision: String(row.connection_revision),
        provider: 'github',
        credential_ref: row.credential_ref
    };
    const reference = await githubCredentialStore.verify(binding);
    if (reference?.valid !== true) return cleanStatusRow(row);
    const materialized = await githubCredentialStore.materialize(row.credential_ref, {
        tenant_id: binding.tenant_id,
        connection_id: binding.connection_id,
        connection_revision: binding.connection_revision,
        provider: binding.provider
    });
    if (!materialized || !Object.hasOwn(materialized, 'credential_material')
        || materialized.credential_material === null || materialized.credential_material === undefined) {
        return cleanStatusRow(row);
    }
    const readback = await githubAppVerifier.readInstallation({
        installation_id: String(row.installation_id),
        credential_material: materialized.credential_material,
        expected_app_slug: githubAppSlug
    });
    const installation = normalizeGitHubInstallation(readback, {
        installationId: row.installation_id,
        appSlug: githubAppSlug
    });
    if (!installation
        || (row.app_id !== undefined && row.app_id !== null && String(row.app_id) !== installation.app_id)
        || (row.account_id !== undefined && row.account_id !== null
            && String(row.account_id) !== installation.account.id)
        || (row.account_login !== undefined && row.account_login !== null
            && String(row.account_login).toLowerCase() !== installation.account.login.toLowerCase())) {
        return cleanStatusRow(row);
    }
    return { ...cleanStatusRow(row), status: 'connected', connected: true };
}

export function createGitHubInstallationCallbackHandler({
    githubAppSlug,
    githubStateSecret,
    githubAppVerifier,
    githubCredentialStore,
    githubAuthorizationLedger,
    connectionRepository,
    githubCallbackReturnPath,
    now = () => new Date()
} = {}) {
    const returnPath = safeCallbackReturnPath(githubCallbackReturnPath);
    return async (req, res) => {
        res.set('cache-control', 'no-store').set('referrer-policy', 'no-referrer');
        if (!hasGitHubConnectionPorts({
            githubAppVerifier, githubCredentialStore, githubAuthorizationLedger, connectionRepository
        }) || !validGitHubAppSlug(githubAppSlug) || typeof githubStateSecret !== 'string'
            || githubStateSecret.length < 32 || (githubCallbackReturnPath && !returnPath)) {
            return problem(res, 503, 'GITHUB_APP_CONNECTION_UNAVAILABLE');
        }
        const installationId = req.query?.installation_id;
        const rawState = req.query?.state;
        if (!['install', 'update'].includes(req.query?.setup_action) || typeof installationId !== 'string'
            || !/^\d{1,20}$/u.test(installationId) || typeof rawState !== 'string') {
            return problem(res, 400, 'GITHUB_INSTALLATION_CALLBACK_INVALID');
        }
        const state = verifySignedState(rawState, { secret: githubStateSecret, now });
        if (!state) return problem(res, 400, 'GITHUB_INSTALLATION_STATE_INVALID');
        try {
            const consumed = await githubAuthorizationLedger.consume({
                ...state,
                now: now().toISOString()
            });
            if (consumed !== true) return problem(res, 409, 'GITHUB_INSTALLATION_STATE_REPLAYED');

            const inspected = await githubAppVerifier.verifyInstallation({
                installation_id: installationId,
                expected_app_slug: githubAppSlug
            });
            const installation = normalizeGitHubInstallation(inspected, {
                installationId,
                appSlug: githubAppSlug
            });
            if (!installation || !Object.hasOwn(inspected ?? {}, 'credential_material')
                || inspected.credential_material === null || inspected.credential_material === undefined) {
                return problem(res, 502, 'GITHUB_INSTALLATION_VERIFICATION_FAILED');
            }

            const reservation = await connectionRepository.reserveGitHubInstallation({
                tenant_id: state.tenant_id,
                initiated_by_person_id: state.person_id,
                installation,
                idempotency_key: state.jti
            });
            const connectionId = reservation?.connection_id;
            const connectionRevision = String(reservation?.connection_revision ?? '');
            if (!isCanonicalId(connectionId, 'wsc') || !/^[1-9][0-9]*$/u.test(connectionRevision)) {
                return problem(res, 503, 'GITHUB_CONNECTION_STATE_UNAVAILABLE');
            }
            const credentialBinding = {
                tenant_id: state.tenant_id,
                connection_id: connectionId,
                connection_revision: connectionRevision,
                provider: 'github'
            };
            let credential;
            let saved = false;
            try {
                const stored = await githubCredentialStore.store({
                    ...credentialBinding,
                    idempotency_key: state.jti,
                    credential_material: inspected.credential_material
                });
                // Track a bounded opaque reference immediately so a bad metadata response
                // cannot leave a credential behind when validation below fails.
                if (typeof stored?.credential_ref === 'string' && stored.credential_ref.length > 0
                    && stored.credential_ref.length <= 512) {
                    credential = { credential_ref: stored.credential_ref };
                }
                if (typeof stored?.credential_ref !== 'string' || stored.credential_ref.length === 0
                    || stored.credential_ref.length > 512
                    || !CREDENTIAL_MODES.has(stored.credential_mode)
                    || !Number.isInteger(stored.refresh_revision) || stored.refresh_revision < 0) {
                    return problem(res, 502, 'GITHUB_CREDENTIAL_STORE_INVALID');
                }
                credential = {
                    ...credential,
                    credential_ref: stored.credential_ref,
                    credential_mode: stored.credential_mode,
                    refresh_revision: stored.refresh_revision
                };
                const referenceBinding = { ...credentialBinding, credential_ref: credential.credential_ref };
                const storedCredential = await githubCredentialStore.verify(referenceBinding);
                if (storedCredential?.valid !== true) {
                    return problem(res, 502, 'GITHUB_CREDENTIAL_STORE_INVALID');
                }
                const materialized = await githubCredentialStore.materialize(
                    credential.credential_ref,
                    credentialBinding
                );
                if (!materialized || !Object.hasOwn(materialized, 'credential_material')
                    || materialized.credential_material === null || materialized.credential_material === undefined) {
                    return problem(res, 502, 'GITHUB_CREDENTIAL_STORE_INVALID');
                }
                const providerReadback = await githubAppVerifier.readInstallation({
                    installation_id: installationId,
                    credential_material: materialized.credential_material,
                    expected_app_slug: githubAppSlug
                });
                const readbackInstallation = normalizeGitHubInstallation(providerReadback, {
                    installationId,
                    appSlug: githubAppSlug
                });
                if (!sameGitHubInstallation(installation, readbackInstallation)) {
                    return problem(res, 502, 'GITHUB_INSTALLATION_READBACK_MISMATCH');
                }
                await connectionRepository.saveGitHubInstallation({
                    tenant_id: state.tenant_id,
                    initiated_by_person_id: state.person_id,
                    connection_id: connectionId,
                    connection_revision: connectionRevision,
                    installation,
                    credential
                });
                saved = true;
            } finally {
                if (credential?.credential_ref && !saved) {
                    try {
                        await githubCredentialStore.revoke({
                            ...credentialBinding,
                            credential_ref: credential.credential_ref,
                            reason: 'github_installation_registration_failed'
                        });
                    } catch { /* Keep reservation cleanup independent of credential cleanup. */ }
                }
                if (!saved) {
                    try {
                        await connectionRepository.cancelGitHubInstallationReservation({
                            tenant_id: state.tenant_id,
                            connection_id: connectionId,
                            connection_revision: connectionRevision,
                            idempotency_key: state.jti
                        });
                    } catch { /* Preserve the original callback failure. */ }
                }
            }

            if (returnPath) return res.status(303).set('location', returnPath).set('cache-control', 'no-store').end();
            return res.status(200).set('cache-control', 'no-store').json({
                provider: 'github', status: 'connected', connected: true,
                account: { installation_id: installation.installation_id, login: installation.account.login }
            });
        } catch {
            return problem(res, 503, 'GITHUB_INSTALLATION_CALLBACK_UNAVAILABLE');
        }
    };
}

export function createOrganizationConnectionsRouter({
    controlPlane,
    appId,
    oauthFlow,
    authService,
    connectionRepository,
    githubAppSlug,
    githubStateSecret,
    githubAppVerifier,
    githubCredentialStore = controlPlane?.credentialStore,
    githubAuthorizationLedger,
    now = () => new Date(),
    resolveAccess
} = {}) {
    const router = express.Router();
    const accessResolver = resolveAccess ?? createSlackInstallationAccessResolver({ authService, trustedAppId: appId });

    async function authorized(req) {
        if (req.authSource === 'service-token' || req.authSource === 'internal'
            || req.authSource === 'insecure-header') return null;
        const access = await accessResolver({ req, auth: req.auth, access: req.access });
        if (!access || !isCanonicalId(access.tenantId, 'ten') || !isCanonicalId(access.personId, 'per')
            || !ADMIN_ROLES.has(String(access.role ?? '').toLowerCase())) return null;
        return access;
    }

    router.get('/:provider/status', async (req, res) => {
        const { provider } = req.params;
        if (!PROVIDERS.has(provider)) return problem(res, 404, 'PROVIDER_NOT_SUPPORTED');
        try {
            const access = await authorized(req);
            if (!access) return problem(res, 403, 'ORGANIZATION_ADMIN_REQUIRED');
            if (!connectionRepository?.listOrganizationConnections) {
                return res.status(200).set('cache-control', 'no-store').json({
                    provider, status: 'unknown', connected: null, account: null,
                    reason: 'connection_state_unavailable'
                });
            }
            const rows = await connectionRepository.listOrganizationConnections({
                tenant_id: access.tenantId,
                provider
            });
            const current = Array.isArray(rows) ? rows[0] : null;
            const status = !current
                ? { status: 'unknown', connected: null, account: null }
                : provider === 'slack'
                    ? await verifiedSlackStatus({ row: current, controlPlane, tenantId: access.tenantId })
                    : await verifiedGitHubStatus({
                        row: current,
                        tenantId: access.tenantId,
                        githubAppSlug,
                        githubAppVerifier,
                        githubCredentialStore
                    });
            return res.status(200).set('cache-control', 'no-store').json({
                provider,
                ...status
            });
        } catch {
            return problem(res, 503, 'CONNECTION_STATE_UNAVAILABLE');
        }
    });

    router.post('/:provider/start', async (req, res) => {
        const { provider } = req.params;
        if (!PROVIDERS.has(provider)) return problem(res, 404, 'PROVIDER_NOT_SUPPORTED');
        try {
            const access = await authorized(req);
            if (!access) return problem(res, 403, 'ORGANIZATION_ADMIN_REQUIRED');
            const body = safeBody(req);
            if (provider === 'slack') {
                if (!controlPlane?.authorizeBinding || !oauthFlow?.createAuthorization
                    || typeof appId !== 'string' || appId.length === 0) {
                    return problem(res, 503, 'SLACK_AUTHORIZATION_UNAVAILABLE');
                }
                const existingRows = connectionRepository?.listOrganizationConnections
                    ? await connectionRepository.listOrganizationConnections({
                        tenant_id: access.tenantId,
                        provider: 'slack'
                    }) : [];
                const current = Array.isArray(existingRows)
                    ? existingRows.find((row) => ['active', 'pending', 'reauth_required'].includes(row?.status))
                    : null;
                if (body.expected_connection_revision !== undefined && current
                    && String(body.expected_connection_revision) !== String(current.connection_revision)) {
                    return problem(res, 409, 'WORKSPACE_CONNECTION_STALE_REVISION');
                }
                const expectedRevision = current?.connection_revision ?? body.expected_connection_revision;
                const binding = validateSlackInstallationBinding({
                    installation_intent_id: generateCanonicalId('insi'),
                    tenant_id: access.tenantId,
                    app_id: appId,
                    ...(body.expected_workspace_id ? { expected_workspace_id: body.expected_workspace_id } : {}),
                    ...(body.expected_enterprise_id ? { expected_enterprise_id: body.expected_enterprise_id } : {}),
                    initiated_by_person_id: access.personId,
                    ...(expectedRevision !== undefined && expectedRevision !== null
                        ? { expected_connection_revision: String(expectedRevision) } : {})
                });
                const authorizedBinding = await controlPlane.authorizeBinding(binding);
                const authorization = oauthFlow.createAuthorization(authorizedBinding);
                if (typeof authorization?.authorization_url !== 'string') {
                    return problem(res, 503, 'SLACK_AUTHORIZATION_UNAVAILABLE');
                }
                return res.status(200).set('cache-control', 'no-store').json({
                    provider, status: 'authorization_required',
                    url: authorization.authorization_url,
                    redirect_uri: authorization.redirect_uri ?? null
                });
            }

            if (!validGitHubAppSlug(githubAppSlug)) {
                return problem(res, 503, 'GITHUB_APP_NOT_CONFIGURED');
            }
            if (!hasGitHubConnectionPorts({
                githubAppVerifier, githubCredentialStore, githubAuthorizationLedger, connectionRepository
            })) return problem(res, 503, 'GITHUB_APP_CONNECTION_UNAVAILABLE');
            const state = stateRecord({
                tenantId: access.tenantId,
                personId: access.personId,
                secret: githubStateSecret,
                now
            });
            if (!state) return problem(res, 503, 'GITHUB_STATE_SIGNING_NOT_CONFIGURED');
            const stateRecordForStore = { ...state };
            delete stateRecordForStore.signed_state;
            const issued = await githubAuthorizationLedger.issue(stateRecordForStore);
            if (issued !== true) return problem(res, 503, 'GITHUB_STATE_STORE_UNAVAILABLE');
            const authorizationUrl = new URL(`/apps/${githubAppSlug}/installations/new`, 'https://github.com');
            authorizationUrl.searchParams.set('state', state.signed_state);
            return res.status(200).set('cache-control', 'no-store').json({
                provider, status: 'authorization_required', url: authorizationUrl.toString()
            });
        } catch (error) {
            if (error instanceof ContractError) return problem(res, error.status, error.code);
            return problem(res, 503, 'AUTHORIZATION_START_UNAVAILABLE');
        }
    });
    return router;
}
