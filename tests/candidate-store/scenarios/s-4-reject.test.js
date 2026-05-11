// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { makeService, baseDraft, approver } from '../_helpers.js';
import { InvalidTransitionError } from '../../../server/services/candidate-store/candidate-repository.js';

describe('candidate-store S-4: reject is terminal', () => {
    it('S-4: rejectCandidate sets status=rejected and graph entity is not created; cannot revive', async () => {
        const writer = { createEntity: vi.fn() };
        const { service, repository } = makeService({ graphWriter: writer });
        const { candidate } = await service.createCandidate(baseDraft({ recommended_subject_type: 'decision' }));
        await service.requestApproval(candidate.id, approver());
        const r = await service.rejectCandidate(candidate.id, approver(), 'not relevant');
        expect(r.promotion_status).toBe('rejected');
        expect(writer.createEntity).not.toHaveBeenCalled();
        // revive 不能（INV-2 / AP-5）
        expect(() => repository.transition(candidate.id, 'approved', { actor_person_id: 'sato_keigo' }))
            .toThrow(InvalidTransitionError);
    });
});
