// @ts-check

import { requireSnsAuthority } from './sns-authority.js';

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

function accountVisibleToAuthority(account, authority) {
    if (!account || !authority) return false;
    if (account.scope_type === 'personal') {
        return account.owner_person_id === authority.owner_person_id;
    }
    if (account.scope_type === 'org') {
        return account.org_id === authority.organization_id
            || authority.org_ids.includes(account.org_id);
    }
    if (account.scope_type === 'project') {
        const projectCodes = authority.projectCodes || [];
        return projectCodes.includes(account.project_id);
    }
    return false;
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

    async run({
        limit = DEFAULT_LIMIT,
        dry_run = false,
        date = null,
        mark_learning_ready = false,
        actor = null
    } = {}) {
        // Metrics polling is a write-capable operation. Resolve the canonical
        // actor before reading the ledger so a missing or ambiguous authority
        // can never result in a provider call.
        const authority = requireSnsAuthority(actor || {});
        const candidates = await this._candidatePosts(limit, { date }, authority);
        const result = {
            date,
            scanned: candidates.length,
            polled: 0,
            failed: 0,
            skipped: 0,
            dry_run,
            mark_learning_ready,
            learning_ready: {
                before: candidates.filter((post) => post.status === 'learning_ready').length,
                promoted: 0,
                after: candidates.filter((post) => post.status === 'learning_ready').length
            },
            polled_posts: [],
            failed_posts: [],
            skipped_posts: [],
            anomalies: []
        };
        for (const post of candidates) {
            if (!post.posted_url) {
                result.skipped += 1;
                result.skipped_posts.push({ post_id: post.id, reason: 'missing_posted_url' });
                continue;
            }
            const tweetId = extractTweetIdFromUrl(post.posted_url);
            if (!tweetId) {
                result.skipped += 1;
                result.skipped_posts.push({ post_id: post.id, reason: 'missing_tweet_id' });
                continue;
            }
            try {
                const account = await this._accountForAuthority(post.account_id, authority);
                if (!account) {
                    result.skipped += 1;
                    result.skipped_posts.push({ post_id: post.id, reason: 'account_outside_authority' });
                    continue;
                }
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
                    const patch = {
                        metrics_snapshot: snapshot
                    };
                    if (mark_learning_ready && post.status === 'posted') {
                        patch.status = 'learning_ready';
                    }
                    updated = await this.ledgerRepository.updatePost(post.id, patch, authority);
                }
                if (post.status !== 'learning_ready' && updated.status === 'learning_ready') {
                    result.learning_ready.promoted += 1;
                    result.learning_ready.after += 1;
                }
                result.polled += 1;
                result.polled_posts.push({
                    post_id: post.id,
                    tweet_id: tweetId,
                    metrics,
                    previous_status: post.status,
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

    async _candidatePosts(limit, { date = null } = {}, authority) {
        const dateFilter = date ? { startDate: date, endDate: date } : {};
        const posted = await this.ledgerRepository.listPosts({ ...dateFilter, status: 'posted' }, authority);
        const learningReady = await this.ledgerRepository.listPosts({ ...dateFilter, status: 'learning_ready' }, authority);
        return [...posted, ...learningReady]
            .filter((post) => post.status !== 'deleted')
            .sort((a, b) => String(a.posted_at || a.scheduled_at || '').localeCompare(String(b.posted_at || b.scheduled_at || '')))
            .slice(0, limit);
    }

    async _accountForAuthority(accountId, authority) {
        // AccountService-style repositories can apply their own visibility
        // policy. Keep the explicit row check below as a second, local guard
        // because credential lookup must never rely on an unscoped findById.
        if (typeof this.accountRepository.listForActor === 'function') {
            const visibleAccounts = await this.accountRepository.listForActor(authority);
            return visibleAccounts.find((account) => account.id === accountId && accountVisibleToAuthority(account, authority)) || null;
        }
        const account = await this.accountRepository.findById(accountId, authority);
        return accountVisibleToAuthority(account, authority) ? account : null;
    }
}

export const __private__ = {
    detectAnomaly,
    withCaptureMetadata
};
