import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createAuthRouter } from '../../../server/routes/auth.js';

function createApp(authService, googleServiceConnectionService) {
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(authService, { googleServiceConnectionService }));
    return app;
}

function oauthStateCookie(state) {
    const digest = crypto.createHash('sha256').update(state, 'utf8').digest('base64url');
    return `brainbase_oauth_state=${digest}`;
}

function authenticatedService(overrides = {}) {
    return {
        verifyToken: vi.fn(() => ({ personId: 'per_woody', organizationId: 'growin' })),
        createState: vi.fn(() => 'gmail-state-123'),
        peekState: vi.fn(() => ({ ok: true, service: 'gmail' })),
        consumeState: vi.fn(() => ({ ok: true, redirect: '/settings', service: 'gmail' })),
        ...overrides
    };
}

describe('Google service auth routes', () => {
    it('starts authenticated service-specific OAuth and binds the selected service to state', async () => {
        const authService = authenticatedService();
        const googleServiceConnectionService = {
            buildAuthorizationUrl: vi.fn(() => 'https://accounts.google.com/o/oauth2/v2/auth?scope=gmail')
        };
        const app = createApp(authService, googleServiceConnectionService);

        const response = await request(app)
            .get('/api/auth/google/start?service=gmail&json=true')
            .set('Authorization', 'Bearer brainbase-session')
            .expect(200);

        expect(response.body.url).toContain('accounts.google.com');
        expect(authService.createState).toHaveBeenCalledWith({ redirect: '/settings', service: 'gmail' });
        expect(googleServiceConnectionService.buildAuthorizationUrl).toHaveBeenCalledWith({
            service: 'gmail', state: 'gmail-state-123', req: expect.any(Object)
        });
    });

    it('uses the service in signed state when handling the callback', async () => {
        const authService = authenticatedService();
        const googleServiceConnectionService = {
            connect: vi.fn(async () => ({
                account_id: 'acc_google_123', service: 'gmail', status: 'connected'
            }))
        };
        const app = createApp(authService, googleServiceConnectionService);

        const response = await request(app)
            .get('/api/auth/google/meet/callback?code=google-code&state=gmail-state-123')
            .set('Authorization', 'Bearer brainbase-session')
            .set('Cookie', oauthStateCookie('gmail-state-123'))
            .expect(200);

        expect(response.body).toEqual({ ok: true, account: {
            account_id: 'acc_google_123', service: 'gmail', status: 'connected'
        } });
        expect(googleServiceConnectionService.connect).toHaveBeenCalledWith({
            code: 'google-code', req: expect.any(Object),
            personId: 'per_woody', organizationId: 'growin',
            idempotencyKey: 'gmail-state-123', service: 'gmail'
        });
    });

    it('returns status for the authenticated person and organization', async () => {
        const authService = authenticatedService();
        const googleServiceConnectionService = {
            status: vi.fn(async () => ({
                service: 'google-calendar', connected: true, status: 'connected', account: {
                    account_id: 'acc_google_123', status: 'connected', capabilities: [
                        'https://www.googleapis.com/auth/calendar.readonly'
                    ]
                }
            }))
        };
        const app = createApp(authService, googleServiceConnectionService);

        const response = await request(app)
            .get('/api/auth/google/meet/status?service=google-calendar')
            .set('Authorization', 'Bearer brainbase-session')
            .expect(200);

        expect(response.body.status).toBe('connected');
        expect(response.body.connected).toBe(true);
        expect(response.body.account.account_id).toBe('acc_google_123');
        expect(googleServiceConnectionService.status).toHaveBeenCalledWith({
            service: 'google-calendar', personId: 'per_woody', organizationId: 'growin'
        });
    });
});
