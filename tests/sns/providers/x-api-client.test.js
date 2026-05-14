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
});
