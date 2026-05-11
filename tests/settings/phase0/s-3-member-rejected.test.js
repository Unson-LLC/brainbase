// @ts-check
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createConfigRouter } from '../../../server/routes/config.js';

describe('phase0 S-3: member role config write → 403', () => {
    it('S-3: actor.role=member cannot upsertProject', async () => {
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => { req.actor = { sub: 'u', role: 'member' }; next(); });
        const cp = { invalidateCache() {} };
        const cs = { upsertProject: async () => ({}) };
        app.use('/api/config', createConfigRouter(cp, cs));
        const res = await request(app).post('/api/config/projects').send({ id: 'x' });
        expect(res.status).toBe(403);
    });
});
