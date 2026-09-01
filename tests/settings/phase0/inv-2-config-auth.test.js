// @ts-check
import { describe, it, expect } from 'vitest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {
    createConfigRouter,
    requireConfigAuth,
    requireConfigWriteRole,
    requireProjectProfileAuth,
    requireProjectProfileWriteRole
} from '../../../server/routes/config.js';

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
    app.use('/api/config', createConfigRouter(fakeConfigParser, fakeConfigService, null, {
        profileWriteGuard: requireProjectProfileWriteRole
    }));
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
        expect(res.body).toEqual({ error: 'role required: gm or ceo', actual: 'member' });
    });

    it.each([
        ['POST', '/api/config/project-profiles'],
        ['PUT', '/api/config/project-profiles/brainbase'],
        ['POST', '/api/config/project-profiles/brainbase/reconcile']
    ])('INV-2: %s %s with member role → structured 403', async (method, url) => {
        const app = makeApp({ actor: { sub: 'u', role: 'member' } });
        const { default: request } = await import('supertest');
        const res = await request(app)[method.toLowerCase()](url).send({});
        expect(res.status).toBe(403);
        expect(res.body.error).toMatchObject({ code: 'FORBIDDEN' });
    });

    it('INV-2: middleware exported and composable', () => {
        expect(typeof requireConfigAuth).toBe('function');
        expect(typeof requireConfigWriteRole).toBe('function');
        expect(typeof requireProjectProfileAuth).toBe('function');
        expect(typeof requireProjectProfileWriteRole).toBe('function');
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
        ['POST', '/api/config/project-profiles'],
        ['PUT', '/api/config/project-profiles/brainbase'],
        ['GET', '/api/config/project-profiles/brainbase/inspect'],
        ['POST', '/api/config/project-profiles/brainbase/reconcile'],
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
