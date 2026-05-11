// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, baseDraft } from '../_helpers.js';

describe('candidate-store S-8: expires_at job sets status=expired', () => {
    it('S-8: expireCandidate transitions to expired and writes audit', async () => {
        const { service } = makeService();
        const { candidate } = await service.createCandidate(baseDraft({
            expires_at: new Date(Date.now() - 1000).toISOString()
        }));
        const r = service.expireCandidate(candidate.id);
        expect(r.promotion_status).toBe('expired');
        const audit = service.listAudit(candidate.id);
        expect(audit.at(-1).next_status).toBe('expired');
    });
});
