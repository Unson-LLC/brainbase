import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireAuth } from '../../../server/middleware/auth.js';

describe('auth middleware', () => {
    it('returns 401 when token is missing', async () => {
        const app = express();
        const authService = {
            verifyToken: () => ({})
        };
        app.use(requireAuth(authService));
        app.get('/secure', (req, res) => res.json({ ok: true }));

        await request(app)
            .get('/secure')
            .expect(401);
    });

    it('test modeではヘッダー認証が優先される', async () => {
        const app = express();
        const authService = {
            verifyToken: () => ({
                role: 'member',
                projectCodes: ['alpha'],
                clearance: ['internal'],
                personId: 'per_1'
            })
        };
        app.use(requireAuth(authService));
        app.get('/secure', (req, res) => res.json({ access: req.access }));

        const res = await request(app)
            .get('/secure')
            .set('Authorization', 'Bearer dummy')
            .set('x-brainbase-role', 'ceo')
            .set('x-brainbase-projects', 'alpha')
            .expect(200);

        expect(res.body.access.role).toBe('ceo');
        expect(res.body.access.projectCodes).toEqual(['alpha']);
    });

    it('session cookieがある時_cookie認証で通す', async () => {
        const app = express();
        const authService = {
            verifyToken: () => ({
                role: 'member',
                projectCodes: ['brainbase'],
                clearance: ['internal'],
                level: 1,
                employmentType: 'contractor',
                sub: 'per_cookie'
            })
        };
        app.use(requireAuth(authService));
        app.get('/secure', (req, res) => res.json({ access: req.access, source: req.authSource }));

        const res = await request(app)
            .get('/secure')
            .set('Cookie', 'brainbase_session=session-token')
            .expect(200);

        expect(res.body.source).toBe('cookie');
        expect(res.body.access.personId).toBe('per_cookie');
        expect(res.body.access.projectCodes).toEqual(['brainbase']);
    });
});
