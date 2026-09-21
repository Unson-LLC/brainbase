import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { registerOutcomeServiceContextApiRoute } from '../../../server/bootstrap/register-api-routes.js';

function createApp(services) {
    const app = express();
    app.use(express.json());
    registerOutcomeServiceContextApiRoute(app, { services });
    return app;
}

describe('outcome service context production route bootstrap', () => {
    it('does not intercept unrelated v1 routes when unconfigured', async () => {
        const app = createApp(null);
        app.get('/v1/other', (_req, res) => res.json({ ok: true }));
        const response = await request(app).get('/v1/other');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: true });
    });

    it('unconfigured bootstrap remains fail closed with 503', async () => {
        const response = await request(createApp(null))
            .post('/v1/outcome-service-context:issue')
            .send({ principal: { tenant_id: 'ten_missing' } });

        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({
            code: 'outcome_issuer_unconfigured',
            status: 503,
            retryable: true
        });
    });

    it('configured bootstrap passes the authenticated service identity to the issuer adapter', async () => {
        const issue = vi.fn(async (payload, identity) => ({
            tenant_context: { accepted: true, run_id: payload.persisted.run_id },
            authoritative_snapshot: { identity_subject: identity.subject }
        }));
        const serviceAuth = vi.fn((req, _res, next) => {
            req.serviceIdentity = Object.freeze({
                issuer: 'brainbase',
                subject: 'mana-runtime',
                audience: ['mana-runtime'],
                deployment_id: 'dep_test',
                expires_at: '2099-01-01T00:00:00.000Z',
                capabilities: ['outcome.generate']
            });
            req.serviceTokenClaims = { sub: 'mana-runtime' };
            next();
        });
        const requestPayload = {
            principal: {
                tenant_id: 'ten_01J00000000000000000000000',
                project_id: 'prj_01J00000000000000000000000',
                actor_principal_id: 'service:outcome-generator'
            },
            persisted: {
                contract_id: 'ctr_01J00000000000000000000000',
                contract_version: '1',
                run_id: 'run_01J00000000000000000000000',
                resource_ref: 'meeting-minutes:github'
            },
            required: {
                run_mode: 'normal',
                operation_id: 'op_01J00000000000000000000000'
            },
            profile: 'meeting_minutes_github_v1'
        };

        const response = await request(createApp({ serviceAuth, outcomeServiceContextIssuer: { issue } }))
            .post('/v1/outcome-service-context:issue')
            .set('brainbase-outcome-authority-readback', Buffer.from(JSON.stringify({ authority_revision: '2' }))
                .toString('base64url'))
            .send(requestPayload);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            tenant_context: { accepted: true, run_id: requestPayload.persisted.run_id },
            authoritative_snapshot: { identity_subject: 'mana-runtime' }
        });
        expect(issue).toHaveBeenCalledOnce();
        expect(issue).toHaveBeenCalledWith(requestPayload, expect.objectContaining({
            subject: 'mana-runtime',
            deployment_id: 'dep_test',
            outcomeAuthorityReadback: { authority_revision: '2' }
        }));
    });

    it('does not invoke the issuer when service authentication rejects the request', async () => {
        const issue = vi.fn();
        const serviceAuth = vi.fn((req, res) => res.status(401).json({ code: 'SERVICE_AUTH_INVALID' }));

        const response = await request(createApp({ serviceAuth, outcomeServiceContextIssuer: { issue } }))
            .post('/v1/outcome-service-context:issue')
            .send({});

        expect(response.status).toBe(401);
        expect(issue).not.toHaveBeenCalled();
    });
});
