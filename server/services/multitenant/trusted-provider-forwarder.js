import { ContractError } from './errors.js';

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

function parseJsonObject(value, name) {
    if (!value) return {};
    let parsed;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error(`${name} must be valid JSON`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${name} must be a JSON object`);
    }
    return parsed;
}

function isLocalhost(url) {
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
}

function parseEndpoint(endpoint, { allowInsecureLocalhost }) {
    let url;
    try {
        url = new URL(endpoint);
    } catch {
        throw new Error('Trusted provider endpoint must be an absolute HTTPS URL');
    }
    if (url.protocol !== 'https:' && !(allowInsecureLocalhost && url.protocol === 'http:' && isLocalhost(url))) {
        throw new Error('Trusted provider endpoint must use HTTPS');
    }
    if (url.username || url.password || url.hash) {
        throw new Error('Trusted provider endpoint must not contain credentials or a fragment');
    }
    return url.toString();
}

async function readBody(response) {
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (contentType.includes('application/json')) return response.json();
    const text = await response.text();
    return text.length === 0 ? null : { text };
}

function containsCredentialEcho(value, credential) {
    const encodings = [...new Set([
        credential.toString('utf8'),
        credential.toString('base64'),
        credential.toString('base64url'),
        credential.toString('hex')
    ].filter((candidate) => candidate.length >= 8))];
    const inspect = (child) => {
        if (typeof child === 'string') return encodings.some((candidate) => child.includes(candidate));
        if (Array.isArray(child)) return child.some(inspect);
        if (!child || typeof child !== 'object') return false;
        return Object.values(child).some(inspect);
    };
    return inspect(value);
}

export function createTrustedHttpProviderForwarder({
    provider,
    endpoint,
    allowedOperations,
    fetchImpl = globalThis.fetch,
    allowInsecureLocalhost = false
} = {}) {
    if (typeof provider !== 'string' || provider.length === 0
        || !Array.isArray(allowedOperations) || allowedOperations.length === 0
        || allowedOperations.some((operation) => typeof operation !== 'string' || operation.length === 0)
        || typeof fetchImpl !== 'function') {
        throw new Error('Trusted provider forwarder configuration is invalid');
    }
    const trustedEndpoint = parseEndpoint(endpoint, { allowInsecureLocalhost });
    const operationAllowlist = new Set(allowedOperations);
    return Object.freeze({
        provider,
        async forward({ credential, operation, body }) {
            if (!operationAllowlist.has(operation)
                || !Buffer.isBuffer(credential) || credential.length === 0
                || !body || typeof body !== 'object' || Array.isArray(body)) {
                throw new ContractError('CREDENTIAL_LEASE_SCOPE_MISMATCH', { status: 403 });
            }
            let response;
            try {
                response = await fetchImpl(trustedEndpoint, {
                    method: 'POST',
                    headers: {
                        authorization: `Bearer ${credential.toString('utf8')}`,
                        'content-type': 'application/json',
                        'brainbase-provider-operation': operation
                    },
                    body: JSON.stringify(body),
                    redirect: 'error'
                });
            } catch (error) {
                if (error instanceof ContractError) throw error;
                throw new ContractError('UPSTREAM_UNAVAILABLE', {
                    status: 503,
                    retryable: true,
                    fault_domain: 'external_provider'
                });
            }
            const responseBody = await readBody(response);
            if (containsCredentialEcho(responseBody, credential)) {
                throw new ContractError('UPSTREAM_INVALID_RESPONSE', {
                    status: 502,
                    retryable: false,
                    fault_domain: 'external_provider'
                });
            }
            return {
                status: response.status,
                body: responseBody
            };
        }
    });
}

export function createEnvCredentialMaterializer({ env = process.env } = {}) {
    const refs = parseJsonObject(
        env.BRAINBASE_TENANT_CREDENTIAL_ENV_REFS_JSON,
        'BRAINBASE_TENANT_CREDENTIAL_ENV_REFS_JSON'
    );
    for (const [credentialRef, envName] of Object.entries(refs)) {
        if (!credentialRef || typeof envName !== 'string' || !ENV_NAME.test(envName)) {
            throw new Error('Tenant credential env ref configuration is invalid');
        }
    }
    return Object.freeze({
        async materialize(credentialRef) {
            const envName = refs[credentialRef];
            const value = envName ? env[envName] : undefined;
            if (typeof value !== 'string' || value.length === 0) {
                throw new ContractError('CREDENTIAL_REF_UNKNOWN', { status: 403 });
            }
            return Buffer.from(value, 'utf8');
        }
    });
}

export function createTrustedProviderForwardersFromEnv({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    const config = parseJsonObject(
        env.BRAINBASE_TENANT_PROVIDER_FORWARDERS_JSON,
        'BRAINBASE_TENANT_PROVIDER_FORWARDERS_JSON'
    );
    return Object.freeze(Object.fromEntries(Object.entries(config).map(([audience, definition]) => {
        if (!audience || !definition || typeof definition !== 'object' || Array.isArray(definition)
            || Object.keys(definition).some((field) => !['provider', 'endpoint', 'allowed_operations'].includes(field))) {
            throw new Error('Tenant provider forwarder configuration is invalid');
        }
        return [audience, createTrustedHttpProviderForwarder({
            provider: definition.provider,
            endpoint: definition.endpoint,
            allowedOperations: definition.allowed_operations,
            fetchImpl
        })];
    })));
}
