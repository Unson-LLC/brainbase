import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createConfigRouter } from '../../../server/routes/config.js';

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.actor = { sub: 'person-1', role: 'ceo' };
        req.access = {
            personId: 'person-1',
            role: 'ceo',
            organizationId: 'unson',
            projectCodes: ['brainbase']
        };
        next();
    });
    app.use('/api/config', createConfigRouter({
        getProjects: vi.fn().mockResolvedValue({ projects: [] }),
        getAll: vi.fn().mockResolvedValue({})
    }, {}));
    return app;
}

describe('retired Project Profile API', () => {
    it.each([
        ['post', '/api/config/project-profiles'],
        ['put', '/api/config/project-profiles/brainbase'],
        ['get', '/api/config/project-profiles/brainbase/inspect'],
        ['post', '/api/config/project-profiles/brainbase/reconcile']
    ])('%s %s is no longer mounted', async (method, path) => {
        const response = await request(makeApp())[method](path).send({});
        expect(response.status).toBe(404);
    });
});
