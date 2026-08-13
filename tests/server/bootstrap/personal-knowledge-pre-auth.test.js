import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerPersonalKnowledgePreAuth } from '../../../server/bootstrap/register-api-routes.js';
import { csrfMiddleware } from '../../../server/middleware/csrf.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SOURCE = path.resolve(TEST_DIR, '../../../server.js');

function createApp(authService) {
    const downstream = vi.fn((_req, res) => res.status(204).end());
    const app = express();
    app.use(express.json());
    registerPersonalKnowledgePreAuth(app, { authService });
    app.use(csrfMiddleware());
    app.post('/api/personal-knowledge/events', downstream);
    app.post('/api/learning/episodes', downstream);
    return { app, downstream };
}

describe('personal knowledge pre-auth registration', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalInternalApiSecret = process.env.INTERNAL_API_SECRET;

    beforeEach(() => {
        process.env.NODE_ENV = 'production';
        process.env.INTERNAL_API_SECRET = 'internal-test-secret';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalInternalApiSecret === undefined) delete process.env.INTERNAL_API_SECRET;
        else process.env.INTERNAL_API_SECRET = originalInternalApiSecret;
    });

    const authService = {
        verifyToken: vi.fn((token) => {
            if (token !== 'valid-token') throw new Error('invalid token');
            return {
                sub: 'per_owner',
                organizationId: 'org_unson',
                role: 'member',
                projectCodes: ['brainbase'],
                clearance: ['internal']
            };
        })
    };

    it.each([
        ['/api/personal-knowledge/events'],
        ['/api/learning/episodes']
    ])('unauthenticated POST %sをCSRFより先に401で拒否する', async (route) => {
        const { app, downstream } = createApp(authService);

        const response = await request(app).post(route).send({}).expect(401);

        expect(response.body).toMatchObject({ error: 'Authorization token required' });
        expect(downstream).not.toHaveBeenCalled();
    });

    it('認証済みブラウザーPOSTのCSRF保護を維持する', async () => {
        const { app, downstream } = createApp(authService);

        const response = await request(app)
            .post('/api/personal-knowledge/events')
            .set('authorization', 'Bearer valid-token')
            .send({})
            .expect(403);

        expect(response.body).toMatchObject({ message: 'CSRF token required' });
        expect(downstream).not.toHaveBeenCalled();
    });

    it('内部サービス認証は認証とCSRFを通過する', async () => {
        const { app, downstream } = createApp(authService);

        await request(app)
            .post('/api/personal-knowledge/events')
            .set('x-internal-api-key', 'internal-test-secret')
            .send({})
            .expect(204);

        expect(downstream).toHaveBeenCalledOnce();
    });

    it('本番serverでpersonal knowledge pre-authをCSRFより先に登録する', () => {
        const source = fs.readFileSync(SERVER_SOURCE, 'utf8');
        const preAuthIndex = source.indexOf('registerPersonalKnowledgePreAuth(app');
        const csrfIndex = source.indexOf('app.use(csrfMiddleware())');

        expect(preAuthIndex).toBeGreaterThan(-1);
        expect(csrfIndex).toBeGreaterThan(preAuthIndex);
    });
});
