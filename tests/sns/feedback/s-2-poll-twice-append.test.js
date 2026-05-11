// @ts-check
import { describe, it, expect } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';

describe('feedback S-2: pollMetrics twice appends', () => {
    it('S-2: two polls → two separate events', async () => {
        const stack = await makeStack();
        const post = await stack.posting.post(satoActor(), { account_id: stack.account.id, body: 'x' });
        await stack.feedback.pollMetrics(stack.account.id, post.tweet_id, stack.account.credential_ref);
        await stack.feedback.pollMetrics(stack.account.id, post.tweet_id, stack.account.credential_ref);
        const events = stack.graphEvents.filter((e) => e.kind === 'sns_metric' && e.tweet_id === post.tweet_id);
        expect(events.length).toBe(2);
    });
});
