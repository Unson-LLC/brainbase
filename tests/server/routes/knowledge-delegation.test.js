import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createKnowledgeDelegationRouter } from '../../../server/routes/knowledge-delegation.js';
import { createKnowledgeRetrieveRouter } from '../../../server/routes/knowledge-retrieve.js';
import { createKnowledgeRetrieveServiceAuthMiddleware } from '../../../server/middleware/knowledge-retrieve-service-auth.js';
import { AuthService } from '../../../server/services/auth-service.js';
import { KnowledgeDelegationTokenIssuer } from '../../../server/services/knowledge-delegation-token-issuer.js';
import { createManaOutcomeAuthorityReadbackProvider } from '../../../server/services/knowledge-retrieve-binding-provider.js';

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
        tenant_id: 'tenant_1',
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

function signedServiceTokenWithoutKnowledgeRefs(authService) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        typ: 'service',
        sub: 'svc_mana_runtime',
        issuer: 'brainbase',
        subject: 'svc_mana_runtime',
        audience: ['brainbase-api'],
        deployment_id: 'dep_test',
        expires_at: new Date((now + 60) * 1000).toISOString(),
        capabilities: ['knowledge.retrieve'],
        personId: 'svc_mana_runtime',
        projectCodes: ['alpha'],
        organizationId: 'org_1',
        delegated_actor_person_id: 'person_1',
        outcome_contract_id: 'contract_1',
        outcome_contract_version: 3,
        run_id: 'run_1',
        run_mode: 'normal',
        iat: now,
        exp: now + 60
    };
    return `bbsvc_${jwt.sign(payload, authService.serviceTokenSecret)}`;
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
        const serviceBinding = { fetch: vi.fn(async () => ({
            ok: true,
            json: async () => ({
                principal: { tenant_id: 'tenant_1', project_id: 'alpha', actor_principal_id: 'person_1' },
                persisted: {
                    contract_id: 'contract_1', contract_version: '3', run_id: 'run_1',
                    resource_ref: 'meeting-minutes:github', knowledge_refs: delegation.knowledge_refs
                },
                authority_revision: '9', profile_id: 'knowledge_retrieve_v1',
                run_mode: 'normal', contract_status: 'active'
            })
        })) };
        const authorityProvider = createManaOutcomeAuthorityReadbackProvider({
            serviceBinding,
            resource: 'meeting-minutes:github',
            resolveTenantForOrganization: vi.fn(async (organizationId) => ({
                tenant_id: 'tenant_1', organization_id: organizationId
            }))
        });
        const verifyBinding = vi.spyOn(authorityProvider, 'verifyBinding');
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
        expect(claims.tenant_id).toBeUndefined();
        expect(claims.tenantId).toBeUndefined();
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
            tenantId: 'tenant_1',
            personId: 'person_1',
            delegatedActorPersonId: 'person_1',
            organizationId: 'org_1'
        });
        expect(verifyBinding).toHaveBeenCalledWith(
            expect.objectContaining({
                knowledge_refs: delegation.knowledge_refs,
                knowledgeRefs: delegation.knowledge_refs,
                refs: delegation.knowledge_refs
            }),
            expect.objectContaining({ serviceTokenClaims: expect.objectContaining({ knowledge_refs: delegation.knowledge_refs }) })
        );
        expect(serviceBinding.fetch).toHaveBeenCalledTimes(2);
        expect(serviceBinding.fetch.mock.calls.map(([, init]) => JSON.parse(init.body).tenant))
            .toEqual(['tenant_1', 'tenant_1']);
    });

    it.each([
        ['ID差替え', [{ id: 'decision_2', version: 'v2' }]],
        ['version差替え', [{ id: 'decision_1', version: 'v3' }]],
        ['refs追加', [
            { id: 'decision_1', version: 'v2' },
            { id: 'decision_2', version: 'v1' }
        ]]
    ])('署名済みdelegated JWTとretrieve refsの%sを拒否する', async (_label, refs) => {
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
        const catalog = { retrieve: vi.fn(async () => ({ project_code: 'alpha', results: [] })) };
        const app = express();
        app.use(express.json());
        app.use('/api/v1/runtime', createKnowledgeDelegationRouter({ serviceAuth, issuer }));
        app.use('/api/knowledge', createKnowledgeRetrieveRouter({
            service: catalog,
            serviceAuthMiddleware: createKnowledgeRetrieveServiceAuthMiddleware({
                authService,
                bindingVerifier: authorityProvider
            })
        }));

        const delegated = await request(app).post('/api/v1/runtime/knowledge:delegate').send(delegation);
        expect(delegated.status).toBe(200);
        const retrieved = await request(app)
            .post('/api/knowledge/retrieve')
            .set('authorization', `Bearer ${delegated.body.token}`)
            .send({
                project_code: 'alpha',
                refs,
                outcome_contract_id: 'contract_1',
                run_id: 'run_1'
            });
        expect(retrieved.status).toBe(403);
        expect(retrieved.body.code).toBe('KNOWLEDGE_RETRIEVE_BINDING_INVALID');
        expect(authorityProvider.verifyBinding).not.toHaveBeenCalled();
        expect(catalog.retrieve).not.toHaveBeenCalled();
    });

    it('署名済みdelegated JWTのknowledge refs欠落を拒否する', async () => {
        const authService = new AuthService();
        const authorityProvider = {
            verifyBinding: vi.fn(async () => authority())
        };
        const serviceAuth = (req, _res, next) => {
            req.serviceIdentity = Object.freeze({ subject: 'svc_mana_runtime' });
            next();
        };
        const catalog = { retrieve: vi.fn(async () => ({ project_code: 'alpha', results: [] })) };
        const app = express();
        app.use(express.json());
        app.use('/api/knowledge', createKnowledgeRetrieveRouter({
            service: catalog,
            serviceAuthMiddleware: createKnowledgeRetrieveServiceAuthMiddleware({
                authService,
                bindingVerifier: authorityProvider
            })
        }));

        const retrieved = await request(app)
            .post('/api/knowledge/retrieve')
            .set('authorization', `Bearer ${signedServiceTokenWithoutKnowledgeRefs(authService)}`)
            .send({
                project_code: 'alpha',
                refs: delegation.knowledge_refs,
                outcome_contract_id: 'contract_1',
                run_id: 'run_1'
            });
        expect(retrieved.status).toBe(403);
        expect(retrieved.body.code).toBe('KNOWLEDGE_RETRIEVE_BINDING_INVALID');
        expect(authorityProvider.verifyBinding).not.toHaveBeenCalled();
        expect(catalog.retrieve).not.toHaveBeenCalled();
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
