import { describe, expect, it } from 'vitest';

import {
    executeFreeeRead,
    FreeeReadPolicyError
} from '../../../../server/services/freee/freee-read-policy.js';

function resolvedCredential(overrides = {}) {
    return Object.freeze({
        service: 'freee',
        purpose: 'runtime_read',
        tenant_id: 'tenant_unson',
        account_id: 'acc_freee',
        company_id: 123456,
        credential_mode: 'customer_oauth',
        capabilities: Object.freeze(['read']),
        ...overrides
    });
}

function limiter(result = true) {
    return {
        calls: [],
        async consume(input) {
            this.calls.push(input);
            return result;
        }
    };
}

function okJson(body = { ok: true }, headers = {}) {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', ...headers }
    });
}

async function expectCode(promise, code) {
    await expect(promise).rejects.toMatchObject({
        name: FreeeReadPolicyError.name,
        code
    });
}

describe('freee read safety policy', () => {
    it('pins accounting reads to the company id from the frozen resolved credential', async () => {
        const rateLimiter = limiter();
        let invoked;
        const response = await executeFreeeRead({
            credential: resolvedCredential(),
            toolCall: {
                name: 'freee_api_get',
                arguments: {
                    service: 'accounting',
                    path: '/api/1/invoices',
                    query: { company_id: 123456, limit: 20 }
                }
            },
            rateLimiter,
            invoke: async (call) => {
                invoked = call;
                return okJson();
            }
        });

        expect(invoked).toEqual({
            service: 'accounting',
            path: '/api/1/invoices',
            query: { company_id: 123456, limit: 20 }
        });
        expect(await response.json()).toEqual({ ok: true });
        expect(rateLimiter.calls).toEqual([{
            key: JSON.stringify(['tenant_unson', 'acc_freee']),
            limit: 30,
            window_ms: 60_000
        }]);
    });

    it('rejects a model supplied company_id that differs from the resolved binding', async () => {
        await expectCode(executeFreeeRead({
            credential: resolvedCredential(),
            toolCall: {
                name: 'freee_api_get',
                arguments: {
                    service: 'accounting',
                    path: '/api/1/deals',
                    query: { company_id: 999999 }
                }
            },
            rateLimiter: limiter(),
            invoke: async () => okJson()
        }), 'FREEE_COMPANY_MISMATCH');
    });

    it('rejects extra top-level tool and argument fields instead of silently dropping them', async () => {
        await expectCode(executeFreeeRead({
            credential: resolvedCredential(),
            toolCall: {
                name: 'freee_api_get',
                arguments: {
                    service: 'accounting',
                    path: '/api/1/deals',
                    method: 'POST'
                }
            },
            rateLimiter: limiter(),
            invoke: async () => okJson()
        }), 'FREEE_TOOL_ARGUMENTS_INVALID');

        await expectCode(executeFreeeRead({
            credential: resolvedCredential(),
            toolCall: {
                name: 'freee_api_get',
                arguments: { service: 'accounting', path: '/api/1/deals' },
                headers: { authorization: 'secret' }
            },
            rateLimiter: limiter(),
            invoke: async () => okJson()
        }), 'FREEE_TOOL_CALL_INVALID');
    });

    it('denies unknown query keys by default and only allows bounded collection limits', async () => {
        for (const query of [
            { offset: 1 },
            { company_ids: '999999' },
            { Company_Id: 999999 },
            { accruals: 'with' }
        ]) {
            await expectCode(executeFreeeRead({
                credential: resolvedCredential(),
                toolCall: {
                    name: 'freee_api_get',
                    arguments: { service: 'accounting', path: '/api/1/invoices', query }
                },
                rateLimiter: limiter(),
                invoke: async () => okJson()
            }), 'FREEE_QUERY_INVALID');
        }

        await expectCode(executeFreeeRead({
            credential: resolvedCredential(),
            toolCall: {
                name: 'freee_api_get',
                arguments: {
                    service: 'accounting',
                    path: '/api/1/partners',
                    query: { limit: 101 }
                }
            },
            rateLimiter: limiter(),
            invoke: async () => okJson()
        }), 'FREEE_PAGE_LIMIT_EXCEEDED');
    });

    it('uses the path value that was validated even when a getter tries to change it later', async () => {
        let reads = 0;
        const args = {
            service: 'accounting',
            query: { company_id: 123456 }
        };
        Object.defineProperty(args, 'path', {
            enumerable: true,
            get() {
                reads += 1;
                return reads === 1 ? '/api/1/invoices' : '/api/1/users/me';
            }
        });

        let invoked;
        await executeFreeeRead({
            credential: resolvedCredential(),
            toolCall: { name: 'freee_api_get', arguments: args },
            rateLimiter: limiter(),
            invoke: async (call) => {
                invoked = call;
                return okJson();
            }
        });

        expect(invoked.path).toBe('/api/1/invoices');
        expect(reads).toBe(1);
    });

    it('rejects non-accounting services, management tools, unknown paths, and query-in-path bypasses', async () => {
        const cases = [
            {
                toolCall: { name: 'freee_list_companies', arguments: { service: 'accounting', path: '/api/1/deals' } },
                code: 'FREEE_TOOL_FORBIDDEN'
            },
            {
                toolCall: { name: 'freee_api_get', arguments: { service: 'hr', path: '/api/v1/employees' } },
                code: 'FREEE_SERVICE_FORBIDDEN'
            },
            {
                toolCall: { name: 'freee_api_get', arguments: { service: 'accounting', path: '/api/1/users/me' } },
                code: 'FREEE_PATH_FORBIDDEN'
            },
            {
                toolCall: { name: 'freee_api_get', arguments: { service: 'accounting', path: '/api/1/invoices?company_id=999999' } },
                code: 'FREEE_PATH_INVALID'
            }
        ];
        for (const { toolCall, code } of cases) {
            await expectCode(executeFreeeRead({
                credential: resolvedCredential(),
                toolCall,
                rateLimiter: limiter(),
                invoke: async () => okJson()
            }), code);
        }
    });

    it('fails closed when the rate limiter is unavailable or exhausted and consumes once per call', async () => {
        await expectCode(executeFreeeRead({
            credential: resolvedCredential(),
            toolCall: { name: 'freee_api_get', arguments: { service: 'accounting', path: '/api/1/deals' } },
            rateLimiter: null,
            invoke: async () => okJson()
        }), 'FREEE_RATE_LIMITER_UNAVAILABLE');

        await expectCode(executeFreeeRead({
            credential: resolvedCredential(),
            toolCall: { name: 'freee_api_get', arguments: { service: 'accounting', path: '/api/1/deals' } },
            rateLimiter: limiter(false),
            invoke: async () => okJson()
        }), 'FREEE_RATE_LIMITED');

        const rateLimiter = limiter();
        for (let i = 0; i < 2; i += 1) {
            await executeFreeeRead({
                credential: resolvedCredential(),
                toolCall: { name: 'freee_api_get', arguments: { service: 'accounting', path: '/api/1/deals' } },
                rateLimiter,
                invoke: async () => okJson()
            });
        }
        expect(rateLimiter.calls).toHaveLength(2);
    });

    it('rejects streaming responses larger than the hard ceiling even when content-length lies', async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(4096));
                controller.close();
            }
        });
        await expectCode(executeFreeeRead({
            credential: resolvedCredential(),
            toolCall: { name: 'freee_api_get', arguments: { service: 'accounting', path: '/api/1/deals' } },
            rateLimiter: limiter(),
            invoke: async () => new Response(stream, {
                headers: { 'content-length': '10' }
            }),
            maxResponseBytes: 1024
        }), 'FREEE_RESPONSE_TOO_LARGE');
    });

    it('drops upstream cookies and encoding metadata after reconstructing the body', async () => {
        const response = await executeFreeeRead({
            credential: resolvedCredential(),
            toolCall: { name: 'freee_api_get', arguments: { service: 'accounting', path: '/api/1/deals' } },
            rateLimiter: limiter(),
            invoke: async () => new Response('{"ok":true}', {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                    'content-encoding': 'gzip',
                    'transfer-encoding': 'chunked',
                    'set-cookie': 'sid=secret',
                    'x-upstream-token': 'secret'
                }
            })
        });

        expect(response.headers.get('content-type')).toBe('application/json');
        expect(response.headers.get('content-length')).toBe(String(new TextEncoder().encode('{"ok":true}').byteLength));
        expect(response.headers.get('content-encoding')).toBeNull();
        expect(response.headers.get('transfer-encoding')).toBeNull();
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(response.headers.get('x-upstream-token')).toBeNull();
        expect(await response.text()).toBe('{"ok":true}');
    });

    it('allows a bodyless successful upstream response without turning it into a 502', async () => {
        const response = await executeFreeeRead({
            credential: resolvedCredential(),
            toolCall: { name: 'freee_api_get', arguments: { service: 'accounting', path: '/api/1/deals/1' } },
            rateLimiter: limiter(),
            invoke: async () => new Response(null, { status: 204 })
        });
        expect(response.status).toBe(204);
        expect(response.body).toBeNull();
    });

    it('requires the resolved credential shape instead of accepting a caller-provided companyId scalar', async () => {
        await expectCode(executeFreeeRead({
            credential: {
                service: 'freee',
                purpose: 'runtime_read',
                tenant_id: 'tenant_unson',
                account_id: 'acc_freee',
                company_id: 123456,
                credential_mode: 'customer_oauth',
                capabilities: ['read']
            },
            toolCall: { name: 'freee_api_get', arguments: { service: 'accounting', path: '/api/1/deals' } },
            rateLimiter: limiter(),
            invoke: async () => okJson()
        }), 'FREEE_RESOLVED_CREDENTIAL_INVALID');
    });
});
