import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
    MAX_REQUEST_BODY_BYTES,
    handleTenantRuntimeBridgeRequest
} from '../../../packages/cloudflare-tenant-runtime-bridge/src/worker.js';

const ENV = Object.freeze({
    BRAINBASE_TENANT_RUNTIME_ORIGIN: 'https://tenant-runtime.internal.example.test',
    BRAINBASE_TENANT_RUNTIME_ORIGIN_HOSTNAME: 'tenant-runtime.internal.example.test',
    CF_ACCESS_CLIENT_ID: 'access-client-id-not-a-production-secret',
    CF_ACCESS_CLIENT_SECRET: 'access-client-secret-not-a-production-secret'
});

function request(path = '/api/v1/runtime/provider-requests:forward', init = {}) {
    return new Request(`http://127.0.0.1:31016${path}`, {
        method: 'POST',
        headers: {
            authorization: 'Bearer bbsvc_test-token',
            'brainbase-protocol-version': '1.0',
            'brainbase-deployment-id': 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX',
            'content-type': 'application/json',
            ...(init.headers ?? {})
        },
        body: init.body ?? JSON.stringify({ tenant_context: {}, provider_operation: 'anthropic.messages.create' }),
        ...init,
        headers: {
            authorization: 'Bearer bbsvc_test-token',
            'brainbase-protocol-version': '1.0',
            'brainbase-deployment-id': 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX',
            'content-type': 'application/json',
            ...(init.headers ?? {})
        }
    });
}

describe('Cloudflare tenant runtime private bridge', () => {
    it('is deployable under the exact Service Binding name without a public Worker URL or plaintext bindings', () => {
        const configPath = process.cwd().endsWith('/packages/cloudflare-tenant-runtime-bridge')
            ? resolve(process.cwd(), 'wrangler.jsonc')
            : resolve(process.cwd(), 'packages/cloudflare-tenant-runtime-bridge/wrangler.jsonc');
        const config = JSON.parse(readFileSync(
            configPath,
            'utf8'
        ));

        expect(config).toMatchObject({
            name: 'brainbase-tenant-runtime',
            main: 'src/worker.js',
            workers_dev: false,
            preview_urls: false
        });
        expect(config.routes).toBeUndefined();
        expect(config.vars).toBeUndefined();
    });

    it('forwards the exact provider route to the configured Tunnel origin with Access service auth', async () => {
        const fetchImpl = vi.fn(async (input) => {
            const forwarded = new Request(input);
            expect(forwarded.url).toBe('https://tenant-runtime.internal.example.test/api/v1/runtime/provider-requests:forward');
            expect(forwarded.method).toBe('POST');
            expect(forwarded.headers.get('authorization')).toBe('Bearer bbsvc_test-token');
            expect(forwarded.headers.get('brainbase-protocol-version')).toBe('1.0');
            expect(forwarded.headers.get('brainbase-deployment-id')).toBe('dep_01ARZ3NDEKTSV4RRFFQ69G5FAX');
            expect(forwarded.headers.get('cf-access-client-id')).toBe(ENV.CF_ACCESS_CLIENT_ID);
            expect(forwarded.headers.get('cf-access-client-secret')).toBe(ENV.CF_ACCESS_CLIENT_SECRET);
            await expect(forwarded.json()).resolves.toMatchObject({ provider_operation: 'anthropic.messages.create' });
            return Response.json({ status: 200, body: { ok: true } }, { status: 200 });
        });

        const response = await handleTenantRuntimeBridgeRequest(request(), ENV, { fetchImpl });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ status: 200, body: { ok: true } });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['unknown route', request('/api/v1/runtime/tenant-context:resolve')],
        ['wrong method', request('/api/v1/runtime/provider-requests:forward', { method: 'PUT' })],
        ['query string', request('/api/v1/runtime/provider-requests:forward?fallback=1')]
    ])('rejects %s without reaching the private origin', async (_label, inbound) => {
        const fetchImpl = vi.fn();

        const response = await handleTenantRuntimeBridgeRequest(inbound, ENV, { fetchImpl });

        expect(response.status).toBe(404);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([
        ['missing origin', { ...ENV, BRAINBASE_TENANT_RUNTIME_ORIGIN: undefined }],
        ['non-HTTPS origin', { ...ENV, BRAINBASE_TENANT_RUNTIME_ORIGIN: 'http://tenant-runtime.internal.example.test' }],
        ['hostname mismatch', { ...ENV, BRAINBASE_TENANT_RUNTIME_ORIGIN_HOSTNAME: 'other.internal.example.test' }],
        ['missing Access client id', { ...ENV, CF_ACCESS_CLIENT_ID: undefined }],
        ['missing Access client secret', { ...ENV, CF_ACCESS_CLIENT_SECRET: undefined }]
    ])('fails closed for %s without exposing configuration', async (_label, env) => {
        const fetchImpl = vi.fn();

        const response = await handleTenantRuntimeBridgeRequest(request(), env, { fetchImpl });
        const body = await response.text();

        expect(response.status).toBe(503);
        expect(response.headers.get('content-type')).toContain('application/problem+json');
        expect(body).not.toContain('tenant-runtime.internal.example.test');
        expect(body).not.toContain(ENV.CF_ACCESS_CLIENT_SECRET);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([
        ['declared oversized body', request(undefined, {
            headers: { 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) }
        })],
        ['streamed oversized body', request(undefined, {
            body: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1)
        })]
    ])('rejects %s before the private origin', async (_label, inbound) => {
        const fetchImpl = vi.fn();

        const response = await handleTenantRuntimeBridgeRequest(inbound, ENV, { fetchImpl });

        expect(response.status).toBe(413);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('does not trust caller forwarding headers or expose upstream cookies and infrastructure headers', async () => {
        const fetchImpl = vi.fn(async (input) => {
            const forwarded = new Request(input);
            expect(forwarded.headers.get('cf-access-client-id')).toBe(ENV.CF_ACCESS_CLIENT_ID);
            expect(forwarded.headers.get('cf-access-client-secret')).toBe(ENV.CF_ACCESS_CLIENT_SECRET);
            expect(forwarded.headers.get('cookie')).toBeNull();
            expect(forwarded.headers.get('x-forwarded-host')).toBeNull();
            expect(forwarded.headers.get('x-arbitrary')).toBeNull();
            return new Response('{"ok":true}', {
                headers: {
                    'content-type': 'application/json',
                    'set-cookie': 'runtime_session=secret',
                    server: 'private-origin',
                    'cf-ray': 'private-ray'
                }
            });
        });
        const inbound = request(undefined, {
            headers: {
                cookie: 'caller=secret',
                'cf-access-client-id': 'attacker',
                'cf-access-client-secret': 'attacker',
                'x-forwarded-host': 'attacker.example',
                'x-arbitrary': 'not-allowed'
            }
        });

        const response = await handleTenantRuntimeBridgeRequest(inbound, ENV, { fetchImpl });

        expect(response.status).toBe(200);
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(response.headers.get('server')).toBeNull();
        expect(response.headers.get('cf-ray')).toBeNull();
        expect(response.headers.get('content-type')).toBe('application/json');
    });
});
