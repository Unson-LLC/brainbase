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
        request_id: 'kpr_1', personal_event_id: 'pke_1', owner_person_id: 'person_a', organization_id: 'org_a',
        project_code: 'brainbase', status: 'pending_owner_approval', sanitized_preview: '採用する判断',
        subject: { type: 'decision', id: 'decision_1' }, body_hash: 'sha256:safe',
        ...overrides
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
        expect(repository.decideOwnerPromotionRequest).toHaveBeenCalledWith('kpr_1', {
            status: 'pending_org_review',
            decided_at: '2026-08-14T00:00:00.000Z'
        }, expect.objectContaining({ access: ownerAccess }));
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

    it('keeps organization approval fail-closed until M1-C provides a normalized Graph payload', async () => {
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
});