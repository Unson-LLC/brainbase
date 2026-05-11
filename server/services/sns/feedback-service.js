// @ts-check
/**
 * SNS Feedback Service (SPEC-sns-feedback-loop)
 * 投稿後の metrics を polling し、graph event として append + 異常検知
 */

export class FeedbackService {
    /**
     * @param {{
     *   xClient: import('./providers/x-client.js').XClient,
     *   graphWriter: { appendEvent: (e:any) => Promise<{id:string}> },
     *   anomalyNotifier?: (info:any) => Promise<void>,
     *   reuseRecorder?: { incrementReuse: (entity_id:string) => Promise<void> }
     * }} deps
     */
    constructor({ xClient, graphWriter, anomalyNotifier = null, reuseRecorder = null }) {
        if (!xClient) throw new Error('xClient required');
        if (!graphWriter) throw new Error('graphWriter required');
        this.xClient = xClient;
        this.graphWriter = graphWriter;
        this.anomalyNotifier = anomalyNotifier;
        this.reuseRecorder = reuseRecorder;
    }

    /**
     * @param {string} account_id
     * @param {string} tweet_id
     * @param {any} credential_ref
     */
    async pollMetrics(account_id, tweet_id, credential_ref) {
        const metrics = await this.xClient.fetchTweetMetrics(credential_ref, tweet_id);
        // INV-1 / INV-2: graph event entity を append（mutation 禁止、新規 event 作成）
        const event = await this.graphWriter.appendEvent({
            kind: 'sns_metric',
            account_id,
            tweet_id,
            metrics,
            measured_at: new Date().toISOString()
        });

        // INV-3: 炎上検知
        const anomaly = this._detectAnomaly(metrics);
        if (anomaly && this.anomalyNotifier) {
            await this.anomalyNotifier({ account_id, tweet_id, metrics, reason: anomaly });
        }

        return { written: 1, anomaly: !!anomaly, event_id: event.id };
    }

    _detectAnomaly(metrics) {
        if (!metrics) return null;
        const { impressions = 0, replies = 0 } = metrics;
        if (impressions > 1000) {
            const ratio = replies / impressions;
            if (ratio > 0.1) return `reply-impression-ratio:${ratio.toFixed(3)}`;
        }
        return null;
    }

    /**
     * INV-4: feedback を curator scoring に反映するため source_entity の reuse_count を増やす hook
     */
    async updateSourceEntityReuse(source_entity_id) {
        if (!this.reuseRecorder) return;
        await this.reuseRecorder.incrementReuse(source_entity_id);
    }
}
