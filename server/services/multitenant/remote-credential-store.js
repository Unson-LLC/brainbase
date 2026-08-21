const MAX_CREDENTIAL_BYTES = 64 * 1024;

function required(env, names) {
    for (const name of names) {
        const value = env?.[name];
        if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
    return null;
}

function configuration(env) {
    const url = required(env, [
        'BRAINBASE_TENANT_CREDENTIAL_STORE_URL',
        'BRAINBASE_SLACK_CREDENTIAL_STORE_URL'
    ]);
    const token = required(env, [
        'BRAINBASE_TENANT_CREDENTIAL_STORE_SERVICE_TOKEN',
        'BRAINBASE_SLACK_CREDENTIAL_STORE_TOKEN'
    ]);
    if (!url || !token) throw new Error('tenant_credential_store_configuration_required');
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error('tenant_credential_store_configuration_invalid');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('tenant_credential_store_configuration_invalid');
    }
    return { url: parsed, token };
}

function endpointForOperation(base, operation) {
    const endpoint = new URL(base.toString());
    const path = endpoint.pathname.replace(/\/+$/u, '');
    if (path === '' || path === '/' || path === '/api/v1/credentials') {
        endpoint.pathname = `${path === '/' ? '' : path}/api/v1/credentials/${operation}`
            .replace(/\/api\/v1\/credentials\/api\/v1\/credentials/u, '/api/v1/credentials');
    }
    return endpoint.toString();
}

function isCanonicalEndpoint(base) {
    const path = base.pathname.replace(/\/+$/u, '');
    return path === '' || path === '/api/v1/credentials';
}

function parseJson(text) {
    try {
        return text ? JSON.parse(text) : {};
    } catch {
        throw new Error('tenant_credential_store_invalid');
    }
}

function assertResult(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body.result)) {
        throw new Error('tenant_credential_store_rejected');
    }
    if (!body.result || typeof body.result !== 'object') {
        throw new Error('tenant_credential_store_rejected');
    }
    return body.result;
}

function assertBinding(binding) {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)
        || ['tenant_id', 'connection_id', 'connection_revision', 'provider']
            .some((field) => typeof binding[field] !== 'string' && !Number.isInteger(binding[field]))) {
        throw new Error('tenant_credential_materialization_binding_required');
    }
    return {
        tenant_id: binding.tenant_id,
        connection_id: binding.connection_id,
        connection_revision: String(binding.connection_revision),
        provider: binding.provider
    };
}

function referenceInput(input) {
    const binding = assertBinding(input);
    if (typeof input?.credential_ref !== 'string' || input.credential_ref.length === 0) {
        throw new Error('tenant_credential_materialization_binding_required');
    }
    return {
        ...binding,
        credential_ref: input.credential_ref
    };
}

function legacyReferenceInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('tenant_credential_materialization_binding_required');
    }
    const fields = ['tenant_id', 'tenant_key', 'credential_ref', 'provider', 'workspace_id', 'app_id'];
    if (fields.some((field) => typeof input[field] !== 'string' || input[field].length === 0)) {
        throw new Error('tenant_credential_materialization_binding_required');
    }
    return Object.fromEntries(fields.map((field) => [field, input[field]]));
}

function createClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    const { url, token } = configuration(env);
    if (typeof fetchImpl !== 'function') throw new Error('tenant_credential_store_configuration_required');
    async function call(operation, input) {
        let response;
        try {
            response = await fetchImpl(endpointForOperation(url, operation), {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${token}`,
                    'content-type': 'application/json',
                    accept: 'application/json'
                },
                body: JSON.stringify({ operation, ...input })
            });
        } catch {
            throw new Error('tenant_credential_store_unavailable');
        }
        let body;
        try {
            body = parseJson(await response.text());
        } catch (error) {
            if (error?.message === 'tenant_credential_store_invalid') throw error;
            throw new Error('tenant_credential_store_invalid');
        }
        if (!response.ok) throw new Error('tenant_credential_store_rejected');
        return assertResult(body);
    }
    return { call, strict: isCanonicalEndpoint(url) };
}

export function isRemoteCredentialStoreConfigured(env = process.env) {
    return Boolean(
        required(env, ['BRAINBASE_TENANT_CREDENTIAL_STORE_URL', 'BRAINBASE_SLACK_CREDENTIAL_STORE_URL'])
        && required(env, [
            'BRAINBASE_TENANT_CREDENTIAL_STORE_SERVICE_TOKEN',
            'BRAINBASE_SLACK_CREDENTIAL_STORE_TOKEN'
        ])
    );
}

export function createRemoteCredentialStore({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    const { call, strict } = createClient({ env, fetchImpl });
    return {
        store(input) {
            return call('store', input);
        },
        verify(input) {
            return call('verify', strict ? referenceInput(input) : legacyReferenceInput(input));
        },
        revoke(input) {
            const reference = strict ? referenceInput(input) : legacyReferenceInput(input);
            return call('revoke', { ...reference, ...(input.reason === undefined ? {} : { reason: input.reason }) });
        },
        materialize(credentialRef, binding) {
            if (typeof credentialRef !== 'string' || credentialRef.length === 0) {
                throw new Error('tenant_credential_materialization_binding_required');
            }
            return call('materialize', {
                ...assertBinding(binding),
                credential_ref: credentialRef
            });
        }
    };
}

export function createRemoteCredentialMaterializer({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    const store = createRemoteCredentialStore({ env, fetchImpl });
    return {
        async materialize(credentialRef, binding) {
            const result = await store.materialize(credentialRef, binding);
            if (typeof result.credential_material !== 'string'
                || Buffer.byteLength(result.credential_material, 'utf8') > MAX_CREDENTIAL_BYTES) {
                throw new Error('tenant_credential_store_invalid');
            }
            return Buffer.from(result.credential_material, 'utf8');
        }
    };
}

export { MAX_CREDENTIAL_BYTES };
