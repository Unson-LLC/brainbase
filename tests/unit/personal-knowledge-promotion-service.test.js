import { describe, expect, it, vi } from 'vitest';

import { PersonalKnowledgePromotionService } from '../../server/services/personal-knowledge/personal-knowledge-promotion-service.js';

const access = { personId: 'person_a', organizationId: 'org_a', role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] };

describe('PersonalKnowledgePromotionService', () => {
    it('creates a sanitized pending preview without publishing an organization event', async () => {
        const repository = {
            transaction: vi.fn(async (handler) => handler({ client: { id: 'preview-tx' } })),
            findById: vi.fn(async () => ({ event_id: 'pke_1', owner_person_id: 'person_a', organization_id: 'org_a', body: '共有可能な判断。secret=abc', body_hash: 'sha256:x' })),
            createPromotionRequest: vi.fn(async (request) => request)
        };
        const knowledgeEventService = { ingest: vi.fn() };
        const service = new PersonalKnowledgePromotionService({ repository, knowledgeEventService });

        const result = await service.requestPromotion('pke_1', {
            project_code: 'brainbase', summary: '共有可能な判断', subject: { type: 'decision', id: 'decision_1' }
        }, { access });

        expect(result.status).toBe('pending_owner_approval');
        expect(result.sanitized_preview).toBe('共有可能な判断');
        expect(result.sanitized_preview).not.toContain('secret');
        expect(repository.findById).toHaveBeenCalledWith('pke_1', { access, client: { id: 'preview-tx' } });
        expect(repository.createPromotionRequest).toHaveBeenCalledWith(expect.any(Object), { access, client: { id: 'preview-tx' } });
        expect(knowledgeEventService.ingest).not.toHaveBeenCalled();
    });

    it('normalizes the promotion subject and rejects private identifiers before creating a request', async () => {
        const repository = {
            transaction: vi.fn(async (handler) => handler({ client: { id: 'preview-tx' } })),
            findById: vi.fn(async () => ({
                event_id: 'pke_1', owner_person_id: 'person_a', organization_id: 'org_a', body_hash: 'sha256:x'
            })),
            createPromotionRequest: vi.fn(async (request) => request)
        };
        const service = new PersonalKnowledgePromotionService({
            repository,
            knowledgeEventService: { ingest: vi.fn() }
        });

        const safe = await service.requestPromotion('pke_1', {
            project_code: 'brainbase',
            summary: '共有可能な判断',
            subject: { type: 'decision', id: 'decision_1', raw_private_note: 'secret=abc' }
        }, { access });

        expect(safe.subject).toEqual({ type: 'decision', id: 'decision_1' });
        await expect(service.requestPromotion('pke_1', {
            project_code: 'brainbase',
            summary: '共有可能な判断',
            subject: { type: 'decision', id: '/Users/ksato/private-note' }
        }, { access })).rejects.toThrow('personal_knowledge_promotion_requires_safe_subject');
    });

    it('publishes one deterministic organization event after owner approval and records lineage', async () => {
        const request = {
            request_id: 'kpr_1', personal_event_id: 'pke_1', owner_person_id: 'person_a', organization_id: 'org_a',
            project_code: 'brainbase', status: 'pending_owner_approval', sanitized_preview: '採用する判断',
            subject: { type: 'decision', id: 'decision_1' }, body_hash: 'sha256:safe'
        };
        const repository = {
            transaction: vi.fn(async (handler) => handler({ client: {} })),
            findPromotionRequest: vi.fn(async () => request),
            findById: vi.fn(async () => ({
                event_id: 'pke_1',
                parent_episode_id: 'personal_episode_1'
            })),
            decidePromotionRequest: vi.fn(async (_id, decision) => ({ ...request, status: decision.status })),
            appendTransition: vi.fn(),
            createLineage: vi.fn(async (lineage) => lineage)
        };
        const knowledgeEventService = { ingest: vi.fn(async (event) => ({ event_id: event.event_id, processing_stage: 'retrievable' })) };
        const service = new PersonalKnowledgePromotionService({ repository, knowledgeEventService, now: () => new Date('2026-08-14T00:00:00.000Z') });

        const first = await service.decidePromotion('kpr_1', { decision: 'approve' }, { access });
        const second = await service.decidePromotion('kpr_1', { decision: 'approve' }, { access });

        expect(first.organization_event_id).toMatch(/^kev_prom_/);
        expect(second.organization_event_id).toBe(first.organization_event_id);
        expect(knowledgeEventService.ingest).toHaveBeenCalledWith(expect.objectContaining({
            event_id: first.organization_event_id,
            body: '採用する判断',
            parent_episode_id: 'personal_episode_1',
            applicability_scope: expect.objectContaining({ project_code: 'brainbase', scope: 'organization' })
        }), expect.objectContaining({ access, client: expect.any(Object) }));
        expect(repository.createLineage).toHaveBeenCalled();
    });

    it('個人eventにEpisodeがない場合も決定的な昇格Episode IDを発行する', async () => {
        const request = {
            request_id: 'kpr_without_episode', personal_event_id: 'pke_without_episode',
            owner_person_id: 'person_a', organization_id: 'org_a', project_code: 'brainbase',
            status: 'pending_owner_approval', sanitized_preview: '共有する観察',
            subject: { type: 'note', id: 'note_shared' }, body_hash: 'sha256:safe'
        };
        const repository = {
            transaction: vi.fn(async (handler) => handler({ client: {} })),
            findPromotionRequest: vi.fn(async () => request),
            findById: vi.fn(async () => ({ event_id: 'pke_without_episode', parent_episode_id: null })),
            decidePromotionRequest: vi.fn(async () => ({ ...request, status: 'approved' })),
            createLineage: vi.fn(async (lineage) => lineage)
        };
        const knowledgeEventService = { ingest: vi.fn(async (event) => ({ event_id: event.event_id })) };
        const service = new PersonalKnowledgePromotionService({ repository, knowledgeEventService });

        await service.decidePromotion('kpr_without_episode', { decision: 'approve' }, { access });

        expect(knowledgeEventService.ingest).toHaveBeenCalledWith(expect.objectContaining({
            parent_episode_id: expect.stringMatching(/^episode_personal_promotion_[a-f0-9]{24}$/)
        }), expect.any(Object));
    });
});
