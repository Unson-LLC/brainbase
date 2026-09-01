import { ContractError } from './errors.js';

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const BODY_ENCODINGS = new Set(['none', 'json', 'utf8', 'base64']);
const RESPONSE_ENCODINGS = new Set(['json', 'utf8', 'base64']);
const CREDENTIAL_PLACEMENTS = new Set(['none', 'bearer', 'basic', 'x-api-key', 'xc-token', 'url']);
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const MAX_CONFIGURED_BYTES = 64 * 1024 * 1024;
const OPERATION_FIELDS = new Set([
    'method', 'path', 'path_params', 'query', 'body_encoding', 'response_encoding',
    'credential_placement', 'credential_username', 'fixed_headers', 'credential_url_hosts',
    'service_bearer_env',
    'allow_binding_provider_mismatch',
    'credential_url_path_pattern', 'target_url_hosts', 'target_url_path_pattern',
    'max_request_bytes', 'max_response_bytes'
]);
const REQUEST_FIELDS = new Set(['path_params', 'query', 'body', 'target_url', 'idempotency_key']);
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;
const PROHIBITED_FIXED_HEADERS = new Set([
    'authorization', 'x-api-key', 'xc-token', 'cookie', 'host', 'content-length',
    'transfer-encoding', 'connection', 'proxy-authorization', 'idempotency-key'
]);

function failSchema() {
    throw new ContractError('SCHEMA_INVALID', { status: 400, fault_domain: 'protocol' });
}

function failScope(reason, context = {}) {
    console.error(JSON.stringify({
        event: 'credential_lease_scope_mismatch',
        scope_reason: reason,
        ...context
    }));
    throw new ContractError('CREDENTIAL_LEASE_SCOPE_MISMATCH', {
        status: 403,
        details: { scope_reason: reason }
    });
}

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function assertTrustedProviderForwardRequest(request) {
    if (!isObject(request)
        || Object.keys(request).some((field) => !REQUEST_FIELDS.has(field))
        || (Object.hasOwn(request, 'idempotency_key')
            && (typeof request.idempotency_key !== 'string'
                || !IDEMPOTENCY_KEY.test(request.idempotency_key)))) {
        failSchema();
    }
    return request;
}

function parseJsonObject(value, name) {
    if (!value) return {};
    let parsed;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error(`${name} must be valid JSON`);
    }
    if (!isObject(parsed)) throw new Error(`${name} must be a JSON object`);
    return parsed;
}

function isLocalhost(url) {
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
}

function parseEndpoint(endpoint, { allowInsecureLocalhost, name = 'Trusted provider endpoint' } = {}) {
    let url;
    try {
        url = new URL(endpoint);
    } catch {
        throw new Error(`${name} must be an absolute HTTPS URL`);
    }
    if (url.protocol !== 'https:' && !(allowInsecureLocalhost && url.protocol === 'http:' && isLocalhost(url))) {
        throw new Error(`${name} must use HTTPS`);
    }
    if (url.username || url.password || url.hash) {
        throw new Error(`${name} must not contain credentials or a fragment`);
    }
    return url;
}

function compilePattern(value, name) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
        throw new Error(`${name} pattern is invalid`);
    }
    try {
        return new RegExp(value, 'u');
    } catch {
        throw new Error(`${name} pattern is invalid`);
    }
}

function normalizeByteLimit(value, name) {
    if (value === undefined) return DEFAULT_MAX_BYTES;
    if (!Number.isInteger(value) || value < 1 || value > MAX_CONFIGURED_BYTES) {
        throw new Error(`${name} is invalid`);
    }
    return value;
}

function normalizePathParams(definition, path) {
    const input = definition ?? {};
    if (!isObject(input)) throw new Error('Trusted provider path parameter configuration is invalid');
    const placeholders = [...path.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu)].map((match) => match[1]);
    if (new Set(placeholders).size !== placeholders.length
        || placeholders.some((name) => !Object.hasOwn(input, name))
        || Object.keys(input).some((name) => !placeholders.includes(name))) {
        throw new Error('Trusted provider path parameter configuration is invalid');
    }
    return Object.freeze(Object.fromEntries(Object.entries(input).map(([name, spec]) => {
        if (!isObject(spec) || Object.keys(spec).some((field) => !['pattern', 'allow_slash'].includes(field))
            || (spec.allow_slash !== undefined && typeof spec.allow_slash !== 'boolean')) {
            throw new Error('Trusted provider path parameter configuration is invalid');
        }
        return [name, Object.freeze({
            pattern: compilePattern(spec.pattern, `Path parameter ${name}`),
            allow_slash: spec.allow_slash === true
        })];
    })));
}

