import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createKnowledgeCatalogRouter } from '../../server/routes/knowledge-resolution.js';
import { KnowledgeCatalogError } from '../../server/services/knowledge-catalog-service.js';

function createApp(service, authoringService = null) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.access = { projectCodes: ['alpha', 'brainbase'], personId: 'per_1', organizationId: 'org_1' };
        next();
    });
    app.use('/api/knowledge', createKnowledgeCatalogRouter({ service, authoringService }));
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
            { projectCodes: ['alpha', 'brainbase'], personId: 'per_1', organizationId: 'org_1' },
            expect.objectContaining({ project_code: 'alpha', scope: 'project' })
        );
    });

    it('repositoryの改訂競合を500へ潰さず409で返す', async () => {
        const conflict = Object.assign(new Error('revision conflict'), {
            code: 'knowledge_revision_version_conflict', status: 409
        });
        const authoringService = { revise: vi.fn(async () => { throw conflict; }) };
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.access = { personId: 'per_1', organizationId: 'org_1', projectCodes: ['alpha'] };
            next();
        });
        app.use('/api/knowledge', createKnowledgeCatalogRouter({ service: {}, authoringService }));

        await request(app).post('/api/knowledge/items/dec_1/revisions')
            .send({ project_code: 'alpha' })
            .expect(409, { error: { code: 'knowledge_revision_version_conflict', message: 'revision conflict' } });
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
            { projectCodes: ['alpha', 'brainbase'], personId: 'per_1', organizationId: 'org_1' },
            { project_code: 'alpha', id: 'dec_1' }
        );
    });

    it('retrieveとcapture proposalとpreviewを別のservice境界へ渡す', async () => {
        const retrieve = vi.fn(async () => ({ results: [] }));
        const captureProposal = vi.fn(async () => ({ state: 'proposed' }));
        const preview = vi.fn(async () => ({ isolation: 'draft_only' }));
        const app = createApp({ list: vi.fn(), get: vi.fn(), retrieve, captureProposal, preview });
        await request(app).post('/api/knowledge/retrieve').send({ project_code: 'alpha', refs: [{ id: 'x', version: '1' }] }).expect(200);
        await request(app).post('/api/knowledge/capture/proposal').send({ project_code: 'alpha', content: 'source' }).expect(200);
        await request(app).post('/api/knowledge/preview').send({ project_code: 'alpha', question: 'q', draft: {} }).expect(200);
        expect(retrieve).toHaveBeenCalledOnce();
        expect(captureProposal).toHaveBeenCalledOnce();
        expect(preview).toHaveBeenCalledOnce();
    });

    it('draft saveとlifecycle/historyをauthoring境界へ渡す', async () => {
        const authoringService = {
            createDraft: vi.fn(async () => ({ draft_id: 'kd_1' })),
            getDraft: vi.fn(), updateDraft: vi.fn(), discardDraft: vi.fn(),
            saveDraft: vi.fn(async () => ({ status: 'saved' })),
            authorityDomains: vi.fn(async () => ({ domains: ['engineering'] })),
            revise: vi.fn(async () => ({ status: 'revised' })),
            supersede: vi.fn(async () => ({ status: 'superseded' })),
            changeLifecycle: vi.fn(async () => ({ status: 'changed' })),
            history: vi.fn(async () => ({ entries: [] }))
        };
        const app = createApp({ list: vi.fn(), get: vi.fn(), retrieve: vi.fn(), preview: vi.fn() }, authoringService);
        await request(app).post('/api/knowledge/drafts').send({ project_code: 'alpha' }).expect(200);
        await request(app).get('/api/knowledge/authority-domains?project_code=alpha').expect(200);
        await request(app).post('/api/knowledge/drafts/kd_1/save').send({ project_code: 'alpha', revision: 1 }).expect(200);
        await request(app).post('/api/knowledge/items/dec_1/lifecycle').send({ project_code: 'alpha', state: 'retired' }).expect(200);
        await request(app).post('/api/knowledge/items/dec_1/revisions').send({ project_code: 'alpha' }).expect(200);
        await request(app).post('/api/knowledge/items/dec_1/supersessions')
            .send({ project_code: 'alpha', superseded_id: 'dec_0' }).expect(200);
        await request(app).get('/api/knowledge/items/dec_1/history?project_code=alpha').expect(200);
        expect(authoringService.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ personId: 'per_1' }), expect.objectContaining({ draft_id: 'kd_1' }));
        expect(authoringService.changeLifecycle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'dec_1' }));
        expect(authoringService.revise).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'dec_1' }));
        expect(authoringService.supersede).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            id: 'dec_1', superseded_id: 'dec_0'
        }));
    });
});
