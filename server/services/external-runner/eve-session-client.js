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

const DEFAULT_STREAM_IDLE_MS = 3000;

// The eve session stream route is a live tail: it replays the durable event
// history immediately but then keeps the HTTP connection open for future
// events, so `response.text()` never resolves for a parked session. These
// boundary events mark the end of the replayed history — once one arrives as
// the latest complete line, no further events can follow without new input.
const STREAM_BOUNDARY_EVENT_TYPES = new Set([
    'session.waiting',
    'session.completed',
    'session.failed'
]);

function parseCompleteNdjsonLines(buffered) {
    const lastNewline = buffered.lastIndexOf('\n');
    if (lastNewline === -1) return { events: [], lastType: null };
    const events = parseEveNdjson(buffered.slice(0, lastNewline + 1));
    return { events, lastType: events.at(-1)?.type ?? null };
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

    async readSessionStream({ sessionId, signal = null, idleMs = DEFAULT_STREAM_IDLE_MS } = {}) {
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
            if (!response.ok) {
                const text = await response.text();
                throw new EveSessionClientError(`Eve session stream failed with HTTP ${response.status}`, {
                    code: 'eve_session_stream_failed',
                    status: response.status,
                    response: text
                });
            }
            return await this._readReplayedStreamEvents(response, { idleMs, outerSignal: timeout.signal });
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

    // Reads the live-tail stream incrementally and returns once the replayed
    // history is complete instead of waiting for a connection close that never
    // comes: a boundary event (session.waiting/completed/failed) as the latest
    // complete line ends the read, and an idle gap of `idleMs` without new
    // bytes ends it for mid-turn sessions that have no boundary yet.
    async _readReplayedStreamEvents(response, { idleMs, outerSignal }) {
        if (!response.body?.getReader) {
            // Test doubles and non-streaming fetch implementations still
            // resolve text() immediately; keep the simple path for them.
            return parseEveNdjson(await response.text());
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = '';
        let streamClosed = false;
        try {
            for (;;) {
                if (outerSignal?.aborted) {
                    throw new EveSessionClientError(`Eve session stream timed out after ${this.timeoutMs}ms`, {
                        code: 'eve_session_timeout'
                    });
                }
                let idleTimer = null;
                const chunk = await Promise.race([
                    reader.read(),
                    new Promise((resolve) => {
                        idleTimer = setTimeout(() => resolve({ idle: true }), idleMs);
                        idleTimer.unref?.();
                    })
                ]).finally(() => clearTimeout(idleTimer));
                if (chunk.done) {
                    streamClosed = true;
                    buffered += decoder.decode();
                    break;
                }
                if (chunk.idle) break;
                buffered += decoder.decode(chunk.value, { stream: true });
                const { lastType } = parseCompleteNdjsonLines(buffered);
                if (lastType && STREAM_BOUNDARY_EVENT_TYPES.has(lastType)) break;
            }
        } finally {
            try {
                await reader.cancel();
            } catch {
                // The tail connection is being abandoned either way.
            }
        }
        // A closed stream has no partial trailing line, so parse everything;
        // an abandoned live tail may end mid-line, so keep complete lines only.
        if (streamClosed) return parseEveNdjson(buffered);
        return parseCompleteNdjsonLines(buffered).events;
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
