import { describe, expect, it, vi } from 'vitest';

import { PersonalKnowledgePromotionService } from '../../../server/services/personal-knowledge/personal-knowledge-promotion-service.js';
import { normalizePromotionPayload } from '../../../server/services/personal-knowledge/personal-knowledge-normalization.js';

describe('PersonalKnowledgePromotionService runtime boundary', () => {
    it('binds owner consent to the exact normalized decision and performs no Graph write', async () => {
        const normalized = normalizePromotionPayload({
            schema_version: 'personal_knowledge_normalized.v1',
            kind: 'decision',
            entity: {
                id: 'decision_intent_to_outcome_north_star', type: 'decision',
                payload: { statement: '自分の意思を最小の認知負荷で継続的に現実へ変える' }
            },
            edges: [], context_entities: [], decision_domain: 'general',
            sensitivity: 'internal', role_min: 'member'
        });
        const request = {
            request_id: 'kpr_1',
            personal_event_id: 'pke_1',
            owner_person_id: 'sato_keigo',
            organization_id: 'unson',
            project_code: 'brainbase',
            status: 'pending_owner_approval',
            normalized_payload: normalized.normalized,
            normalized_payload_hash: normalized.normalized_payload_hash
        };
        const repository = {
            transaction: vi.fn((handler) => handler({ client: { query: vi.fn() } })),
            findPromotionRequest: vi.fn(async () => request),
            decideOwnerPromotionRequest: vi.fn(async (_id, decision) => ({
                ...request,
                status: decision.status,
                owner_decided_by: 'per_graph_sato',
                owner_decided_at: decision.decided_at,
                owner_consent_receipt_id: decision.owner_consent_receipt_id
            }))
        };
        const knowledgeEventService = { ingest: vi.fn(), ingestInTransaction: vi.fn() };
        const knowledgeGraphRepository = { commitNormalizedPromotion: vi.fn() };
        const service = new PersonalKnowledgePromotionService({
            repository, knowledgeEventService, knowledgeGraphRepository,
            now: () => new Date('2026-08-25T00:00:00.000Z')
        });

        const result = await service.decidePromotion('kpr_1', {
            decision: 'approve',
            normalized_payload_hash: normalized.normalized_payload_hash
        }, {
            access: {
                personId: 'sato_keigo',
                actorPersonId: 'per_graph_sato',
                organizationId: 'unson',
                projectCodes: ['brainbase']
            }
        });

        expect(result).toMatchObject({
            status: 'pending_org_review',
            owner_consent_receipt_id: expect.stringMatching(/^pkoc_[a-f0-9]{24}$/)
        });
        expect(knowledgeEventService.ingest).not.toHaveBeenCalled();
        expect(knowledgeEventService.ingestInTransaction).not.toHaveBeenCalled();
        expect(knowledgeGraphRepository.commitNormalizedPromotion).not.toHaveBeenCalled();
    });
});
