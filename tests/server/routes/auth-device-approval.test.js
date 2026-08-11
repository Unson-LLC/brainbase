import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createAuthRouter } from '../../../server/routes/auth.js';

function createApp(authService) {
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(authService));
    return app;
}

describe('device approval route', () => {
    it('rejects approval without an authenticated token', async () => {
        const authService = { approveDeviceCode: vi.fn() };

        await request(createApp(authService))
            .post('/api/auth/device/approve')
            .send({
                device_code: 'device-code',
                slack_user_id: 'forged-user',
                slack_workspace_id: 'forged-workspace'
            })
            .expect(401);

        expect(authService.approveDeviceCode).not.toHaveBeenCalled();
    });

    it('binds approval to the Slack identity in the verified token', async () => {
        const authService = {
            assertReady: vi.fn(),
            verifyToken: vi.fn(() => ({
                sub: 'person-1',
                slackUserId: 'verified-user',
                slackWorkspaceId: 'verified-workspace'
            })),
            approveDeviceCode: vi.fn()
        };

        await request(createApp(authService))
            .post('/api/auth/device/approve')
            .set('Authorization', 'Bearer valid-token')
            .send({
                device_code: 'device-code',
                slack_user_id: 'forged-user',
                slack_workspace_id: 'forged-workspace'
            })
            .expect(200, { ok: true });

        expect(authService.approveDeviceCode).toHaveBeenCalledWith(
            'device-code',
            'verified-user',
            'verified-workspace'
        );
    });

    it('rejects authenticated principals without a Slack identity', async () => {
        const authService = {
            assertReady: vi.fn(),
            verifyToken: vi.fn(() => ({
                sub: 'service-principal',
                role: 'ceo'
            })),
            approveDeviceCode: vi.fn()
        };

        await request(createApp(authService))
            .post('/api/auth/device/approve')
            .set('Authorization', 'Bearer non-slack-token')
            .send({ device_code: 'device-code' })
            .expect(403);

        expect(authService.approveDeviceCode).not.toHaveBeenCalled();
    });
});
