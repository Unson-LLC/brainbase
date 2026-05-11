// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';
import { FeedbackService } from '../../../server/services/sns/feedback-service.js';

describe('feedback INV-3: anomaly detect for flamewar candidates', () => {
    it('INV-3: high replies/impressions ratio triggers anomalyNotifier', async () => {
        const stack = await makeStack();
        const post = await stack.posting.post(satoActor(), { account_id: stack.account.id, body: 'b' });
        const notifier = vi.fn();
        const feedback = new FeedbackService({
            xClient: stack.xClient,
            graphWriter: stack.graphWriter,
            anomalyNotifier: notifier
        });
        stack.xClient._setMetricsForTest(post.tweet_id, { impressions: 5000, replies: 1000, likes: 100, retweets: 50 });
        const r = await feedback.pollMetrics(stack.account.id, post.tweet_id, stack.account.credential_ref);
        expect(r.anomaly).toBe(true);
        expect(notifier).toHaveBeenCalled();
    });
});