function normalizeQuery(definition) {
    const input = definition ?? {};
    if (!isObject(input)) throw new Error('Trusted provider query configuration is invalid');
    return Object.freeze(Object.fromEntries(Object.entries(input).map(([name, spec]) => {
        if (!/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(name) || !isObject(spec)
            || Object.keys(spec).some((field) => ![
                'type', 'pattern', 'enum', 'minimum', 'maximum', 'repeatable'
            ].includes(field))) {
            throw new Error('Trusted provider query configuration is invalid');
        }
        const type = spec.type ?? 'string';
        if (!['string', 'integer', 'boolean'].includes(type)
            || (spec.repeatable !== undefined && typeof spec.repeatable !== 'boolean')
            || (spec.enum !== undefined && (!Array.isArray(spec.enum) || spec.enum.length === 0))
            || (spec.minimum !== undefined && !Number.isInteger(spec.minimum))
            || (spec.maximum !== undefined && !Number.isInteger(spec.maximum))) {
            throw new Error('Trusted provider query configuration is invalid');
        }
        return [name, Object.freeze({
            type,
            pattern: spec.pattern === undefined ? null : compilePattern(spec.pattern, `Query ${name}`),
            enum: spec.enum === undefined ? null : Object.freeze([...spec.enum]),
            minimum: spec.minimum,
            maximum: spec.maximum,
            repeatable: spec.repeatable === true
        })];
    })));
}

function normalizeHeaders(definition) {
    const input = definition ?? {};
    if (!isObject(input)) throw new Error('Trusted provider fixed header configuration is invalid');
    const headers = {};
    for (const [rawName, value] of Object.entries(input)) {
        const name = rawName.toLowerCase();
        if (!/^[a-z0-9-]+$/u.test(name) || PROHIBITED_FIXED_HEADERS.has(name)
            || typeof value !== 'string' || value.length === 0 || value.includes('\n') || value.includes('\r')) {
            throw new Error('Trusted provider fixed header configuration is invalid');
        }
        headers[name] = value;
    }
    return Object.freeze(headers);
}

function normalizeHosts(value, name) {
    if (value === undefined) return Object.freeze([]);
    if (!Array.isArray(value) || value.length === 0
        || value.some((host) => typeof host !== 'string' || !/^[A-Za-z0-9.-]+$/u.test(host))) {
        throw new Error(`${name} is invalid`);
    }
    return Object.freeze(value.map((host) => host.toLowerCase()));
}

