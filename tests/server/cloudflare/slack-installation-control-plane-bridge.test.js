import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
    INSTALLATION_CONTROL_PLANE_PATHS,
    MAX_REQUEST_BODY_BYTES,
    handleSlackInstallationControlPlaneBridgeRequest
} from '../../../packages/cloudflare-slack-installation-control-plane-bridge/src/worker.js';

const ENV = Object.freeze({
    BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_ORIGIN: 'https://brainbase.internal.example.test',
    BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_ORIGIN_HOSTNAME: 'brainbase.internal.example.test',
    CF_ACCESS_CLIENT_ID: 'access-client-id-not-a-production-secret',
    CF_ACCESS_CLIENT_SECRET: 'access-client-secret-not-a-production-secret',
    BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_SERVICE_TOKEN: 'bbsvc_exchange-service-token'
});

function request(path = INSTALLATION_CONTROL_PLANE_PATHS[0], init = {}) {
    const method = init.method ?? 'POST';
    return new Request(`http://127.0.0.1:31017${path}`, {
        method,
        headers: {
            authorization: 'Bearer bbsvc_test-token',
            'brainbase-protocol-version': '1.0',
            'brainbase-deployment-id': 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX',
            'content-type': 'application/json',
            ...(init.headers ?? {})
        },
        body: init.body ?? (method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify({
            installation_intent_id: 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAX',
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX'
        })),
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

describe('Cloudflare Slack installation control-plane private bridge', () => {
    it('is deployable under the exact Service Binding name without a public Worker URL or plaintext bindings', () => {
        const configPath = process.cwd().endsWith('/packages/cloudflare-slack-installation-control-plane-bridge')
            ? resolve(process.cwd(), 'wrangler.jsonc')
            : resolve(
                process.cwd(),
                'packages/cloudflare-slack-installation-control-plane-bridge/wrangler.jsonc'
            );
        const config = JSON.parse(readFileSync(configPath, 'utf8'));

        expect(config).toMatchObject({
            name: 'brainbase-slack-installation-control-plane',
            main: 'src/worker.js',
            workers_dev: false,
            preview_urls: false
        });
        expect(config.routes).toBeUndefined();
        expect(config.vars).toBeUndefined();
    });

    it.each(INSTALLATION_CONTROL_PLANE_PATHS)(
        'forwards the exact private control-plane route with Access service auth: %s',
        async (path) => {
            const fetchImpl = vi.fn(async (input) => {
                const forwarded = new Request(input);
                expect(forwarded.url).toBe(`https://brainbase.internal.example.test${path}`);
                expect(forwarded.method).toBe('POST');
                expect(forwarded.headers.get('authorization')).toBe(
                    path === INSTALLATION_CONTROL_PLANE_PATHS[0]
                        ? 'Bearer bbsvc_test-token'
                        : `Bearer ${ENV.BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_SERVICE_TOKEN}`
                );
                expect(forwarded.headers.get('brainbase-protocol-version')).toBe('1.0');
                expect(forwarded.headers.get('brainbase-deployment-id'))
                    .toBe('dep_01ARZ3NDEKTSV4RRFFQ69G5FAX');
                expect(forwarded.headers.get('cf-access-client-id')).toBe(ENV.CF_ACCESS_CLIENT_ID);
                expect(forwarded.headers.get('cf-access-client-secret')).toBe(ENV.CF_ACCESS_CLIENT_SECRET);
                await expect(forwarded.json()).resolves.toMatchObject({
                    installation_intent_id: 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAX'
                });
                return Response.json({ installation_intent_id: 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAX' });
            });

            const response = await handleSlackInstallationControlPlaneBridgeRequest(
                request(path),
                ENV,
                { fetchImpl }
            );

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({
                installation_intent_id: 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAX'
            });
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        }
    );

    it('replaces a caller authorization token with the dedicated service token during exchange-and-register', async () => {
        const fetchImpl = vi.fn(async (input) => {
            const forwarded = new Request(input);
            expect(forwarded.headers.get('authorization')).toBe(
                `Bearer ${ENV.BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_SERVICE_TOKEN}`
            );
            expect(forwarded.headers.get('authorization')).not.toContain('caller-token-must-not-cross');
            return Response.json({ result: { ok: true } });
        });
        const response = await handleSlackInstallationControlPlaneBridgeRequest(
            request(INSTALLATION_CONTROL_PLANE_PATHS[1], {
                headers: { authorization: 'Bearer caller-token-must-not-cross' }
            }),
            ENV,
            { fetchImpl }
        );
        expect(response.status).toBe(200);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['unknown route', request('/api/v1/slack-installations:not-allowed')],
        ['wrong method', request(INSTALLATION_CONTROL_PLANE_PATHS[0], { method: 'GET' })],
        ['query string', request(`${INSTALLATION_CONTROL_PLANE_PATHS[0]}?fallback=1`)]
    ])('rejects %s without reaching the private origin', async (_label, inbound) => {
        const fetchImpl = vi.fn();

        const response = await handleSlackInstallationControlPlaneBridgeRequest(inbound, ENV, { fetchImpl });

        expect(response.status).toBe(404);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([
        ['missing origin', { ...ENV, BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_ORIGIN: undefined }],
        ['non-HTTPS origin', {
            ...ENV,
            BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_ORIGIN: 'http://brainbase.internal.example.test'
        }],
        ['hostname mismatch', {
            ...ENV,
            BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_ORIGIN_HOSTNAME: 'other.internal.example.test'
        }],
        ['missing Access client id', { ...ENV, CF_ACCESS_CLIENT_ID: undefined }],
        ['missing Access client secret', { ...ENV, CF_ACCESS_CLIENT_SECRET: undefined }],
        ['missing exchange service token', {
            ...ENV,
            BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_SERVICE_TOKEN: undefined
        }, INSTALLATION_CONTROL_PLANE_PATHS[1]]
    ])('fails closed for %s without exposing configuration', async (_label, env, path = INSTALLATION_CONTROL_PLANE_PATHS[0]) => {
        const fetchImpl = vi.fn();

        const response = await handleSlackInstallationControlPlaneBridgeRequest(
            request(path),
            env,
            { fetchImpl }
        );
        const body = await response.text();

        expect(response.status).toBe(503);
        expect(response.headers.get('content-type')).toContain('application/problem+json');
        expect(body).not.toContain('brainbase.internal.example.test');
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

        const response = await handleSlackInstallationControlPlaneBridgeRequest(inbound, ENV, { fetchImpl });

        expect(response.status).toBe(413);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('does not trust caller Access or forwarding headers and strips upstream infrastructure headers', async () => {
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
                    'set-cookie': 'session=secret',
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

        const response = await handleSlackInstallationControlPlaneBridgeRequest(inbound, ENV, { fetchImpl });

        expect(response.status).toBe(200);
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(response.headers.get('server')).toBeNull();
        expect(response.headers.get('cf-ray')).toBeNull();
        expect(response.headers.get('content-type')).toBe('application/json');
    });
});
