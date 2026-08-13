import { randomUUID } from 'node:crypto';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PROTECTED_HEADERS = new Set([
    'authorization',
    'x-internal-api-key',
    'x-session-id',
    'x-csrf-token'
]);

export class BrainbaseHttpError extends Error {
    constructor({ method, path, status, payload }) {
        const detail = payload?.message || payload?.error || payload?.raw || 'unknown error';
        super(`${method} ${path} failed: ${status} ${detail}`);
        this.name = 'BrainbaseHttpError';
        this.status = status;
        this.payload = payload;
    }
}

function requiredString(value, name) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
    return value;
}

async function responsePayload(response) {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

function assertNoProtectedHeaders(headers) {
    for (const name of Object.keys(headers)) {
        if (PROTECTED_HEADERS.has(name.toLowerCase())) {
            throw new Error(`protected HTTP header cannot be overridden: ${name}`);
        }
    }
}

export function createBrainbaseHttpClient({
    baseUrl,
    accessToken,
    internalApiKey,
    fetchImpl = globalThis.fetch,
    sessionId = `brainbase-script-${randomUUID()}`
}) {
    const normalizedBaseUrl = requiredString(baseUrl, 'baseUrl').replace(/\/$/, '');
    const stableSessionId = requiredString(sessionId, 'sessionId');
    if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
    if (accessToken && internalApiKey) throw new Error('choose either accessToken or internalApiKey');

    const authHeaders = accessToken
        ? { Authorization: `Bearer ${requiredString(accessToken, 'accessToken')}` }
        : internalApiKey
            ? { 'x-internal-api-key': requiredString(internalApiKey, 'internalApiKey') }
            : {};
    let csrfToken = null;
    let csrfTokenPromise = null;

    async function send(path, { method, body, headers, auth }) {
        const startedAt = Date.now();
        const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
            method,
            headers: {
                Accept: 'application/json',
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                ...headers,
                ...(auth ? authHeaders : {})
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return {
            method,
            path,
            status: response.status,
            latencyMs: Date.now() - startedAt,
            headers: response.headers,
            payload: await responsePayload(response),
            ok: response.ok
        };
    }

    async function getCsrfToken() {
        if (csrfToken) return csrfToken;
        if (!csrfTokenPromise) {
            csrfTokenPromise = (async () => {
                const result = await send('/api/csrf-token', {
                    method: 'GET',
                    headers: { 'X-Session-Id': stableSessionId },
                    auth: true
                });
                if (!result.ok) throw new BrainbaseHttpError(result);
                const acquiredToken = requiredString(result.payload?.token, 'CSRF token');
                csrfToken = acquiredToken;
                return acquiredToken;
            })().finally(() => {
                csrfTokenPromise = null;
            });
        }
        return csrfTokenPromise;
    }

    return {
        async request(path, {
            method = 'GET',
            body,
            headers = {},
            auth = true,
            csrf = true,
            throwOnError = true
        } = {}) {
            assertNoProtectedHeaders(headers);
            const normalizedMethod = method.toUpperCase();
            const needsCsrf = csrf && MUTATION_METHODS.has(normalizedMethod);
            for (let attempt = 0; attempt < 2; attempt += 1) {
                const requestCsrfToken = needsCsrf ? await getCsrfToken() : null;
                const csrfHeaders = requestCsrfToken
                    ? { 'X-Session-Id': stableSessionId, 'X-CSRF-Token': requestCsrfToken }
                    : {};
                const result = await send(path, {
                    method: normalizedMethod,
                    body,
                    auth,
                    headers: { ...headers, ...csrfHeaders }
                });
                if (result.ok) return result;

                const csrfRejected = needsCsrf
                    && result.status === 403
                    && /csrf/i.test(String(result.payload?.message || result.payload?.error || ''));
                if (csrfRejected && attempt === 0) {
                    if (csrfToken === requestCsrfToken) csrfToken = null;
                    continue;
                }
                if (throwOnError) throw new BrainbaseHttpError(result);
                return result;
            }
            throw new Error('unreachable Brainbase HTTP request state');
        }
    };
}
