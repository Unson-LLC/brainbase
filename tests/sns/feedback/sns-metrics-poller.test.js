// @ts-check
import { describe, expect, it, vi } from 'vitest';

import { InMemoryAccountRepository } from '../../../server/services/account/account-repository.js';
import { InMemorySnsPostingLedgerRepository } from '../../../server/services/sns/posting-ledger-repository.js';
import {
    extractTweetIdFromUrl,
    SnsMetricsPoller
} from '../../../server/services/sns/sns-metrics-poller.js';

const SNS_AUTHORITY = Object.freeze({
    owner_person_id: 'sato_keigo',
    actor_person_id: 'sato_keigo',
    organization_id: 'org_unson',
    sub: 'sato_keigo',
    org_ids: ['org_unson'],
    role: 'member',
    projectCodes: []
});

const OTHER_AUTHORITY = Object.freeze({
    owner_person_id: 'other_person',
    actor_person_id: 'other_person',
    organization_id: 'org_other',
    sub: 'other_person',
    org_ids: ['org_other'],
    role: 'member',
    projectCodes: []
});

function makePostedLedger({
    status = 'posted',
    date = '2026-05-15',
    posted_url = 'https://x.com/AIBizNavigator/status/2055000000000000001'
} = {}) {
    const ledgerRepository = new InMemorySnsPostingLedgerRepository();
    ledgerRepository.upsertReviewPack({
        account_id: 'acc_x_sato',
        account_handle: '@AIBizNavigator',
        drafts: [{
            date,
            slot_index: 1,
            lane: 'learn_in_public',
            body: '投稿後の反応をLedgerに戻す'
        }]
    }, SNS_AUTHORITY);
    let post = ledgerRepository.updatePost(ledgerRepository.listPosts({}, SNS_AUTHORITY)[0].id, { status: 'approved' }, SNS_AUTHORITY);
    post = ledgerRepository.updatePost(post.id, { status: 'scheduled' }, SNS_AUTHORITY);
    post = ledgerRepository.updatePost(post.id, {
        status: 'posted',
        posted_url,
        posted_at: '2026-05-15T03:00:00.000Z'
    }, SNS_AUTHORITY);
    if (status === 'learning_ready') {
        post = ledgerRepository.updatePost(post.id, { status: 'learning_ready' }, SNS_AUTHORITY);
    }
    if (status === 'deleted') {
        post = ledgerRepository.updatePost(post.id, {
            status: 'deleted',
            deleted_at: '2026-05-15T04:00:00.000Z',
            deletion_source: 'manual_x_delete',
            deletion_reason: 'X上で削除した'
        }, SNS_AUTHORITY);
    }
    return { ledgerRepository, post };
}

function addPostedLedgerPost(ledgerRepository, {
    date = '2026-05-16',
    slot_index = 2,
    posted_url = 'https://x.com/AIBizNavigator/status/2055000000000000002',
    account_id = 'acc_x_sato',
    authority = SNS_AUTHORITY
} = {}) {
    ledgerRepository.upsertReviewPack({
        account_id,
        account_handle: '@AIBizNavigator',
        drafts: [{
            date,
            slot_index,
            lane: 'learn_in_public',
            body: `投稿後の反応をLedgerに戻す ${slot_index}`
        }]
    }, authority);
    let post = ledgerRepository.listPosts({ startDate: date, endDate: date }, authority)[0];
    post = ledgerRepository.updatePost(post.id, { status: 'approved' }, authority);
    post = ledgerRepository.updatePost(post.id, { status: 'scheduled' }, authority);
    return ledgerRepository.updatePost(post.id, {
        status: 'posted',
        posted_url,
        posted_at: `${date}T03:00:00.000Z`
    }, authority);
}