function normalizeOperation(name, definition, { hasBaseUrl, env }) {
    if (!name || !isObject(definition)
        || Object.keys(definition).some((field) => !OPERATION_FIELDS.has(field))) {
        throw new Error('Trusted provider operation configuration is invalid');
    }
    const method = definition.method?.toUpperCase();
    const path = definition.path;
    const bodyEncoding = definition.body_encoding;
    const responseEncoding = definition.response_encoding;
    const credentialPlacement = definition.credential_placement;
    const credentialUsername = definition.credential_username;
    const allowBindingProviderMismatch = definition.allow_binding_provider_mismatch === true;
    const serviceBearerEnv = definition.service_bearer_env;
    if (!METHODS.has(method) || typeof path !== 'string' || !path.startsWith('/')
        || path.includes('?') || path.includes('#') || path.includes('\\')
        || !BODY_ENCODINGS.has(bodyEncoding) || !RESPONSE_ENCODINGS.has(responseEncoding)
        || !CREDENTIAL_PLACEMENTS.has(credentialPlacement)
        || (definition.allow_binding_provider_mismatch !== undefined
            && typeof definition.allow_binding_provider_mismatch !== 'boolean')
        || (allowBindingProviderMismatch && credentialPlacement !== 'none')
        || (serviceBearerEnv !== undefined
            && (credentialPlacement !== 'none' || !ENV_NAME.test(serviceBearerEnv)))
        || (credentialPlacement === 'basic'
            && (typeof credentialUsername !== 'string' || credentialUsername.length === 0
                || credentialUsername.length > 128 || /[:\r\n]/u.test(credentialUsername)))
        || (credentialPlacement !== 'basic' && credentialUsername !== undefined)
        || (['GET', 'HEAD'].includes(method) && bodyEncoding !== 'none')) {
        throw new Error('Trusted provider operation configuration is invalid');
    }
    const credentialUrlHosts = normalizeHosts(definition.credential_url_hosts, 'Credential URL host allowlist');
    const targetUrlHosts = normalizeHosts(definition.target_url_hosts, 'Target URL host allowlist');
    if (credentialPlacement === 'url' && credentialUrlHosts.length === 0) {
        throw new Error('Credential URL operations require a host allowlist');
    }
    if (!hasBaseUrl && credentialPlacement !== 'url' && targetUrlHosts.length === 0) {
        throw new Error('Trusted provider base URL is required');
    }
    return Object.freeze({
        method,
        path,
        path_params: normalizePathParams(definition.path_params, path),
        query: normalizeQuery(definition.query),
        body_encoding: bodyEncoding,
        response_encoding: responseEncoding,
        credential_placement: credentialPlacement,
        credential_username: credentialUsername ?? null,
        service_bearer: serviceBearerEnv === undefined
            ? null
            : (() => {
                const value = env?.[serviceBearerEnv];
                if (typeof value !== 'string' || value.length === 0) {
                    throw new Error('Trusted provider service bearer configuration is invalid');
                }
                return Buffer.from(value, 'utf8');
            })(),
        allow_binding_provider_mismatch: allowBindingProviderMismatch,
        fixed_headers: normalizeHeaders(definition.fixed_headers),
        credential_url_hosts: credentialUrlHosts,
        credential_url_path_pattern: definition.credential_url_path_pattern === undefined
            ? null
            : compilePattern(definition.credential_url_path_pattern, 'Credential URL path'),
        target_url_hosts: targetUrlHosts,
        target_url_path_pattern: definition.target_url_path_pattern === undefined
            ? null
            : compilePattern(definition.target_url_path_pattern, 'Target URL path'),
        max_request_bytes: normalizeByteLimit(definition.max_request_bytes, 'max_request_bytes'),
        max_response_bytes: normalizeByteLimit(definition.max_response_bytes, 'max_response_bytes')
    });
}

function assertPathValue(value, spec) {
    if (typeof value !== 'string' || value.length === 0 || !spec.pattern.test(value)) failSchema();
    const segments = spec.allow_slash ? value.split('/') : [value];
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) failSchema();
    return segments.map((segment) => encodeURIComponent(segment)).join('/');
}

function validateQueryValue(value, spec) {
    if (spec.type === 'integer' && !Number.isInteger(value)) failSchema();
    if (spec.type === 'boolean' && typeof value !== 'boolean') failSchema();
    if (spec.type === 'string' && typeof value !== 'string') failSchema();
    if (spec.minimum !== undefined && value < spec.minimum) failSchema();
    if (spec.maximum !== undefined && value > spec.maximum) failSchema();
    if (spec.enum && !spec.enum.includes(value)) failSchema();
    if (spec.pattern && !spec.pattern.test(String(value))) failSchema();
    return String(value);
}

function validateQuery(query, definitions) {
    const input = query ?? {};
    if (!isObject(input) || Object.keys(input).some((name) => !Object.hasOwn(definitions, name))) failSchema();
    const result = [];
    for (const [name, value] of Object.entries(input)) {
        const spec = definitions[name];
        const values = Array.isArray(value) ? value : [value];
        if ((Array.isArray(value) && !spec.repeatable) || values.length === 0) failSchema();
        for (const child of values) result.push([name, validateQueryValue(child, spec)]);
    }
    return result;
}

function validateExistingQuery(url, definitions) {
    for (const [name, value] of url.searchParams.entries()) {
        const spec = definitions[name];
        if (!spec) failScope('path_parameter_not_allowed');
        validateQueryValue(value, { ...spec, type: 'string' });
    }
}

