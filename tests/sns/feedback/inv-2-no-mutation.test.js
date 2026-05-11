// @ts-check
import { describe, it, expect } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';

describe('feedback INV-2: events are append-only', () => {
    it('INV-2: 2x pollMetrics produces 2 separate events, no update', async () => {
        const stack = await makeStack();
        const post = await stack.posting.post(satoActor(), { account_id: stack.account.id, body: 'x' });
        const credRef = stack.account.credential_ref;
        const before = stack.graphEvents.filter((e) => e.kind === 'sns_metric').length;
        await stack.feedback.pollMetrics(stack.account.id, post.tweet_id, credRef);
        await stack.feedback.pollMetrics(stack.account.id, post.tweet_id, credRef);
        const after = stack.graphEvents.filter((e) => e.kind === 'sns_metric').length;
        expect(after - before).toBe(2);
    });
});