function makeAccountRepository({ includeOtherPerson = false } = {}) {
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
    if (includeOtherPerson) {
        accountRepository.create({
            id: 'acc_x_other',
            service: 'x',
            scope_type: 'personal',
            owner_person_id: 'other_person',
            display_name: 'other @X',
            credential_ref: { provider: 'infisical', path: '/integrations/x/other', version: 'v1' },
            capabilities: ['post', 'read'],
            created_by_person_id: 'other_person'
        });
    }
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

    it('requires a canonical actor before reading the ledger or invoking X', async () => {
        const ledgerRepository = {
            listPosts: vi.fn(),
            updatePost: vi.fn()
        };
        const xClient = { fetchTweetMetrics: vi.fn() };
        const poller = new SnsMetricsPoller({
            ledgerRepository,
            accountRepository: makeAccountRepository(),
            xClient
        });

        await expect(poller.run({ dry_run: true })).rejects.toThrow('owner_person_id is required');
        expect(ledgerRepository.listPosts).not.toHaveBeenCalled();
        expect(xClient.fetchTweetMetrics).not.toHaveBeenCalled();
    });

    it('keeps posts from another person and organization out of the polling run', async () => {
        const ledgerRepository = new InMemorySnsPostingLedgerRepository();
        const ownPost = addPostedLedgerPost(ledgerRepository, {
            date: '2026-05-17',
            slot_index: 1,
            posted_url: 'https://x.com/AIBizNavigator/status/2055000000000000003'
        });
        const otherPost = addPostedLedgerPost(ledgerRepository, {
            date: '2026-05-17',
            slot_index: 2,
            posted_url: 'https://x.com/Other/status/2055000000000000004',
            authority: OTHER_AUTHORITY
        });
        const xClient = {
            fetchTweetMetrics: vi.fn(async () => ({
                impressions: 12,
                likes: 1,
                reposts: 0,
                replies: 0,
                bookmarks: 0
            }))
        };
        const poller = new SnsMetricsPoller({
            ledgerRepository,
            accountRepository: makeAccountRepository({ includeOtherPerson: true }),
            xClient
        });

        const result = await poller.run({ limit: 10, date: '2026-05-17', actor: SNS_AUTHORITY });

        expect(result).toMatchObject({ scanned: 1, polled: 1, failed: 0, skipped: 0 });
        expect(result.polled_posts.map((entry) => entry.post_id)).toEqual([ownPost.id]);
        expect(xClient.fetchTweetMetrics).toHaveBeenCalledTimes(1);
        expect(ledgerRepository.findById(otherPost.id, OTHER_AUTHORITY).metrics_snapshots).toHaveLength(0);
    });

    it('does not use an account row outside the actor scope', async () => {
        const ledgerRepository = new InMemorySnsPostingLedgerRepository();
        const post = addPostedLedgerPost(ledgerRepository, {
            date: '2026-05-18',
            slot_index: 1,
            account_id: 'acc_x_other',
            posted_url: 'https://x.com/Other/status/2055000000000000005'
        });
        const xClient = { fetchTweetMetrics: vi.fn() };
        const poller = new SnsMetricsPoller({
            ledgerRepository,
            accountRepository: makeAccountRepository({ includeOtherPerson: true }),
            xClient
        });

        const result = await poller.run({ limit: 10, date: '2026-05-18', actor: SNS_AUTHORITY });

        expect(result).toMatchObject({ scanned: 1, polled: 0, failed: 0, skipped: 1 });
        expect(result.skipped_posts).toEqual([{ post_id: post.id, reason: 'account_outside_authority' }]);
        expect(xClient.fetchTweetMetrics).not.toHaveBeenCalled();
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

        const result = await poller.run({ limit: 10, actor: SNS_AUTHORITY });

        expect(result).toMatchObject({ scanned: 1, polled: 1, failed: 0 });
        expect(xClient.fetchTweetMetrics).toHaveBeenCalledWith(
            { provider: 'infisical', path: '/integrations/x/sato', version: 'v1' },
            '2055000000000000001'
        );
        const updated = ledgerRepository.findById(post.id, SNS_AUTHORITY);
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

        const result = await poller.run({ actor: SNS_AUTHORITY });

        expect(result.scanned).toBe(0);
        expect(result.polled).toBe(0);
    });

    it('surfaces posted records without posted_url as skipped instead of hiding them from scanned counts', async () => {
        const { ledgerRepository, post } = makePostedLedger({ posted_url: null });
        const poller = new SnsMetricsPoller({
            ledgerRepository,
            accountRepository: makeAccountRepository(),
            xClient: { fetchTweetMetrics: vi.fn() }
        });

        const result = await poller.run({ date: '2026-05-15', mark_learning_ready: true, actor: SNS_AUTHORITY });

        expect(result).toMatchObject({
            scanned: 1,
            polled: 0,
            failed: 0,
            skipped: 1,
            skipped_posts: [{
                post_id: post.id,
                reason: 'missing_posted_url'
            }]
        });
    });

    it('scopes polling to the requested Ledger date', async () => {
        const { ledgerRepository, post } = makePostedLedger({ date: '2026-05-15' });
        addPostedLedgerPost(ledgerRepository, {
            date: '2026-05-16',
            slot_index: 2,
            posted_url: 'https://x.com/AIBizNavigator/status/2055000000000000002'
        });
        const xClient = {
            fetchTweetMetrics: vi.fn(async () => ({
                impressions: 120,
                likes: 8,
                reposts: 1,
                replies: 2,
                bookmarks: 3
            }))
        };
        const poller = new SnsMetricsPoller({
            ledgerRepository,
            accountRepository: makeAccountRepository(),
            xClient
        });

        const result = await poller.run({ limit: 10, date: '2026-05-15', actor: SNS_AUTHORITY });

        expect(result).toMatchObject({
            date: '2026-05-15',
            scanned: 1,
            polled: 1,
            failed: 0,
            learning_ready: {
                before: 0,
                promoted: 0,
                after: 0
            }
        });
        expect(result.polled_posts.map((entry) => entry.post_id)).toEqual([post.id]);
        expect(xClient.fetchTweetMetrics).toHaveBeenCalledTimes(1);
    });

    it('can promote successfully polled posted records to learning_ready', async () => {
        const { ledgerRepository, post } = makePostedLedger();
        const poller = new SnsMetricsPoller({
            ledgerRepository,
            accountRepository: makeAccountRepository(),
            xClient: {
                fetchTweetMetrics: vi.fn(async () => ({
                    impressions: 300,
                    likes: 12,
                    reposts: 2,
                    replies: 1,
                    bookmarks: 5
                }))
            },
            now: () => new Date('2026-05-15T12:00:00.000Z')
        });

        const result = await poller.run({ limit: 10, mark_learning_ready: true, actor: SNS_AUTHORITY });

        expect(result.polled_posts[0]).toMatchObject({
            post_id: post.id,
            previous_status: 'posted',
            status: 'learning_ready'
        });
        expect(result.learning_ready).toEqual({
            before: 0,
            promoted: 1,
            after: 1
        });
        const updated = ledgerRepository.findById(post.id, SNS_AUTHORITY);
        expect(updated.status).toBe('learning_ready');
        expect(updated.metrics_snapshots).toHaveLength(1);
    });

    it('does not mutate metrics or status during dry_run even with mark_learning_ready', async () => {
        const { ledgerRepository, post } = makePostedLedger();
        const poller = new SnsMetricsPoller({
            ledgerRepository,
            accountRepository: makeAccountRepository(),
            xClient: {
                fetchTweetMetrics: vi.fn(async () => ({
                    impressions: 300,
                    likes: 12,
                    reposts: 2,
                    replies: 1,
                    bookmarks: 5
                }))
            }
        });

        const result = await poller.run({ limit: 10, dry_run: true, mark_learning_ready: true, actor: SNS_AUTHORITY });

        expect(result).toMatchObject({
            dry_run: true,
            mark_learning_ready: true,
            polled: 1,
            learning_ready: {
                before: 0,
                promoted: 0,
                after: 0
            }
        });
        const updated = ledgerRepository.findById(post.id, SNS_AUTHORITY);
        expect(updated.status).toBe('posted');
        expect(updated.metrics_snapshots).toHaveLength(0);
    });

    it('surfaces fetch failures without promoting or hiding them as zero reactions', async () => {
        const { ledgerRepository, post } = makePostedLedger();
        const poller = new SnsMetricsPoller({
            ledgerRepository,
            accountRepository: makeAccountRepository(),
            xClient: {
                fetchTweetMetrics: vi.fn(async () => {
                    const error = new Error('X API response missing tweet data');
                    error.code = 'missing_tweet_data';
                    throw error;
                })
            }
        });

        const result = await poller.run({ limit: 10, mark_learning_ready: true, actor: SNS_AUTHORITY });

        expect(result).toMatchObject({
            scanned: 1,
            polled: 0,
            failed: 1,
            learning_ready: {
                before: 0,
                promoted: 0,
                after: 0
            },
            failed_posts: [{
                post_id: post.id,
                code: 'missing_tweet_data'
            }]
        });
        expect(ledgerRepository.findById(post.id, SNS_AUTHORITY).status).toBe('posted');
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

        const result = await poller.run({ actor: SNS_AUTHORITY });

        expect(result.anomalies).toHaveLength(1);
        expect(anomalyNotifier).toHaveBeenCalledTimes(1);
        expect(anomalyNotifier.mock.calls[0][0]).toMatchObject({
            post_id: post.id,
            tweet_id: '2055000000000000001',
            reason: 'reply-impression-ratio:0.130'
        });
        expect(ledgerRepository.findById(post.id, SNS_AUTHORITY).metrics_snapshots[0].anomaly).toMatchObject({
            reason: 'reply-impression-ratio:0.130'
        });
    });
});
