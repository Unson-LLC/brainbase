import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerOnboardingApiRoute } from '../../../server/bootstrap/register-api-routes.js';
import { csrfMiddleware } from '../../../server/middleware/csrf.js';

function createApp() {
    const startRun = vi.fn(async (actor, input) => ({
        id: 'onb_registered',
        status: 'collecting',
        project_code: input.project_code,
        owner_person_id: actor.personId
    }));
    const app = express();
    app.use(express.json());
    app.use(csrfMiddleware());
    registerOnboardingApiRoute(app, {
        authService: {
            verifyToken: vi.fn((token) => {
                if (token !== 'test-token') throw new Error('invalid token');
                return { sub: 'per_owner', role: 'ceo', projectCodes: ['brainbase'], clearance: ['internal'] };
            })
        },
        onboardingRuntimeService: { startRun }
    });
    return { app, startRun };
}

describe('onboarding production API registration', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    it('unauthenticated requestをproduction auth boundaryで拒否する', async () => {
        const { app, startRun } = createApp();
        const response = await request(app).post('/api/onboarding/runs').send({
            project_code: 'brainbase', value_target: '問い', source_mode: 'drive'
        }).expect(403);
        expect(response.body).toMatchObject({ message: 'CSRF token required' });
        expect(startRun).not.toHaveBeenCalled();
    });

    it('Bearer認証後のmounted routeからruntime serviceを呼ぶ', async () => {
        const { app, startRun } = createApp();
        const response = await request(app).post('/api/onboarding/runs')
            .set('authorization', 'Bearer test-token')
            .send({ project_code: 'brainbase', value_target: '問い', source_mode: 'drive' })
            .expect(201);

        expect(response.body).toMatchObject({
            id: 'onb_registered', project_code: 'brainbase', owner_person_id: 'per_owner'
        });
        expect(startRun).toHaveBeenCalledOnce();
    });

    it('invalid BearerはCSRFを通過してもproduction auth boundaryで拒否する', async () => {
        const { app, startRun } = createApp();
        await request(app).post('/api/onboarding/runs')
            .set('authorization', 'Bearer invalid-token')
            .send({ project_code: 'brainbase', value_target: '問い', source_mode: 'drive' })
            .expect(401);
        expect(startRun).not.toHaveBeenCalled();
    });
});
