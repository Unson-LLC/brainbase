import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createBrainbaseOverviewRouter } from '../../../server/routes/brainbase/overview-routes.js';
import { createBrainbaseTrendsRouter } from '../../../server/routes/brainbase/trends-routes.js';

const retirement = {
    error: 'capability_retired',
    capability: 'brainbase.nocodb-auxiliary',
    owner: 'Canonical Graph and Task APIs',
    replacement: 'Use the Graph project catalog and Canonical Task APIs'
};

function retiredApp() {
    const app = express();
    app.use('/api/brainbase', createBrainbaseOverviewRouter({
        projectCatalogParser: {
            getAll: vi.fn(async () => ({ projects: { projects: [] } }))
        },
        projectCatalogAuthGuard: (_req, _res, next) => next(),
        githubService: {},
        systemService: {},
        storageService: {}
    }));
    app.use('/api/brainbase', createBrainbaseTrendsRouter());
    return app;
}

describe('legacy NocoDB auxiliary routes', () => {
    it.each([
        '/api/brainbase/critical-alerts',
        '/api/brainbase/critical-alerts?test=true',
        '/api/brainbase/strategic-overview',
        '/api/brainbase/strategic-overview?test=true',
        '/api/brainbase/projects/example/stats',
        '/api/brainbase/projects/example/stats?test=true'
    ])('returns an explicit retirement for %s', async (path) => {
        const response = await request(retiredApp()).get(path);

        expect(response.status).toBe(410);
        expect(response.body).toEqual(retirement);
    });

    it.each([
        '/api/brainbase/trends?project_id=example',
        '/api/brainbase/trends/heatmap?test=true'
    ])('returns an explicit retirement for %s without fixture fallback', async (path) => {
        const response = await request(retiredApp()).get(path);

        expect(response.status).toBe(410);
        expect(response.body).toEqual(retirement);
    });

    it('keeps Graph project catalog access while reporting retired health enrichment', async () => {
        const projectCatalogParser = {
            getAll: vi.fn(async () => ({
                projects: {
                    projects: [
                        { id: 'graph-project', name: 'Graph Project', nocodb: { project_id: 'legacy-project' } },
                        { id: 'graph-only', name: 'Graph Only' }
                    ]
                }
            }))
        };
        const app = express();
        app.use('/api/brainbase', createBrainbaseOverviewRouter({
            projectCatalogParser,
            projectCatalogAuthGuard: (req, _res, next) => {
                req.access = { projectCodes: ['graph-project', 'graph-only'], role: 'member' };
                next();
            },
            githubService: {},
            systemService: {},
            storageService: {},
            // This object must not be consumed by the Graph catalog route.
            nocodbService: { getProjectStats: vi.fn(() => { throw new Error('NocoDB must not be called'); }) }
        }));

        const response = await request(app).get('/api/brainbase/projects');

        expect(response.status).toBe(200);
        expect(response.body).toEqual([
            {
                id: 'graph-project',
                name: 'Graph Project',
                hasNocodb: true,
                healthStatus: 'unavailable',
                healthSource: 'nocodb_retired',
                healthScore: null,
                overdue: null,
                blocked: null,
                completionRate: null,
                manaScore: null
            },
            {
                id: 'graph-only',
                name: 'Graph Only',
                hasNocodb: false,
                healthStatus: 'unmapped',
                healthSource: 'nocodb_retired',
                healthScore: null,
                overdue: null,
                blocked: null,
                completionRate: null,
                manaScore: null
            }
        ]);
    });
});
