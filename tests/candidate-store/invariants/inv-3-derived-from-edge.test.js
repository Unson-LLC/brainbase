// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { makeService, baseDraft, approver } from '../_helpers.js';

describe('candidate-store INV-3: promoted graph entity has derived_from edge to candidate', () => {
    it('INV-3: graphWriter receives derived_from_candidate_id option', async () => {
        const writeSpy = vi.fn().mockResolvedValue({ id: 'graph_xyz' });
        const { service } = makeService({ graphWriter: { createEntity: writeSpy } });
        const { candidate } = await service.createCandidate(baseDraft({ recommended_subject_type: 'decision' }));
        await service.requestApproval(candidate.id, approver());
        await service.approveCandidate(candidate.id, approver());
        expect(writeSpy).toHaveBeenCalledTimes(1);
        const [, opts] = writeSpy.mock.calls[0];
        expect(opts).toEqual({ derived_from_candidate_id: candidate.id });
    });
});
