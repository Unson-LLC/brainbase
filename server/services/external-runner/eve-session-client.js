// @ts-check

const DEFAULT_TIMEOUT_MS = 30000;

function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/g, '');
}

function joinEveApiPath(baseUrl, apiPath) {
    const base = trimTrailingSlash(baseUrl);
    if (!base) return '';
    return `${base}${apiPath}`;
}

function pickContinuationToken(body) {
    return body?.continuationToken || body?.continuation_token || null;
}

function pickSessionId(response) {
    return response.headers?.get?.('x-eve-session-id') || null;
}

function normalizeTimeoutMs(value) {
    if (value === undefined || value === null || value === '') return DEFAULT_TIMEOUT_MS;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function ownKeys(input) {
    return input && typeof input === 'object' ? Object.keys(input) : [];
}

async function readResponseBody(response) {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return { text };
    }
}

function withTimeoutSignal(timeoutMs, outerSignal = null) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return {
            signal: outerSignal || undefined,
            clear: () => {}
        };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (outerSignal) {
        if (outerSignal.aborted) controller.abort();
        outerSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return {
        signal: controller.signal,
        clear: () => clearTimeout(timer)
    };
}

export class EveSessionClientError extends Error {
    constructor(message, { code = 'eve_session_client_error', status = null, response = null } = {}) {
        super(message);
        this.name = 'EveSessionClientError';
        this.code = code;
        this.status = status;
        this.response = response;
    }
}

function assertNoCallerContinuationToken(input) {
    const disallowedFields = ownKeys(input).filter((key) => key === 'continuationToken' || key === 'continuation_token');
    if (disallowedFields.length === 0) return;
    throw new EveSessionClientError('continuationToken is server-owned and cannot be supplied to EveSessionClient.createSession', {
        code: 'eve_continuation_token_input_forbidden',
        response: {
            disallowed_fields: disallowedFields
        }
    });
}

export function parseEveNdjson(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

export class EveSessionClient {
    constructor({
        baseUrl = process.env.EVE_API_BASE_URL || process.env.EVE_BASE_URL || '',
        token = process.env.EVE_API_TOKEN || process.env.EVE_TOKEN || '',
        basicUsername = process.env.EVE_API_BASIC_USERNAME || '',
        basicPassword = process.env.EVE_API_BASIC_PASSWORD || '',
        protectionBypassToken = process.env.EVE_API_PROTECTION_BYPASS || '',
        fetchImpl = globalThis.fetch,
        timeoutMs = Number(process.env.EVE_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
    } = {}) {
        this.baseUrl = trimTrailingSlash(baseUrl);
        this.token = token || '';
        this.basicUsername = basicUsername || '';
        this.basicPassword = basicPassword || '';
        this.protectionBypassToken = protectionBypassToken || '';
        this.fetchImpl = fetchImpl;
        this.timeoutMs = normalizeTimeoutMs(timeoutMs);
    }

    isConfigured() {
        return Boolean(this.baseUrl && this.fetchImpl);
    }

    _authHeaders() {
        const headers = {};
        if (this.basicUsername && this.basicPassword) {
            const credentials = Buffer.from(`${this.basicUsername}:${this.basicPassword}`, 'utf8').toString('base64');
            headers.authorization = `Basic ${credentials}`;
        } else if (this.token) {
            headers.authorization = `Bearer ${this.token}`;
        }
        if (this.protectionBypassToken) {
            headers['x-vercel-protection-bypass'] = this.protectionBypassToken;
        }
        return headers;
    }

    async createSession(input = {}) {
        assertNoCallerContinuationToken(input);
        const { message, context = null, signal = null } = input;
        if (!this.isConfigured()) {
            throw new EveSessionClientError('Eve session client is not configured', {
                code: 'eve_session_client_not_configured'
            });
        }
        if (typeof message !== 'string' || message.trim() === '') {
            throw new EveSessionClientError('message is required', {
                code: 'eve_message_required'
            });
        }

        // The eve channel API reads `clientContext` (string | string[] | JSON
        // object) and turns it into agent-visible "Client context:" messages;
        // a bare `context` field is silently ignored by its parseCreateBody.
        // The handoff context must therefore ride in `clientContext` to reach
        // the agent. `context` is kept for forward compatibility.
        const body = {
            message,
            ...(context == null ? {} : { context, clientContext: context })
        };
        const timeout = withTimeoutSignal(this.timeoutMs, signal);
        try {
            const response = await this.fetchImpl(joinEveApiPath(this.baseUrl, '/eve/v1/session'), {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...this._authHeaders()
                },
                body: JSON.stringify(body),
                signal: timeout.signal
            });
            const responseBody = await readResponseBody(response);
            if (!response.ok) {
                throw new EveSessionClientError(
                    responseBody?.error || responseBody?.message || `Eve session create failed with HTTP ${response.status}`,
                    {
                        code: responseBody?.code || 'eve_session_create_failed',
                        status: response.status,
                        response: responseBody
                    }
                );
            }
            return {
                session_id: pickSessionId(response),
                continuation_token: pickContinuationToken(responseBody),
                response: responseBody
            };
        } catch (error) {
            if (error instanceof EveSessionClientError) throw error;
            const aborted = error?.name === 'AbortError';
            throw new EveSessionClientError(
                aborted ? `Eve session create timed out after ${this.timeoutMs}ms` : `Eve session create failed: ${error?.message || String(error)}`,
                {
                    code: aborted ? 'eve_session_timeout' : 'eve_session_create_failed'
                }
            );
        } finally {
            timeout.clear();
        }
    }

    async readSessionStream({ sessionId, signal = null } = {}) {
        if (!this.isConfigured()) {
            throw new EveSessionClientError('Eve session client is not configured', {
                code: 'eve_session_client_not_configured'
            });
        }
        if (typeof sessionId !== 'string' || sessionId.trim() === '') {
            throw new EveSessionClientError('sessionId is required', {
                code: 'eve_session_id_required'
            });
        }

        const timeout = withTimeoutSignal(this.timeoutMs, signal);
        try {
            const response = await this.fetchImpl(joinEveApiPath(this.baseUrl, `/eve/v1/session/${encodeURIComponent(sessionId)}/stream`), {
                method: 'GET',
                headers: {
                    ...this._authHeaders()
                },
                signal: timeout.signal
            });
            const text = await response.text();
            if (!response.ok) {
                throw new EveSessionClientError(`Eve session stream failed with HTTP ${response.status}`, {
                    code: 'eve_session_stream_failed',
                    status: response.status,
                    response: text
                });
            }
            return parseEveNdjson(text);
        } catch (error) {
            if (error instanceof EveSessionClientError) throw error;
            const aborted = error?.name === 'AbortError';
            throw new EveSessionClientError(
                aborted ? `Eve session stream timed out after ${this.timeoutMs}ms` : `Eve session stream failed: ${error?.message || String(error)}`,
                {
                    code: aborted ? 'eve_session_timeout' : 'eve_session_stream_failed'
                }
            );
        } finally {
            timeout.clear();
        }
    }
}

export function createEveSessionClientFromEnv(env = process.env) {
    return new EveSessionClient({
        baseUrl: env.EVE_API_BASE_URL || env.EVE_BASE_URL || '',
        token: env.EVE_API_TOKEN || env.EVE_TOKEN || '',
        basicUsername: env.EVE_API_BASIC_USERNAME || '',
        basicPassword: env.EVE_API_BASIC_PASSWORD || '',
        protectionBypassToken: env.EVE_API_PROTECTION_BYPASS || '',
        timeoutMs: normalizeTimeoutMs(env.EVE_API_TIMEOUT_MS)
    });
}
