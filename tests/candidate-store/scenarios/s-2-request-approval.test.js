// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft, approver } from '../_helpers.js';

describe('candidate-store S-2: request approval transitions candidate → pending_approval', () => {
    it('S-2: requestApproval transitions status and writes audit entry', async () => {
        const { service } = makeService();
        const { candidate } = await service.createCandidate(baseDraft({ recommended_subject_type: 'decision' }));
        const transitioned = await service.requestApproval(candidate.id, approver());
        expect(transitioned.promotion_status).toBe('pending_approval');
        const audit = service.listAudit(candidate.id);
        expect(audit.at(-1).next_status).toBe('pending_approval');
    });
});
