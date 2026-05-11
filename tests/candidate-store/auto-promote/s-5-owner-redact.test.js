// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, preferenceDraft, approver } from '../_helpers.js';

describe('auto-promote S-5: owner redact removes content from auto-promoted preference', () => {
    it('S-5: redactCandidate replaces body and flags redaction; audit recorded', async () => {
        const { service } = makeService({ withPolicy: true });
        const result = await service.createCandidate(preferenceDraft({
            body: '機微な好み: タバコ吸う'
        }));
        const id = result.candidate.id;
        const before = service.listAudit(id).length;
        const redacted = await service.redactCandidate(id, approver(), '[redacted by owner]');
        expect(redacted.body).toBe('[redacted by owner]');
        expect(redacted.redaction_status).toBe('redacted');
        const after = service.listAudit(id).length;
        expect(after).toBeGreaterThan(before);
    });
});
