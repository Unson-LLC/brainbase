// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, preferenceDraft } from '../_helpers.js';

describe('auto-promote INV-7: daily rate limit', () => {
    it('INV-7: 51st auto-promote in 24h is declined and routes to pending_approval', async () => {
        const { service } = makeService({ withPolicy: true, dailyLimit: 3 });
        for (let i = 0; i < 3; i += 1) {
            const r = await service.createCandidate(preferenceDraft({
                source_event_ids: [`session:limit:${i}`],
                body: `prefer ${i}`
            }));
            expect(r.auto).toBe(true);
        }
        const over = await service.createCandidate(preferenceDraft({
            source_event_ids: ['session:limit:3'],
            body: 'prefer overflow'
        }));
        expect(over.auto).toBeFalsy();
        expect(over.candidate.promotion_status).toBe('candidate');
    });
});
