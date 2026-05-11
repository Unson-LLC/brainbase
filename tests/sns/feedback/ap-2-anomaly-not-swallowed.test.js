// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { makeStack, satoActor } from '../_m4-helpers.js';
import { FeedbackService } from '../../../server/services/sns/feedback-service.js';

describe('feedback AP-2: anomaly not silently swallowed', () => {
    it('AP-2: anomaly result is propagated even without notifier', async () => {
        const stack = await makeStack();
        const post = await stack.posting.post(satoActor(), { account_id: stack.account.id, body: 'x' });
        const fb = new FeedbackService({
            xClient: stack.xClient, graphWriter: stack.graphWriter
            // no anomalyNotifier
        });
        stack.xClient._setMetricsForTest(post.tweet_id, { impressions: 5000, replies: 1500, likes: 0, retweets: 0 });
        const r = await fb.pollMetrics(stack.account.id, post.tweet_id, stack.account.credential_ref);
        // anomaly フラグが返り値に含まれる（呼び出し側で見えるようになっている）
        expect(r.anomaly).toBe(true);
    });
});
