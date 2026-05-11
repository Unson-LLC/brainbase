// @ts-check
import { describe, it, expect } from 'vitest';
import { PrivatePreferencePolicy } from '../../../server/services/candidate-store/auto-promote-policy/private-preference.js';

describe('auto-promote INV-3: redaction_status must be none', () => {
    it('INV-3: needs_redaction → reject', () => {
        const p = new PrivatePreferencePolicy();
        const r = p.applies({
            cognitive_type: 'preference', visibility: 'owner', sensitivity: 'internal',
            agency_level: 'synthesize', owner_person_id: 'sato', actor_person_id: 'sato',
            redaction_status: 'needs_redaction'
        });
        expect(r.applies).toBe(false);
        expect(r.reason).toBe('redaction-required');
    });
});
