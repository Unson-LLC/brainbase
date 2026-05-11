// @ts-check
import { describe, it, expect } from 'vitest';
import { PrivatePreferencePolicy } from '../../../server/services/candidate-store/auto-promote-policy/private-preference.js';

describe('auto-promote AP-1: agency_level=none blocks auto-promote', () => {
    it('AP-1: even if preference + owner=actor, agency_level=none rejects', () => {
        const p = new PrivatePreferencePolicy();
        const r = p.applies({
            cognitive_type: 'preference', visibility: 'owner', sensitivity: 'internal',
            agency_level: 'none', owner_person_id: 'sato', actor_person_id: 'sato',
            redaction_status: 'none'
        });
        expect(r.applies).toBe(false);
        expect(r.reason).toBe('agency-level-not-allowed');
    });
});
