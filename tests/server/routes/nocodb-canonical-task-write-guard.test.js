import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNocoDBRouter } from '../../../server/routes/nocodb.js';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/nocodb', createNocoDBRouter());
    return app;
}

describe('retired NocoDB HTTP boundary', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each([
        ['GET', '/api/nocodb/tasks'],
        ['POST', '/api/nocodb/tasks'],
        ['PUT', '/api/nocodb/tasks/42'],
        ['PATCH', '/api/nocodb/tasks/42'],
        ['DELETE', '/api/nocodb/tasks/42'],
        ['GET', '/api/nocodb/issues'],
        ['POST', '/api/nocodb/issues'],
        ['PUT', '/api/nocodb/issues/42'],
        ['GET', '/api/nocodb/unknown/subpath']
    ])('returns 410 for %s %s without reaching NocoDB', async (method, url) => {
        const response = await request(createApp())[method.toLowerCase()](url).send({
            projectId: 'brainbase',
            title: 'must not be written'
        });

        expect(response.status).toBe(410);
        expect(response.body).toEqual({
            error: 'capability_retired',
            capability: 'brainbase.nocodb-api',
            owner: 'Canonical Task PostgreSQL API',
            replacement: 'Use /api/companion/tasks backed by PostgreSQL'
        });
        expect(fetch).not.toHaveBeenCalled();
    });
});
