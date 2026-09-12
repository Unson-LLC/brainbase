// @vitest-environment node

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { requirePersonalKnowledgeCompanyAuthority } from '../../../server/middleware/personal-knowledge-company-authority.js';
import { requirePersonalKnowledgeAccess } from '../../../server/middleware/personal-knowledge-access.js';
import { createPersonalKnowledgeRouter } from '../../../server/routes/personal-knowledge.js';
import { createPersonalKnowledgeAuthority } from '../../helpers/personal-knowledge-client-authority.js';

function response() {
    return {
        status: vi.fn(function status() { return this; }),
        json: vi.fn(function json() { return this; })
    };
}

function projectRegistry(projectCode = 'project-a') {
    return {
        resolveProjectBindingById: vi.fn(async ({ tenant_id, project_id }) => ({
            tenant_id,
            project_id,
            project_code: projectCode,
            project_status: 'active'
        }))
    };
}

function tamperSignature(value) {
    const replacement = value[0] === 'A' ? 'B' : 'A';
    return `${replacement}${value.slice(1)}`;
}

async function serviceRequest({
    authority,
    path = '/search',
    method = 'POST',
    body = {},
    projectCodes = ['project-a'],
    authSource = 'service-token',
    env = authority.env,
    now,
    connectionRegistry = projectRegistry()
} = {}) {
    const req = {
        method,
        path,
        body: { company_authority_response: authority.response, ...body },
        query: {},
        params: {},
        authSource,
        access: { projectCodes }
    };
    const res = response();
    const next = vi.fn();
    await requirePersonalKnowledgeCompanyAuthority({
        env,
        connectionRegistry,
        ...(now ? { now: () => now } : {})
    })(req, res, next);
    return { req, res, next };
}

function createApp({
    authority,
    projectCodes = ['project-a'],
    authSource = 'service-token',
    connectionRegistry = projectRegistry()
} = {}) {
    const personalKnowledgeService = {
        ingest: vi.fn(async (input) => ({ accepted: true, input })),
        search: vi.fn(async (input) => ({ accepted: true, input })),
        getCycle: vi.fn(async () => ({ accepted: true })),
        recordFeedback: vi.fn(async () => ({ accepted: true }))
    };
    const promotionService = {
        requestPromotion: vi.fn(),
        decideOwnerPromotion: vi.fn(),
        listOrganizationReviews: vi.fn(),
        saveNormalizedPromotion: vi.fn(),
        reviewOrganizationPromotion: vi.fn()
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.authSource = authSource;
        req.access = { projectCodes };
        next();
    });
    app.use(
        '/api/personal-knowledge',
        requirePersonalKnowledgeCompanyAuthority({ env: authority.env, connectionRegistry }),
        requirePersonalKnowledgeAccess({ env: {} }),
        createPersonalKnowledgeRouter({ personalKnowledgeService, promotionService })
    );
    return { app, personalKnowledgeService, promotionService };
}

