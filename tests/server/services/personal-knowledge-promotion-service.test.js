import { describe, expect, it, vi } from 'vitest';

import { PersonalKnowledgePromotionService } from '../../../server/services/personal-knowledge/personal-knowledge-promotion-service.js';

describe('PersonalKnowledgePromotionService', () => {
    it('owner-approved decision promotion supplies the complete Graph decision contract', async () => {
        const request = {
            request_id: 'kpr_1',
            personal_event_id: 'pke_1',
            owner_person_id: 'sato_keigo',
            organization_id: 'unson',
            project_code: 'brainbase',
            status: 'pending_owner_approval',
            sanitized_preview: '自分の意思を最小の認知負荷で継続的に現実へ変える',
            subject: { type: 'decision', id: 'decision_intent_to_outcome_north_star' },
            body_hash: 'sha256:abc'
        };
        const repository = {
            findPromotionRequest: vi.fn(async () => request),
            findById: vi.fn(async () => ({ event_id: 'pke_1', parent_episode_id: 'episode_1' })),
            decidePromotionRequest: vi.fn(async () => ({})),
            createLineage: vi.fn(async () => ({}))
        };
        const knowledgeEventService = { ingest: vi.fn(async () => ({ semantic_state: 'active' })) };
        const service = new PersonalKnowledgePromotionService({ repository, knowledgeEventService });

        await service.decidePromotion('kpr_1', {
            decision: 'approve',
            decision_authority: { authorized: true, actor_person_id: 'per_graph_sato' }
        }, {
            access: {
                personId: 'sato_keigo',
                actorPersonId: 'per_graph_sato',
                organizationId: 'unson'
            }
        });

        expect(knowledgeEventService.ingest).toHaveBeenCalledWith(
            expect.objectContaining({
                subject: request.subject,
                decision: { statement: request.sanitized_preview },
                decision_authority: expect.objectContaining({
                    authorized: true,
                    decider_id: 'per_graph_sato',
                    domain: 'general'
                })
            }),
            expect.any(Object)
        );
    });
});
