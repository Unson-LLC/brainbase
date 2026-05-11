// @ts-check
import { describe, it, expect } from 'vitest';
import express from 'express';
import { createConfigRouter, requireConfigAuth, requireConfigWriteRole } from '../../../server/routes/config.js';

function makeApp({ actor } = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { if (actor) req.actor = actor; next(); });
    const fakeConfigParser = { getProjects: async () => ({}), getAll: async () => ({}), invalidateCache() {} };
    const fakeConfigService = { upsertProject: async () => ({}) };
    app.use('/api/config', createConfigRouter(fakeConfigParser, fakeConfigService));
    return app;
}

describe('phase0 INV-2: config write requires auth', () => {
    it('INV-2: POST /api/config/projects without actor → 401', async () => {
        const app = makeApp();
        const { default: request } = await import('supertest');
        const res = await request(app).post('/api/config/projects').send({ id: 'x' });
        expect(res.status).toBe(401);
    });

    it('INV-2: PUT /api/config/projects/:id with member role → 403', async () => {
        const app = makeApp({ actor: { sub: 'u', role: 'member' } });
        const { default: request } = await import('supertest');
        const res = await request(app).put('/api/config/projects/x').send({});
        expect(res.status).toBe(403);
    });

    it('INV-2: middleware exported and composable', () => {
        expect(typeof requireConfigAuth).toBe('function');
        expect(typeof requireConfigWriteRole).toBe('function');
    });
});
