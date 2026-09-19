import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createRetiredCapabilityRouter } from '../../../server/routes/retired-capability.js';

describe('retired capability router', () => {
    it.each(['get', 'post', 'put', 'patch', 'delete'])('refuses %s of legacy session state', async method => {
        const app = express();
        app.use('/api/state', createRetiredCapabilityRouter({
            capability: 'brainbase.session-state',
            owner: 'Codex app and CLI',
            replacement: 'Use Codex directly'
        }));
        const response = await request(app)[method]('/api/state');
        expect(response.status).toBe(410);
        expect(response.body.error).toBe('capability_retired');
        expect(response.body).not.toHaveProperty('sessions');
    });

    it('returns an explicit 410 boundary for every method and subpath', async () => {
        const app = express();
        app.use('/api/sessions', createRetiredCapabilityRouter({
            capability: 'brainbase.session-runtime',
            owner: 'Codex app and CLI',
            replacement: 'Use Codex directly'
        }));

        const response = await request(app)
            .post('/api/sessions/session-1/archive')
            .send({});

        expect(response.status).toBe(410);
        expect(response.body).toEqual({
            error: 'capability_retired',
            capability: 'brainbase.session-runtime',
            owner: 'Codex app and CLI',
            replacement: 'Use Codex directly'
        });
    });
});