function encodeRequestBody(body, operation) {
    switch (operation.body_encoding) {
    case 'none':
        if (body !== undefined && body !== null) failSchema();
        return undefined;
    case 'json': {
        if (!isObject(body)) failSchema();
        const encoded = JSON.stringify(body);
        if (Buffer.byteLength(encoded) > operation.max_request_bytes) failSchema();
        return encoded;
    }
    case 'utf8':
        if (typeof body !== 'string' || Buffer.byteLength(body) > operation.max_request_bytes) failSchema();
        return body;
    case 'base64': {
        if (typeof body !== 'string' || body.length % 4 !== 0
            || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(body)) failSchema();
        const decoded = Buffer.from(body, 'base64');
        if (decoded.length > operation.max_request_bytes) failSchema();
        return decoded;
    }
    default:
        failSchema();
    }
}

function validateTargetUrl(rawUrl, hosts, pathPattern, { allowInsecureLocalhost }) {
    const url = parseEndpoint(rawUrl, { allowInsecureLocalhost, name: 'Trusted target URL' });
    if (!hosts.includes(url.hostname.toLowerCase()) || (pathPattern && !pathPattern.test(url.pathname))) {
        failScope('target_url_not_allowed');
    }
    return url;
}

function buildTargetUrl({ baseUrl, operation, request, credential, allowInsecureLocalhost }) {
    let url;
    if (operation.credential_placement === 'url') {
        url = validateTargetUrl(
            credential.toString('utf8'),
            operation.credential_url_hosts,
            operation.credential_url_path_pattern,
            { allowInsecureLocalhost }
        );
        if (request.target_url !== undefined) failSchema();
    } else if (request.target_url !== undefined) {
        if (operation.target_url_hosts.length === 0 || typeof request.target_url !== 'string') failSchema();
        url = validateTargetUrl(
            request.target_url,
            operation.target_url_hosts,
            operation.target_url_path_pattern,
            { allowInsecureLocalhost }
        );
    } else {
        if (!baseUrl) failScope('provider_base_url_unavailable');
        url = new URL(baseUrl.toString());
        const supplied = request.path_params ?? {};
        if (!isObject(supplied)
            || Object.keys(supplied).some((name) => !Object.hasOwn(operation.path_params, name))
            || Object.keys(operation.path_params).some((name) => !Object.hasOwn(supplied, name))) failSchema();
        const expanded = operation.path.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu, (_match, name) => (
            assertPathValue(supplied[name], operation.path_params[name])
        ));
        url.pathname = `${url.pathname.replace(/\/$/u, '')}${expanded}`;
    }
    if (url.search && request.query !== undefined) failSchema();
    if (url.search) {
        validateExistingQuery(url, operation.query);
    } else {
        for (const [name, value] of validateQuery(request.query, operation.query)) {
            url.searchParams.append(name, value);
        }
    }
    return url.toString();
}

async function readBody(response, operation) {
    const contentType = response.headers?.get?.('content-type') ?? null;
    try {
        if (operation.response_encoding === 'json') {
            const body = await response.json();
            if (Buffer.byteLength(JSON.stringify(body)) > operation.max_response_bytes) throw new Error('too large');
            return { body, contentType };
        }
        if (operation.response_encoding === 'utf8') {
            const body = await response.text();
            if (Buffer.byteLength(body) > operation.max_response_bytes) throw new Error('too large');
            return { body: body.length === 0 ? null : body, contentType };
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > operation.max_response_bytes) throw new Error('too large');
        return { body: bytes.toString('base64'), contentType };
    } catch {
        throw new ContractError('UPSTREAM_INVALID_RESPONSE', {
            status: 502,
            retryable: false,
            fault_domain: 'external_provider'
        });
    }
}

