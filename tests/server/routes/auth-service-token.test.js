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

describe('auth service token route', () => {
    it('POST /api/auth/service-tokens はGM以上ならservice tokenを発行する', async () => {
        const authService = {
            normalizeRole: (role) => (['member', 'gm', 'ceo'].includes(role) ? role : 'member'),
            verifyToken: () => ({
                role: 'gm',
                projectCodes: ['unson'],
                clearance: ['internal', 'restricted'],
                personId: 'per_admin',
                organizationId: 'unson'
            }),
            issueServiceToken: vi.fn(() => ({
                token: 'bbsvc_issued',
                token_type: 'Bearer',
                expires_at: '2026-05-01T00:00:00.000Z',
                access: {
                    role: 'gm',
                    projectCodes: ['unson'],
                    clearance: ['internal'],
                    personId: 'svc_hp_unson',
                    employmentType: 'internal_service'
                }
            })),
            createAuditLog: vi.fn(async () => {})
        };
        const app = createApp(authService);

        const res = await request(app)
            .post('/api/auth/service-tokens')
            .set('Authorization', 'Bearer user-token')
            .send({
                name: 'hp_unson production',
                role: 'gm',
                projectCodes: ['unson'],
                clearance: ['internal']
            })
            .expect(201);

        expect(res.body.token).toBe('bbsvc_issued');
        expect(authService.issueServiceToken).toHaveBeenCalledWith(expect.objectContaining({
            name: 'hp_unson production',
            role: 'gm',
            projectCodes: ['unson'],
            clearance: ['internal'],
            createdBy: 'per_admin',
            organizationId: 'unson'
        }));
        expect(authService.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
            eventType: 'SERVICE_TOKEN_ISSUE'
        }));
    });

    it('POST /api/auth/service-tokens はmemberからの発行を拒否する', async () => {
        const authService = {
            normalizeRole: (role) => role || 'member',
            verifyToken: () => ({
                role: 'member',
                projectCodes: ['unson'],
                clearance: ['internal'],
                personId: 'per_member'
            })
        };
        const app = createApp(authService);

        await request(app)
            .post('/api/auth/service-tokens')
            .set('Authorization', 'Bearer user-token')
            .send({ name: 'hp_unson production' })
            .expect(403);
    });

    it('POST /api/auth/service-tokens はGMが自分のproject外に発行することを拒否する', async () => {
        const authService = {
            normalizeRole: (role) => role || 'member',
            verifyToken: () => ({
                role: 'gm',
                projectCodes: ['brainbase'],
                clearance: ['internal'],
                personId: 'per_gm'
            })
        };
        const app = createApp(authService);

        await request(app)
            .post('/api/auth/service-tokens')
            .set('Authorization', 'Bearer user-token')
            .send({ name: 'hp_unson production', projectCodes: ['unson'] })
            .expect(403);
    });
});
