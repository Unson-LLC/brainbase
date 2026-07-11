import { describe, expect, it } from 'vitest';

import {
    createEveSessionClientFromEnv,
    EveSessionClient,
    EveSessionClientError,
    parseEveNdjson
} from '../../../server/services/external-runner/eve-session-client.js';

describe('EveSessionClient', () => {
    it('creates an Eve session through the official /eve/v1/session API shape', async () => {
        const calls = [];
        const client = new EveSessionClient({
            baseUrl: 'https://eve.example',
            token: 'token-123',
            fetchImpl: async (url, init) => {
                calls.push({ url, init });
                return new Response(JSON.stringify({
                    continuationToken: 'cont-001',
                    role: 'assistant',
                    content: []
                }), {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                        'x-eve-session-id': 'eve-session-001'
                    }
                });
            },
            timeoutMs: 1000
        });

        const result = await client.createSession({
            message: 'Run Brainbase workflow',
            context: { loop_intent_id: 'loop-001' }
        });

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://eve.example/eve/v1/session');
        expect(calls[0].init).toMatchObject({
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: 'Bearer token-123'
            }
        });
        expect(JSON.parse(calls[0].init.body)).toEqual({
            message: 'Run Brainbase workflow',
            context: { loop_intent_id: 'loop-001' }
        });
        expect(result).toMatchObject({
            session_id: 'eve-session-001',
            continuation_token: 'cont-001'
        });
    });

    it('rejects caller-supplied continuation tokens before Eve network calls', async () => {
        for (const input of [
            { continuationToken: 'caller-continuation-token' },
            { continuation_token: 'caller-continuation-token' }
        ]) {
            const calls = [];
            const client = new EveSessionClient({
                baseUrl: 'https://eve.example',
                fetchImpl: async (url, init) => {
                    calls.push({ url, init });
                    return new Response('{}', { status: 200 });
                },
                timeoutMs: 1000
            });

            await expect(client.createSession({
                message: 'Run Brainbase workflow',
                ...input
            })).rejects.toMatchObject({
                name: 'EveSessionClientError',
                code: 'eve_continuation_token_input_forbidden',
                response: {
                    disallowed_fields: Object.keys(input)
                }
            });
            expect(calls).toHaveLength(0);
        }
    });

    it('reads the Eve session stream as newline-delimited JSON events', async () => {
        const calls = [];
        const client = new EveSessionClient({
            baseUrl: 'https://eve.example',
            token: 'token-123',
            fetchImpl: async (url, init) => {
                calls.push({ url, init });
                return new Response([
                    JSON.stringify({ type: 'sessionStarted', id: 'evt-1' }),
                    JSON.stringify({ type: 'approvalRequested', id: 'evt-2' })
                ].join('\n'), { status: 200 });
            },
            timeoutMs: 1000
        });

        const events = await client.readSessionStream({
            sessionId: 'eve-session-001'
        });

        expect(calls[0].url).toBe('https://eve.example/eve/v1/session/eve-session-001/stream');
        expect(calls[0].init.headers).toMatchObject({
            authorization: 'Bearer token-123'
        });
        expect(events).toEqual([
            { type: 'sessionStarted', id: 'evt-1' },
            { type: 'approvalRequested', id: 'evt-2' }
        ]);
    });

    it('fails loudly when Eve returns a non-2xx response', async () => {
        const client = new EveSessionClient({
            baseUrl: 'https://eve.example',
            fetchImpl: async () => new Response(JSON.stringify({
                code: 'invalid_request',
                error: 'bad request'
            }), {
                status: 400,
                headers: { 'content-type': 'application/json' }
            }),
            timeoutMs: 1000
        });

        await expect(client.createSession({ message: 'Run' })).rejects.toMatchObject({
            name: 'EveSessionClientError',
            code: 'invalid_request',
            status: 400,
            response: {
                code: 'invalid_request',
                error: 'bad request'
            }
        });
    });

    it('preserves HTTP status when Eve returns malformed JSON on a non-2xx response', async () => {
        const client = new EveSessionClient({
            baseUrl: 'https://eve.example',
            fetchImpl: async () => new Response('{not-json', {
                status: 502,
                headers: { 'content-type': 'application/json' }
            }),
            timeoutMs: 1000
        });

        await expect(client.createSession({ message: 'Run' })).rejects.toMatchObject({
            name: 'EveSessionClientError',
            code: 'eve_session_create_failed',
            status: 502,
            response: { text: '{not-json' }
        });
    });

    it('does not trust session ids from the Eve response body', async () => {
        const client = new EveSessionClient({
            baseUrl: 'https://eve.example',
            fetchImpl: async () => new Response(JSON.stringify({
                sessionId: 'body-session-id',
                session_id: 'body-session-snake',
                continuationToken: 'cont-001'
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            }),
            timeoutMs: 1000
        });

        await expect(client.createSession({ message: 'Run' })).resolves.toMatchObject({
            session_id: null,
            continuation_token: 'cont-001'
        });
    });

    it('fails loudly when Eve session creation times out', async () => {
        const client = new EveSessionClient({
            baseUrl: 'https://eve.example',
            fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () => {
                    reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                }, { once: true });
            }),
            timeoutMs: 1
        });

        await expect(client.createSession({ message: 'Run' })).rejects.toMatchObject({
            name: 'EveSessionClientError',
            code: 'eve_session_timeout'
        });
    });

    it('requires configuration before any real network call', async () => {
        const client = new EveSessionClient({ baseUrl: '', fetchImpl: async () => new Response('{}') });

        await expect(client.createSession({ message: 'Run' })).rejects.toBeInstanceOf(EveSessionClientError);
        await expect(client.createSession({ message: 'Run' })).rejects.toMatchObject({
            code: 'eve_session_client_not_configured'
        });
    });

    it('defaults invalid env timeout values instead of disabling timeouts', () => {
        const client = createEveSessionClientFromEnv({
            EVE_API_BASE_URL: 'https://eve.example',
            EVE_API_TIMEOUT_MS: 'not-a-number'
        });

        expect(client.timeoutMs).toBe(30000);
    });

    it('prefers HTTP Basic auth over Bearer and sends the Vercel protection bypass header', async () => {
        const calls = [];
        const client = new EveSessionClient({
            baseUrl: 'https://eve.example',
            token: 'token-123',
            basicUsername: 'brainbase-operator',
            basicPassword: 'operator-secret',
            protectionBypassToken: 'bypass-secret',
            fetchImpl: async (url, init) => {
                calls.push({ url, init });
                return new Response('{}', {
                    status: 200,
                    headers: { 'x-eve-session-id': 'eve-session-002' }
                });
            },
            timeoutMs: 1000
        });

        await client.createSession({ message: 'Run Brainbase workflow' });
        await client.readSessionStream({ sessionId: 'eve-session-002' });

        const expectedBasic = `Basic ${Buffer.from('brainbase-operator:operator-secret', 'utf8').toString('base64')}`;
        expect(calls).toHaveLength(2);
        for (const call of calls) {
            expect(call.init.headers.authorization).toBe(expectedBasic);
            expect(call.init.headers['x-vercel-protection-bypass']).toBe('bypass-secret');
        }
    });

    it('keeps Bearer auth and omits the bypass header when basic/bypass env is absent', async () => {
        const calls = [];
        const client = createEveSessionClientFromEnv({
            EVE_API_BASE_URL: 'https://eve.example',
            EVE_API_TOKEN: 'token-123'
        });
        client.fetchImpl = async (url, init) => {
            calls.push({ url, init });
            return new Response('{}', { status: 200 });
        };

        await client.createSession({ message: 'Run Brainbase workflow' });

        expect(calls[0].init.headers.authorization).toBe('Bearer token-123');
        expect('x-vercel-protection-bypass' in calls[0].init.headers).toBe(false);
    });

    it('wires basic auth and protection bypass from env', () => {
        const client = createEveSessionClientFromEnv({
            EVE_API_BASE_URL: 'https://eve.example',
            EVE_API_BASIC_USERNAME: 'brainbase-operator',
            EVE_API_BASIC_PASSWORD: 'operator-secret',
            EVE_API_PROTECTION_BYPASS: 'bypass-secret'
        });

        expect(client.basicUsername).toBe('brainbase-operator');
        expect(client.basicPassword).toBe('operator-secret');
        expect(client.protectionBypassToken).toBe('bypass-secret');
    });

    it('parses NDJSON without treating blank lines as events', () => {
        expect(parseEveNdjson('{"type":"message"}\n\n{"type":"sessionCompleted"}\n')).toEqual([
            { type: 'message' },
            { type: 'sessionCompleted' }
        ]);
    });
});
