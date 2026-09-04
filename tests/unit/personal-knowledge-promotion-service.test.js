import { describe, expect, it, vi } from 'vitest';

import { PersonalKnowledgePromotionService } from '../../server/services/personal-knowledge/personal-knowledge-promotion-service.js';
import {
    normalizePromotionPayload,
    ownerConsentReceipt
} from '../../server/services/personal-knowledge/personal-knowledge-normalization.js';
import { buildPersonalKnowledgePromotionAuthority } from '../../server/services/personal-knowledge/promotion-authority-contract.js';

const ownerAccess = {
    personId: 'person_a', actorPersonId: 'person_a_auth', organizationId: 'org_a',
    role: 'member', projectCodes: ['brainbase'], clearance: ['internal']
};
const reviewerAccess = {
    personId: 'person_reviewer', actorPersonId: 'person_reviewer_auth', organizationId: 'org_a',
    role: 'gm', projectCodes: ['brainbase'], clearance: ['internal']
};

let authoritySequence = 0;
function authorityFor(access, capabilityId, overrides = {}) {
    authoritySequence += 1;
    const action = capabilityId.endsWith(':request')
        ? 'request'
        : capabilityId.endsWith(':owner_consent') ? 'owner_consent' : 'organization_review';
    const target = buildPersonalKnowledgePromotionAuthority({
        action,
        personalEventId: overrides.personalEventId || 'pke_1',
        requestId: overrides.requestId || (action === 'request' ? null : 'kpr_1'),
        normalizedPayloadHash: action === 'request'
            ? null
            : (overrides.normalizedPayloadHash
                || normalizePromotionPayload(normalizedDecision()).normalized_payload_hash)
    });
    return {
        capabilityId,
        actorPersonId: access.actorPersonId || access.personId,
        organizationIds: [access.organizationId],
        projectIds: ['brainbase'],
        operationId: `op_test_${authoritySequence}`,
        idempotencyKey: `ik_test_${authoritySequence}`,
        ...target
    };
}
const requestContext = (access = ownerAccess, overrides = {}) => ({ access, promotionAuthority: authorityFor(access, 'personal_knowledge_promotion:request', overrides) });
const ownerContext = (access = ownerAccess, overrides = {}) => ({ access, promotionAuthority: authorityFor(access, 'personal_knowledge_promotion:owner_consent', overrides) });
const organizationContext = (access = reviewerAccess, overrides = {}) => ({ access, promotionAuthority: authorityFor(access, 'personal_knowledge_promotion:organization_review', overrides) });

function transaction(handler) {
    return handler({ client: { id: 'tx', query: vi.fn() } });
}

function requestFixture(overrides = {}) {
    return {
        request_id: 'kpr_1',
        personal_event_id: 'pke_private_1',
        owner_person_id: 'person_a',
        organization_id: 'org_a',
        project_code: 'brainbase',
        status: 'pending_owner_approval',
        owner_decision_revision: 0,
        organization_review_revision: 0,
        sanitized_preview: '個人用の元メモ',
        subject: { type: 'decision', id: 'decision_1' },
        body_hash: 'sha256:source_evidence',
        ...overrides
    };
}

function normalizedDecision() {
    return {
        schema_version: 'personal_knowledge_normalized.v1',
        kind: 'decision',
        entity: {
            id: 'decision_1',
            type: 'decision',
            payload: { statement: '組織版では本人データの暗黙fallbackを禁止する' }
        },
        edges: [],
        context_entities: [],
        decision_domain: 'brainbase_architecture',
        sensitivity: 'internal',
        role_min: 'member'
    };
}

function normalizedRelation() {
    return {
        schema_version: 'personal_knowledge_normalized.v1',
        kind: 'relation',
        entity: {
            id: 'project_brainbase',
            type: 'project',
            payload: { name: 'Brainbase', status: 'active' }
        },
        edges: [{
            from_id: 'project_brainbase',
            to_id: 'org_unson',
            relation: 'owned_by',
            payload: { effective: true }
        }],
        context_entities: [{ id: 'org_unson', type: 'org' }],
        sensitivity: 'internal',
        role_min: 'member'
    };
}

function normalizeFixture(payload) {
    return normalizePromotionPayload(payload);
}

function consentedRequest(payload = normalizedDecision(), overrides = {}) {
    const normalization = normalizeFixture(payload);
    const request = requestFixture({
        status: 'pending_org_review',
        owner_decision_revision: 1,
        organization_review_revision: 0,
        owner_decided_by: 'person_a_auth',
        owner_decided_at: '2026-08-14T00:00:00.000Z',
        normalized_payload: normalization.normalized,
        normalized_payload_hash: normalization.normalized_payload_hash,
        normalized_by_person_id: 'person_a_auth',
        normalized_at: '2026-08-13T00:00:00.000Z',
        normalization_contract_version: 'personal_knowledge_normalized.v1'
    });
    request.owner_consent_receipt_id = ownerConsentReceipt(request);
    return { ...request, ...overrides };
}

