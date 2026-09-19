import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createAuthRouter } from '../../../server/routes/auth.js';

function createApp(authService, googleMeetConnectionService) {
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(authService, { googleMeetConnectionService }));
    return app;
}

function oauthStateCookie(state) {
    const digest = crypto.createHash('sha256').update(state, 'utf8').digest('base64url');
    return `brainbase_oauth_state=${digest}`;
}

function authenticatedService(overrides = {}) {
    return {
        verifyToken: vi.fn(() => ({
            personId: 'per_woody',
            organizationId: 'growin'
        })),
        createState: vi.fn(() => 'meet-state-123'),
        consumeState: vi.fn(() => ({ ok: true, redirect: '/settings' })),
        ...overrides
    };
}

describe('Google Meet auth routes', () => {
    it('starts incremental authorization for the authenticated Brainbase user', async () => {
        const authService = authenticatedService();
        const googleMeetConnectionService = {
            buildAuthorizationUrl: vi.fn(() => 'https://accounts.google.com/o/oauth2/v2/auth?scope=meet')
        };
        const app = createApp(authService, googleMeetConnectionService);

        const response = await request(app)
            .get('/api/auth/google/meet/start?json=true')
            .set('Authorization', 'Bearer brainbase-session')
            .expect(200);

        expect(response.body.url).toContain('accounts.google.com');
        expect(authService.createState).toHaveBeenCalledWith({ redirect: '/settings' });
        expect(googleMeetConnectionService.buildAuthorizationUrl).toHaveBeenCalledWith({
            state: 'meet-state-123',
            req: expect.any(Object)
        });
        expect(response.headers['set-cookie']?.join(';')).toContain('brainbase_oauth_state=');
    });

    it('binds the connected Google account to the signed person and organization', async () => {
        const authService = authenticatedService();
        const googleMeetConnectionService = {
            connect: vi.fn(async () => ({ id: 'acc_google_meet_123', status: 'active' }))
        };
        const app = createApp(authService, googleMeetConnectionService);

        const response = await request(app)
            .get('/api/auth/google/meet/callback?code=google-code&state=meet-state-123')
            .set('Authorization', 'Bearer brainbase-session')
            .set('Cookie', oauthStateCookie('meet-state-123'))
            .expect(200);

        expect(response.body).toEqual({
            ok: true,
            account: { id: 'acc_google_meet_123', status: 'active' }
        });
        expect(googleMeetConnectionService.connect).toHaveBeenCalledWith({
            code: 'google-code',
            req: expect.any(Object),
            personId: 'per_woody',
            organizationId: 'growin',
            idempotencyKey: 'meet-state-123'
        });
    });

    it('rejects a callback not started by the same browser before exchanging the code', async () => {
        const authService = authenticatedService();
        const googleMeetConnectionService = { connect: vi.fn() };
        const app = createApp(authService, googleMeetConnectionService);

        await request(app)
            .get('/api/auth/google/meet/callback?code=google-code&state=meet-state-123')
            .set('Authorization', 'Bearer brainbase-session')
            .set('Cookie', oauthStateCookie('other-state'))
            .expect(400, { error: 'Invalid state' });

        expect(authService.consumeState).not.toHaveBeenCalled();
        expect(googleMeetConnectionService.connect).not.toHaveBeenCalled();
    });

    it('requires a signed Brainbase session before starting Google authorization', async () => {
        const authService = authenticatedService({ verifyToken: vi.fn(() => null) });
        const googleMeetConnectionService = { buildAuthorizationUrl: vi.fn() };
        const app = createApp(authService, googleMeetConnectionService);

        await request(app)
            .get('/api/auth/google/meet/start?json=true')
            .expect(401);

        expect(googleMeetConnectionService.buildAuthorizationUrl).not.toHaveBeenCalled();
    });
});
