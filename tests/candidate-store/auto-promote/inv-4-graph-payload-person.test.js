// @ts-check
import { describe, it, expect } from 'vitest';
import { PrivatePreferencePolicy } from '../../../server/services/candidate-store/auto-promote-policy/private-preference.js';

describe('auto-promote INV-4: graph entity type=person with preference_attachment', () => {
    it('INV-4: buildGraphPayload returns type=person attached to owner', () => {
        const p = new PrivatePreferencePolicy();
        const payload = p.buildGraphPayload({
            id: 'cand_x',
            owner_person_id: 'sato_keigo',
            body: 'codex委譲が好き',
            confidence: 0.8
        });
        expect(payload.type).toBe('person');
        expect(payload.person_id).toBe('sato_keigo');
        expect(payload.preference_attachment.body).toBe('codex委譲が好き');
        expect(payload.preference_attachment.source_candidate_id).toBe('cand_x');
    });

    it('INV-4: targetSubjectType returns "person"', () => {
        const p = new PrivatePreferencePolicy();
        expect(p.targetSubjectType()).toBe('person');
    });
});
