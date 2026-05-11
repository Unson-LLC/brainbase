// @ts-check
import { describe, it, expect } from 'vitest';
import { PrivatePreferencePolicy } from '../../../server/services/candidate-store/auto-promote-policy/private-preference.js';

describe('auto-promote AP-3: non-preference cognitive types blocked', () => {
    const base = {
        visibility: 'owner', sensitivity: 'internal', agency_level: 'synthesize',
        owner_person_id: 'sato', actor_person_id: 'sato', redaction_status: 'none'
    };
    it('AP-3: insight rejected', () => {
        const p = new PrivatePreferencePolicy();
        const r = p.applies({ ...base, cognitive_type: 'insight' });
        expect(r.applies).toBe(false);
        expect(r.reason).toBe('cognitive_type-not-preference');
    });
    it('AP-3: claim rejected', () => {
        const p = new PrivatePreferencePolicy();
        expect(p.applies({ ...base, cognitive_type: 'claim' }).applies).toBe(false);
    });
    it('AP-3: hypothesis rejected', () => {
        const p = new PrivatePreferencePolicy();
        expect(p.applies({ ...base, cognitive_type: 'hypothesis' }).applies).toBe(false);
    });
});
