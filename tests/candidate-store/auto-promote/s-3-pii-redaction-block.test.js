// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { makeService, preferenceDraft } from '../_helpers.js';

describe('auto-promote S-3: PII review redaction blocks auto-promote', () => {
    it('S-3: candidate with PII → needs_redaction → no auto-promote', async () => {
        const writer = { createEntity: vi.fn() };
        const { service } = makeService({ withPolicy: true, graphWriter: writer });
        const r = await service.createCandidate(preferenceDraft({
            body: '俺の好み（電話番号: 090-1234-5678）'
        }));
        expect(r.auto).toBeFalsy();
        expect(r.candidate.redaction_status).toBe('needs_redaction');
        expect(r.candidate.promotion_status).toBe('candidate');
        expect(writer.createEntity).not.toHaveBeenCalled();
    });
});
