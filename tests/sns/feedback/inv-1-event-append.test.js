// @ts-check
import { describe, it, expect } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';

describe('feedback INV-1: metrics written as event entity', () => {
    it('INV-1: pollMetrics appends graph event of kind sns_metric', async () => {
        const stack = await makeStack();
        const post = await stack.posting.post(satoActor(), { account_id: stack.account.id, body: 'b' });
        const credRef = stack.account.credential_ref;
        await stack.feedback.pollMetrics(stack.account.id, post.tweet_id, credRef);
        expect(stack.graphEvents.some((e) => e.kind === 'sns_metric')).toBe(true);
    });
});
