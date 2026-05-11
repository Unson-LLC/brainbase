// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft, approver } from '../_helpers.js';
import { InvalidTransitionError } from '../../../server/services/candidate-store/candidate-repository.js';

describe('candidate-store INV-2: status transitions are monotonic', () => {
    it('INV-2: candidate→pending_approval→approved→promoted_to_graph is allowed, rollback rejected', async () => {
        const { service, repository } = makeService();
        const { candidate } = await service.createCandidate(baseDraft({ recommended_subject_type: 'person' }));
        await service.requestApproval(candidate.id, approver());
        const { candidate: promoted } = await service.approveCandidate(candidate.id, approver());
        expect(promoted.promotion_status).toBe('promoted_to_graph');

        expect(() => repository.transition(candidate.id, 'candidate', { actor_person_id: 'sato_keigo' }))
            .toThrow(InvalidTransitionError);
        expect(() => repository.transition(candidate.id, 'pending_approval', { actor_person_id: 'sato_keigo' }))
            .toThrow(InvalidTransitionError);
    });
});
