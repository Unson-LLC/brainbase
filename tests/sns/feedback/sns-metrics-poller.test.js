// @ts-check
import { describe, expect, it, vi } from 'vitest';

import { InMemoryAccountRepository } from '../../../server/services/account/account-repository.js';
import { InMemorySnsPostingLedgerRepository } from '../../../server/services/sns/posting-ledger-repository.js';
import {
    extractTweetIdFromUrl,
    SnsMetricsPoller
} from '../../../server/services/sns/sns-metrics-poller.js';

function makePostedLedger({ status = 'posted', posted_url = 'https://x.com/AIBizNavigator/status/2055000000000000001' } = {}) {
    const ledgerRepository = new InMemorySnsPostingLedgerRepository();
    ledgerRepository.upsertReviewPack({
        account_id: 'acc_x_sato',
        account_handle: '@AIBizNavigator',
        drafts: [{
            date: '2026-05-15',
            slot_index: 1,
            lane: 'learn_in_public',
            body: '投稿後の反応をLedgerに戻す'
        }]
    });
    let post = ledgerRepository.updatePost(ledgerRepository.listPosts({})[0].id, { status: 'approved' }, { actor_person_id: 'sato_keigo' });
    post = ledgerRepository.updatePost(post.id, { status: 'scheduled' }, { actor_person_id: 'sato_keigo' });
    post = ledgerRepository.updatePost(post.id, {
        status: 'posted',
        posted_url,
        posted_at: '2026-05-15T03:00:00.000Z'
    }, { actor_person_id: 'sato_keigo' });
    if (status === 'learning_ready') {
        post = ledgerRepository.updatePost(post.id, { status: 'learning_ready' }, { actor_person_id: 'sato_keigo' });
    }
    if (status === 'deleted') {
        post = ledgerRepository.updatePost(post.id, {
            status: 'deleted',
            deleted_at: '2026-05-15T04:00:00.000Z',
            deletion_source: 'manual_x_delete',
            deletion_reason: 'X上で削除した'
        }, { actor_person_id: 'sato_keigo' });
    }
    return { ledgerRepository, post };
}

function makeAccountRepository() {
    const accountRepository = new InMemoryAccountRepository();
    accountRepository.create({
        id: 'acc_x_sato',
        service: 'x',
        scope_type: 'personal',
        owner_person_id: 'sato_keigo',
        display_name: 'sato @X',
        credential_ref: { provider: 'infisical', path: '/integrations/x/sato', version: 'v1' },
        capabilities: ['post', 'read'],
        created_by_person_id: 'sato_keigo'
    });
    return accountRepository;
}

describe('SnsMetricsPoller', () => {
    it('extracts tweet ids from common X status URLs', () => {
        expect(extractTweetIdFromUrl('https://x.com/AIBizNavigator/status/2055000000000000001?s=20'))
            .toBe('2055000000000000001');
        expect(extractTweetIdFromUrl('https://twitter.com/AIBizNavigator/status/12345'))
            .toBe('12345');
        expect(extractTweetIdFromUrl('https://x.com/i/web/status/67890'))
            .toBe('67890');
        expect(extractTweetIdFromUrl('not a tweet')).toBeNull();
    });

    it('polls posted Ledger records and appends metrics snapshots without changing status', async () => {
        const { ledgerRepository, post } = makePostedLedger();
        const accountRepository = makeAccountRepository();
        const xClient = {
            fetchTweetMetrics: vi.fn(async () => ({
                impressions: 1280,
                likes: 84,
                reposts: 9,
                replies: 18,
                bookmarks: 21
            }))
        };
        const poller = new SnsMetricsPoller({
            ledgerRepository,
            accountRepository,
            xClient,
            now: () => new Date('2026-05-15T12:00:00.000Z')
        });

        const result = await poller.run({ limit: 10 });

        expect(result).toMatchObject({ scanned: 1, polled: 1, failed: 0 });
        expect(xClient.fetchTweetMetrics).toHaveBeenCalledWith(
            { provider: 'infisical', path: '/integrations/x/sato', version: 'v1' },
            '2055000000000000001'
        );
        const updated = ledgerRepository.findById(post.id);
        expect(updated.status).toBe('posted');
        expect(updated.metrics_snapshots).toHaveLength(1);
        expect(updated.metrics_snapshots[0]).toMatchObject({
            impressions: 1280,
            likes: 84,
            reposts: 9,
            replies: 18,
            bookmarks: 21,
            tweet_id: '2055000000000000001',
            captured_at: '2026-05-15T12:00:00.000Z'
        });
    });

    it('does not poll deleted Ledger records', async () => {
        const { ledgerRepository } = makePostedLedger({ status: 'deleted' });
        const poller = new SnsMetricsPoller({
            ledgerRepository,
            accountRepository: makeAccountRepository(),
            xClient: { fetchTweetMetrics: vi.fn() }
        });

        const result = await poller.run();

        expect(result.scanned).toBe(0);
        expect(result.polled).toBe(0);
    });

    it('fires anomaly notifier when reply ratio crosses the configured threshold', async () => {
        const { ledgerRepository, post } = makePostedLedger();
        const anomalyNotifier = vi.fn();
        const poller = new SnsMetricsPoller({
            ledgerRepository,
            accountRepository: makeAccountRepository(),
            xClient: {
                fetchTweetMetrics: vi.fn(async () => ({
                    impressions: 2000,
                    likes: 40,
                    reposts: 3,
                    replies: 260,
                    bookmarks: 5
                }))
            },
            anomalyNotifier,
            now: () => new Date('2026-05-15T12:00:00.000Z')
        });

        const result = await poller.run();

        expect(result.anomalies).toHaveLength(1);
        expect(anomalyNotifier).toHaveBeenCalledTimes(1);
        expect(anomalyNotifier.mock.calls[0][0]).toMatchObject({
            post_id: post.id,
            tweet_id: '2055000000000000001',
            reason: 'reply-impression-ratio:0.130'
        });
        expect(ledgerRepository.findById(post.id).metrics_snapshots[0].anomaly).toMatchObject({
            reason: 'reply-impression-ratio:0.130'
        });
    });
});
