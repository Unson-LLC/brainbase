import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../../server/services/graph-embedding-provider.js', () => ({
    createGraphEmbeddingProvider: vi.fn(() => ({
        modelId: 'gemini-embedding-001:768:v2',
        embed: vi.fn(async () => [Array(768).fill(0.01)]),
    })),
}));

import { createInfoSSOTRouter } from '../../../server/routes/info-ssot.js';

const accessFixture = {
    role: 'member',
    projectCodes: ['brainbase'],
    clearance: ['internal']
};

function appFor(infoSSOTService, access = accessFixture) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.authSource = 'bearer';
        req.access = access;
        next();
    });
    app.use('/api/info', createInfoSSOTRouter(infoSSOTService));
    return app;
}

describe('POST /api/info/graph/search', () => {
    it('passes the authenticated project and clearance context into the scoped search', async () => {
        const client = {
            query: vi.fn()
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ rows: [{ total: 1, ready: 1, truncated: 0 }] })
                .mockResolvedValueOnce({ rows: [{ id: 'decision_1', entity_type: 'decision', score: 0.9 }] }),
        };
        const info = {
            withAccessContext: vi.fn(async (_access, handler) => handler(client)),
        };

        const response = await request(appFor(info))
            .post('/api/info/graph/search')
            .send({ query: '検索語', project: 'brainbase', types: ['decision'], top_k: 1 })
            .expect(200);

        expect(response.body).toMatchObject({
            coverage: 'complete',
            records: [{ id: 'decision_1', entity_type: 'decision', score: 0.9 }],
        });
        expect(info.withAccessContext).toHaveBeenCalledWith(expect.objectContaining({
            role: 'member', projectCodes: ['brainbase'], clearance: ['internal'],
        }), expect.any(Function));
    });

    it('returns a scope denial without invoking the provider or a broad fallback', async () => {
        const info = { withAccessContext: vi.fn() };

        const response = await request(appFor(info))
            .post('/api/info/graph/search')
            .send({ query: '別プロジェクト', project: 'other' })
            .expect(403);

        expect(response.body).toMatchObject({ error: 'graph_search_project_denied', code: 'graph_search_project_denied' });
        expect(info.withAccessContext).not.toHaveBeenCalled();
    });
});