function containsCredentialEcho(value, credential, additional = []) {
    const encodings = [...new Set([
        credential.toString('utf8'),
        credential.toString('base64'),
        credential.toString('base64url'),
        credential.toString('hex'),
        ...additional
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
    baseUrl,
    operations,
    fetchImpl = globalThis.fetch,
    allowInsecureLocalhost = false,
    env = process.env
} = {}) {
    if (typeof provider !== 'string' || provider.length === 0 || !isObject(operations)
        || Object.keys(operations).length === 0 || typeof fetchImpl !== 'function') {
        throw new Error('Trusted provider forwarder configuration is invalid');
    }
    const trustedBaseUrl = baseUrl === undefined
        ? null
        : parseEndpoint(baseUrl, { allowInsecureLocalhost, name: 'Trusted provider base URL' });
    if (trustedBaseUrl?.search) throw new Error('Trusted provider base URL must not contain a query');
    const operationAllowlist = Object.freeze(Object.fromEntries(
        Object.entries(operations).map(([name, definition]) => [
            name,
            normalizeOperation(name, definition, { hasBaseUrl: Boolean(trustedBaseUrl), env })
        ])
    ));
    return Object.freeze({
        provider,
        requiresCredential(operation) {
            return operationAllowlist[operation]?.credential_placement !== 'none';
        },
        allowsBindingProviderMismatch(operation) {
            return operationAllowlist[operation]?.allow_binding_provider_mismatch === true;
        },
        async forward({ credential, operation, request }) {
            const definition = operationAllowlist[operation];
            if (!definition) failScope('provider_operation_not_allowed', {
                provider,
                provider_operation: operation
            });
            assertTrustedProviderForwardRequest(request);
            if ((!Buffer.isBuffer(credential) || credential.length === 0)
                && definition.credential_placement !== 'none') {
                failScope('credential_material_empty', {
                    provider,
                    provider_operation: operation
                });
            }
            const body = encodeRequestBody(request.body, definition);
            const targetUrl = buildTargetUrl({
                baseUrl: trustedBaseUrl,
                operation: definition,
                request,
                credential,
                allowInsecureLocalhost
            });
            const headers = {
                ...definition.fixed_headers,
                'brainbase-provider-operation': operation
            };
            if (request.idempotency_key !== undefined) {
                headers['Idempotency-Key'] = request.idempotency_key;
            }
            const additionalCredentialEncodings = [];
            if (definition.service_bearer) {
                headers.authorization = `Bearer ${definition.service_bearer.toString('utf8')}`;
                additionalCredentialEncodings.push(
                    definition.service_bearer,
                    definition.service_bearer.toString('utf8'),
                    headers.authorization
                );
            }
            if (body !== undefined && !headers['content-type']) {
                headers['content-type'] = definition.body_encoding === 'json'
                    ? 'application/json'
                    : definition.body_encoding === 'utf8'
                        ? 'text/plain; charset=utf-8'
                        : 'application/octet-stream';
            }
            if (definition.credential_placement === 'bearer') {
                headers.authorization = `Bearer ${credential.toString('utf8')}`;
            } else if (definition.credential_placement === 'basic') {
                headers.authorization = `Basic ${Buffer.from(
                    `${definition.credential_username}:${credential.toString('utf8')}`,
                    'utf8'
                ).toString('base64')}`;
                additionalCredentialEncodings.push(headers.authorization);
            } else if (definition.credential_placement === 'x-api-key') {
                headers['x-api-key'] = credential.toString('utf8');
            } else if (definition.credential_placement === 'xc-token') {
                headers['xc-token'] = credential.toString('utf8');
            }
            let response;
            try {
                response = await fetchImpl(targetUrl, {
                    method: definition.method,
                    headers,
                    ...(body === undefined ? {} : { body }),
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
            const { body: responseBody, contentType } = await readBody(response, definition);
            if (containsCredentialEcho(responseBody, credential, additionalCredentialEncodings)) {
                throw new ContractError('UPSTREAM_INVALID_RESPONSE', {
                    status: 502,
                    retryable: false,
                    fault_domain: 'external_provider'
                });
            }
            return {
                status: response.status,
                response_encoding: definition.response_encoding,
                content_type: contentType,
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
        if (!audience || !isObject(definition)
            || Object.keys(definition).some((field) => !['provider', 'base_url', 'operations'].includes(field))) {
            throw new Error('Tenant provider forwarder configuration is invalid');
        }
        return [audience, createTrustedHttpProviderForwarder({
            provider: definition.provider,
            baseUrl: definition.base_url,
            operations: definition.operations,
            fetchImpl,
            env
        })];
    })));
}
