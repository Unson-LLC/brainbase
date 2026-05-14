// @ts-check
import { describe, expect, it } from 'vitest';

import { InMemorySnsPostingLedgerRepository } from '../../../server/services/sns/posting-ledger-repository.js';
import { SnsLedgerPublishService } from '../../../server/services/sns/sns-ledger-publish-service.js';
import { SnsScheduledPublisher } from '../../../server/services/sns/sns-scheduled-publisher.js';

function actor() {
    return { sub: 'sato_keigo', actor_person_id: 'sato_keigo' };
}

function makeRepository() {
    const repository = new InMemorySnsPostingLedgerRepository();
    repository.upsertReviewPack({
        account_id: 'acc_x_sato',
        account_handle: '@AIBizNavigator',
        drafts: [
            {
                date: '2026-05-14',
                slot_index: 1,
                lane: 'trust_balance',
                body: 'Claude Codeを会社で使うなら、レビュー境界が本体',
                scheduled_at: '2026-05-14T11:55:00.000Z'
            },
            {
                date: '2026-05-14',
                slot_index: 2,
                lane: 'own_proof',
                body: 'AI PMは管理ではなく、判断の前提を揃える仕事になる',
                scheduled_at: '2026-05-14T12:05:00.000Z'
            }
        ]
    });
    for (const post of repository.listPosts({})) {
        repository.updatePost(post.id, { status: 'approved' }, actor());
        repository.updatePost(post.id, { status: 'scheduled' }, actor());
    }
    return repository;
}

describe('SnsScheduledPublisher', () => {
    it('publishes only due scheduled posts through SnsLedgerPublishService when auto publish is enabled', async () => {
        const repository = makeRepository();
        const executorCalls = [];
        const publishService = new SnsLedgerPublishService({
            ledgerRepository: repository,
            postExecutor: async (payload) => {
                executorCalls.push(payload);
                return { success: true, url: 'https://x.com/i/web/status/2055000000000000001' };
            },
            now: () => new Date('2026-05-14T12:00:30.000Z')
        });
        const publisher = new SnsScheduledPublisher({
            ledgerRepository: repository,
            publishService,
            now: () => new Date('2026-05-14T12:00:00.000Z')
        });

        const result = await publisher.run({
            actor: actor(),
            auto_publish_enabled: true
        });

        expect(result).toMatchObject({ scanned: 2, due: 1, posted: 1, failed: 0, skipped: 0, dry_run: false });
        expect(executorCalls).toHaveLength(1);
        expect(executorCalls[0].body).toContain('レビュー境界');
        expect(repository.findById('sns_20260514_1_trust_balance')).toMatchObject({
            status: 'posted',
            posted_url: 'https://x.com/i/web/status/2055000000000000001'
        });
        expect(repository.findById('sns_20260514_2_own_proof').status).toBe('scheduled');
    });

    it('does not mutate or call X publish when auto publish is disabled', async () => {
        const repository = makeRepository();
        const publishService = {
            async publishPost() {
                throw new Error('publish should not be called');
            }
        };
        const publisher = new SnsScheduledPublisher({
            ledgerRepository: repository,
            publishService,
            now: () => new Date('2026-05-14T12:00:00.000Z')
        });

        const result = await publisher.run({
            actor: actor(),
            auto_publish_enabled: false
        });

        expect(result).toMatchObject({ scanned: 2, due: 1, posted: 0, failed: 0, skipped: 1 });
        expect(result.skipped_posts[0]).toMatchObject({
            post_id: 'sns_20260514_1_trust_balance',
            reason: 'auto_publish_disabled'
        });
        expect(repository.findById('sns_20260514_1_trust_balance').status).toBe('scheduled');
    });

    it('dry-runs due post selection without mutating the ledger', async () => {
        const repository = makeRepository();
        const publisher = new SnsScheduledPublisher({
            ledgerRepository: repository,
            publishService: { async publishPost() { throw new Error('publish should not be called'); } },
            now: () => new Date('2026-05-14T12:00:00.000Z')
        });

        const result = await publisher.run({
            actor: actor(),
            dry_run: true,
            auto_publish_enabled: true
        });

        expect(result).toMatchObject({ scanned: 2, due: 1, posted: 0, failed: 0, skipped: 0, dry_run: true });
        expect(result.due_posts).toEqual(['sns_20260514_1_trust_balance']);
        expect(repository.findById('sns_20260514_1_trust_balance').status).toBe('scheduled');
    });

    it('marks a claimed post as publish_failed with memo context when publishing fails', async () => {
        const repository = makeRepository();
        const publisher = new SnsScheduledPublisher({
            ledgerRepository: repository,
            publishService: {
                async publishPost() {
                    throw new Error('X rate limit');
                }
            },
            now: () => new Date('2026-05-14T12:00:00.000Z')
        });

        const result = await publisher.run({
            actor: actor(),
            auto_publish_enabled: true
        });

        expect(result).toMatchObject({ due: 1, posted: 0, failed: 1 });
        const post = repository.findById('sns_20260514_1_trust_balance');
        expect(post.status).toBe('publish_failed');
        expect(post.memo).toContain('sns-scheduled-publisher failed');
        expect(post.memo).toContain('X rate limit');
    });
});
