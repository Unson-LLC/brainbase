import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createKnowledgeCatalogRouter } from '../../server/routes/knowledge-resolution.js';
import { KnowledgeCatalogError } from '../../server/services/knowledge-catalog-service.js';

function createApp(service) {
    const app = express();
    app.use((req, _res, next) => {
        req.access = { projectCodes: ['alpha', 'brainbase'] };
        next();
    });
    app.use('/api/knowledge', createKnowledgeCatalogRouter({ service }));
    return app;
}

describe('knowledge catalog API', () => {
    it('GET /itemsへ認可contextとfilterを渡す', async () => {
        const list = vi.fn(async () => ({ state: 'empty', records: [] }));
        const response = await request(createApp({ list, get: vi.fn() }))
            .get('/api/knowledge/items?project_code=alpha&scope=project')
            .expect(200);

        expect(response.body.state).toBe('empty');
        expect(list).toHaveBeenCalledWith(
            { projectCodes: ['alpha', 'brainbase'] },
            expect.objectContaining({ project_code: 'alpha', scope: 'project' })
        );
    });

    it('既知の認可errorだけを明示し、未知の取得失敗は内部情報を隠す', async () => {
        const forbidden = createApp({
            list: vi.fn(async () => { throw new KnowledgeCatalogError('knowledge_project_not_accessible', 'denied', 403); }),
            get: vi.fn()
        });
        await request(forbidden).get('/api/knowledge/items?project_code=secret')
            .expect(403, { error: { code: 'knowledge_project_not_accessible', message: 'denied' } });

        const failed = createApp({
            list: vi.fn(async () => { throw new Error('database password leaked'); }),
            get: vi.fn()
        });
        const response = await request(failed).get('/api/knowledge/items?project_code=alpha').expect(500);
        expect(response.body.error).toEqual({
            code: 'knowledge_catalog_failed', message: 'Knowledge catalog request failed'
        });
    });

    it('GET /items/:idへidとprojectを渡す', async () => {
        const get = vi.fn(async () => ({ id: 'dec_1' }));
        await request(createApp({ list: vi.fn(), get }))
            .get('/api/knowledge/items/dec_1?project_code=alpha')
            .expect(200, { id: 'dec_1' });
        expect(get).toHaveBeenCalledWith(
            { projectCodes: ['alpha', 'brainbase'] },
            { project_code: 'alpha', id: 'dec_1' }
        );
    });

    it('retrieveとpreviewを別のservice境界へ渡す', async () => {
        const retrieve = vi.fn(async () => ({ results: [] }));
        const preview = vi.fn(async () => ({ isolation: 'draft_only' }));
        const app = createApp({ list: vi.fn(), get: vi.fn(), retrieve, preview });
        await request(app).post('/api/knowledge/retrieve').send({ project_code: 'alpha', refs: [{ id: 'x', version: '1' }] }).expect(200);
        await request(app).post('/api/knowledge/preview').send({ project_code: 'alpha', question: 'q', draft: {} }).expect(200);
        expect(retrieve).toHaveBeenCalledOnce();
        expect(preview).toHaveBeenCalledOnce();
    });
});