describe('requirePersonalKnowledgeCompanyAuthority', () => {
    it('accepts a fresh signed search authority and removes the envelope before routing', async () => {
        const authority = createPersonalKnowledgeAuthority();
        const { req, res, next } = await serviceRequest({ authority, body: { query: '判断', limit: 3 } });

        expect(res.status).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledOnce();
        expect(req.body).toEqual({ query: '判断', limit: 3 });
        expect(req.companyAuthorityAccess).toMatchObject({
            personId: 'person-sato',
            actorPersonId: 'person-sato',
            organizationId: 'organization-tenant-a',
            projectCodes: ['project-a'],
            clearance: ['personal']
        });
    });

    it('resolves a canonical project id to its transport project code before checking access', async () => {
        const authority = createPersonalKnowledgeAuthority({ project: 'project-id-a' });
        const connectionRegistry = projectRegistry('project-a');
        const { req, res, next } = await serviceRequest({ authority, connectionRegistry });

        expect(res.status).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledOnce();
        expect(connectionRegistry.resolveProjectBindingById).toHaveBeenCalledWith({
            tenant_id: authority.context.tenant_context.tenant.tenant_id,
            project_id: 'project-id-a'
        });
        expect(req.companyAuthorityAccess.projectCodes).toEqual(['project-a']);
    });

    it('fails closed when the canonical project resolver is unavailable', async () => {
        const authority = createPersonalKnowledgeAuthority({ project: 'project-id-a' });
        const { res, next } = await serviceRequest({ authority, connectionRegistry: {} });

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('fails closed when the resolver returns a project binding outside transport access', async () => {
        const authority = createPersonalKnowledgeAuthority({ project: 'project-id-a' });
        const connectionRegistry = projectRegistry('project-other');
        const { res, next } = await serviceRequest({ authority, connectionRegistry });

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('accepts a fresh signed write authority and removes the envelope from events', async () => {
        const authority = createPersonalKnowledgeAuthority({ effect: 'write' });
        const { req, res, next } = await serviceRequest({
            authority,
            path: '/events',
            body: { event_id: 'pke_client_1', body: 'private note' }
        });

        expect(res.status).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledOnce();
        expect(req.body).toEqual({ event_id: 'pke_client_1', body: 'private note' });
    });

    it('accepts a Slack external subject distinct from the canonical owner', async () => {
        const authority = createPersonalKnowledgeAuthority({
            owner: 'person-sato',
            canonicalPersonId: 'person-sato',
            externalSubjectId: 'UCLIENT',
            requesterId: 'UCLIENT'
        });
        const { req, res, next } = await serviceRequest({ authority });

        expect(res.status).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledOnce();
        expect(req.companyAuthorityAccess).toMatchObject({
            personId: 'person-sato', actorPersonId: 'person-sato'
        });
    });

    it.each([
        ['outer signature', (authority) => { authority.response.context.integrity.value = tamperSignature(authority.response.context.integrity.value); }],
        ['tenant signature', (authority) => { authority.response.context.tenant_context.integrity.value = tamperSignature(authority.response.context.tenant_context.integrity.value); }]
    ])('rejects %s before the service can run', async (_name, mutate) => {
        const authority = createPersonalKnowledgeAuthority();
        mutate(authority);
        const { res, next } = await serviceRequest({ authority, now: authority.now });

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('logs an explicit safe reason when the company authority public key is missing', async () => {
        const authority = createPersonalKnowledgeAuthority();
        const env = { ...authority.env };
        delete env.BRAINBASE_COMPANY_AUTHORITY_PUBLIC_JWK_JSON;
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const { res, next } = await serviceRequest({ authority, env, now: authority.now });

            expect(res.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
            expect(log).toHaveBeenCalledWith(JSON.stringify({
                event: 'personal_knowledge_company_authority_rejected',
                reason: 'company_authority_public_jwk_missing'
            }));
        } finally {
            log.mockRestore();
        }
    });

    it('preserves a safe ContractError code in the rejection diagnostic', async () => {
        const authority = createPersonalKnowledgeAuthority();
        authority.response.context.integrity.value = tamperSignature(authority.response.context.integrity.value);
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const { res, next } = await serviceRequest({ authority, now: authority.now });

            expect(res.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
            expect(log).toHaveBeenCalledWith(JSON.stringify({
                event: 'personal_knowledge_company_authority_rejected',
                reason: 'AUTHORITY_CONTEXT_INVALID_SIGNATURE'
            }));
        } finally {
            log.mockRestore();
        }
    });

    it('does not emit an unknown uppercase error code in the rejection diagnostic', async () => {
        const authority = createPersonalKnowledgeAuthority();
        const connectionRegistry = {
            resolveProjectBindingById: vi.fn(async () => {
                const error = new Error('upstream secret');
                error.code = 'UPSTREAM_SECRET';
                throw error;
            })
        };
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const { res, next } = await serviceRequest({ authority, connectionRegistry });

            expect(res.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
            expect(log).toHaveBeenCalledWith(JSON.stringify({
                event: 'personal_knowledge_company_authority_rejected',
                reason: 'contract_validation_failed'
            }));
            expect(log.mock.calls.flat().join(' ')).not.toContain('UPSTREAM_SECRET');
        } finally {
            log.mockRestore();
        }
    });

    it('rejects a valid but expired signed context', async () => {
        const now = new Date('2026-09-06T00:00:00.000Z');
        const authority = createPersonalKnowledgeAuthority({
            now,
            issuedAt: '2026-09-05T23:45:00.000Z',
            expiresAt: '2026-09-05T23:50:00.000Z'
        });
        const { res, next } = await serviceRequest({ authority, now });

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it.each([
        ['audience does not match the runtime expectation', 'BRAINBASE_TENANT_RUNTIME_AUDIENCE', 'other-runtime'],
        ['deployment does not match the runtime expectation', 'BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID', 'other-deployment']
    ])('rejects when the signed context %s', async (_name, envKey, expectedValue) => {
        const authority = createPersonalKnowledgeAuthority();
        const env = { ...authority.env, [envKey]: expectedValue };
        const { res, next } = await serviceRequest({ authority, env });

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it.each([
        ['owner differs from signed canonical actor', { canonicalPersonId: 'person-other' }],
        ['resource is outside the owner notes scope', { resourceRef: 'personal://person-sato/profile' }],
        ['read capability is used for events', { path: '/events', authority: { effect: 'read' } }],
        ['transport project is outside signed scope', { projectCodes: ['project-other'] }],
        ['shared channel is used', { channel: 'C123' }],
        ['group DM is used', { channel: 'G123' }],
        ['tenant principal is a service', { principalType: 'service' }],
        ['tenant scope is not personal', { dataScopes: ['internal'] }]
    ])('rejects %s', async (_name, options) => {
        const { path, authority: authorityOptions, projectCodes, ...fixtureOptions } = options;
        const authority = createPersonalKnowledgeAuthority(authorityOptions || fixtureOptions);
        const { res, next } = await serviceRequest({ authority, path: path || '/search', projectCodes });

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects a signed context whose Slack requester is not the outer subject', async () => {
        const authority = createPersonalKnowledgeAuthority({ requesterId: 'UOTHER' });
        const { res, next } = await serviceRequest({ authority });

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects broad effects and capability/effect mismatches', async () => {
        const broad = createPersonalKnowledgeAuthority({ allowedEffects: ['read', 'write'] });
        const mismatch = createPersonalKnowledgeAuthority({ effect: 'write', capability: 'personal_read' });

        for (const authority of [broad, mismatch]) {
            const result = await serviceRequest({ authority });
            expect(result.res.status).toHaveBeenCalledWith(403);
            expect(result.next).not.toHaveBeenCalled();
        }
    });

    it('rejects a generic service token without signed authority, even with body identity claims', async () => {
        const authority = createPersonalKnowledgeAuthority();
        const req = {
            method: 'POST', path: '/search',
            body: { owner_person_id: 'person-sato', organization_id: 'organization-tenant-a', query: '秘密' },
            authSource: 'service-token', access: { projectCodes: ['project-a'] }
        };
        const res = response();
        const next = vi.fn();

        await requirePersonalKnowledgeCompanyAuthority({
            env: authority.env,
            connectionRegistry: projectRegistry()
        })(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('allows an interactive JWT to continue without a signed envelope', async () => {
        const authority = createPersonalKnowledgeAuthority();
        const req = {
            method: 'GET', path: '/search', body: {},
            authSource: 'bearer', access: { projectCodes: ['project-a'] }
        };
        const res = response();
        const next = vi.fn();

        await requirePersonalKnowledgeCompanyAuthority({
            env: authority.env,
            connectionRegistry: projectRegistry()
        })(req, res, next);

        expect(res.status).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledOnce();
    });

    it('rejects a signed envelope from an interactive JWT instead of overriding JWT identity', async () => {
        const authority = createPersonalKnowledgeAuthority();
        const { res, next } = await serviceRequest({ authority, authSource: 'bearer' });

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects service access to GET search and promotion endpoints', async () => {
        const authority = createPersonalKnowledgeAuthority();
        const { app, personalKnowledgeService, promotionService } = createApp({ authority });

        await request(app).get('/api/personal-knowledge/search').query({ q: 'secret' }).expect(403);
        await request(app).post('/api/personal-knowledge/promotions/kpr_1/organization-decision')
            .send({ company_authority_response: authority.response, decision: 'reject' }).expect(403);

        expect(personalKnowledgeService.search).not.toHaveBeenCalled();
        expect(promotionService.reviewOrganizationPromotion).not.toHaveBeenCalled();
    });

    it('routes POST search and POST events without persisting authority metadata', async () => {
        const authority = createPersonalKnowledgeAuthority();
        const writeAuthority = createPersonalKnowledgeAuthority({ effect: 'write' });
        const { app, personalKnowledgeService } = createApp({ authority });
        const searchBody = {
            company_authority_response: authority.response,
            query: 'private note',
            limit: 3
        };
        const eventBody = {
            company_authority_response: writeAuthority.response,
            event_id: 'pke_client_2',
            body: 'private note',
            body_hash: 'sha256:fixture'
        };

        await request(app).post('/api/personal-knowledge/search').send(searchBody).expect(200);
        await request(app).post('/api/personal-knowledge/events').send(eventBody).expect(201);

        expect(personalKnowledgeService.search).toHaveBeenCalledWith(
            { query: 'private note', limit: 3 },
            expect.objectContaining({ access: expect.objectContaining({
                personId: 'person-sato', organizationId: 'organization-tenant-a'
            }) })
        );
        expect(personalKnowledgeService.ingest).toHaveBeenCalledWith(
            { event_id: 'pke_client_2', body: 'private note', body_hash: 'sha256:fixture' },
            expect.objectContaining({ access: expect.objectContaining({ personId: 'person-sato' }) })
        );
        expect(personalKnowledgeService.search.mock.calls[0][0]).not.toHaveProperty('company_authority_response');
        expect(personalKnowledgeService.ingest.mock.calls[0][0]).not.toHaveProperty('company_authority_response');
    });

    it.each([
        ['empty query', { query: '' }],
        ['non-string query', { query: 42 }],
        ['query over 4000 characters', { query: 'x'.repeat(4001) }],
        ['limit zero', { query: 'q', limit: 0 }],
        ['limit over 50', { query: 'q', limit: 51 }],
        ['fractional limit', { query: 'q', limit: 1.5 }],
        ['non-numeric limit', { query: 'q', limit: 'many' }],
        ['boolean limit', { query: 'q', limit: true }]
    ])('rejects %s input', async (_name, input) => {
        const authority = createPersonalKnowledgeAuthority();
        const { app, personalKnowledgeService } = createApp({ authority });

        await request(app).post('/api/personal-knowledge/search').send({
            company_authority_response: authority.response,
            ...input
        }).expect(400);
        expect(personalKnowledgeService.search).not.toHaveBeenCalled();
    });

    it('defaults an omitted search limit without rejecting the request', async () => {
        const authority = createPersonalKnowledgeAuthority();
        const { app, personalKnowledgeService } = createApp({ authority });

        await request(app).post('/api/personal-knowledge/search').send({
            company_authority_response: authority.response,
            query: 'private note'
        }).expect(200);
        expect(personalKnowledgeService.search).toHaveBeenCalledWith(
            { query: 'private note', limit: 10 },
            expect.any(Object)
        );
    });
});
