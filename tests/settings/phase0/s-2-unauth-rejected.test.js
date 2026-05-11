// @ts-check
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createConfigRouter } from '../../../server/routes/config.js';

describe('phase0 S-2: unauthenticated config POST → 401', () => {
    it('S-2: anonymous POST /api/config/projects → 401', async () => {
        const app = express();
        app.use(express.json());
        const cp = { invalidateCache() {} };
        const cs = { upsertProject: async () => ({}) };
        app.use('/api/config', createConfigRouter(cp, cs));
        const res = await request(app).post('/api/config/projects').send({ id: 'x' });
        expect(res.status).toBe(401);
    });
});
