// @ts-check
import { describe, it, expect } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';

describe('posting INV-6: rate limit → queued', () => {
    it('INV-6: when X rate_limit exhausted, post returns queued=true', async () => {
        const stack = await makeStack();
        stack.xClient.rateLimitRemaining = 0;
        const r = await stack.posting.post(satoActor(), { account_id: stack.account.id, body: 'x' });
        expect(r.posted).toBe(false);
        expect(r.reason).toBe('rate-limited');
        expect(r.queued).toBe(true);
    });
});
