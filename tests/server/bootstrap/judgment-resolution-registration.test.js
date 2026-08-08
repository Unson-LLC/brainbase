import express from 'express';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerJudgmentResolutionApiRoute } from '../../../server/bootstrap/register-api-routes.js';
import { csrfMiddleware } from '../../../server/middleware/csrf.js';
import { canonicalJson, computeRequestDigest } from '../../../server/services/judgment-resolution-service.js';

const secret = 'registration-secret';
const now = new Date('2026-08-07T00:00:00.000Z');
const payload = {
    request: '意味を説明して', turn_id: 'turn-registration', project_code: 'brainbase',
    classification_proposal: { intent: 'answer', domains: ['general'], action_kind: 'none', risk: 'low', confidence: 'confirmed', signals: [] }
};

function headers() {
    const digest = computeRequestDigest(payload);
    const signaturePayload = canonicalJson(['brainbase-judgment-binding-v1', 'brainbase-mcp', '1', payload.turn_id, now.toISOString(), digest]);
    return {
        'x-brainbase-judgment-adapter': 'brainbase-mcp', 'x-brainbase-judgment-version': '1',
        'x-brainbase-judgment-issued-at': now.toISOString(), 'x-brainbase-judgment-request-digest': digest,
        'x-brainbase-judgment-signature': createHmac('sha256', secret).update(signaturePayload).digest('hex')
    };
}

function createApp() {
    const resolve = vi.fn(() => ({ resolution_id: 'jr_registered', status: 'resolved' }));
    const app = express();
    app.use(express.json());
    app.use(csrfMiddleware());
    registerJudgmentResolutionApiRoute(app, {
        authService: {
            verifyToken: vi.fn((token) => {
                if (token !== 'test-token') throw new Error('invalid token');
                return { sub: 'person_owner', tenantId: 'unson', role: 'ceo', projectCodes: ['brainbase'] };
            })
        },
        service: { resolve, hasHostBinding: vi.fn(() => true) }, bindingSecret: secret, now: () => now
    });
    return { app, resolve };
}

describe('judgment resolution production API registration', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    it('unauthenticated requestをresolver前で拒否する', async () => {
        const { app, resolve } = createApp();
        const response = await request(app).post('/api/judgment/resolve').set(headers()).send(payload).expect(403);
        expect(response.body).toMatchObject({ message: 'CSRF token required' });
        expect(resolve).not.toHaveBeenCalled();
    });

    it('invalid BearerはCSRFを通過してもauth boundaryで拒否する', async () => {
        const { app, resolve } = createApp();
        await request(app).post('/api/judgment/resolve')
            .set('authorization', 'Bearer invalid-token').set(headers()).send(payload).expect(401);
        expect(resolve).not.toHaveBeenCalled();
    });

    it('Bearer exemptionを近接pathや別methodへ広げない', async () => {
        const { app } = createApp();
        await request(app).post('/api/judgment/resolve/other')
            .set('authorization', 'Bearer test-token').send(payload).expect(403);
        await request(app).put('/api/judgment/resolve')
            .set('authorization', 'Bearer test-token').send(payload).expect(403);
    });

    it('strict authとbinding検証後だけresolverを呼ぶ', async () => {
        const { app, resolve } = createApp();
        await request(app).post('/api/judgment/resolve').set('authorization', 'Bearer test-token').set(headers()).send(payload).expect(200);
        expect(resolve).toHaveBeenCalledOnce();
        expect(resolve.mock.calls[0][1]).toMatchObject({
            access: { personId: 'person_owner', tenantId: 'unson', projectCodes: ['brainbase'] },
            hostBinding: { status: 'managed' }
        });
    });
});
