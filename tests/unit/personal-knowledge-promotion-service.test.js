import { describe, expect, it, vi } from 'vitest';

import { PersonalKnowledgePromotionService } from '../../server/services/personal-knowledge/personal-knowledge-promotion-service.js';

const ownerAccess = {
    personId: 'person_a', actorPersonId: 'person_a_auth', organizationId: 'org_a',
    role: 'member', projectCodes: ['brainbase'], clearance: ['internal']
};
const reviewerAccess = {
    personId: 'person_reviewer', actorPersonId: 'person_reviewer_auth', organizationId: 'org_a',
    role: 'gm', projectCodes: ['brainbase'], clearance: ['internal']
};

function transaction(handler) {
    return handler({ client: { id: 'tx', query: vi.fn() } });
}

function requestFixture(overrides = {}) {
    return {
        request_id: 'kpr_1', personal_event_id: 'pke_private_1', owner_person_id: 'person_a', organization_id: 'org_a',
        project_code: 'brainbase', status: 'pending_owner_approval', sanitized_preview: '個人用の元メモ',
        subject: { type: 'decision', id: 'decision_1' }, body_hash: 'sha256:source_evidence',
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

function normalizedEntityWithRelation() {
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

describe('PersonalKnowledgePromotionService two-stage review', () => {
    it('creates a sanitized pending owner preview without publishing an organization event', async () => {
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
            project_code: 'brainbase', summary: '共有可能な判断', subject: { type: 'decision', id: 'decision_1' }
        }, { access: ownerAccess });

        expect(result.status).toBe('pending_owner_approval');
        expect(result.sanitized_preview).toBe('共有可能な判断');
        expect(repository.findById).toHaveBeenCalledWith('pke_1', expect.objectContaining({ access: ownerAccess }));
        expect(knowledgeEventService.ingest).not.toHaveBeenCalled();
    });

    it('normalizes the promotion subject and rejects private identifiers before creating a request', async () => {
        const repository = {
            transaction: vi.fn(transaction),
            findById: vi.fn(async () => ({
                event_id: 'pke_1', owner_person_id: 'person_a', organization_id: 'org_a', body_hash: 'sha256:x'
            })),
            createPromotionRequest: vi.fn(async (request) => request)
        };
        const service = new PersonalKnowledgePromotionService({ repository });

        const safe = await service.requestPromotion('pke_1', {
            project_code: 'brainbase',
            summary: '共有可能な判断',
            subject: { type: 'decision', id: 'decision_1', raw_private_note: 'secret=abc' }
        }, { access: ownerAccess });

        expect(safe.subject).toEqual({ type: 'decision', id: 'decision_1' });
        await expect(service.requestPromotion('pke_1', {
            project_code: 'brainbase',
            summary: '共有可能な判断',
            subject: { type: 'decision', id: '/Users/ksato/private-note' }
        }, { access: ownerAccess })).rejects.toThrow('personal_knowledge_promotion_requires_safe_subject');
    });

    it('moves owner approval only to pending_org_review and never ingests Graph', async () => {
        const request = requestFixture();
        const repository = {
            transaction: vi.fn(transaction),
            findPromotionRequest: vi.fn(async () => request),
            decideOwnerPromotionRequest: vi.fn(async (_id, decision, options) => ({
                ...request,
                status: decision.status,
                owner_decided_by: options.access.actorPersonId,
                owner_decided_at: decision.decided_at
            }))
        };
        const knowledgeEventService = { ingest: vi.fn() };
        const service = new PersonalKnowledgePromotionService({
            repository, knowledgeEventService, now: () => new Date('2026-08-14T00:00:00.000Z')
        });

        const result = await service.decideOwnerPromotion('kpr_1', { decision: 'approve' }, { access: ownerAccess });

        expect(result).toMatchObject({
            status: 'pending_org_review',
            owner_decided_by: 'person_a_auth',
            owner_decided_at: '2026-08-14T00:00:00.000Z'
        });
        expect(knowledgeEventService.ingest).not.toHaveBeenCalled();
    });

    it('records owner rejection separately from organization rejection', async () => {
        const request = requestFixture();
        const repository = {
            transaction: vi.fn(transaction),
            findPromotionRequest: vi.fn(async () => request),
            decideOwnerPromotionRequest: vi.fn(async (_id, decision) => ({ ...request, status: decision.status }))
        };
        const service = new PersonalKnowledgePromotionService({ repository });

        const result = await service.decidePromotion('kpr_1', { decision: 'reject' }, { access: ownerAccess });

        expect(result.status).toBe('owner_rejected');
    });

    it('lists only the organization review queue for GM/CEO access', async () => {
        const reviews = [requestFixture({ status: 'pending_org_review' })];
        const repository = {
            transaction: vi.fn(transaction),
            listOrganizationPromotionReviews: vi.fn(async () => reviews)
        };
        const service = new PersonalKnowledgePromotionService({ repository });

        await expect(service.listOrganizationReviews({ limit: 20 }, { access: ownerAccess }))
            .rejects.toMatchObject({ message: 'personal_knowledge_organization_reviewer_required', status: 403 });
        await expect(service.listOrganizationReviews({ limit: 20 }, { access: reviewerAccess }))
            .resolves.toEqual(reviews);
    });

    it('allows a distinct GM reviewer to reject a pending organization request', async () => {
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
        const service = new PersonalKnowledgePromotionService({
            repository, now: () => new Date('2026-08-15T00:00:00.000Z')
        });

        const result = await service.reviewOrganizationPromotion('kpr_1', {
            decision: 'reject', reason: '組織知識としては局所的'
        }, { access: reviewerAccess });

        expect(result).toMatchObject({
            status: 'org_rejected',
            organization_reviewed_by: 'person_reviewer_auth',
            organization_review_reason: '組織知識としては局所的'
        });
    });

    it('rejects member review, owner self-review, and project mismatch', async () => {
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
        })).rejects.toMatchObject({ message: 'personal_knowledge_distinct_organization_reviewer_required', status: 403 });
        await expect(service.reviewOrganizationPromotion('kpr_1', { decision: 'reject' }, {
            access: { ...reviewerAccess, projectCodes: ['other'] }
        })).rejects.toMatchObject({ message: 'personal_knowledge_project_access_denied', status: 403 });
    });

    it('stores only a schema-validated normalized payload after owner consent', async () => {
        const request = requestFixture({
            status: 'pending_org_review',
            owner_decided_by: 'person_a_auth',
            owner_decided_at: '2026-08-14T00:00:00.000Z'
        });
        const repository = {
            transaction: vi.fn(transaction),
            findPromotionRequest: vi.fn(async () => request),
            saveNormalizedPromotionPayload: vi.fn(async (_id, normalization, options) => ({
                ...request,
                normalized_payload: normalization.normalized_payload,
                normalized_payload_hash: normalization.normalized_payload_hash,
                normalized_by_person_id: options.access.actorPersonId,
                owner_consent_receipt_id: normalization.owner_consent_receipt_id
            }))
        };
        const service = new PersonalKnowledgePromotionService({
            repository, now: () => new Date('2026-08-15T00:00:00.000Z')
        });

        const result = await service.saveNormalizedPromotion('kpr_1', {
            normalized_payload: normalizedDecision()
        }, { access: reviewerAccess });

        expect(result.normalized_payload.entity.payload.statement).toContain('暗黙fallbackを禁止');
        expect(result.normalized_payload_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(result.owner_consent_receipt_id).toMatch(/^pkoc_[a-f0-9]{24}$/);
        expect(repository.saveNormalizedPromotionPayload).toHaveBeenCalledWith(
            'kpr_1',
            expect.objectContaining({ contract_version: 'personal_knowledge_normalized.v1' }),
            expect.objectContaining({ access: reviewerAccess })
        );
    });

    it('rejects raw transcript, private fields, and server-controlled evidence in normalized payloads', async () => {
        const request = requestFixture({
            status: 'pending_org_review',
            owner_decided_by: 'person_a_auth',
            owner_decided_at: '2026-08-14T00:00:00.000Z'
        });
        const repository = {
            transaction: vi.fn(transaction),
            findPromotionRequest: vi.fn(async () => request),
            saveNormalizedPromotionPayload: vi.fn()
        };
        const service = new PersonalKnowledgePromotionService({ repository });
        const payload = normalizedDecision();
        payload.entity.payload.raw_transcript = '個人の会話全文';

        await expect(service.saveNormalizedPromotion('kpr_1', { normalized_payload: payload }, { access: reviewerAccess }))
            .rejects.toMatchObject({ message: 'personal_knowledge_normalized_payload_forbidden_field' });
        expect(repository.saveNormalizedPromotionPayload).not.toHaveBeenCalled();
    });

    it('keeps organization approval fail-closed until a normalized Graph payload exists', async () => {
        const request = requestFixture({ status: 'pending_org_review' });
        const repository = {
            transaction: vi.fn(transaction),
            findPromotionRequest: vi.fn(async () => request),
            reviewOrganizationPromotionRequest: vi.fn()
        };
        const knowledgeEventService = { ingest: vi.fn() };
        const service = new PersonalKnowledgePromotionService({ repository, knowledgeEventService });

        await expect(service.reviewOrganizationPromotion('kpr_1', { decision: 'approve' }, { access: reviewerAccess }))
            .rejects.toMatchObject({ message: 'personal_knowledge_normalized_payload_required', status: 409 });
        expect(repository.reviewOrganizationPromotionRequest).not.toHaveBeenCalled();
        expect(knowledgeEventService.ingest).not.toHaveBeenCalled();
    });

    it('publishes a normalized decision with receipts and never copies Personal text or preview', async () => {
        const normalized = normalizedDecision();
        const request = requestFixture({
            status: 'pending_org_review',
            sanitized_preview: '絶対に組織Graphへコピーしてはいけない個人文',
            owner_decided_by: 'person_a_auth',
            owner_decided_at: '2026-08-14T00:00:00.000Z',
            owner_consent_receipt_id: 'pkoc_111111111111111111111111',
            normalized_payload: normalized,
            normalized_payload_hash: 'sha256:5aa0ce21f5374f05a5ee91c0d60df2bb6efa78ea5f29f241eeb303f2f4c868fa',
            normalization_contract_version: 'personal_knowledge_normalized.v1'
        });
        const repository = {
            transaction: vi.fn(transaction),
            findPromotionRequest: vi.fn(async () => request),
            saveNormalizedPromotionPayload: vi.fn(async (_id, normalization) => {
                Object.assign(request, {
                    normalized_payload: normalization.normalized_payload,
                    normalized_payload_hash: normalization.normalized_payload_hash,
                    owner_consent_receipt_id: normalization.owner_consent_receipt_id,
                    normalization_contract_version: normalization.contract_version
                });
                return request;
            }),
            reviewOrganizationPromotionRequest: vi.fn(async (_id, decision) => ({
                ...request,
                status: decision.status,
                organization_event_id: decision.organization_event_id,
                graph_entity_id: decision.graph_entity_id,
                organization_review_receipt_id: decision.organization_review_receipt_id
            })),
            createLineage: vi.fn(async (lineage) => lineage)
        };
        const knowledgeGraphRepository = {
            commitNormalizedPromotion: vi.fn(async (mutation) => ({ id: mutation.entity.id, edge_count: 0 }))
        };
        const knowledgeEventService = {
            graphRepository: knowledgeGraphRepository,
            ingestInTransaction: vi.fn(async (event) => ({
                event_id: event.event_id,
                candidate_id: 'candidate_1',
                semantic_state: 'active'
            }))
        };
        const service = new PersonalKnowledgePromotionService({
            repository,
            knowledgeEventService,
            knowledgeGraphRepository,
            now: () => new Date('2026-08-15T00:00:00.000Z')
        });

        const saved = await service.saveNormalizedPromotion('kpr_1', { normalized_payload: normalized }, {
            access: reviewerAccess
        });
        request.normalized_payload = saved.normalized_payload;
        request.normalized_payload_hash = saved.normalized_payload_hash;
        request.owner_consent_receipt_id = saved.owner_consent_receipt_id;

        const result = await service.reviewOrganizationPromotion('kpr_1', {
            decision: 'approve', reason: '組織の設計判断として採用'
        }, { access: reviewerAccess });

        expect(result.status).toBe('org_accepted');
        expect(result.organization_event_id).toMatch(/^kev_prom_[a-f0-9]{24}$/);
        expect(result.organization_review_receipt_id).toMatch(/^pkor_[a-f0-9]{24}$/);
        const organizationEvent = knowledgeEventService.ingestInTransaction.mock.calls[0][0];
        const graphMutation = knowledgeGraphRepository.commitNormalizedPromotion.mock.calls[0][0];
        const lineage = repository.createLineage.mock.calls[0][0];
        const published = JSON.stringify({ organizationEvent, graphMutation, lineage });
        expect(published).not.toContain(request.sanitized_preview);
        expect(published).not.toContain('pke_private_1');
        expect(organizationEvent.body).toBeUndefined();
        expect(organizationEvent.body_hash).toBe(request.normalized_payload_hash);
        expect(graphMutation.entity.payload.promotion_evidence.owner_consent_receipt_id)
            .toBe(request.owner_consent_receipt_id);
        expect(lineage.sanitization).toMatchObject({
            raw_copied: false,
            personal_body_copied: false,
            sanitized_preview_copied: false,
            normalized_payload_hash: request.normalized_payload_hash
        });
    });

    it('publishes explicit ontology relations only through the normalized contract', async () => {
        const normalized = normalizedEntityWithRelation();
        const request = requestFixture({
            status: 'pending_org_review',
            owner_decided_by: 'person_a_auth',
            owner_decided_at: '2026-08-14T00:00:00.000Z'
        });
        const repository = {
            transaction: vi.fn(transaction),
            findPromotionRequest: vi.fn(async () => request),
            saveNormalizedPromotionPayload: vi.fn(async (_id, normalization) => {
                Object.assign(request, {
                    normalized_payload: normalization.normalized_payload,
                    normalized_payload_hash: normalization.normalized_payload_hash,
                    owner_consent_receipt_id: normalization.owner_consent_receipt_id,
                    normalization_contract_version: normalization.contract_version
                });
                return request;
            }),
            reviewOrganizationPromotionRequest: vi.fn(async (_id, decision) => ({ ...request, status: decision.status })),
            createLineage: vi.fn(async (lineage) => lineage)
        };
        const knowledgeGraphRepository = {
            commitNormalizedPromotion: vi.fn(async (mutation) => ({ id: mutation.entity.id, edge_count: 1 }))
        };
        const knowledgeEventService = {
            graphRepository: knowledgeGraphRepository,
            ingestInTransaction: vi.fn(async (event) => ({
                event_id: event.event_id, candidate_id: 'candidate_relation', semantic_state: 'active'
            }))
        };
        const service = new PersonalKnowledgePromotionService({
            repository, knowledgeEventService, knowledgeGraphRepository,
            now: () => new Date('2026-08-15T00:00:00.000Z')
        });

        await service.saveNormalizedPromotion('kpr_1', { normalized_payload: normalized }, { access: reviewerAccess });
        await service.reviewOrganizationPromotion('kpr_1', { decision: 'approve' }, { access: reviewerAccess });

        const mutation = knowledgeGraphRepository.commitNormalizedPromotion.mock.calls[0][0];
        expect(mutation.entity).toMatchObject({ id: 'project_brainbase', type: 'project' });
        expect(mutation.edges).toHaveLength(1);
        expect(mutation.edges[0]).toMatchObject({
            from_id: 'project_brainbase', to_id: 'org_unson', relation: 'owned_by'
        });
        expect(mutation.context_entities).toEqual([{ id: 'org_unson', type: 'org' }]);
    });

    it('rejects a quarantined Knowledge Event and leaves the promotion pending', async () => {
        const normalized = normalizedDecision();
        const request = requestFixture({
            status: 'pending_org_review',
            owner_decided_by: 'person_a_auth',
            owner_decided_at: '2026-08-14T00:00:00.000Z'
        });
        const repository = {
            transaction: vi.fn(transaction),
            findPromotionRequest: vi.fn(async () => request),
            saveNormalizedPromotionPayload: vi.fn(async (_id, normalization) => {
                Object.assign(request, {
                    normalized_payload: normalization.normalized_payload,
                    normalized_payload_hash: normalization.normalized_payload_hash,
                    owner_consent_receipt_id: normalization.owner_consent_receipt_id
                });
                return request;
            }),
            reviewOrganizationPromotionRequest: vi.fn(),
            createLineage: vi.fn()
        };
        const knowledgeGraphRepository = { commitNormalizedPromotion: vi.fn() };
        const knowledgeEventService = {
            graphRepository: knowledgeGraphRepository,
            ingestInTransaction: vi.fn(async () => ({
                event_id: 'kev_1', semantic_state: 'quarantined', quarantine_reason: 'decision_authority_unverified'
            }))
        };
        const service = new PersonalKnowledgePromotionService({
            repository, knowledgeEventService, knowledgeGraphRepository
        });

        await service.saveNormalizedPromotion('kpr_1', { normalized_payload: normalized }, { access: reviewerAccess });
        await expect(service.reviewOrganizationPromotion('kpr_1', { decision: 'approve' }, { access: reviewerAccess }))
            .rejects.toMatchObject({ message: 'personal_knowledge_graph_promotion_quarantined', status: 409 });
        expect(knowledgeGraphRepository.commitNormalizedPromotion).not.toHaveBeenCalled();
        expect(repository.reviewOrganizationPromotionRequest).not.toHaveBeenCalled();
        expect(repository.createLineage).not.toHaveBeenCalled();
    });
});