function promotionHarness({ request, eventResult = null, graphEdgeCount = 0 } = {}) {
    const repository = {
        transaction: vi.fn(transaction),
        findPromotionRequest: vi.fn(async () => request),
        claimPromotionAuthorityUse: vi.fn(async () => undefined),
        saveNormalizedPromotionPayload: vi.fn(async (_id, normalization, options) => {
            Object.assign(request, {
                normalized_payload: normalization.normalized_payload,
                normalized_payload_hash: normalization.normalized_payload_hash,
                normalized_by_person_id: options.access.actorPersonId,
                normalized_at: normalization.normalized_at,
                owner_consent_receipt_id: normalization.owner_consent_receipt_id,
                normalization_contract_version: normalization.contract_version
            });
            return request;
        }),
        reviewOrganizationPromotionRequest: vi.fn(async (_id, decision, options) => ({
            ...request,
            status: decision.status,
            organization_reviewed_by: options.access.actorPersonId,
            organization_review_reason: decision.reason,
            organization_event_id: decision.organization_event_id,
            graph_entity_id: decision.graph_entity_id,
            organization_review_receipt_id: decision.organization_review_receipt_id
        })),
        createLineage: vi.fn(async (lineage) => lineage)
    };
    const knowledgeGraphRepository = {
        commitNormalizedPromotion: vi.fn(async (mutation) => ({
            id: mutation.entity.id,
            edge_count: graphEdgeCount
        }))
    };
    const knowledgeEventService = {
        graphRepository: knowledgeGraphRepository,
        ingestInTransaction: vi.fn(async (event) => eventResult || ({
            event_id: event.event_id,
            candidate_id: 'candidate_1',
            semantic_state: 'active'
        })),
        reconcileGraphProjection: vi.fn(async () => undefined)
    };
    const service = new PersonalKnowledgePromotionService({
        repository,
        knowledgeEventService,
        knowledgeGraphRepository,
        now: () => new Date('2026-08-15T00:00:00.000Z')
    });
    return { service, repository, knowledgeGraphRepository, knowledgeEventService };
}

