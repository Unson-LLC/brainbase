// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft, approver } from '../_helpers.js';

describe('candidate-store INV-8: every state transition is audited', () => {
    it('INV-8: audit events contain actor, decision_owner, reason, decided_at, previous_status, next_status', async () => {
        const { service } = makeService();
        const { candidate } = await service.createCandidate(baseDraft({ recommended_subject_type: 'decision' }));
        await service.requestApproval(candidate.id, approver());
        await service.approveCandidate(candidate.id, approver(), { reason: 'manual approve' });
        const audit = service.listAudit(candidate.id);
        expect(audit.length).toBeGreaterThanOrEqual(3);
        for (const ev of audit) {
            expect(ev.actor_person_id).toBeTruthy();
            expect(ev.decided_at).toBeTruthy();
            expect(ev.previous_status).toBeTruthy();
            expect(ev.next_status).toBeTruthy();
        }
        expect(audit.at(-1).next_status).toBe('promoted_to_graph');
    });
});
