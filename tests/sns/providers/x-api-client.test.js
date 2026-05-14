// @ts-check
import { describe, expect, it, vi } from 'vitest';

import { XApiClient } from '../../../server/services/sns/providers/x-client.js';

describe('XApiClient metrics lookup', () => {
    it('maps X API v2 tweet metrics into SNS Ledger metrics shape', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            json: async () => ({
                data: {
                    id: '2055000000000000001',
                    public_metrics: {
                        like_count: 84,
                        retweet_count: 9,
                        reply_count: 18,
                        bookmark_count: 21,
                        impression_count: 1200
                    },
                    organic_metrics: {
                        impression_count: 1280,
                        like_count: 82,
                        retweet_count: 8,
                        reply_count: 17
                    }
                }
            })
        }));
        const client = new XApiClient({
            fetchImpl,
            accessTokenResolver: async () => 'user-context-token'
        });

        const metrics = await client.fetchTweetMetrics(
            { provider: 'infisical', path: '/integrations/x/sato', version: 'v1' },
            '2055000000000000001'
        );

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(String(fetchImpl.mock.calls[0][0])).toContain('/2/tweets/2055000000000000001');
        expect(String(fetchImpl.mock.calls[0][0])).toContain('tweet.fields=public_metrics%2Corganic_metrics%2Cnon_public_metrics');
        expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer user-context-token');
        expect(metrics).toEqual({
            impressions: 1280,
            likes: 84,
            reposts: 9,
            replies: 18,
            bookmarks: 21
        });
    });

    it('throws a rate_limited error for X API 429 responses', async () => {
        const client = new XApiClient({
            fetchImpl: vi.fn(async () => ({
                ok: false,
                status: 429,
                text: async () => 'Too Many Requests'
            })),
            accessTokenResolver: async () => 'token'
        });

        await expect(client.fetchTweetMetrics({}, '1')).rejects.toMatchObject({
            code: 'rate_limited'
        });
    });

    it('checks user-context token health and reads rate limit headers without exposing the token', async () => {
        const headers = new Map([
            ['x-rate-limit-remaining', '299'],
            ['x-rate-limit-reset', '1778847300']
        ]);
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 200,
            headers: { get: (key) => headers.get(key) }
        }));
        const client = new XApiClient({
            fetchImpl,
            accessTokenResolver: async () => 'user-context-token'
        });

        await expect(client.healthCheck({ env: 'SNS_X_ACCESS_TOKEN' })).resolves.toEqual({ ok: true });
        await expect(client.getRateLimitStatus({ env: 'SNS_X_ACCESS_TOKEN' })).resolves.toEqual({
            remaining: 299,
            resetAt: '2026-05-15T12:15:00.000Z'
        });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer user-context-token');
    });

    it('returns null rate-limit fields when X omits rate-limit headers', async () => {
        const client = new XApiClient({
            fetchImpl: vi.fn(async () => ({
                ok: false,
                status: 401,
                headers: { get: () => null }
            })),
            accessTokenResolver: async () => 'user-context-token'
        });

        await expect(client.getRateLimitStatus({ env: 'SNS_X_ACCESS_TOKEN' })).resolves.toEqual({
            remaining: null,
            resetAt: null
        });
    });
});
