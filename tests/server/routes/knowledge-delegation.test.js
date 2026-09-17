import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createKnowledgeDelegationRouter } from '../../../server/routes/knowledge-delegation.js';
import { createKnowledgeRetrieveRouter } from '../../../server/routes/knowledge-retrieve.js';
import { createKnowledgeRetrieveServiceAuthMiddleware } from '../../../server/middleware/knowledge-retrieve-service-auth.js';
import { AuthService } from '../../../server/services/auth-service.js';
import { KnowledgeDelegationTokenIssuer } from '../../../server/services/knowledge-delegation-token-issuer.js';

const delegation = Object.freeze({
    organization_id: 'org_1',
    delegated_actor_person_id: 'person_1',
    project_code: 'alpha',
    outcome_contract_id: 'contract_1',
    outcome_contract_version: 3,
    run_id: 'run_1',
    run_mode: 'normal',
    knowledge_refs: [{ id: 'decision_1', version: 'v2' }]
});

function authority(overrides = {}) {
    return {
        organization_id: delegation.organization_id,
        delegated_actor_person_id: delegation.delegated_actor_person_id,
        authorized_project_codes: [delegation.project_code],
        capability: 'knowledge.retrieve',
        outcome_contract_id: delegation.outcome_contract_id,
        run_id: delegation.run_id,
        contract_version: delegation.outcome_contract_version,
        run_mode: delegation.run_mode,
        knowledge_refs: delegation.knowledge_refs,
        authority_revision: '9',
        profile_id: 'knowledge_retrieve_v1',
        ...overrides
    };
}

describe('knowledge delegation production route', () => {
    beforeEach(() => {
        process.env.BRAINBASE_SERVICE_TOKEN_SECRET = 'delegation-test-secret';
        process.env.BRAINBASE_SERVICE_TOKEN_ISSUER = 'brainbase';
        process.env.BRAINBASE_SERVICE_TOKEN_AUDIENCE = 'brainbase-api';
        process.env.BRAINBASE_SERVICE_TOKEN_DEPLOYMENT_ID = 'dep_test';
    });

    it('generic runtime identityから短命tokenを発行しactorとservice subjectを分離してretrieveできる', async () => {
        const authService = new AuthService();
        const authorityProvider = {
            verifyAuthority: vi.fn(async () => authority()),
            verifyBinding: vi.fn(async (_expected, context) => authority({
                service_subject: context.serviceIdentity.subject
            }))
        };
        const issuer = new KnowledgeDelegationTokenIssuer({ authService, authorityProvider, ttlSeconds: 60 });
        const serviceAuth = (req, _res, next) => {
            req.serviceIdentity = Object.freeze({ subject: 'svc_mana_runtime' });
            next();
        };
        const catalog = { retrieve: vi.fn(async (access, input) => ({ access, project_code: input.project_code, results: [] })) };
        const app = express();
        app.use(express.json());
        app.use('/api/v1/runtime', createKnowledgeDelegationRouter({ serviceAuth, issuer }));
        app.use('/api/knowledge', createKnowledgeRetrieveRouter({
            service: catalog,
            serviceAuthMiddleware: createKnowledgeRetrieveServiceAuthMiddleware({ authService, bindingVerifier: authorityProvider })
        }));

        const delegated = await request(app).post('/api/v1/runtime/knowledge:delegate').send(delegation);
        expect(delegated.status).toBe(200);
        expect(delegated.headers['cache-control']).toBe('no-store');
        expect(delegated.body).toMatchObject({
            token: expect.stringMatching(/^bbsvc_/),
            token_type: 'Bearer',
            binding: {
                delegated_actor_person_id: 'person_1',
                service_subject: 'svc_mana_runtime',
                run_mode: 'normal',
                knowledge_refs: delegation.knowledge_refs
            }
        });
        const claims = authService.verifyServiceToken(delegated.body.token);
        expect(claims).toMatchObject({
            sub: 'svc_mana_runtime',
            personId: 'svc_mana_runtime',
            delegated_actor_person_id: 'person_1',
            run_mode: 'normal',
            knowledge_refs: delegation.knowledge_refs
        });
        expect(claims.exp - claims.iat).toBe(60);

        const retrieved = await request(app)
            .post('/api/knowledge/retrieve')
            .set('authorization', `Bearer ${delegated.body.token}`)
            .send({
                project_code: 'alpha',
                refs: delegation.knowledge_refs,
                outcome_contract_id: 'contract_1',
                run_id: 'run_1'
            });
        expect(retrieved.status).toBe(200);
        expect(retrieved.body.access).toMatchObject({
            personId: 'person_1',
            delegatedActorPersonId: 'person_1',
            organizationId: 'org_1'
        });
    });

    it.each([
        ['run mode', { run_mode: 'safe_test' }],
        ['knowledge refs', { knowledge_refs: [{ id: 'decision_2', version: 'v1' }] }]
    ])('authority readbackと%sが異なる場合はtokenを発行しない', async (_label, mismatch) => {
        const authService = new AuthService();
        const authorityProvider = { verifyAuthority: vi.fn(async () => authority(mismatch)) };
        const issuer = new KnowledgeDelegationTokenIssuer({ authService, authorityProvider });
        const app = express();
        app.use(express.json());
        app.use('/api/v1/runtime', createKnowledgeDelegationRouter({
            serviceAuth(req, _res, next) {
                req.serviceIdentity = { subject: 'svc_mana_runtime' };
                next();
            },
            issuer
        }));

        const response = await request(app).post('/api/v1/runtime/knowledge:delegate').send(delegation);
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('KNOWLEDGE_DELEGATION_DENIED');
    });
});
