import { generateKeyPairSync } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
    createPersonalKnowledgePromotionAuthorityGuard,
    createUnavailablePersonalKnowledgePromotionAuthorityGuard
} from '../../../server/middleware/personal-knowledge-promotion-authority.js';
import { createPersonalKnowledgeRouter } from '../../../server/routes/personal-knowledge.js';
import {
    normalizePromotionPayload,
    ownerConsentReceipt
} from '../../../server/services/personal-knowledge/personal-knowledge-normalization.js';
import { PersonalKnowledgePromotionService } from '../../../server/services/personal-knowledge/personal-knowledge-promotion-service.js';
import { buildPersonalKnowledgePromotionAuthority } from '../../../server/services/personal-knowledge/promotion-authority-contract.js';
import { computeBusinessIdempotencyKey } from '../../../server/services/multitenant/contract-usage-ledger.js';
import { createSignedTenantContext, verifyTenantContext } from '../../../server/services/multitenant/tenant-context.js';

const CAPABILITY = 'personal_knowledge_promotion:owner_consent';
const NOW = new Date('2026-08-25T00:01:00.000Z');

function envelope(overrides = {}) {
    const value = {
        schema_version: '1.0', protocol_id: 'mana-brainbase-tenant-context', protocol_version: '1.0',
        issuer: 'brainbase', audience: ['brainbase-api'],
        tenant: { tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV', tenant_revision: '1' },
        workspace_connection: { connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV', connection_revision: '1', status: 'active', provider: 'slack', installation_id: 'i', workspace_id: 'w', app_id: 'a' },
        actor: { principal_id: 'person_a_auth', principal_type: 'person', authenticated_subject_id: 'subject_a' },
        authorization: { organization_ids: ['org_a'], project_ids: ['brainbase'], data_scopes: ['company'], capability_ids: [CAPABILITY] },
        placement: { deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV', profile: 'shared_cloud' },
        slack: { event_id: 'evt_p0_owner_1', channel_id: 'channel_a' },
        correlation_id: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAV', operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        idempotency_key: '', contract_revision: '1',
        credential: { mode: 'cloud_standard', credential_ref: 'credref:a', billing_principal_id: 'billing_a' },
        issued_at: '2026-08-25T00:00:00.000Z', expires_at: '2026-08-25T00:05:00.000Z',
        authority: buildPersonalKnowledgePromotionAuthority({
            action: 'owner_consent', requestId: 'kpr_test',
            normalizedPayloadHash: `sha256:${'1'.repeat(64)}`
        }),
        ...overrides
    };
    value.idempotency_key = computeBusinessIdempotencyKey({
        protocol_id: value.protocol_id, protocol_major: '1', tenant_id: value.tenant.tenant_id,
        connection_id: value.workspace_connection.connection_id,
        slack_event_id: value.slack.event_id, operation_id: value.operation_id
    });
    return value;
}

function harness({ now = NOW, tamper = false, envelopeOverrides = {} } = {}) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const signed = createSignedTenantContext(envelope(envelopeOverrides), { key_id: 'p0-key', private_key: privateKey });
    const supplied = tamper ? { ...signed, actor: { ...signed.actor, principal_id: 'attacker' } } : signed;
    const effect = vi.fn((_req, res) => res.status(204).end());
    const services = {
        tenantContextVerifier: (input) => verifyTenantContext(input, {
            keys: [{ key_id: 'p0-key', status: 'current', public_key: publicKey }],
            audience: 'brainbase-api', deployment_id: signed.placement.deployment_id, now
        })
    };
    const app = express();
    app.use(express.json());
    app.post('/promotions/:requestId/owner-decision', createPersonalKnowledgePromotionAuthorityGuard(services, CAPABILITY), effect);
    return { app, supplied, effect };
}

function header(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function organizationReviewRuntime({
    requestOrganizationId = 'org_a',
    accessOrganizationId = 'org_a',
    ownerPersonId = 'person_owner',
    reviewerPersonId = 'person_reviewer'
} = {}) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const requestId = 'kpr_runtime_scope';
    const normalized = normalizePromotionPayload({
        schema_version: 'personal_knowledge_normalized.v1', kind: 'decision',
        entity: { id: 'decision_runtime_scope', type: 'decision', payload: { statement: '境界外を拒否する' } },
        edges: [], context_entities: [], decision_domain: 'brainbase_architecture',
        sensitivity: 'internal', role_min: 'member'
    });
    const unsigned = envelope();
    unsigned.authorization.capability_ids = ['personal_knowledge_promotion:organization_review'];
    unsigned.authorization.organization_ids = [accessOrganizationId];
    unsigned.actor.principal_id = `${reviewerPersonId}_auth`;
    unsigned.authority = buildPersonalKnowledgePromotionAuthority({
        action: 'organization_review', requestId,
        normalizedPayloadHash: normalized.normalized_payload_hash
    });
    unsigned.idempotency_key = computeBusinessIdempotencyKey({
        protocol_id: unsigned.protocol_id, protocol_major: '1', tenant_id: unsigned.tenant.tenant_id,
        connection_id: unsigned.workspace_connection.connection_id,
        slack_event_id: unsigned.slack.event_id, operation_id: unsigned.operation_id
    });
    const signed = createSignedTenantContext(unsigned, { key_id: 'p0-key', private_key: privateKey });
    const promotionRequest = {
        request_id: requestId, personal_event_id: 'pke_private_scope', owner_person_id: ownerPersonId,
        organization_id: requestOrganizationId, project_code: 'brainbase', status: 'pending_org_review',
        normalized_payload: normalized.normalized, normalized_payload_hash: normalized.normalized_payload_hash,
        owner_consent_receipt_id: 'pkoc_scope'
    };
    const repository = {
        transaction: (work) => work({ client: { query: vi.fn() } }),
        findPromotionRequest: vi.fn(async () => promotionRequest),
        claimPromotionAuthorityUse: vi.fn(), reviewOrganizationPromotionRequest: vi.fn(), createLineage: vi.fn()
    };
    const graphRepository = { commitNormalizedPromotion: vi.fn() };
    const knowledgeEventService = { graphRepository, ingestInTransaction: vi.fn() };
    const promotionService = new PersonalKnowledgePromotionService({
        repository, knowledgeGraphRepository: graphRepository, knowledgeEventService, now: () => NOW
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.personalKnowledgeAccess = {
            personId: reviewerPersonId, actorPersonId: `${reviewerPersonId}_auth`,
            organizationId: accessOrganizationId, projectCodes: ['brainbase'], role: 'gm', clearance: ['internal']
        };
        next();
    });
    app.use(createPersonalKnowledgeRouter({
        personalKnowledgeService: {}, promotionService,
        promotionAuthorityGuards: {
            organization: createPersonalKnowledgePromotionAuthorityGuard({
                tenantContextVerifier: (input) => verifyTenantContext(input, {
                    keys: [{ key_id: 'p0-key', status: 'current', public_key: publicKey }],
                    audience: 'brainbase-api', deployment_id: signed.placement.deployment_id, now: NOW
                })
            }, 'personal_knowledge_promotion:organization_review')
        }
    }));
    return { app, signed, requestId, repository, graphRepository, knowledgeEventService };
}

function expectNoPromotionEffects(runtime) {
    expect(runtime.repository.claimPromotionAuthorityUse).not.toHaveBeenCalled();
    expect(runtime.knowledgeEventService.ingestInTransaction).not.toHaveBeenCalled();
    expect(runtime.graphRepository.commitNormalizedPromotion).not.toHaveBeenCalled();
    expect(runtime.repository.reviewOrganizationPromotionRequest).not.toHaveBeenCalled();
    expect(runtime.repository.createLineage).not.toHaveBeenCalled();
}

describe('Personal KG promotion A0 signed authority boundary', () => {
    it('returns unavailable_connection and leaves downstream effects at zero', async () => {
        const effect = vi.fn((_req, res) => res.status(204).end());
        const app = express();
        app.post('/promotion', createUnavailablePersonalKnowledgePromotionAuthorityGuard(), effect);
        await request(app).post('/promotion').expect(503, {
            error: 'personal_knowledge_promotion_authority_unavailable'
        });
        expect(effect).not.toHaveBeenCalled();
    });

    it('accepts a valid exact-capability signed context', async () => {
        const { app, supplied, effect } = harness();
        await request(app).post('/promotions/kpr_test/owner-decision').set('Brainbase-Tenant-Context', header(supplied)).expect(204);
        expect(effect).toHaveBeenCalledOnce();
    });

    it('rejects an expired context with downstream effects at zero', async () => {
        const { app, supplied, effect } = harness({ now: new Date('2026-08-25T00:05:31.000Z') });
        await request(app).post('/promotions/kpr_test/owner-decision').set('Brainbase-Tenant-Context', header(supplied)).expect(403);
        expect(effect).not.toHaveBeenCalled();
    });

    it('rejects a tampered signature with downstream effects at zero', async () => {
        const { app, supplied, effect } = harness({ tamper: true });
        await request(app).post('/promotions/kpr_test/owner-decision').set('Brainbase-Tenant-Context', header(supplied)).expect(403);
        expect(effect).not.toHaveBeenCalled();
    });

    it('rejects a signed authority for request A when the route targets request B', async () => {
        const { app, supplied, effect } = harness();
        await request(app)
            .post('/promotions/kpr_other/owner-decision')
            .set('Brainbase-Tenant-Context', header(supplied))
            .send({ decision: 'approve' })
            .expect(403);
        expect(effect).not.toHaveBeenCalled();
    });

    it('rejects a body hash different from the signed normalized payload hash', async () => {
        const { app, supplied, effect } = harness();
        await request(app)
            .post('/promotions/kpr_test/owner-decision')
            .set('Brainbase-Tenant-Context', header(supplied))
            .send({ decision: 'approve', normalized_payload_hash: `sha256:${'2'.repeat(64)}` })
            .expect(403);
        expect(effect).not.toHaveBeenCalled();
    });

    it('rejects replay through the HTTP runtime before a second Graph effect', async () => {
        const { publicKey, privateKey } = generateKeyPairSync('ed25519');
        const unsigned = envelope();
        unsigned.authorization.capability_ids = ['personal_knowledge_promotion:organization_review'];
        unsigned.actor.principal_id = 'person_reviewer_auth';
        const normalized = normalizePromotionPayload({
            schema_version: 'personal_knowledge_normalized.v1',
            kind: 'decision',
            entity: {
                id: 'decision_runtime_replay', type: 'decision',
                payload: { statement: '同一署名authorityの再送を拒否する' }
            },
            edges: [], context_entities: [], decision_domain: 'brainbase_architecture',
            sensitivity: 'internal', role_min: 'member'
        });
        unsigned.authority = buildPersonalKnowledgePromotionAuthority({
            action: 'organization_review', requestId: 'kpr_runtime_replay',
            normalizedPayloadHash: normalized.normalized_payload_hash
        });
        const signed = createSignedTenantContext(unsigned, { key_id: 'p0-key', private_key: privateKey });
        const promotionRequest = {
            request_id: 'kpr_runtime_replay', personal_event_id: 'pke_private_runtime',
            owner_person_id: 'person_owner', organization_id: 'org_a', project_code: 'brainbase',
            status: 'pending_org_review', sanitized_preview: 'private preview',
            subject: { type: 'decision', id: 'decision_runtime_replay' },
            body_hash: 'sha256:private', normalized_payload: normalized.normalized,
            normalized_payload_hash: normalized.normalized_payload_hash,
            normalized_by_person_id: 'person_owner_auth', normalized_at: '2026-08-25T00:00:00.000Z',
            normalization_contract_version: 'personal_knowledge_normalized.v1',
            owner_decided_by: 'person_owner_auth', owner_decided_at: '2026-08-25T00:00:00.000Z',
            owner_decision_revision: 1, organization_review_revision: 0
        };
        promotionRequest.owner_consent_receipt_id = ownerConsentReceipt(promotionRequest);
        const claimed = new Set();
        const repository = {
            transaction: (work) => work({ client: { query: vi.fn() } }),
            findPromotionRequest: vi.fn(async () => promotionRequest),
            claimPromotionAuthorityUse: vi.fn(async (use) => {
                if (claimed.has(use.operation_id)) {
                    throw Object.assign(new Error('personal_knowledge_promotion_authority_replayed'), { status: 409 });
                }
                claimed.add(use.operation_id);
            }),
            reviewOrganizationPromotionRequest: vi.fn(async (_id, decision) => {
                Object.assign(promotionRequest, {
                    status: decision.status,
                    organization_review_revision: promotionRequest.organization_review_revision + 1
                });
                return promotionRequest;
            }),
            createLineage: vi.fn(async (lineage) => lineage)
        };
        const graphRepository = {
            commitNormalizedPromotion: vi.fn(async (mutation) => ({ id: mutation.entity.id, edge_count: 0 }))
        };
        const promotionService = new PersonalKnowledgePromotionService({
            repository,
            knowledgeGraphRepository: graphRepository,
            knowledgeEventService: {
                graphRepository,
                ingestInTransaction: vi.fn(async (event) => ({
                    event_id: event.event_id, candidate_id: 'candidate_runtime', semantic_state: 'active'
                })),
                reconcileGraphProjection: vi.fn(async () => undefined)
            },
            now: () => NOW
        });
        const services = {
            tenantContextVerifier: (input) => verifyTenantContext(input, {
                keys: [{ key_id: 'p0-key', status: 'current', public_key: publicKey }],
                audience: 'brainbase-api', deployment_id: signed.placement.deployment_id, now: NOW
            })
        };
        const app = express();
        app.use(express.json());
        app.use((_req, _res, next) => {
            _req.personalKnowledgeAccess = {
                personId: 'person_reviewer', actorPersonId: 'person_reviewer_auth',
                organizationId: 'org_a', projectCodes: ['brainbase'], role: 'gm', clearance: ['internal']
            };
            next();
        });
        app.use(createPersonalKnowledgeRouter({
            personalKnowledgeService: {},
            promotionService,
            promotionAuthorityGuards: {
                organization: createPersonalKnowledgePromotionAuthorityGuard(
                    services,
                    'personal_knowledge_promotion:organization_review'
                )
            }
        }));
        const mutation = (expectedRevision) => request(app)
            .post('/promotions/kpr_runtime_replay/organization-decision')
            .set('Brainbase-Tenant-Context', header(signed))
            .send({
                decision: 'approve',
                expected_organization_review_revision: expectedRevision
            });

        await mutation(0).expect(200);
        await mutation(1).expect(409, { error: 'personal_knowledge_promotion_authority_replayed' });
        expect(graphRepository.commitNormalizedPromotion).toHaveBeenCalledOnce();
        expect(repository.reviewOrganizationPromotionRequest).toHaveBeenCalledOnce();
        expect(repository.createLineage).toHaveBeenCalledOnce();
    });

    it('rejects a valid signed authority for a different authenticated actor before every promotion effect', async () => {
        const { publicKey, privateKey } = generateKeyPairSync('ed25519');
        const normalized = normalizePromotionPayload({
            schema_version: 'personal_knowledge_normalized.v1', kind: 'decision',
            entity: { id: 'decision_runtime_cross_person', type: 'decision', payload: { statement: 'actor境界を拒否する' } },
            edges: [], context_entities: [], decision_domain: 'brainbase_architecture',
            sensitivity: 'internal', role_min: 'member'
        });
        const unsigned = envelope();
        unsigned.authorization.capability_ids = ['personal_knowledge_promotion:organization_review'];
        unsigned.actor.principal_id = 'person_other_auth';
        unsigned.authority = buildPersonalKnowledgePromotionAuthority({
            action: 'organization_review', requestId: 'kpr_runtime_cross_person',
            normalizedPayloadHash: normalized.normalized_payload_hash
        });
        const signed = createSignedTenantContext(unsigned, { key_id: 'p0-key', private_key: privateKey });
        const promotionRequest = {
            request_id: 'kpr_runtime_cross_person', personal_event_id: 'pke_private_cross_person',
            owner_person_id: 'person_owner', organization_id: 'org_a', project_code: 'brainbase',
            status: 'pending_org_review', sanitized_preview: 'private preview',
            subject: { type: 'decision', id: 'decision_runtime_cross_person' },
            body_hash: 'sha256:private', normalized_payload: normalized.normalized,
            normalized_payload_hash: normalized.normalized_payload_hash, owner_consent_receipt_id: 'pkoc_owner_cross_person'
        };
        const repository = {
            transaction: (work) => work({ client: { query: vi.fn() } }),
            findPromotionRequest: vi.fn(async () => promotionRequest),
            claimPromotionAuthorityUse: vi.fn(),
            reviewOrganizationPromotionRequest: vi.fn(),
            createLineage: vi.fn()
        };
        const graphRepository = { commitNormalizedPromotion: vi.fn() };
        const knowledgeEventService = {
            graphRepository,
            ingestInTransaction: vi.fn()
        };
        const promotionService = new PersonalKnowledgePromotionService({
            repository,
            knowledgeGraphRepository: graphRepository,
            knowledgeEventService,
            now: () => NOW
        });
        const services = {
            tenantContextVerifier: (input) => verifyTenantContext(input, {
                keys: [{ key_id: 'p0-key', status: 'current', public_key: publicKey }],
                audience: 'brainbase-api', deployment_id: signed.placement.deployment_id, now: NOW
            })
        };
        const app = express();
        app.use(express.json());
        app.use((_req, _res, next) => {
            _req.personalKnowledgeAccess = {
                personId: 'person_reviewer', actorPersonId: 'person_reviewer_auth',
                organizationId: 'org_a', projectCodes: ['brainbase'], role: 'gm', clearance: ['internal']
            };
            next();
        });
        app.use(createPersonalKnowledgeRouter({
            personalKnowledgeService: {},
            promotionService,
            promotionAuthorityGuards: {
                organization: createPersonalKnowledgePromotionAuthorityGuard(
                    services,
                    'personal_knowledge_promotion:organization_review'
                )
            }
        }));

        await request(app)
            .post('/promotions/kpr_runtime_cross_person/organization-decision')
            .set('Brainbase-Tenant-Context', header(signed))
            .send({ decision: 'approve' })
            .expect(403, { error: 'personal_knowledge_promotion_authority_scope_mismatch' });

        expect(knowledgeEventService.ingestInTransaction).not.toHaveBeenCalled();
        expect(graphRepository.commitNormalizedPromotion).not.toHaveBeenCalled();
        expect(repository.reviewOrganizationPromotionRequest).not.toHaveBeenCalled();
        expect(repository.createLineage).not.toHaveBeenCalled();
        expect(repository.claimPromotionAuthorityUse).not.toHaveBeenCalled();
    });

    it('rejects cross-tenant organization review through the HTTP runtime with every downstream effect at zero', async () => {
        const runtime = organizationReviewRuntime({ requestOrganizationId: 'org_a', accessOrganizationId: 'org_b' });
        await request(runtime.app)
            .post(`/promotions/${runtime.requestId}/organization-decision`)
            .set('Brainbase-Tenant-Context', header(runtime.signed))
            .send({ decision: 'approve' })
            .expect(404, { error: 'personal_knowledge_promotion_not_found' });
        expectNoPromotionEffects(runtime);
    });

    it('rejects owner equals reviewer through the HTTP runtime with every downstream effect at zero', async () => {
        const runtime = organizationReviewRuntime({ ownerPersonId: 'person_reviewer', reviewerPersonId: 'person_reviewer' });
        await request(runtime.app)
            .post(`/promotions/${runtime.requestId}/organization-decision`)
            .set('Brainbase-Tenant-Context', header(runtime.signed))
            .send({ decision: 'approve' })
            .expect(403, { error: 'personal_knowledge_distinct_organization_reviewer_required' });
        expectNoPromotionEffects(runtime);
    });
});
