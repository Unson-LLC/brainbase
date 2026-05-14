// @ts-check

const DEFAULT_LIMIT = 20;
const ANOMALY_IMPRESSIONS_THRESHOLD = 1000;
const ANOMALY_REPLY_RATIO_THRESHOLD = 0.1;

export function extractTweetIdFromUrl(url) {
    const match = String(url || '').match(/(?:x|twitter)\.com\/(?:i\/web\/status\/|[^/]+\/status\/)(\d+)/u);
    return match ? match[1] : null;
}

function detectAnomaly(metrics, {
    impressionsThreshold = ANOMALY_IMPRESSIONS_THRESHOLD,
    replyRatioThreshold = ANOMALY_REPLY_RATIO_THRESHOLD
} = {}) {
    const impressions = Number(metrics?.impressions || 0);
    const replies = Number(metrics?.replies || 0);
    if (impressions > impressionsThreshold) {
        const ratio = replies / impressions;
        if (ratio > replyRatioThreshold) {
            return {
                kind: 'reply_impression_ratio',
                reason: `reply-impression-ratio:${ratio.toFixed(3)}`,
                reply_impression_ratio: Number(ratio.toFixed(4))
            };
        }
    }
    return null;
}

function withCaptureMetadata(metrics, { tweetId, capturedAt, anomaly }) {
    return {
        ...metrics,
        tweet_id: tweetId,
        captured_at: capturedAt,
        source: 'x-api',
        ...(anomaly ? { anomaly } : {})
    };
}

export class SnsMetricsPoller {
    constructor({
        ledgerRepository,
        accountRepository,
        xClient,
        anomalyNotifier = null,
        now = () => new Date()
    }) {
        if (!ledgerRepository) throw new Error('ledgerRepository required');
        if (!accountRepository || typeof accountRepository.findById !== 'function') {
            throw new Error('accountRepository.findById required');
        }
        if (!xClient || typeof xClient.fetchTweetMetrics !== 'function') {
            throw new Error('xClient.fetchTweetMetrics required');
        }
        this.ledgerRepository = ledgerRepository;
        this.accountRepository = accountRepository;
        this.xClient = xClient;
        this.anomalyNotifier = anomalyNotifier;
        this.now = now;
    }

    async run({ limit = DEFAULT_LIMIT, dry_run = false } = {}) {
        const candidates = await this._candidatePosts(limit);
        const result = {
            scanned: candidates.length,
            polled: 0,
            failed: 0,
            skipped: 0,
            dry_run,
            polled_posts: [],
            failed_posts: [],
            skipped_posts: [],
            anomalies: []
        };
        for (const post of candidates) {
            const tweetId = extractTweetIdFromUrl(post.posted_url);
            if (!tweetId) {
                result.skipped += 1;
                result.skipped_posts.push({ post_id: post.id, reason: 'missing_tweet_id' });
                continue;
            }
            try {
                const account = await this.accountRepository.findById(post.account_id);
                if (!account?.credential_ref) {
                    result.skipped += 1;
                    result.skipped_posts.push({ post_id: post.id, reason: 'missing_account_credential' });
                    continue;
                }
                const metrics = await this.xClient.fetchTweetMetrics(account.credential_ref, tweetId);
                const anomaly = detectAnomaly(metrics);
                const capturedAt = this.now().toISOString();
                const snapshot = withCaptureMetadata(metrics, { tweetId, capturedAt, anomaly });
                let updated = post;
                if (!dry_run) {
                    updated = await this.ledgerRepository.updatePost(post.id, {
                        metrics_snapshot: snapshot
                    }, { actor_person_id: 'sns_metrics_poller' });
                }
                result.polled += 1;
                result.polled_posts.push({
                    post_id: post.id,
                    tweet_id: tweetId,
                    metrics,
                    status: updated.status
                });
                if (anomaly) {
                    const anomalyEvent = {
                        post_id: post.id,
                        account_id: post.account_id,
                        tweet_id: tweetId,
                        posted_url: post.posted_url,
                        metrics,
                        ...anomaly
                    };
                    result.anomalies.push(anomalyEvent);
                    if (!dry_run && this.anomalyNotifier) {
                        await this.anomalyNotifier(anomalyEvent);
                    }
                }
            } catch (error) {
                result.failed += 1;
                result.failed_posts.push({
                    post_id: post.id,
                    error: error?.message || String(error),
                    code: error?.code || null
                });
            }
        }
        return result;
    }

    async _candidatePosts(limit) {
        const posted = await this.ledgerRepository.listPosts({ status: 'posted' });
        const learningReady = await this.ledgerRepository.listPosts({ status: 'learning_ready' });
        return [...posted, ...learningReady]
            .filter((post) => post.posted_url && post.status !== 'deleted')
            .sort((a, b) => String(a.posted_at || a.scheduled_at || '').localeCompare(String(b.posted_at || b.scheduled_at || '')))
            .slice(0, limit);
    }
}

export const __private__ = {
    detectAnomaly,
    withCaptureMetadata
};
