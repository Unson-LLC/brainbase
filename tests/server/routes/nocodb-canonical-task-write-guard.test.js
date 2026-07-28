import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNocoDBRouter } from '../../../server/routes/nocodb.js';

const CANONICAL_BASE_ID = 'pva7l2qlu6fdfip';

function createApp({ mappings, canonicalTaskStoreConfig }) {
    const app = express();
    app.use(express.json());
    app.use('/api/nocodb', createNocoDBRouter({
        getNocoDBMappings: vi.fn().mockResolvedValue(mappings)
    }, { canonicalTaskStoreConfig }));
    return app;
}

describe('legacy NocoDB canonical Task write guard', () => {
    beforeEach(() => {
        process.env.NOCODB_BASE_URL = 'https://nocodb.test';
        process.env.NOCODB_API_TOKEN = 'test-token';
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        delete process.env.NOCODB_BASE_URL;
        delete process.env.NOCODB_API_TOKEN;
        vi.unstubAllGlobals();
    });

    it.each([
        ['POST', '/api/nocodb/tasks', {
            projectId: 'brainbase',
            title: 'canonical task'
        }],
        ['PUT', '/api/nocodb/tasks/42', {
            baseId: CANONICAL_BASE_ID,
            fields: { 'ステータス': '進行中' }
        }],
        ['DELETE', '/api/nocodb/tasks/42', {
            baseId: CANONICAL_BASE_ID
        }]
    ])('Given canonical base, when %s mutates legacy Task route, then it returns 409 before NocoDB access', async (method, url, body) => {
        const app = createApp({
            mappings: [{ project_id: 'brainbase', base_id: CANONICAL_BASE_ID }],
            canonicalTaskStoreConfig: { baseId: CANONICAL_BASE_ID }
        });

        const response = await request(app)[method.toLowerCase()](url).send(body);

        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({ code: 'canonical_task_api_required' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('Given canonical identity is unavailable, when a Task mutation is requested, then it fails closed before NocoDB access', async () => {
        const app = createApp({
            mappings: [{ project_id: 'other', base_id: 'other-base' }],
            canonicalTaskStoreConfig: null
        });

        const response = await request(app)
            .put('/api/nocodb/tasks/42')
            .send({ baseId: 'other-base', fields: { 'ステータス': '進行中' } });

        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({ code: 'canonical_task_store_config_unavailable' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('Given a non-canonical base, when legacy Task update runs, then the existing NocoDB path is preserved', async () => {
        fetch
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ list: [{ id: 'other-table', title: 'タスク' }] })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ columns: [{ title: 'Id', pk: true }] })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ Id: 42, 'ステータス': '進行中' })
            });
        const app = createApp({
            mappings: [{ project_id: 'other', base_id: 'other-base' }],
            canonicalTaskStoreConfig: { baseId: CANONICAL_BASE_ID }
        });

        const response = await request(app)
            .put('/api/nocodb/tasks/42')
            .send({ baseId: 'other-base', fields: { 'ステータス': '進行中' } });

        expect(response.status).toBe(200);
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'PATCH' });
    });

    it('Given read-only Task request, when canonical identity is unavailable, then the existing list contract remains available', async () => {
        const app = createApp({ mappings: [], canonicalTaskStoreConfig: null });

        const response = await request(app).get('/api/nocodb/tasks');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ records: [], projects: [] });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('Given an Issue write, when canonical Task identity is unavailable, then the unrelated NocoDB path remains available', async () => {
        fetch
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ list: [{ id: 'issue-table', title: '課題' }] })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ Id: 7, 'タイトル': 'unrelated issue' })
            });
        const app = createApp({
            mappings: [{ project_id: 'other', base_id: 'other-base' }],
            canonicalTaskStoreConfig: null
        });

        const response = await request(app)
            .post('/api/nocodb/issues')
            .send({ projectId: 'other', title: 'unrelated issue' });

        expect(response.status).toBe(201);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST' });
    });
});
