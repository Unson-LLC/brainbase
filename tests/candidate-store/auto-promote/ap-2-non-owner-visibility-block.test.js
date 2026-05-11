// @ts-check
import { describe, it, expect } from 'vitest';
import { PrivatePreferencePolicy } from '../../../server/services/candidate-store/auto-promote-policy/private-preference.js';

describe('auto-promote AP-2: visibility=team/org preference is not auto-promoted', () => {
    const base = {
        cognitive_type: 'preference', sensitivity: 'internal',
        agency_level: 'synthesize', owner_person_id: 'sato',
        actor_person_id: 'sato', redaction_status: 'none'
    };
    it('AP-2: visibility=team → reject', () => {
        const p = new PrivatePreferencePolicy();
        const r = p.applies({ ...base, visibility: 'team' });
        expect(r.applies).toBe(false);
        expect(r.reason).toBe('visibility-not-owner');
    });
    it('AP-2: visibility=org → reject', () => {
        const p = new PrivatePreferencePolicy();
        expect(p.applies({ ...base, visibility: 'org' }).applies).toBe(false);
    });
    it('AP-2: visibility=public → reject', () => {
        const p = new PrivatePreferencePolicy();
        expect(p.applies({ ...base, visibility: 'public' }).applies).toBe(false);
    });
});
