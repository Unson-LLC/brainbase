// @ts-check
import { describe, it, expect } from 'vitest';
import { PrivatePreferencePolicy } from '../../../server/services/candidate-store/auto-promote-policy/private-preference.js';

describe('auto-promote INV-2: owner_person_id must equal actor_person_id', () => {
    it('INV-2: owner==actor → applies; owner!=actor → reject', () => {
        const p = new PrivatePreferencePolicy();
        const base = {
            cognitive_type: 'preference', visibility: 'owner', sensitivity: 'internal',
            agency_level: 'synthesize', redaction_status: 'none'
        };
        expect(p.applies({ ...base, owner_person_id: 'sato', actor_person_id: 'sato' }).applies).toBe(true);
        const r = p.applies({ ...base, owner_person_id: 'umeda', actor_person_id: 'sato' });
        expect(r.applies).toBe(false);
        expect(r.reason).toBe('owner-actor-mismatch');
    });
});
