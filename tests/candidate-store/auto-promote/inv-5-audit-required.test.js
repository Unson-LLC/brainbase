// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, preferenceDraft } from '../_helpers.js';

describe('auto-promote INV-5: audit entry recorded for auto-promote', () => {
    it('INV-5: auto-promote records transitions in audit_events', async () => {
        const { service } = makeService({ withPolicy: true });
        const result = await service.createCandidate(preferenceDraft());
        expect(result.auto).toBe(true);
        const audit = service.listAudit(result.candidate.id);
        const transitions = audit.map((a) => `${a.previous_status}→${a.next_status}`);
        expect(transitions).toEqual(expect.arrayContaining([
            'candidate→pending_approval',
            'pending_approval→approved',
            'approved→promoted_to_graph'
        ]));
        // 全ての audit entry に decision_owner_person_id = candidate owner が記録される
        for (const ev of audit) {
            expect(ev.decision_owner_person_id).toBe('sato_keigo');
        }
    });
});
