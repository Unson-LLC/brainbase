// @ts-check
/**
 * X (Twitter) Client interface + InMemoryXClient (テスト/dev用)
 * 本番では X API v2 を叩く実装に差し替え
 */

import { randomBytes } from 'crypto';

/**
 * @typedef {Object} XClient
 * @property {(ctx:any) => Promise<{url:string, state:string}>} startOAuth
 * @property {(params:any) => Promise<{external_account_id:string, external_handle:string, credential_metadata:any}>} exchangeCallback
 * @property {(credential_ref:any) => Promise<{credential_metadata:any}>} refresh
 * @property {(credential_ref:any) => Promise<void>} revoke
 * @property {(credential_ref:any) => Promise<{ok:boolean, reason?:string}>} healthCheck
 * @property {(credential_ref:any) => Promise<{remaining:number, resetAt:string}>} getRateLimitStatus
 * @property {(credential_ref:any, payload:{text:string}) => Promise<{tweet_id:string}>} postTweet
 * @property {(credential_ref:any, tweet_id:string) => Promise<{impressions:number, likes:number, replies:number, reposts:number, bookmarks?:number}>} fetchTweetMetrics
 */

function defaultAccessTokenResolver(credentialRef) {
    if (credentialRef?.env && process.env[credentialRef.env]) return process.env[credentialRef.env];
    return process.env.SNS_X_ACCESS_TOKEN
        || process.env.X_ACCESS_TOKEN
        || process.env.TWITTER_ACCESS_TOKEN
        || process.env.X_BEARER_TOKEN
        || process.env.TWITTER_BEARER_TOKEN
        || '';
}

function xApiError(status, body) {
    const error = new Error(`X API request failed: ${status} ${String(body || '').slice(0, 200)}`);
    if (status === 429) error.code = 'rate_limited';
    if (status === 401 || status === 403) error.code = 'auth_failed';
    return error;
}

function pickMetric(primary, fallback, key) {
    const value = primary?.[key] ?? fallback?.[key];
    return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function normalizeTweetMetrics(data) {
    const publicMetrics = data?.public_metrics || {};
    const organicMetrics = data?.organic_metrics || {};
    const nonPublicMetrics = data?.non_public_metrics || {};
    return {
        impressions: pickMetric(organicMetrics, nonPublicMetrics, 'impression_count') || pickMetric(publicMetrics, null, 'impression_count'),
        likes: pickMetric(publicMetrics, organicMetrics, 'like_count'),
        reposts: pickMetric(publicMetrics, organicMetrics, 'retweet_count'),
        replies: pickMetric(publicMetrics, organicMetrics, 'reply_count'),
        bookmarks: pickMetric(publicMetrics, organicMetrics, 'bookmark_count')
    };
}

/**
 * X API v2 client for production metrics lookup.
 * Uses OAuth 2.0 user context when SNS_X_ACCESS_TOKEN/X_ACCESS_TOKEN is supplied.
 */
export class XApiClient {
    constructor({
        baseUrl = 'https://api.x.com',
        fetchImpl = globalThis.fetch,
        accessTokenResolver = defaultAccessTokenResolver
    } = {}) {
        if (typeof fetchImpl !== 'function') throw new Error('fetch implementation required');
        this.baseUrl = baseUrl.replace(/\/$/u, '');
        this.fetchImpl = fetchImpl;
        this.accessTokenResolver = accessTokenResolver;
    }

    async fetchTweetMetrics(credential_ref, tweet_id) {
        const token = await this.accessTokenResolver(credential_ref);
        if (!token) {
            const error = new Error('X access token required for metrics polling');
            error.code = 'missing_x_access_token';
            throw error;
        }
        const url = new URL(`/2/tweets/${encodeURIComponent(tweet_id)}`, this.baseUrl);
        url.searchParams.set('tweet.fields', 'public_metrics,organic_metrics,non_public_metrics');
        const response = await this.fetchImpl(url.toString(), {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json'
            }
        });
        if (!response.ok) {
            const body = typeof response.text === 'function' ? await response.text() : '';
            throw xApiError(response.status, body);
        }
        const payload = await response.json();
        if (!payload?.data) {
            const error = new Error('X API response missing tweet data');
            error.code = 'missing_tweet_data';
            throw error;
        }
        return normalizeTweetMetrics(payload.data);
    }
}

/**
 * テスト用 in-memory client。本番では別実装に差し替え。
 * @implements {XClient}
 */
export class InMemoryXClient {
    constructor({ now = () => new Date() } = {}) {
        this.now = now;
        this.calls = { postTweet: 0, healthCheck: 0, revoke: 0, fetchMetrics: 0 };
        /** @type {Map<string, {text:string, posted_at:string, credential_path:string}>} */
        this.tweets = new Map();
        /** @type {Map<string, {impressions:number, likes:number, replies:number, retweets:number}>} */
        this.metrics = new Map();
        /** @type {Set<string>} */
        this.revokedPaths = new Set();
        this.rateLimitRemaining = 300;
    }

    async startOAuth(ctx) {
        const state = ctx.state || `mock-state-${randomBytes(8).toString('hex')}`;
        return { url: `https://twitter.com/i/oauth2/authorize?state=${state}`, state };
    }

    async exchangeCallback(params) {
        return {
            external_account_id: `x-user-${params.code || 'mock'}`,
            external_handle: params.handle || '@mock_user',
            credential_metadata: { provider: 'infisical', path: `/integrations/x/${params.code || 'mock'}`, version: 'v1' }
        };
    }

    async refresh(credential_ref) {
        return { credential_metadata: { ...credential_ref, version: 'v2' } };
    }

    async revoke(credential_ref) {
        this.calls.revoke += 1;
        this.revokedPaths.add(credential_ref.path);
    }

    async healthCheck(credential_ref) {
        this.calls.healthCheck += 1;
        if (this.revokedPaths.has(credential_ref.path)) return { ok: false, reason: 'revoked' };
        return { ok: true };
    }

    async getRateLimitStatus() {
        return { remaining: this.rateLimitRemaining, resetAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
    }

    async postTweet(credential_ref, payload) {
        this.calls.postTweet += 1;
        if (this.revokedPaths.has(credential_ref.path)) {
            const err = new Error('revoked');
            err.code = 'revoked';
            throw err;
        }
        if (this.rateLimitRemaining <= 0) {
            const err = new Error('rate limit');
            err.code = 'rate_limited';
            throw err;
        }
        this.rateLimitRemaining -= 1;
        const tweet_id = `tw_${this.tweets.size + 1}_${randomBytes(4).toString('hex')}`;
        this.tweets.set(tweet_id, {
            text: payload.text,
            posted_at: this.now().toISOString(),
            credential_path: credential_ref.path
        });
        this.metrics.set(tweet_id, { impressions: 0, likes: 0, replies: 0, retweets: 0 });
        return { tweet_id };
    }

    async fetchTweetMetrics(credential_ref, tweet_id) {
        this.calls.fetchMetrics += 1;
        const m = this.metrics.get(tweet_id) || { impressions: 0, likes: 0, replies: 0, retweets: 0 };
        return { ...m };
    }

    _setMetricsForTest(tweet_id, metrics) {
        this.metrics.set(tweet_id, { ...this.metrics.get(tweet_id), ...metrics });
    }
}
