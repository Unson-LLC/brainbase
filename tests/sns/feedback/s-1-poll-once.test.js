// @ts-check
import { describe, it, expect } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';

describe('feedback S-1: pollMetrics once', () => {
    it('S-1: written=1, event recorded with metrics + measured_at', async () => {
        const stack = await makeStack();
        const post = await stack.posting.post(satoActor(), { account_id: stack.account.id, body: 'x' });
        const r = await stack.feedback.pollMetrics(stack.account.id, post.tweet_id, stack.account.credential_ref);
        expect(r.written).toBe(1);
        const evt = stack.graphEvents.find((e) => e.kind === 'sns_metric' && e.tweet_id === post.tweet_id);
        expect(evt).toBeTruthy();
        expect(evt.measured_at).toBeTruthy();
        expect(evt.metrics).toBeTruthy();
    });
});
