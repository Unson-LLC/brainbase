// @ts-check
import { describe, it, expect } from 'vitest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createConfigRouter, requireConfigAuth, requireConfigWriteRole } from '../../../server/routes/config.js';

function makeApp({ actor } = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { if (actor) req.actor = actor; next(); });
    const fakeConfigParser = { getProjects: async () => ({}), getAll: async () => ({}), invalidateCache() {} };
    const fakeConfigService = {
        upsertProject: async () => ({}),
        deleteProject: async () => ({}),
        upsertOrganization: async () => ({}),
        deleteOrganization: async () => ({}),
        updateNotifications: async () => ({}),
        upsertGitHubMapping: async () => ({}),
        deleteGitHubMapping: async () => ({}),
        upsertNocoDBMapping: async () => ({}),
        deleteNocoDBMapping: async () => ({})
    };
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

    it('INV-2: runtime config router is wired with shared requireAuth middleware', () => {
        const source = fs.readFileSync(path.resolve('server/bootstrap/register-api-routes.js'), 'utf8');
        expect(source).toMatch(/import\s+\{\s*requireAuth\s*\}\s+from ['"]\.\.\/middleware\/auth\.js['"]/);
        expect(source).toMatch(/createConfigRouter\([\s\S]*authGuard:\s*requireAuth\(authService\)/);
    });

    it.each([
        ['POST', '/api/config/projects'],
        ['PUT', '/api/config/projects/brainbase'],
        ['DELETE', '/api/config/projects/brainbase'],
        ['POST', '/api/config/organizations'],
        ['PUT', '/api/config/organizations/unson'],
        ['DELETE', '/api/config/organizations/unson'],
        ['PUT', '/api/config/notifications'],
        ['POST', '/api/config/github'],
        ['PUT', '/api/config/github/brainbase'],
        ['DELETE', '/api/config/github/brainbase'],
        ['POST', '/api/config/nocodb'],
        ['PUT', '/api/config/nocodb/brainbase'],
        ['DELETE', '/api/config/nocodb/brainbase']
    ])('INV-2: %s %s without actor → 401', async (method, url) => {
        const app = makeApp();
        const { default: request } = await import('supertest');
        const res = await request(app)[method.toLowerCase()](url).send({});
        expect(res.status).toBe(401);
    });
});
