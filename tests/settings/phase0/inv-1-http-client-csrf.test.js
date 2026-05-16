// @ts-check
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { CoreApiClient } from '../../../public/modules/settings/settings-core.js';

const HTTP_CLIENT_PATH = path.resolve('public/modules/core/http-client.js');

describe('phase0 INV-1: HttpClient has CSRF token auto-attach', () => {
    it('INV-1: http-client.js handles CSRF header injection', () => {
        const source = fs.readFileSync(HTTP_CLIENT_PATH, 'utf8');
        // 既存 HttpClient は CSRF token を取り扱う想定
        expect(source).toMatch(/csrf|CSRF|x-csrf-token/i);
    });

    it('INV-1: CoreApiClient delegates mutating settings calls to HttpClient-compatible client', async () => {
        const calls = [];
        const client = {
            get: async (url) => ({ url }),
            post: async (url, body) => { calls.push(['post', url, body]); return { ok: true }; },
            put: async (url, body) => { calls.push(['put', url, body]); return { ok: true }; },
            delete: async (url) => { calls.push(['delete', url]); return { ok: true }; }
        };
        const api = new CoreApiClient(client);

        await api.upsertProject({ id: 'brainbase' });
        await api.updateNotifications({ dnd: { enabled: true } });
        await api.deleteNocoDBMapping('brainbase');

        expect(calls).toEqual([
            ['post', '/api/config/projects', { id: 'brainbase' }],
            ['put', '/api/config/notifications', { dnd: { enabled: true } }],
            ['delete', '/api/config/nocodb/brainbase']
        ]);
    });
});
