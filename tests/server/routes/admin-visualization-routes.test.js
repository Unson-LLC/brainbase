import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { requireAuth } from '../../../server/middleware/auth.js';
import { csrfMiddleware, generateCsrfToken } from '../../../server/middleware/csrf.js';
import { createAdminVisualizationRouter } from '../../../server/routes/admin-visualization.js';

function makeService() {
    return {
        getOverview: vi.fn(async () => ({ ok: true })),
        listGraphEntities: vi.fn(async () => ({ source_class: 'graph_ssot', records: [] })),
        listCandidates: vi.fn(async () => ({ source_class: 'candidate_store', records: [] })),
        listPersonalKg: vi.fn(async () => ({ source_class: 'personal_kg', records: [] })),
        previewContext: vi.fn(async () => ({ source_class: 'ai_context', preview: {}, warnings: [] })),
        getDataFlow: vi.fn(async () => ({ source_class: 'ai_context', steps: [] })),
        getHealth: vi.fn(async () => ({ sources: [] }))
    };
}

function makeAuthedApp(service) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.access = { role: 'gm', projectCodes: ['brainbase'], clearance: ['internal'], personId: 'sato' };
        next();
    });
    app.use('/api/admin', createAdminVisualizationRouter(service));
    return app;
}

function makeAuthedCsrfApp(service) {
    const app = express();
    app.use(express.json());
    app.use(csrfMiddleware());
    app.use((req, _res, next) => {
        req.access = { role: 'gm', projectCodes: ['brainbase'], clearance: ['internal'], personId: 'sato' };
        next();
    });
    app.use('/api/admin', createAdminVisualizationRouter(service));
    return app;
}

describe('admin visualization routes', () => {
    it('S-7 INV-7: unauthenticated /api/admin request is rejected by requireAuth before route data', async () => {
        const service = makeService();
        const app = express();
        app.use('/api/admin', requireAuth({ verifyToken: () => { throw new Error('no token'); } }), createAdminVisualizationRouter(service));
        await request(app).get('/api/admin/overview').expect(401);
        expect(service.getOverview).not.toHaveBeenCalled();
    });

    it('Contract-1: GET /api/admin/overview passes req.access to service', async () => {
        const service = makeService();
        await request(makeAuthedApp(service)).get('/api/admin/overview').expect(200);
        expect(service.getOverview).toHaveBeenCalledWith(expect.objectContaining({ role: 'gm', projectCodes: ['brainbase'] }));
    });

    it('Contract-2 Contract-3 Contract-4: read-only endpoints expose source_class boundaries', async () => {
        const app = makeAuthedApp(makeService());
        expect((await request(app).get('/api/admin/graph/entities').expect(200)).body.source_class).toBe('graph_ssot');
        expect((await request(app).get('/api/admin/candidates').expect(200)).body.source_class).toBe('candidate_store');
        expect((await request(app).get('/api/admin/personal-kg').expect(200)).body.source_class).toBe('personal_kg');
        expect((await request(app).post('/api/admin/context-preview').send({ project: 'brainbase' }).expect(200)).body.source_class).toBe('ai_context');
    });

    it('Contract-5: data-flow and health endpoints pass access and query filters to service', async () => {
        const service = makeService();
        const app = makeAuthedApp(service);
        expect((await request(app).get('/api/admin/data-flow?project=brainbase&candidate=cand_1&entity=project_brainbase').expect(200)).body.source_class).toBe('ai_context');
        expect(service.getDataFlow).toHaveBeenCalledWith(expect.objectContaining({ personId: 'sato' }), expect.objectContaining({ project: 'brainbase', candidate: 'cand_1', entity: 'project_brainbase' }));
        await request(app).get('/api/admin/personal-kg?owner=sato&layer=personal_kg_core').expect(200);
        expect(service.listPersonalKg).toHaveBeenCalledWith(expect.objectContaining({ personId: 'sato' }), expect.objectContaining({ owner: 'sato', layer: 'personal_kg_core' }));
        await request(app).get('/api/admin/health').expect(200);
        expect(service.getHealth).toHaveBeenCalledWith(expect.objectContaining({ role: 'gm' }));
    });

    it('Contract-4: production context preview requires CSRF token before the admin route runs', async () => {
        const previousEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const service = makeService();
            const app = makeAuthedCsrfApp(service);
            await request(app).post('/api/admin/context-preview').send({ project: 'brainbase' }).expect(403);
            expect(service.previewContext).not.toHaveBeenCalled();
            const token = generateCsrfToken('admin-test');
            await request(app)
                .post('/api/admin/context-preview')
                .set('X-Session-Id', 'admin-test')
                .set('X-CSRF-Token', token)
                .send({ project: 'brainbase' })
                .expect(200);
            expect(service.previewContext).toHaveBeenCalledOnce();
        } finally {
            process.env.NODE_ENV = previousEnv;
        }
    });

    it('INV-6 AP-4: mutation-shaped admin routes are not registered', async () => {
        const app = makeAuthedApp(makeService());
        await request(app).post('/api/admin/candidates').send({ id: 'cand_1' }).expect(404);
        await request(app).patch('/api/admin/graph/entities/project_brainbase').send({}).expect(404);
    });
});
