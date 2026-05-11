// @ts-check
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createConfigRouter } from '../../../server/routes/config.js';

describe('phase0 AP-2: server side enforces role even if UI lies', () => {
    it('AP-2: malicious member sends crafted x-user-level header still 403', async () => {
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => { req.actor = { sub: 'u', role: 'member' }; next(); });
        const cp = { invalidateCache() {} };
        const cs = { upsertProject: async () => ({}) };
        app.use('/api/config', createConfigRouter(cp, cs));
        const res = await request(app)
            .post('/api/config/projects')
            .set('x-user-level', '99')
            .set('x-required-level', '99')
            .send({ id: 'x' });
        expect(res.status).toBe(403);
    });
});
