// @ts-check
import { describe, it, expect } from 'vitest';
import { makeService, preferenceDraft } from '../_helpers.js';

describe('auto-promote S-4: rate limit overflow → pending_approval', () => {
    it('S-4: dailyLimit=2; 3rd attempt is not auto', async () => {
        const { service } = makeService({ withPolicy: true, dailyLimit: 2 });
        for (let i = 0; i < 2; i += 1) {
            const r = await service.createCandidate(preferenceDraft({
                source_event_ids: [`session:rl:${i}`],
                body: `prefer ${i}`
            }));
            expect(r.auto).toBe(true);
        }
        const over = await service.createCandidate(preferenceDraft({
            source_event_ids: ['session:rl:2'],
            body: 'overflow'
        }));
        expect(over.auto).toBeFalsy();
    });
});
