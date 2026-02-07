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

    it('attaches access from token and ignores headers', async () => {
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
            .expect(200);

        expect(res.body.access.role).toBe('member');
        expect(res.body.access.projectCodes).toEqual(['alpha']);
    });
});
