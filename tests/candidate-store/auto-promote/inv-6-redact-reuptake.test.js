// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, preferenceDraft, approver } from '../_helpers.js';

describe('auto-promote INV-6: owner can redact auto-promoted preference', () => {
    it('INV-6: redactCandidate updates body and redaction_status', async () => {
        const { service } = makeService({ withPolicy: true });
        const result = await service.createCandidate(preferenceDraft());
        const id = result.candidate.id;
        const r = await service.redactCandidate(id, approver(), '[redacted by owner]');
        expect(r.redaction_status).toBe('redacted');
        expect(r.body).toBe('[redacted by owner]');
    });
});
