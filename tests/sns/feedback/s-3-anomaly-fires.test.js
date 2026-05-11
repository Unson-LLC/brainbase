// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';
import { FeedbackService } from '../../../server/services/sns/feedback-service.js';

describe('feedback S-3: anomaly fires', () => {
    it('S-3: high replies trigger anomalyNotifier with reason', async () => {
        const stack = await makeStack();
        const post = await stack.posting.post(satoActor(), { account_id: stack.account.id, body: 'x' });
        const notifier = vi.fn();
        const fb = new FeedbackService({
            xClient: stack.xClient, graphWriter: stack.graphWriter, anomalyNotifier: notifier
        });
        stack.xClient._setMetricsForTest(post.tweet_id, { impressions: 10000, replies: 2500, likes: 200, retweets: 50 });
        await fb.pollMetrics(stack.account.id, post.tweet_id, stack.account.credential_ref);
        expect(notifier).toHaveBeenCalledTimes(1);
        const arg = notifier.mock.calls[0][0];
        expect(arg.reason).toMatch(/reply-impression-ratio/);
    });
});
