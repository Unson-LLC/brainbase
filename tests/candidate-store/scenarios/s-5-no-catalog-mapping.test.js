// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft, approver } from '../_helpers.js';

describe('candidate-store S-5: catalog mismatch → rejected', () => {
    it('S-5: hypothesis with no catalog mapping → rejected with reason no catalog mapping', async () => {
        const { service } = makeService();
        const { candidate } = await service.createCandidate(baseDraft({
            cognitive_type: 'hypothesis',
            recommended_subject_type: null
        }));
        await service.requestApproval(candidate.id, approver());
        const r = await service.approveCandidate(candidate.id, approver());
        expect(r.rejected).toBe(true);
        expect(r.candidate.promotion_status).toBe('rejected');
        const audit = service.listAudit(candidate.id);
        expect(audit.at(-1).decision_reason).toBe('no catalog mapping');
    });

    it('S-5: unknown subject_type also rejected', async () => {
        const { service } = makeService();
        const { candidate } = await service.createCandidate(baseDraft({
            recommended_subject_type: 'made_up_type'
        }));
        await service.requestApproval(candidate.id, approver());
        const r = await service.approveCandidate(candidate.id, approver());
        expect(r.rejected).toBe(true);
    });
});
