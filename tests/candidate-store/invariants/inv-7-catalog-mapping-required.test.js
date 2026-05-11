// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft, approver } from '../_helpers.js';

describe('candidate-store INV-7: catalog mapping required for promote', () => {
    it('INV-7: approve with no catalog mapping → rejected with reason', async () => {
        const { service, repository } = makeService();
        const { candidate } = await service.createCandidate(baseDraft({ recommended_subject_type: null }));
        await service.requestApproval(candidate.id, approver());
        const result = await service.approveCandidate(candidate.id, approver());
        expect(result.rejected).toBe(true);
        expect(result.candidate.promotion_status).toBe('rejected');
        const audit = repository.listAudit(candidate.id);
        const last = audit[audit.length - 1];
        expect(last.next_status).toBe('rejected');
        expect(last.decision_reason).toBe('no catalog mapping');
    });
});
