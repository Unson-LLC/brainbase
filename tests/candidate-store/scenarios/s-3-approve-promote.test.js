// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { makeService, baseDraft, approver } from '../_helpers.js';

describe('candidate-store S-3: approve → promoted_to_graph', () => {
    it('S-3: approval creates Graph entity and sets promoted_graph_entity_id', async () => {
        const writer = { createEntity: vi.fn().mockResolvedValue({ id: 'graph_decision_42' }) };
        const { service } = makeService({ graphWriter: writer });
        const { candidate } = await service.createCandidate(baseDraft({ recommended_subject_type: 'decision' }));
        await service.requestApproval(candidate.id, approver());
        const result = await service.approveCandidate(candidate.id, approver(), { reason: 'looks right' });
        expect(result.candidate.promotion_status).toBe('promoted_to_graph');
        expect(result.candidate.promoted_graph_entity_id).toBe('graph_decision_42');
        expect(result.graphEntity.id).toBe('graph_decision_42');
        expect(writer.createEntity).toHaveBeenCalledTimes(1);
    });
});
