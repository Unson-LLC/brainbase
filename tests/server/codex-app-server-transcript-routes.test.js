import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createSessionRouter } from '../../server/routes/sessions.js';

function createApp(codexAppServerTranscript) {
    const app = express();
    app.use(express.json());
    app.use('/api/sessions', createSessionRouter(
        { codexAppServerTranscript },
        null,
        { get: () => ({ sessions: [] }) }
    ));
    return app;
}

describe('Codex App Server transcript routes', () => {
    it('wires transcript GET and turn POST through the transcript service', async () => {
        const codexAppServerTranscript = {
            ensureSession: vi.fn(async (sessionId) => ({
                sessionId,
                threadId: 'thread-route',
                status: 'ready',
                timeline: [{ id: 'assistant-1', kind: 'assistant', text: 'route transcript' }]
            })),
            startTurn: vi.fn(async (sessionId, text) => ({
                sessionId,
                threadId: 'thread-route',
                status: 'working',
                timeline: [{ id: 'user-1', kind: 'user', text }]
            }))
        };
        const app = createApp(codexAppServerTranscript);

        await request(app)
            .get('/api/sessions/session-route/codex-app-server/transcript')
            .expect(200)
            .expect((response) => {
                expect(response.body).toMatchObject({
                    sessionId: 'session-route',
                    threadId: 'thread-route',
                    timeline: [{ kind: 'assistant', text: 'route transcript' }]
                });
            });

        await request(app)
            .post('/api/sessions/session-route/codex-app-server/turns')
            .send({ text: 'route turn' })
            .expect(200)
            .expect((response) => {
                expect(response.body).toMatchObject({
                    sessionId: 'session-route',
                    status: 'working',
                    timeline: [{ kind: 'user', text: 'route turn' }]
                });
            });

        expect(codexAppServerTranscript.ensureSession).toHaveBeenCalledWith('session-route');
        expect(codexAppServerTranscript.startTurn).toHaveBeenCalledWith('session-route', 'route turn');
    });

    it('preserves transcript service error status and message', async () => {
        const unavailable = new Error('transcript unavailable');
        unavailable.status = 503;
        const codexAppServerTranscript = {
            ensureSession: vi.fn(async () => {
                throw unavailable;
            }),
            startTurn: vi.fn()
        };
        const app = createApp(codexAppServerTranscript);

        await request(app)
            .get('/api/sessions/session-route/codex-app-server/transcript')
            .expect(503)
            .expect((response) => {
                expect(response.body).toEqual({ error: 'transcript unavailable' });
            });
    });
});
