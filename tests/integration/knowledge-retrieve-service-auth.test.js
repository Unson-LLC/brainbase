import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
    createKnowledgeRetrieveServiceAuthMiddleware
} from '../../server/middleware/knowledge-retrieve-service-auth.js';
import {
    createKnowledgeRetrieveRouter,
    KNOWLEDGE_RETRIEVE_REQUEST_CONTRACT,
    KNOWLEDGE_RETRIEVE_RESPONSE_CONTRACT
} from '../../server/routes/knowledge-retrieve.js';

const TOKEN = 'bbsvc_verified-service-token';
const REQUEST = {
    project_code: 'alpha',
    refs: [{ id: 'item-1', version: '1' }],
    outcome_contract_id: 'oc_1',
    run_id: 'run_1'
};

function createAuthService(claims = {}) {
    return {
        serviceTokenIssuer: 'brainbase',
        serviceTokenAudience: ['mana-runtime'],
        serviceTokenDeploymentId: 'dep_1',
        verifyServiceToken: vi.fn(() => ({
            issuer: 'brainbase',
            subject: 'svc_mana',
            audience: ['mana-runtime'],
            deployment_id: 'dep_1',
            expires_at: '2030-01-01T00:00:00.000Z',
            capabilities: ['knowledge.retrieve'],
            ...claims
        }))
    };
}

function createApp({ authService = createAuthService(), binding = {}, bindingVerifier, service } = {}) {
    const retrieveService = service || {
        retrieve: vi.fn(async (access, input) => ({
            project_code: input.project_code,
            results: [{ id: 'item-1', access }]
        }))
    };
    const verifier = bindingVerifier === undefined ? vi.fn(async () => ({
        organization_id: 'org_1',
        delegated_actor_person_id: 'person_1',
        authorized_project_codes: ['alpha'],
        capability: 'knowledge.retrieve',
        outcome_contract_id: 'oc_1',
        run_id: 'run_1',
        service_subject: 'svc_mana',
        ...binding
    })) : bindingVerifier;
    const app = express();
    app.use(express.json());
    app.use('/api/knowledge', createKnowledgeRetrieveRouter({
        service: retrieveService,
        serviceAuthMiddleware: createKnowledgeRetrieveServiceAuthMiddleware({
            authService,
            bindingVerifier: verifier,
            now: () => new Date('2026-09-17T00:00:00.000Z')
        })
    }));
    return { app, authService, verifier, service: retrieveService };
}

