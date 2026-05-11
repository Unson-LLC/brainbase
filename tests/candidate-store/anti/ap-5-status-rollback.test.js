// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft, approver } from '../_helpers.js';
import { InvalidTransitionError } from '../../../server/services/candidate-store/candidate-repository.js';

describe('candidate-store AP-5: status rollback rejected', () => {
    it('AP-5: cannot revert pending_approval → candidate', async () => {
        const { service, repository } = makeService();
        const { candidate } = await service.createCandidate(baseDraft({ recommended_subject_type: 'decision' }));
        await service.requestApproval(candidate.id, approver());
        expect(() => repository.transition(candidate.id, 'candidate', { actor_person_id: 'sato_keigo' }))
            .toThrow(InvalidTransitionError);
    });

    it('AP-5: cannot revert promoted_to_graph → approved', async () => {
        const { service, repository } = makeService();
        const { candidate } = await service.createCandidate(baseDraft({ recommended_subject_type: 'decision' }));
        await service.requestApproval(candidate.id, approver());
        await service.approveCandidate(candidate.id, approver());
        expect(() => repository.transition(candidate.id, 'approved', { actor_person_id: 'sato_keigo' }))
            .toThrow(InvalidTransitionError);
    });
});
