import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { registerVibeproHandoffApiRoute } from '../../../server/bootstrap/register-api-routes.js';
import { createVibeproHandoffRouter } from '../../../server/routes/vibepro-handoffs.js';

const actor = {
    personId: 'per_owner', organizationId: 'org_unson', tenantId: 'org_unson',
    projectCodes: ['brainbase'], clearance: ['internal'], role: 'member'
};

function appFor(runtime, authSource = 'bearer', header = 'Bearer local-token') {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.authSource = authSource;
        req.access = actor;
        next();
    });
    app.use('/api/vibepro-handoffs', createVibeproHandoffRouter({ runtime }));
    return { app, header };
}

describe('VibePro handoff routes', () => {
    it('accepts only an explicit verified Bearer or Bearer-carried service token and wires the actor', async () => {
        const runtime = {
            adopt: vi.fn(async (_body, receivedActor) => ({ status: 'adopted', owner: receivedActor.personId })),
            issue: vi.fn(async (_body, receivedActor) => ({ schema_version: 'v2', owner: receivedActor.personId }))
        };
        const { app, header } = appFor(runtime);

        await request(app).post('/api/vibepro-handoffs/adoptions').set('Authorization', header).send({ caseId: 'oc_001' }).expect(201);
        await request(app).post('/api/vibepro-handoffs/issue').set('Authorization', header).send({ caseId: 'oc_001' }).expect(200);
        expect(runtime.adopt).toHaveBeenCalledWith({ caseId: 'oc_001' }, expect.objectContaining({ personId: 'per_owner' }));
        expect(runtime.issue).toHaveBeenCalledWith({ caseId: 'oc_001' }, expect.objectContaining({ organizationId: 'org_unson' }));

        const service = appFor(runtime, 'service-token', 'Bearer bbsvc_local-token');
        await request(service.app).post('/api/vibepro-handoffs/issue').set('Authorization', service.header).send({}).expect(200);
    });

    it.each(['cookie', 'insecure-header', 'internal'])('rejects %s even when a runtime exists', async (authSource) => {
        const runtime = { adopt: vi.fn(), issue: vi.fn() };
        const { app } = appFor(runtime, authSource);
        await request(app).post('/api/vibepro-handoffs/adoptions').set('Authorization', 'Bearer local-token').send({}).expect(403);
        expect(runtime.adopt).not.toHaveBeenCalled();
    });

    it.each(['bearer local-token', 'Bearer  local-token', 'Bearer'])('rejects malformed Bearer headers even when auth classified a cookie as service-token', async (header) => {
        const runtime = { adopt: vi.fn(), issue: vi.fn() };
        const { app } = appFor(runtime, 'service-token');
        await request(app).post('/api/vibepro-handoffs/issue').set('Authorization', header).send({}).expect(403);
        expect(runtime.issue).not.toHaveBeenCalled();
    });

    it('fails closed with 503 when normal bootstrap has no configured runtime', async () => {
        const { app } = appFor(null);
        const response = await request(app).post('/api/vibepro-handoffs/issue').set('Authorization', 'Bearer local-token').send({}).expect(503);
        expect(response.body.error).toBe('vibepro_handoff_unavailable');
    });

    it('uses actual requireAuth classification and rejects malformed or internal alternatives', async () => {
        const runtime = { adopt: vi.fn(), issue: vi.fn(async () => ({ schema_version: 'v2' })) };
        const authService = {
            verifyToken: (token) => {
                if (token !== 'valid-user') throw new Error('invalid token');
                return { ...actor, sub: actor.personId };
            },
            verifyServiceToken: (token) => {
                if (!['bbsvc_service', 'bbsvc_cookie'].includes(token)) throw new Error('invalid service token');
                return { ...actor, sub: actor.personId };
            }
        };
        const app = express();
        app.use(express.json());
        registerVibeproHandoffApiRoute(app, { authService, runtime });

        await request(app).post('/api/vibepro-handoffs/issue').send({}).expect(401);
        await request(app).post('/api/vibepro-handoffs/issue').set('Authorization', 'Bearer invalid').send({}).expect(401);
        await request(app).post('/api/vibepro-handoffs/issue')
            .set('Authorization', 'bearer fake').set('Cookie', 'brainbase_session=bbsvc_cookie').send({}).expect(403);
        await request(app).post('/api/vibepro-handoffs/issue')
            .set('Authorization', 'Bearer bbsvc_service').send({}).expect(200);

        const previousInternalApiSecret = process.env.INTERNAL_API_SECRET;
        process.env.INTERNAL_API_SECRET = 'handoff-internal-test-key';
        try {
            await request(app).post('/api/vibepro-handoffs/issue')
                .set('Authorization', 'Bearer valid-user').set('x-internal-api-key', 'handoff-internal-test-key')
                .send({}).expect(403);
        } finally {
            if (previousInternalApiSecret === undefined) delete process.env.INTERNAL_API_SECRET;
            else process.env.INTERNAL_API_SECRET = previousInternalApiSecret;
        }
    });
});
