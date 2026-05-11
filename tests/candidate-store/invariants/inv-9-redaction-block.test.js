// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft, approver } from '../_helpers.js';

describe('candidate-store INV-9: needs_redaction blocks promote', () => {
    it('INV-9: PII review hits set redaction_status=needs_redaction; auto-promote is skipped', async () => {
        const { service, repository } = makeService({ withPolicy: true });
        const result = await service.createCandidate({
            ...baseDraft({
                cognitive_type: 'preference',
                body: '電話 090-1234-5678 をよく使う',
                recommended_subject_type: 'person',
                requires_approval: false
            })
        });
        expect(result.blocked).toBeFalsy();
        const stored = repository.list()[0];
        expect(stored.redaction_status).toBe('needs_redaction');
        expect(stored.promotion_status).toBe('candidate');
        expect(result.auto).toBeFalsy();
    });
});