describe('Mana Knowledge retrieve service-auth boundary', () => {
    it('publishes a concrete request/response contract compatible with catalog output', () => {
        expect(KNOWLEDGE_RETRIEVE_REQUEST_CONTRACT.required).toEqual([
            'project_code', 'refs', 'outcome_contract_id', 'run_id'
        ]);
        expect(KNOWLEDGE_RETRIEVE_REQUEST_CONTRACT.capability).toBe('knowledge.retrieve');
        expect(KNOWLEDGE_RETRIEVE_RESPONSE_CONTRACT.required).toEqual(['project_code', 'results']);
    });

    it('accepts only a verified bbsvc token and passes persisted binding access to catalog', async () => {
        const { app, verifier, service } = createApp();
        const response = await request(app)
            .post('/api/knowledge/retrieve')
            .set('authorization', `Bearer ${TOKEN}`)
            .send(REQUEST)
            .expect(200);

        expect(verifier).toHaveBeenCalledWith(expect.objectContaining({
            project_code: 'alpha',
            outcome_contract_id: 'oc_1',
            run_id: 'run_1',
            capability: 'knowledge.retrieve',
            service_subject: 'svc_mana'
        }), expect.objectContaining({ serviceIdentity: expect.objectContaining({ subject: 'svc_mana' }) }));
        expect(service.retrieve).toHaveBeenCalledWith(expect.objectContaining({
            organizationId: 'org_1',
            personId: 'person_1',
            delegatedActorPersonId: 'person_1',
            projectCodes: ['alpha'],
            capability: 'knowledge.retrieve'
        }), REQUEST);
        expect(response.body).toMatchObject({ project_code: 'alpha', results: [{ id: 'item-1' }] });
    });

    it('rejects non-bbsvc bearer and untrusted internal/insecure headers before catalog', async () => {
        const { app, authService, service } = createApp();
        for (const headers of [
            { authorization: 'Bearer user-token' },
            { 'x-internal-api-key': 'secret' },
            { 'x-role': 'ceo' },
            { 'x-mana': 'org_1' }
        ]) {
            const response = await request(app).post('/api/knowledge/retrieve').set(headers).send(REQUEST);
            expect(response.status).toBe(401);
            expect(response.body.code).toBe('SERVICE_AUTH_INVALID');
        }
        expect(authService.verifyServiceToken).not.toHaveBeenCalled();
        expect(service.retrieve).not.toHaveBeenCalled();
    });

    it('rejects actor and tenant supplied in the request body', async () => {
        const { app, service } = createApp();
        for (const body of [
            { ...REQUEST, actor: 'attacker' },
            { ...REQUEST, organization_id: 'org_attacker' }
        ]) {
            const response = await request(app).post('/api/knowledge/retrieve')
                .set('authorization', `Bearer ${TOKEN}`).send(body);
            expect(response.status).toBe(400);
            expect(response.body.code).toBe('KNOWLEDGE_RETRIEVE_INPUT_INVALID');
        }
        expect(service.retrieve).not.toHaveBeenCalled();
    });

    it.each([
        ['tenant', { organization_id: null }],
        ['actor', { delegated_actor_person_id: null }],
        ['project', { authorized_project_codes: ['secret'] }],
        ['outcome contract', { outcome_contract_id: 'oc_other' }],
        ['run', { run_id: 'run_other' }],
        ['capability', { capability: 'knowledge.write' }]
    ])('rejects persisted %s binding mismatch', async (_name, binding) => {
        const { app, service } = createApp({ binding });
        const response = await request(app).post('/api/knowledge/retrieve')
            .set('authorization', `Bearer ${TOKEN}`).send(REQUEST);
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('KNOWLEDGE_RETRIEVE_BINDING_INVALID');
        expect(service.retrieve).not.toHaveBeenCalled();
    });

    it('rejects a project outside the persisted authorized project codes', async () => {
        const { app, service } = createApp({ binding: { authorized_project_codes: ['beta'] } });
        const response = await request(app).post('/api/knowledge/retrieve')
            .set('authorization', `Bearer ${TOKEN}`).send(REQUEST);
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('KNOWLEDGE_RETRIEVE_BINDING_INVALID');
        expect(service.retrieve).not.toHaveBeenCalled();
    });

    it('fails closed when verifier, repository or service-auth configuration is missing', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/knowledge', createKnowledgeRetrieveRouter({
            service: { retrieve: vi.fn() },
            serviceAuthMiddleware: createKnowledgeRetrieveServiceAuthMiddleware()
        }));
        const response = await request(app).post('/api/knowledge/retrieve')
            .set('authorization', `Bearer ${TOKEN}`).send(REQUEST);
        expect(response.status).toBe(503);
        expect(response.body.code).toBe('KNOWLEDGE_RETRIEVE_BINDING_UNAVAILABLE');

        const noVerifier = createApp({ bindingVerifier: null });
        const noVerifierResponse = await request(noVerifier.app).post('/api/knowledge/retrieve')
            .set('authorization', `Bearer ${TOKEN}`).send(REQUEST);
        expect(noVerifierResponse.status).toBe(503);
        expect(noVerifierResponse.body.code).toBe('KNOWLEDGE_RETRIEVE_BINDING_UNAVAILABLE');
    });

    it('validates issuer, audience, deployment and expiry through AuthService service-auth', async () => {
        for (const claims of [
            { issuer: 'other' },
            { audience: ['other'] },
            { deployment_id: 'dep_other' },
            { expires_at: '2020-01-01T00:00:00.000Z' },
            { capabilities: [] }
        ]) {
            const { app, service } = createApp({ authService: createAuthService(claims) });
            const response = await request(app).post('/api/knowledge/retrieve')
                .set('authorization', `Bearer ${TOKEN}`).send(REQUEST);
            expect(response.status).toBe(401);
            expect(response.body.code).toBe('SERVICE_AUTH_INVALID');
            expect(service.retrieve).not.toHaveBeenCalled();
        }
    });
});