describe('PersonalKnowledgePromotionService two-stage organization promotion', () => {
    it('rejects omitted authority before every promotion side effect', async () => {
        const repository = {
            transaction: vi.fn(transaction),
            findById: vi.fn(async () => ({
                event_id: 'pke_1', owner_person_id: 'person_a', organization_id: 'org_a'
            })),
            createPromotionRequest: vi.fn()
        };
        const service = new PersonalKnowledgePromotionService({ repository });
        await expect(service.requestPromotion('pke_1', {
            project_code: 'brainbase', summary: '共有可能な判断', normalized_payload: normalizedDecision()
        }, { access: ownerAccess })).rejects.toMatchObject({
            message: 'personal_knowledge_promotion_authority_required', status: 403
        });
        expect(repository.createPromotionRequest).not.toHaveBeenCalled();
    });

    it('rejects unknown_tenant and ambiguous_tenant authority before Graph effects', async () => {
        const request = consentedRequest();
        const { service, knowledgeGraphRepository } = promotionHarness({ request });
        const baseAuthority = {
            capabilityId: 'personal_knowledge_promotion:organization_review',
            actorPersonId: reviewerAccess.actorPersonId,
            organizationIds: ['org_unknown'], projectIds: ['brainbase'],
            operationId: 'op_unknown', idempotencyKey: 'ik_unknown',
            ...buildPersonalKnowledgePromotionAuthority({
                action: 'organization_review', requestId: 'kpr_1',
                normalizedPayloadHash: normalizePromotionPayload(normalizedDecision()).normalized_payload_hash
            })
        };
        await expect(service.reviewOrganizationPromotion('kpr_1', { decision: 'approve' }, {
            access: reviewerAccess, promotionAuthority: baseAuthority
        })).rejects.toMatchObject({ message: 'personal_knowledge_promotion_authority_scope_mismatch', status: 403 });
        await expect(service.reviewOrganizationPromotion('kpr_1', { decision: 'approve' }, {
            access: reviewerAccess,
            promotionAuthority: {
                ...baseAuthority, organizationIds: ['org_a', 'org_b'],
                operationId: 'op_ambiguous', idempotencyKey: 'ik_ambiguous'
            }
        })).rejects.toMatchObject({ message: 'personal_knowledge_promotion_authority_scope_mismatch', status: 403 });
        expect(knowledgeGraphRepository.commitNormalizedPromotion).not.toHaveBeenCalled();
    });

    it('rejects a valid signed authority for a different authenticated actor before every organization effect', async () => {
        const request = consentedRequest();
        const { service, repository, knowledgeGraphRepository, knowledgeEventService } = promotionHarness({ request });
        const crossPersonAuthority = authorityFor(
            { ...reviewerAccess, actorPersonId: 'person_other_auth' },
            'personal_knowledge_promotion:organization_review'
        );

        await expect(service.reviewOrganizationPromotion('kpr_1', { decision: 'approve' }, {
            access: reviewerAccess,
            promotionAuthority: crossPersonAuthority
        })).rejects.toMatchObject({
            message: 'personal_knowledge_promotion_authority_scope_mismatch', status: 403
        });

        expect(knowledgeEventService.ingestInTransaction).not.toHaveBeenCalled();
        expect(knowledgeGraphRepository.commitNormalizedPromotion).not.toHaveBeenCalled();
        expect(repository.reviewOrganizationPromotionRequest).not.toHaveBeenCalled();
        expect(repository.createLineage).not.toHaveBeenCalled();
        expect(repository.claimPromotionAuthorityUse).not.toHaveBeenCalled();
    });

    it('rejects a signed authority for request A when the transaction targets request B', async () => {
        const request = consentedRequest();
        const { service, repository, knowledgeGraphRepository, knowledgeEventService } = promotionHarness({ request });
        const authorityForOtherRequest = authorityFor(
            reviewerAccess,
            'personal_knowledge_promotion:organization_review',
            { requestId: 'kpr_other' }
        );

        await expect(service.reviewOrganizationPromotion('kpr_1', { decision: 'approve' }, {
            access: reviewerAccess,
            promotionAuthority: authorityForOtherRequest
        })).rejects.toMatchObject({
            message: 'personal_knowledge_promotion_authority_scope_mismatch', status: 403
        });

        expect(knowledgeEventService.ingestInTransaction).not.toHaveBeenCalled();
        expect(knowledgeGraphRepository.commitNormalizedPromotion).not.toHaveBeenCalled();
        expect(repository.reviewOrganizationPromotionRequest).not.toHaveBeenCalled();
        expect(repository.createLineage).not.toHaveBeenCalled();
        expect(repository.claimPromotionAuthorityUse).not.toHaveBeenCalled();
    });

    it('rejects a signed authority for a different normalized payload before every organization effect', async () => {
        const request = consentedRequest();
        const { service, repository, knowledgeGraphRepository, knowledgeEventService } = promotionHarness({ request });
        const authorityWithOtherHash = authorityFor(
            reviewerAccess,
            'personal_knowledge_promotion:organization_review',
            { normalizedPayloadHash: `sha256:${'f'.repeat(64)}` }
        );

        await expect(service.reviewOrganizationPromotion('kpr_1', { decision: 'approve' }, {
            access: reviewerAccess,
            promotionAuthority: authorityWithOtherHash
        })).rejects.toMatchObject({
            message: 'personal_knowledge_promotion_authority_scope_mismatch', status: 403
        });

        expect(knowledgeEventService.ingestInTransaction).not.toHaveBeenCalled();
        expect(knowledgeGraphRepository.commitNormalizedPromotion).not.toHaveBeenCalled();
        expect(repository.reviewOrganizationPromotionRequest).not.toHaveBeenCalled();
        expect(repository.createLineage).not.toHaveBeenCalled();
        expect(repository.claimPromotionAuthorityUse).not.toHaveBeenCalled();
    });

    it('returns no_data for a missing Personal event before promotion effects', async () => {
        const repository = {
            transaction: vi.fn(transaction), findById: vi.fn(async () => null), createPromotionRequest: vi.fn()
        };
        const service = new PersonalKnowledgePromotionService({ repository });
        await expect(service.requestPromotion('pke_missing', {
            project_code: 'brainbase', summary: 'missing', normalized_payload: normalizedDecision()
        }, { access: ownerAccess })).rejects.toMatchObject({
            message: 'personal_knowledge_event_not_found', status: 404
        });
        expect(repository.createPromotionRequest).not.toHaveBeenCalled();
    });

    it('rejects replayed signed authority before a second Graph effect', async () => {
        const request = consentedRequest();
        const { service, repository, knowledgeGraphRepository } = promotionHarness({ request });
        const claimed = new Set();
        repository.claimPromotionAuthorityUse = vi.fn(async (use) => {
            if (claimed.has(use.operation_id)) {
                throw Object.assign(new Error('personal_knowledge_promotion_authority_replayed'), { status: 409 });
            }
            claimed.add(use.operation_id);
        });
        const promotionAuthority = {
            capabilityId: 'personal_knowledge_promotion:organization_review',
            actorPersonId: reviewerAccess.actorPersonId,
            organizationIds: [reviewerAccess.organizationId],
            projectIds: ['brainbase'],
            operationId: 'op_replay_1',
            idempotencyKey: 'ik_replay_1',
            ...buildPersonalKnowledgePromotionAuthority({
                action: 'organization_review', requestId: 'kpr_1',
                normalizedPayloadHash: request.normalized_payload_hash
            })
        };

        await service.reviewOrganizationPromotion('kpr_1', {
            decision: 'approve', expected_organization_review_revision: 0
        }, {
            access: reviewerAccess, promotionAuthority
        });
        await expect(service.reviewOrganizationPromotion('kpr_1', {
            decision: 'approve', expected_organization_review_revision: 0
        }, {
            access: reviewerAccess, promotionAuthority
        })).rejects.toThrow('personal_knowledge_promotion_authority_replayed');

        expect(knowledgeGraphRepository.commitNormalizedPromotion).toHaveBeenCalledOnce();
    });

    it('stores the exact normalized payload before owner review and never publishes at request time', async () => {
        const repository = {
            transaction: vi.fn(transaction),
            findById: vi.fn(async () => ({
                event_id: 'pke_1', owner_person_id: 'person_a', organization_id: 'org_a',
                body: '共有可能な判断。secret=abc', body_hash: 'sha256:x'
            })),
            createPromotionRequest: vi.fn(async (request) => request)
        };
        const knowledgeEventService = { ingest: vi.fn() };
        const service = new PersonalKnowledgePromotionService({ repository, knowledgeEventService });

        const result = await service.requestPromotion('pke_1', {
            project_code: 'brainbase',
            summary: '共有可能な判断',
            subject: { type: 'decision', id: 'decision_1', raw_private_note: 'secret=abc' },
            normalized_payload: normalizedDecision()
        }, requestContext());

        expect(result).toMatchObject({
            status: 'pending_owner_approval',
            sanitized_preview: '共有可能な判断',
            subject: { type: 'decision', id: 'decision_1' },
            normalized_payload: normalizedDecision(),
            owner_consent_receipt_id: null
        });
        expect(result.normalized_payload_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(knowledgeEventService.ingest).not.toHaveBeenCalled();
        await expect(service.requestPromotion('pke_1', {
            project_code: 'brainbase',
            summary: '共有可能な判断',
            subject: { type: 'decision', id: '/Users/ksato/private-note' },
            normalized_payload: normalizedDecision()
        }, requestContext())).rejects.toThrow('personal_knowledge_promotion_requires_safe_subject');
    });

    it('rejects a promotion request without the exact normalized payload to consent to', async () => {
        const repository = {
            transaction: vi.fn(transaction),
            findById: vi.fn(async () => ({
                event_id: 'pke_1', owner_person_id: 'person_a', organization_id: 'org_a'
            })),
            createPromotionRequest: vi.fn()
        };
        const service = new PersonalKnowledgePromotionService({ repository });
        await expect(service.requestPromotion('pke_1', {
            project_code: 'brainbase', summary: '共有可能な判断'
        }, requestContext())).rejects.toThrow('personal_knowledge_normalized_payload_required');
        expect(repository.createPromotionRequest).not.toHaveBeenCalled();
    });

    it('moves owner approval only to pending_org_review and keeps Graph write at zero', async () => {
        const normalization = normalizeFixture(normalizedDecision());
        const request = requestFixture({
            normalized_payload: normalization.normalized,
            normalized_payload_hash: normalization.normalized_payload_hash
        });
        const repository = {
            transaction: vi.fn(transaction),
            findPromotionRequest: vi.fn(async () => request),
            decideOwnerPromotionRequest: vi.fn(async (_id, decision, options) => ({
                ...request,
                status: decision.status,
                owner_decided_by: options.access.actorPersonId,
                owner_decided_at: decision.decided_at,
                owner_consent_receipt_id: decision.owner_consent_receipt_id
            }))
        };
        const knowledgeEventService = { ingest: vi.fn() };
        const service = new PersonalKnowledgePromotionService({
            repository, knowledgeEventService, now: () => new Date('2026-08-14T00:00:00.000Z')
        });

        const result = await service.decideOwnerPromotion('kpr_1', {
            decision: 'approve',
            normalized_payload_hash: normalization.normalized_payload_hash,
            expected_owner_decision_revision: 0
        }, ownerContext());

        expect(result).toMatchObject({
            status: 'pending_org_review',
            owner_decided_by: 'person_a_auth',
            owner_decided_at: '2026-08-14T00:00:00.000Z',
            owner_consent_receipt_id: expect.stringMatching(/^pkoc_[a-f0-9]{24}$/)
        });
        expect(repository.decideOwnerPromotionRequest).toHaveBeenCalledWith(
            'kpr_1',
            expect.objectContaining({ expected_owner_decision_revision: '0' }),
            expect.any(Object)
        );
        expect(knowledgeEventService.ingest).not.toHaveBeenCalled();
    });

    it('rejects replayed owner-consent authority before returning an already approved request', async () => {
        const request = consentedRequest();
        const { service, repository, knowledgeEventService, knowledgeGraphRepository } = promotionHarness({ request });
        const claimed = new Set();
        repository.claimPromotionAuthorityUse = vi.fn(async (use) => {
            if (claimed.has(use.operation_id)) {
                throw Object.assign(new Error('personal_knowledge_promotion_authority_replayed'), { status: 409 });
            }
            claimed.add(use.operation_id);
        });
        const promotionAuthority = authorityFor(
            ownerAccess,
            'personal_knowledge_promotion:owner_consent',
            { normalizedPayloadHash: request.normalized_payload_hash }
        );
        const context = { access: ownerAccess, promotionAuthority };
        const input = {
            decision: 'approve',
            normalized_payload_hash: request.normalized_payload_hash,
            expected_owner_decision_revision: 1
        };

        await expect(service.decideOwnerPromotion('kpr_1', input, context)).resolves.toBe(request);
        await expect(service.decideOwnerPromotion('kpr_1', input, context)).rejects.toMatchObject({
            message: 'personal_knowledge_promotion_authority_replayed', status: 409
        });

        expect(repository.claimPromotionAuthorityUse).toHaveBeenCalledTimes(2);
        expect(knowledgeEventService.ingestInTransaction).not.toHaveBeenCalled();
        expect(knowledgeGraphRepository.commitNormalizedPromotion).not.toHaveBeenCalled();
        expect(repository.reviewOrganizationPromotionRequest).not.toHaveBeenCalled();
        expect(repository.createLineage).not.toHaveBeenCalled();
    });

    it('rejects stale or substituted payload hashes before recording owner consent', async () => {
        const normalization = normalizeFixture(normalizedDecision());
        const request = requestFixture({
            normalized_payload: normalization.normalized,
            normalized_payload_hash: normalization.normalized_payload_hash
        });
        const repository = {
            transaction: vi.fn(transaction),
            findPromotionRequest: vi.fn(async () => request),
            decideOwnerPromotionRequest: vi.fn()
        };
        const service = new PersonalKnowledgePromotionService({ repository });
        await expect(service.decideOwnerPromotion('kpr_1', {
            decision: 'approve', normalized_payload_hash: `sha256:${'0'.repeat(64)}`
        }, ownerContext())).rejects.toMatchObject({
            message: 'personal_knowledge_promotion_authority_scope_mismatch', status: 403
        });
        expect(repository.decideOwnerPromotionRequest).not.toHaveBeenCalled();
    });

    it('rejects a stale owner decision revision before claiming authority', async () => {
        const normalization = normalizeFixture(normalizedDecision());
        const request = requestFixture({
            owner_decision_revision: 2,
            normalized_payload: normalization.normalized,
            normalized_payload_hash: normalization.normalized_payload_hash
        });
        const repository = {
            transaction: vi.fn(transaction),
            findPromotionRequest: vi.fn(async () => request),
            claimPromotionAuthorityUse: vi.fn(),
            decideOwnerPromotionRequest: vi.fn()
        };
        const service = new PersonalKnowledgePromotionService({ repository });

        await expect(service.decideOwnerPromotion('kpr_1', {
            decision: 'approve',
            normalized_payload_hash: normalization.normalized_payload_hash,
            expected_owner_decision_revision: 1
        }, ownerContext())).rejects.toMatchObject({
            message: 'personal_knowledge_promotion_stale_revision', status: 409,
            details: expect.objectContaining({
                action: 'owner_consent', expected_revision: '1', current_revision: '2'
            })
        });
        expect(repository.claimPromotionAuthorityUse).not.toHaveBeenCalled();
        expect(repository.decideOwnerPromotionRequest).not.toHaveBeenCalled();
    });

    it('requires a distinct organization reviewer with GM/CEO role in the same project', async () => {
        const request = requestFixture({ status: 'pending_org_review' });
        const repository = {
            transaction: vi.fn(transaction),
            findPromotionRequest: vi.fn(async () => request)
        };
        const service = new PersonalKnowledgePromotionService({ repository });

        await expect(service.reviewOrganizationPromotion('kpr_1', { decision: 'reject' }, { access: ownerAccess }))
            .rejects.toMatchObject({ message: 'personal_knowledge_organization_reviewer_required', status: 403 });
        await expect(service.reviewOrganizationPromotion('kpr_1', { decision: 'reject' }, {
            access: { ...ownerAccess, role: 'gm' }
        })).rejects.toMatchObject({
            message: 'personal_knowledge_distinct_organization_reviewer_required', status: 403
        });
        await expect(service.reviewOrganizationPromotion('kpr_1', { decision: 'reject' }, {
            access: { ...reviewerAccess, projectCodes: ['other'] }
        })).rejects.toMatchObject({ message: 'personal_knowledge_project_access_denied', status: 403 });
    });

    it('rejects cross-tenant review before every organization-side effect', async () => {
        const request = consentedRequest();
        const { service, repository, knowledgeGraphRepository, knowledgeEventService } = promotionHarness({ request });
        await expect(service.reviewOrganizationPromotion('kpr_1', { decision: 'approve' }, {
            access: { ...reviewerAccess, organizationId: 'org_b' }
        })).rejects.toMatchObject({ message: 'personal_knowledge_promotion_not_found', status: 404 });
        expect(knowledgeEventService.ingestInTransaction).not.toHaveBeenCalled();
        expect(knowledgeGraphRepository.commitNormalizedPromotion).not.toHaveBeenCalled();
        expect(repository.reviewOrganizationPromotionRequest).not.toHaveBeenCalled();
        expect(repository.createLineage).not.toHaveBeenCalled();
    });

    it('records organization rejection without creating a Knowledge Event or Graph mutation', async () => {
        const request = requestFixture({ status: 'pending_org_review' });
        const repository = {
            transaction: vi.fn(transaction),
            findPromotionRequest: vi.fn(async () => request),
            reviewOrganizationPromotionRequest: vi.fn(async (_id, decision, options) => ({
                ...request,
                status: decision.status,
                organization_reviewed_by: options.access.actorPersonId,
                organization_review_reason: decision.reason
            }))
        };
        const knowledgeEventService = { ingest: vi.fn() };
        const service = new PersonalKnowledgePromotionService({ repository, knowledgeEventService });

        const result = await service.reviewOrganizationPromotion('kpr_1', {
            decision: 'reject',
            reason: '組織知識としては局所的',
            expected_organization_review_revision: 0
        }, organizationContext());

        expect(result).toMatchObject({
            status: 'org_rejected',
            organization_reviewed_by: 'person_reviewer_auth',
            organization_review_reason: '組織知識としては局所的'
        });
        expect(repository.reviewOrganizationPromotionRequest).toHaveBeenCalledWith(
            'kpr_1',
            expect.objectContaining({ expected_organization_review_revision: '0' }),
            expect.any(Object)
        );
        expect(knowledgeEventService.ingest).not.toHaveBeenCalled();
    });

    it('keeps the owner-selected normalized payload immutable', async () => {
        const request = consentedRequest();
        const { service, repository } = promotionHarness({ request });

        await expect(service.saveNormalizedPromotion('kpr_1', {
            normalized_payload: normalizedRelation()
        }, ownerContext())).rejects.toMatchObject({
            message: 'personal_knowledge_promotion_already_decided', status: 409
        });
        expect(repository.saveNormalizedPromotionPayload).not.toHaveBeenCalled();
    });

    it('claims owner consent authority for normalized-payload PUT and rejects the same signed replay', async () => {
        const normalization = normalizeFixture(normalizedDecision());
        const request = requestFixture({
            normalized_payload: normalization.normalized,
            normalized_payload_hash: normalization.normalized_payload_hash
        });
        const { service, repository, knowledgeEventService, knowledgeGraphRepository } = promotionHarness({ request });
        const claimed = new Set();
        repository.claimPromotionAuthorityUse = vi.fn(async (use) => {
            if (claimed.has(use.operation_id)) {
                throw Object.assign(new Error('personal_knowledge_promotion_authority_replayed'), { status: 409 });
            }
            claimed.add(use.operation_id);
        });
        const promotionAuthority = authorityFor(ownerAccess, 'personal_knowledge_promotion:owner_consent');
        const context = { access: ownerAccess, promotionAuthority };

        await expect(service.saveNormalizedPromotion('kpr_1', {
            normalized_payload: normalizedDecision()
        }, context)).resolves.toMatchObject({
            request_id: 'kpr_1', idempotent: true
        });
        await expect(service.saveNormalizedPromotion('kpr_1', {
            normalized_payload: normalizedDecision()
        }, context)).rejects.toMatchObject({
            message: 'personal_knowledge_promotion_authority_replayed', status: 409
        });

        expect(repository.claimPromotionAuthorityUse).toHaveBeenCalledTimes(2);
        expect(repository.claimPromotionAuthorityUse).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                operation_id: promotionAuthority.operationId,
                action: 'owner_consent',
                request_id: 'kpr_1'
            }),
            expect.objectContaining({ access: ownerAccess, client: expect.any(Object) })
        );
        expect(knowledgeEventService.ingestInTransaction).not.toHaveBeenCalled();
        expect(knowledgeGraphRepository.commitNormalizedPromotion).not.toHaveBeenCalled();
        expect(repository.reviewOrganizationPromotionRequest).not.toHaveBeenCalled();
        expect(repository.createLineage).not.toHaveBeenCalled();
    });

    it('rejects forbidden raw transcript, private fields, and server-controlled evidence', async () => {
        const repository = {
            transaction: vi.fn(transaction),
            findById: vi.fn(async () => ({
                event_id: 'pke_1', owner_person_id: 'person_a', organization_id: 'org_a'
            })),
            createPromotionRequest: vi.fn()
        };
        const service = new PersonalKnowledgePromotionService({ repository });
        const payload = normalizedDecision();
        payload.entity.payload.raw_transcript = '個人の会話全文';

        await expect(service.requestPromotion('pke_1', {
            project_code: 'brainbase', summary: '共有可能な判断', normalized_payload: payload
        }, {
            ...requestContext()
        })).rejects.toMatchObject({ message: 'personal_knowledge_normalized_payload_forbidden_field' });
        expect(repository.createPromotionRequest).not.toHaveBeenCalled();
    });

    it('keeps organization approval fail-closed until normalization and owner receipt exist', async () => {
        const request = requestFixture({ status: 'pending_org_review' });
        const repository = {
            transaction: vi.fn(transaction),
            findPromotionRequest: vi.fn(async () => request),
            reviewOrganizationPromotionRequest: vi.fn()
        };
        const knowledgeEventService = { ingest: vi.fn() };
        const service = new PersonalKnowledgePromotionService({ repository, knowledgeEventService });

        await expect(service.reviewOrganizationPromotion('kpr_1', {
            decision: 'approve', expected_organization_review_revision: 0
        }, {
            ...organizationContext()
        })).rejects.toMatchObject({ message: 'personal_knowledge_normalized_payload_required', status: 409 });
        expect(repository.reviewOrganizationPromotionRequest).not.toHaveBeenCalled();
        expect(knowledgeEventService.ingest).not.toHaveBeenCalled();
    });

    it('rejects a stale organization review revision before Knowledge Event or Graph effects', async () => {
        const request = consentedRequest(normalizedDecision(), { organization_review_revision: 2 });
        const { service, repository, knowledgeGraphRepository, knowledgeEventService } = promotionHarness({ request });

        await expect(service.reviewOrganizationPromotion('kpr_1', {
            decision: 'approve', expected_organization_review_revision: 1
        }, organizationContext())).rejects.toMatchObject({
            message: 'personal_knowledge_promotion_stale_revision', status: 409,
            details: expect.objectContaining({
                action: 'organization_review', expected_revision: '1', current_revision: '2'
            })
        });
        expect(repository.claimPromotionAuthorityUse).not.toHaveBeenCalled();
        expect(knowledgeEventService.ingestInTransaction).not.toHaveBeenCalled();
        expect(knowledgeGraphRepository.commitNormalizedPromotion).not.toHaveBeenCalled();
        expect(repository.reviewOrganizationPromotionRequest).not.toHaveBeenCalled();
        expect(repository.createLineage).not.toHaveBeenCalled();
    });

    it('publishes normalized knowledge and receipts without copying Personal text into organization data', async () => {
        const request = consentedRequest(normalizedDecision(), {
            sanitized_preview: '絶対に組織Graphへコピーしてはいけない個人文',
        });
        const { service, repository, knowledgeGraphRepository, knowledgeEventService } = promotionHarness({ request });

        const result = await service.reviewOrganizationPromotion('kpr_1', {
            decision: 'approve',
            reason: '組織の設計判断として採用',
            expected_organization_review_revision: 0
        }, organizationContext());

        expect(result.status).toBe('org_accepted');
        expect(result.organization_event_id).toMatch(/^kev_prom_[a-f0-9]{24}$/);
        expect(result.organization_review_receipt_id).toMatch(/^pkor_[a-f0-9]{24}$/);

        const organizationEvent = knowledgeEventService.ingestInTransaction.mock.calls[0][0];
        const graphMutation = knowledgeGraphRepository.commitNormalizedPromotion.mock.calls[0][0];
        const lineage = repository.createLineage.mock.calls[0][0];
        const organizationPublished = JSON.stringify({ organizationEvent, graphMutation });

        expect(organizationPublished).not.toContain(request.sanitized_preview);
        expect(organizationPublished).not.toContain(request.personal_event_id);
        expect(organizationEvent.body).toBeUndefined();
        expect(organizationEvent.body_hash).toBe(request.normalized_payload_hash);
        expect(graphMutation.entity.payload.promotion_evidence.owner_consent_receipt_id)
            .toBe(request.owner_consent_receipt_id);

        // Personal-side lineage keeps the private FK for owner/audit correlation, but stores no text.
        expect(lineage.personal_event_id).toBe(request.personal_event_id);
        expect(JSON.stringify(lineage.sanitization)).not.toContain(request.sanitized_preview);
        expect(lineage.sanitization).toMatchObject({
            raw_copied: false,
            personal_body_copied: false,
            sanitized_preview_copied: false,
            normalized_payload_hash: request.normalized_payload_hash
        });
    });

    it('publishes explicit ontology relations only through the normalized contract', async () => {
        const request = consentedRequest(normalizedRelation());
        const { service, knowledgeGraphRepository } = promotionHarness({ request, graphEdgeCount: 1 });

        await service.reviewOrganizationPromotion('kpr_1', {
            decision: 'approve', expected_organization_review_revision: 0
        }, {
            ...organizationContext(reviewerAccess, {
                normalizedPayloadHash: normalizePromotionPayload(normalizedRelation()).normalized_payload_hash
            })
        });

        const mutation = knowledgeGraphRepository.commitNormalizedPromotion.mock.calls[0][0];
        expect(mutation.entity).toMatchObject({ id: 'project_brainbase', type: 'project' });
        expect(mutation.edges).toHaveLength(1);
        expect(mutation.edges[0]).toMatchObject({
            from_id: 'project_brainbase', to_id: 'org_unson', relation: 'owned_by'
        });
        expect(mutation.context_entities).toEqual([{ id: 'org_unson', type: 'org' }]);
    });

    it('rejects a quarantined Knowledge Event and leaves Graph, acceptance, and lineage untouched', async () => {
        const request = consentedRequest();
        const { service, repository, knowledgeGraphRepository } = promotionHarness({
            request,
            eventResult: {
                event_id: 'kev_1', semantic_state: 'quarantined',
                quarantine_reason: 'decision_authority_unverified'
            }
        });

        await expect(service.reviewOrganizationPromotion('kpr_1', {
            decision: 'approve', expected_organization_review_revision: 0
        }, {
            ...organizationContext()
        })).rejects.toMatchObject({
            message: 'personal_knowledge_graph_promotion_quarantined', status: 409
        });

        expect(knowledgeGraphRepository.commitNormalizedPromotion).not.toHaveBeenCalled();
        expect(repository.reviewOrganizationPromotionRequest).not.toHaveBeenCalled();
        expect(repository.createLineage).not.toHaveBeenCalled();
    });

    it('records a fresh authority use after organization acceptance without duplicate effects', async () => {
        const request = consentedRequest(normalizedDecision(), {
            status: 'org_accepted', organization_review_revision: 1
        });
        const { service, repository, knowledgeGraphRepository, knowledgeEventService } = promotionHarness({ request });
        const result = await service.reviewOrganizationPromotion('kpr_1', {
            decision: 'approve', expected_organization_review_revision: 1
        }, {
            ...organizationContext()
        });
        expect(result).toBe(request);
        expect(repository.claimPromotionAuthorityUse).toHaveBeenCalledOnce();
        expect(repository.claimPromotionAuthorityUse).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'organization_review', request_id: 'kpr_1' }),
            expect.objectContaining({ access: reviewerAccess, client: expect.any(Object) })
        );
        expect(knowledgeEventService.ingestInTransaction).not.toHaveBeenCalled();
        expect(knowledgeGraphRepository.commitNormalizedPromotion).not.toHaveBeenCalled();
        expect(repository.reviewOrganizationPromotionRequest).not.toHaveBeenCalled();
        expect(repository.createLineage).not.toHaveBeenCalled();
    });
});
