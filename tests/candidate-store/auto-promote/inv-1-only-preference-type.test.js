// @ts-check
import { describe, it, expect } from 'vitest';
import { PrivatePreferencePolicy } from '../../../server/services/candidate-store/auto-promote-policy/private-preference.js';

const base = {
    visibility: 'owner', sensitivity: 'internal', agency_level: 'synthesize',
    owner_person_id: 'sato', actor_person_id: 'sato', redaction_status: 'none'
};

describe('auto-promote INV-1: only cognitive_type=preference applies', () => {
    it('INV-1: preference applies, others reject', () => {
        const p = new PrivatePreferencePolicy();
        expect(p.applies({ ...base, cognitive_type: 'preference' }).applies).toBe(true);
        for (const t of ['observation', 'insight', 'claim', 'hypothesis', 'experiment', 'result']) {
            expect(p.applies({ ...base, cognitive_type: t }).applies).toBe(false);
        }
    });
});
