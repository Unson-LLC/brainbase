// @ts-check

export class FreeeReadPolicyError extends Error {
    constructor(code, { status = 403, details = {} } = {}) {
        super(code);
        this.name = 'FreeeReadPolicyError';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

const TOOL = 'freee_api_get';
const SERVICE = 'accounting';
const MAX_PAGE_LIMIT = 100;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REQUESTS_PER_MINUTE = 30;
const TOOL_CALL_FIELDS = new Set(['name', 'arguments']);
const ARGUMENT_FIELDS = new Set(['service', 'path', 'query']);
const COLLECTION_PATHS = new Set([
    '/api/1/invoices',
    '/api/1/deals',
    '/api/1/partners'
]);
const ALLOWED_PATHS = Object.freeze([
    /^\/api\/1\/invoices$/u,
    /^\/api\/1\/invoices\/[1-9][0-9]{0,18}$/u,
    /^\/api\/1\/deals$/u,
    /^\/api\/1\/deals\/[1-9][0-9]{0,18}$/u,
    /^\/api\/1\/partners$/u,
    /^\/api\/1\/partners\/[1-9][0-9]{0,18}$/u
]);

function invalid(code, options) {
    throw new FreeeReadPolicyError(code, options);
}

function plainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
    return Object.keys(value).every((key) => allowed.has(key));
}

function positiveInteger(value, field) {
    const numeric = typeof value === 'string' && /^[0-9]+$/u.test(value)
        ? Number(value)
        : value;
    if (!Number.isSafeInteger(numeric) || numeric <= 0) {
        invalid('FREEE_READ_POLICY_INVALID', { status: 400, details: { field } });
    }
    return numeric;
}

function assertResolvedCredential(credential) {
    if (!plainObject(credential)
        || !Object.isFrozen(credential)
        || credential.service !== 'freee'
        || credential.purpose !== 'runtime_read'
        || credential.credential_mode !== 'customer_oauth'
        || !Array.isArray(credential.capabilities)
        || !credential.capabilities.includes('read')
        || typeof credential.tenant_id !== 'string' || !credential.tenant_id
        || typeof credential.account_id !== 'string' || !credential.account_id) {
        invalid('FREEE_RESOLVED_CREDENTIAL_INVALID', { status: 500 });
    }
    return positiveInteger(credential.company_id, 'resolved_company_id');
}

function normalizeQuery(query, path, companyId) {
    if (query !== undefined && !plainObject(query)) {
        invalid('FREEE_QUERY_INVALID', { status: 400 });
    }
    const source = query ?? {};
    const allowed = COLLECTION_PATHS.has(path)
        ? new Set(['company_id', 'limit'])
        : new Set(['company_id']);

    for (const key of Object.keys(source)) {
        if (!allowed.has(key)) {
            invalid('FREEE_QUERY_INVALID', { status: 400, details: { field: key } });
        }
    }

    const normalized = {};
    if (source.company_id !== undefined
        && positiveInteger(source.company_id, 'company_id') !== companyId) {
        invalid('FREEE_COMPANY_MISMATCH', { status: 403 });
    }
    normalized.company_id = companyId;

    if (COLLECTION_PATHS.has(path)) {
        if (source.limit === undefined) {
            normalized.limit = DEFAULT_PAGE_LIMIT;
        } else {
            const limit = positiveInteger(source.limit, 'limit');
            if (limit > MAX_PAGE_LIMIT) {
                invalid('FREEE_PAGE_LIMIT_EXCEEDED', {
                    status: 400,
                    details: { max_limit: MAX_PAGE_LIMIT }
                });
            }
            normalized.limit = limit;
        }
    }

    return normalized;
}

function authorizeToolCall({ credential, toolCall }) {
    const companyId = assertResolvedCredential(credential);
    if (!plainObject(toolCall) || !hasOnlyKeys(toolCall, TOOL_CALL_FIELDS)) {
        invalid('FREEE_TOOL_CALL_INVALID', { status: 400 });
    }
    const toolName = toolCall.name;
    const args = toolCall.arguments;
    if (toolName !== TOOL) invalid('FREEE_TOOL_FORBIDDEN');
    if (!plainObject(args) || !hasOnlyKeys(args, ARGUMENT_FIELDS)) {
        invalid('FREEE_TOOL_ARGUMENTS_INVALID', { status: 400 });
    }

    const service = args.service;
    const path = args.path;
    const query = args.query;

    if (service !== SERVICE) {
        invalid('FREEE_SERVICE_FORBIDDEN', { details: { service: service ?? null } });
    }
    if (typeof path !== 'string' || !path.startsWith('/') || path.includes('?') || path.includes('#')) {
        invalid('FREEE_PATH_INVALID', { status: 400 });
    }
    if (!ALLOWED_PATHS.some((pattern) => pattern.test(path))) {
        invalid('FREEE_PATH_FORBIDDEN', { details: { path } });
    }

    return Object.freeze({
        service: SERVICE,
        path,
        query: Object.freeze(normalizeQuery(query, path, companyId))
    });
}

async function consumeRateLimit({ rateLimiter, credential }) {
    if (!rateLimiter || typeof rateLimiter.consume !== 'function') {
        invalid('FREEE_RATE_LIMITER_UNAVAILABLE', { status: 503 });
    }
    const allowed = await rateLimiter.consume({
        key: JSON.stringify([credential.tenant_id, credential.account_id]),
        limit: MAX_REQUESTS_PER_MINUTE,
        window_ms: 60_000
    });
    if (allowed !== true) invalid('FREEE_RATE_LIMITED', { status: 429 });
}

function sanitizedResponseHeaders(source, bodySize = null) {
    const headers = new Headers();
    const contentType = source.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    if (bodySize !== null) headers.set('content-length', String(bodySize));
    return headers;
}

async function limitResponse(response, maxBytes) {
    if (!response || typeof response !== 'object'
        || typeof response.status !== 'number'
        || !response.headers || typeof response.headers.get !== 'function') {
        invalid('FREEE_UPSTREAM_RESPONSE_INVALID', { status: 502 });
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_RESPONSE_BYTES) {
        invalid('FREEE_RESPONSE_LIMIT_INVALID', { status: 500 });
    }

    if (!response.body) {
        return new Response(null, {
            status: response.status,
            statusText: response.statusText,
            headers: sanitizedResponseHeaders(response.headers)
        });
    }

    const declaredRaw = response.headers.get('content-length');
    const declared = declaredRaw === null ? null : Number(declaredRaw);
    if (Number.isFinite(declared) && declared > maxBytes) {
        invalid('FREEE_RESPONSE_TOO_LARGE', { status: 502, details: { max_bytes: maxBytes } });
    }

    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
            await reader.cancel();
            invalid('FREEE_RESPONSE_TOO_LARGE', { status: 502, details: { max_bytes: maxBytes } });
        }
        chunks.push(value);
    }

    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new Response(merged, {
        status: response.status,
        statusText: response.statusText,
        headers: sanitizedResponseHeaders(response.headers, size)
    });
}

