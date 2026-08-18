// @ts-check
import { describe, expect, it, vi } from 'vitest';

import { InMemorySnsPostingLedgerRepository } from '../../../server/services/sns/posting-ledger-repository.js';
import { SnsLedgerPublishService } from '../../../server/services/sns/sns-ledger-publish-service.js';

function actor() {
    return { sub: 'sato_keigo', actor_person_id: 'sato_keigo' };
}

function makeRepository(status = 'approved') {
    const repository = new InMemorySnsPostingLedgerRepository();
    repository.upsertReviewPack({
        account_id: 'acc_x_sato',
        account_handle: '@AIBizNavigator',
        drafts: [{
            date: '2026-05-14',
            slot_index: 1,
            lane: 'trust_balance',
            body: 'Claude Codeを会社で使うなら、レビュー境界まで含めて設計する',
            title: 'Claude Code法人導入'
        }]
    });
    let post = repository.listPosts({})[0];
    if (status === 'approved' || status === 'scheduled' || status === 'publishing' || status === 'posted') {
        post = repository.updatePost(post.id, { status: 'approved' }, actor());
    }
    if (status === 'scheduled' || status === 'publishing' || status === 'posted') {
        post = repository.updatePost(post.id, { status: 'scheduled' }, actor());
    }
    if (status === 'publishing') {
        post = repository.updatePost(post.id, { status: 'publishing' }, actor());
    }
    if (status === 'posted') {
        post = repository.updatePost(post.id, {
            status: 'posted',
            posted_url: 'https://x.com/i/web/status/1',
            posted_at: '2026-05-14T00:00:00.000Z'
        }, actor());
    }
    return { repository, post };
}

describe('SnsLedgerPublishService', () => {
    it('publishes only a previously claimed Ledger post and stores the posted URL', async () => {
        const { repository, post } = makeRepository('publishing');
        const calls = [];
        const service = new SnsLedgerPublishService({
            ledgerRepository: repository,
            postExecutor: async (payload) => {
                calls.push(payload);
                return { success: true, id: '2055000000000000001', url: 'https://x.com/i/web/status/2055000000000000001' };
            },
            now: () => new Date('2026-05-14T03:00:00.000Z')
        });

        const result = await service.publishPost(post.id, { actor: actor(), confirm_public_post: true });

        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            title: post.title,
            body: post.body,
            dry_run: false
        });
        expect(result.post).toMatchObject({
            status: 'posted',
            posted_url: 'https://x.com/i/web/status/2055000000000000001',
            posted_at: '2026-05-14T03:00:00.000Z'
        });
        expect(repository.findById(post.id).status).toBe('posted');
    });

    it.each(['approved', 'scheduled'])('rejects an unclaimed %s post before the provider side effect', async (status) => {
        const { repository, post } = makeRepository(status);
        const postExecutor = vi.fn();
        const service = new SnsLedgerPublishService({ ledgerRepository: repository, postExecutor });

        await expect(service.publishPost(post.id, { actor: actor(), confirm_public_post: true }))
            .rejects.toThrow('claimed before public SNS publish');

        expect(postExecutor).not.toHaveBeenCalled();
        expect(repository.findById(post.id).status).toBe(status);
    });

    it('dry-runs the publish executor without mutating the Ledger post', async () => {
        const { repository, post } = makeRepository('scheduled');
        const service = new SnsLedgerPublishService({
            ledgerRepository: repository,
            postExecutor: async () => ({ dry_run: true, text: post.body })
        });

        const result = await service.publishPost(post.id, { actor: actor(), dry_run: true });

        expect(result.dry_run).toBe(true);
        expect(result.post.status).toBe('scheduled');
        expect(repository.findById(post.id).status).toBe('scheduled');
        expect(repository.findById(post.id).posted_url).toBe(null);
    });

    it('rejects public posting without explicit confirmation', async () => {
        const { repository, post } = makeRepository('approved');
        const service = new SnsLedgerPublishService({
            ledgerRepository: repository,
            postExecutor: async () => ({ success: true, url: 'https://x.com/i/web/status/1' })
        });

        await expect(service.publishPost(post.id, { actor: actor() }))
            .rejects.toThrow('confirm_public_post required');
        expect(repository.findById(post.id).status).toBe('approved');
    });

    it('rejects posts that are still waiting for review', async () => {
        const { repository, post } = makeRepository('review_needed');
        const service = new SnsLedgerPublishService({
            ledgerRepository: repository,
            postExecutor: async () => ({ success: true, url: 'https://x.com/i/web/status/1' })
        });

        await expect(service.publishPost(post.id, { actor: actor(), confirm_public_post: true }))
            .rejects.toThrow('approved, scheduled, or publishing');
    });
});
