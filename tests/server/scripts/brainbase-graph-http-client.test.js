import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createBrainbaseHttpClient } from '../../../scripts/lib/brainbase-http-client.mjs';
import { createBrainbaseGraphHttpClient } from '../../../scripts/lib/brainbase-graph-http-client.mjs';

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Brainbase Graph HTTP write contract', () => {
    it('uses the explicitly preferred credential when both are available', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
        const http = createBrainbaseHttpClient({
            baseUrl: 'https://bb.unson.jp',
            accessToken: 'access-token',
            internalApiKey: 'internal-secret',
            authPreference: 'internal-api-key',
            fetchImpl
        });

        await http.request('/api/health');

        expect(fetchImpl).toHaveBeenCalledWith('https://bb.unson.jp/api/health', expect.objectContaining({
            headers: expect.objectContaining({ 'x-internal-api-key': 'internal-secret' })
        }));
        expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
    });

    it('rejects an auth preference when its credential is missing', () => {
        expect(() => createBrainbaseHttpClient({
            baseUrl: 'https://bb.unson.jp', accessToken: 'access-token', authPreference: 'internal-api-key'
        })).toThrow('authPreference internal-api-key requires internalApiKey');
    });

    it('supports the shared transport with an internal API key', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ token: 'csrf-token' }))
            .mockResolvedValueOnce(jsonResponse({ ok: true }));
        const http = createBrainbaseHttpClient({
            baseUrl: 'https://bb.unson.jp', internalApiKey: 'internal-secret', fetchImpl, sessionId: 'test-session'
        });

        await http.request('/api/admin/context-preview', { method: 'POST', body: { project: 'brainbase' } });

        expect(fetchImpl).toHaveBeenNthCalledWith(2, 'https://bb.unson.jp/api/admin/context-preview', expect.objectContaining({
            headers: expect.objectContaining({
                'x-internal-api-key': 'internal-secret',
                'X-Session-Id': 'test-session',
                'X-CSRF-Token': 'csrf-token'
            })
        }));
    });

    it('gets a CSRF token and upserts with one session and the write schema', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ token: 'csrf-token' }))
            .mockResolvedValueOnce(jsonResponse({ id: 'app_mana' }, 201));
        const client = createBrainbaseGraphHttpClient({
            baseUrl: 'https://bb.unson.jp/', accessToken: 'secret-token', fetchImpl, sessionId: 'test-session'
        });

        await client.upsertEntity({
            id: 'app_mana', entityType: 'app', projectCode: 'mana', projectName: 'mana', payload: { status: 'active' }
        });

        expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://bb.unson.jp/api/csrf-token', expect.objectContaining({
            method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer secret-token', 'X-Session-Id': 'test-session' })
        }));
        expect(fetchImpl).toHaveBeenNthCalledWith(2, 'https://bb.unson.jp/api/info/graph/entities', expect.objectContaining({
            method: 'POST', headers: expect.objectContaining({
                Authorization: 'Bearer secret-token',
                'Content-Type': 'application/json',
                'X-Session-Id': 'test-session',
                'X-CSRF-Token': 'csrf-token'
            })
        }));
        expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
            id: 'app_mana', entityType: 'app', projectCode: 'mana', projectName: 'mana',
            roleMin: 'gm', sensitivity: 'internal', payload: { status: 'active' }
        });
    });

    it('does not attempt a write when the CSRF response has no token', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
        const client = createBrainbaseGraphHttpClient({
            baseUrl: 'https://bb.unson.jp', accessToken: 'secret-token', fetchImpl, sessionId: 'test-session'
        });
        await expect(client.upsertEntity({ id: 'app_mana', entityType: 'app', projectCode: 'mana' }))
            .rejects.toThrow('CSRF token is required');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('rejects the read-model snake_case shape before making a request', async () => {
        const fetchImpl = vi.fn();
        const client = createBrainbaseGraphHttpClient({ baseUrl: 'https://bb.unson.jp', accessToken: 'secret-token', fetchImpl });
        await expect(client.upsertEntity({ id: 'app_mana', entity_type: 'app', projectCode: 'mana' }))
            .rejects.toThrow('entityType is required');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('refreshes and retries once only when a 403 is a CSRF rejection', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ token: 'csrf-one' }))
            .mockResolvedValueOnce(jsonResponse({ message: 'Invalid CSRF token' }, 403))
            .mockResolvedValueOnce(jsonResponse({ token: 'csrf-two' }))
            .mockResolvedValueOnce(jsonResponse({ id: 'app_mana' }, 201));
        const client = createBrainbaseGraphHttpClient({
            baseUrl: 'https://bb.unson.jp', accessToken: 'secret-token', fetchImpl, sessionId: 'test-session'
        });
        await expect(client.upsertEntity({ id: 'app_mana', entityType: 'app', projectCode: 'mana' }))
            .resolves.toMatchObject({ id: 'app_mana' });
        expect(fetchImpl).toHaveBeenCalledTimes(4);
        expect(fetchImpl.mock.calls[3][1].headers['X-CSRF-Token']).toBe('csrf-two');
    });

    it('shares one CSRF acquisition across parallel mutations', async () => {
        let issuedTokens = 0;
        let activeToken;
        const fetchImpl = vi.fn(async (url, options) => {
            if (url.endsWith('/api/csrf-token')) {
                issuedTokens += 1;
                activeToken = `csrf-${issuedTokens}`;
                await Promise.resolve();
                return jsonResponse({ token: activeToken });
            }
            if (options.headers['X-CSRF-Token'] !== activeToken) {
                return jsonResponse({ message: 'Invalid CSRF token' }, 403);
            }
            return jsonResponse({ id: JSON.parse(options.body).id }, 201);
        });
        const client = createBrainbaseGraphHttpClient({
            baseUrl: 'https://bb.unson.jp', accessToken: 'secret-token', fetchImpl, sessionId: 'test-session'
        });

        await expect(Promise.all([
            client.upsertEntity({ id: 'app_mana', entityType: 'app', projectCode: 'mana' }),
            client.upsertEntity({ id: 'app_brainbase', entityType: 'app', projectCode: 'brainbase' })
        ])).resolves.toEqual([{ id: 'app_mana' }, { id: 'app_brainbase' }]);
        expect(issuedTokens).toBe(1);
    });

    it('shares one CSRF refresh when parallel mutations reject the same stale token', async () => {
        let issuedTokens = 0;
        let stalePosts = 0;
        let releaseStalePosts;
        const stalePostsReady = new Promise((resolve) => { releaseStalePosts = resolve; });
        const fetchImpl = vi.fn(async (url, options) => {
            if (url.endsWith('/api/csrf-token')) {
                issuedTokens += 1;
                return jsonResponse({ token: `csrf-${issuedTokens}` });
            }
            if (options.headers['X-CSRF-Token'] === 'csrf-1') {
                stalePosts += 1;
                if (stalePosts === 2) releaseStalePosts();
                await stalePostsReady;
                return jsonResponse({ message: 'Invalid CSRF token' }, 403);
            }
            return jsonResponse({ id: JSON.parse(options.body).id }, 201);
        });
        const client = createBrainbaseGraphHttpClient({
            baseUrl: 'https://bb.unson.jp', accessToken: 'secret-token', fetchImpl, sessionId: 'test-session'
        });

        await expect(Promise.all([
            client.upsertEntity({ id: 'app_mana', entityType: 'app', projectCode: 'mana' }),
            client.upsertEntity({ id: 'app_brainbase', entityType: 'app', projectCode: 'brainbase' })
        ])).resolves.toEqual([{ id: 'app_mana' }, { id: 'app_brainbase' }]);
        expect(issuedTokens).toBe(2);
    });

    it.each(['Authorization', 'authorization', 'X-Internal-API-Key', 'X-Session-Id', 'X-CSRF-Token'])(
        'rejects caller overrides of protected header %s',
        async (headerName) => {
            const fetchImpl = vi.fn();
            const http = createBrainbaseHttpClient({
                baseUrl: 'https://bb.unson.jp', accessToken: 'secret-token', fetchImpl, sessionId: 'test-session'
            });
            await expect(http.request('/api/health', { headers: { [headerName]: 'attacker-value' } }))
                .rejects.toThrow(`protected HTTP header cannot be overridden: ${headerName}`);
            expect(fetchImpl).not.toHaveBeenCalled();
        }
    );

    it('finds an entity through the server-side id filter', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ records: [{ id: 'app_mana' }] }));
        const client = createBrainbaseGraphHttpClient({
            baseUrl: 'https://bb.unson.jp', accessToken: 'secret-token', fetchImpl
        });

        await expect(client.findEntity({ entityType: 'app', entityId: 'app_mana' }))
            .resolves.toEqual({ id: 'app_mana' });
        expect(fetchImpl).toHaveBeenCalledWith(
            'https://bb.unson.jp/api/info/graph/entities?id=app_mana&type=app&limit=1',
            expect.objectContaining({ method: 'GET' })
        );
    });

    it('does not retry an authorization 403', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ token: 'csrf-token' }))
            .mockResolvedValueOnce(jsonResponse({ message: 'Insufficient project access' }, 403));
        const client = createBrainbaseGraphHttpClient({
            baseUrl: 'https://bb.unson.jp', accessToken: 'secret-token', fetchImpl, sessionId: 'test-session'
        });
        await expect(client.upsertEntity({ id: 'app_mana', entityType: 'app', projectCode: 'mana' }))
            .rejects.toThrow('Insufficient project access');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('keeps the environment upsert script on the shared authenticated client', () => {
        const source = fs.readFileSync(path.resolve('scripts/upsert-app-environments.mjs'), 'utf8');
        expect(source).toContain('createBrainbaseGraphHttpClient');
        expect(source).not.toContain("method: 'POST'");
    });

    it('keeps other Brainbase script mutations on the shared HTTP transport', () => {
        const source = fs.readFileSync(path.resolve('scripts/admin-api-path-surface-smoke.mjs'), 'utf8');
        expect(source).toContain('createBrainbaseHttpClient');
        expect(source).not.toContain("fetch(`${baseUrl}/api/csrf-token`");
        expect(source).not.toContain("'X-CSRF-Token'");
    });

});