/**
 * Single fail-closed entrypoint for one freee API read tool call.
 *
 * The caller must invoke this once per JSON-RPC tools/call item. Batch requests
 * therefore consume rate-limit budget per call, not per HTTP request.
 */
export async function executeFreeeRead({
    credential,
    toolCall,
    rateLimiter,
    invoke,
    maxResponseBytes = MAX_RESPONSE_BYTES
}) {
    if (typeof invoke !== 'function') {
        invalid('FREEE_INVOKER_UNAVAILABLE', { status: 503 });
    }
    const authorizedCall = authorizeToolCall({ credential, toolCall });
    await consumeRateLimit({ rateLimiter, credential });
    const response = await invoke(authorizedCall);
    return limitResponse(response, maxResponseBytes);
}

export const FREEE_READ_SAFETY_POLICY = Object.freeze({
    tool: TOOL,
    service: SERVICE,
    max_page_limit: MAX_PAGE_LIMIT,
    default_page_limit: DEFAULT_PAGE_LIMIT,
    max_response_bytes: MAX_RESPONSE_BYTES,
    max_requests_per_minute: MAX_REQUESTS_PER_MINUTE,
    allowed_paths: Object.freeze([
        '/api/1/invoices',
        '/api/1/invoices/{id}',
        '/api/1/deals',
        '/api/1/deals/{id}',
        '/api/1/partners',
        '/api/1/partners/{id}'
    ]),
    allowed_collection_query_keys: Object.freeze(['company_id', 'limit']),
    allowed_detail_query_keys: Object.freeze(['company_id'])
});
