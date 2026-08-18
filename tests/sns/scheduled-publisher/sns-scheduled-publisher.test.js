// @ts-check
import { describe, expect, it, vi } from 'vitest';

import { InMemorySnsPostingLedgerRepository } from '../../../server/services/sns/posting-ledger-repository.js';
import { SnsLedgerPublishService } from '../../../server/services/sns/sns-ledger-publish-service.js';
import { SnsScheduledPublisher } from '../../../server/services/sns/sns-scheduled-publisher.js';
import { ContractError } from '../../../server/services/multitenant/errors.js';

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
                scheduled_at: '2026-05-14T11:55:00.000Z',
                tenant_boundary: {
                    tenant_context: { tenant: { tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV', tenant_revision: '7' } },
                    resource_ref: { object_type: 'project', resource_id: 'project_sns' }
                }
            },
            {
                date: '2026-05-14',
                slot_index: 2,
                lane: 'own_proof',
                body: 'AI PMは管理ではなく、判断の前提を揃える仕事になる',
                scheduled_at: '2026-05-14T12:05:00.000Z',
                tenant_boundary: {
                    tenant_context: { tenant: { tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV', tenant_revision: '7' } },
                    resource_ref: { object_type: 'project', resource_id: 'project_sns' }
                }
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
            tenantBoundaryAuthorizer: async () => ({ authorized: true }),
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
            tenantBoundaryAuthorizer: async () => ({ authorized: true }),
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

    it('AC-005 authorizes the persisted background_job binding before claim and provider publish', async () => {
        const repository = makeRepository();
        const events = [];
        const originalClaim = repository.claimScheduledPost.bind(repository);
        repository.claimScheduledPost = async (...args) => {
            events.push('claim');
            return originalClaim(...args);
        };
        const publisher = new SnsScheduledPublisher({
            ledgerRepository: repository,
            tenantBoundaryAuthorizer: async (input) => {
                events.push('authorize');
                expect(input).toEqual({
                    tenant_context: { tenant: { tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV', tenant_revision: '7' } },
                    resource_ref: { object_type: 'project', resource_id: 'project_sns' }
                });
                return { authorized: true };
            },
            publishService: {
                async publishPost(postId) {
                    events.push('publish');
                    repository.updatePost(postId, { status: 'posted' }, actor());
                    return { post: repository.findById(postId) };
                }
            },
            now: () => new Date('2026-05-14T12:00:00.000Z')
        });

        const result = await publisher.run({ actor: actor(), auto_publish_enabled: true });

        expect(result.posted).toBe(1);
        expect(events).toEqual(['authorize', 'claim', 'publish']);
    });

    it.each([
        ['missing authorizer', null, 'UPSTREAM_UNAVAILABLE', 503],
        ['cross tenant', async () => { throw new ContractError('CROSS_TENANT_CANDIDATE', { status: 403 }); }, 'CROSS_TENANT_CANDIDATE', 403]
    ])('AC-005 rejects %s before claim or provider side effects', async (_label, tenantBoundaryAuthorizer, code, status) => {
        const repository = makeRepository();
        const claim = vi.spyOn(repository, 'claimScheduledPost');
        const publishPost = vi.fn();
        const publisher = new SnsScheduledPublisher({
            ledgerRepository: repository,
            publishService: { publishPost },
            tenantBoundaryAuthorizer,
            now: () => new Date('2026-05-14T12:00:00.000Z')
        });

        await expect(publisher.run({ actor: actor(), auto_publish_enabled: true }))
            .rejects.toMatchObject({ code, status });
        expect(claim).not.toHaveBeenCalled();
        expect(publishPost).not.toHaveBeenCalled();
        expect(repository.findById('sns_20260514_1_trust_balance').status).toBe('scheduled');
    });

    it('AC-005 rejects a scheduled row without a persisted tenant binding', async () => {
        const repository = makeRepository();
        const due = repository.findById('sns_20260514_1_trust_balance');
        repository.posts.set(due.id, { ...repository.posts.get(due.id), evidence: {} });
        const claim = vi.spyOn(repository, 'claimScheduledPost');
        const publishPost = vi.fn();
        const publisher = new SnsScheduledPublisher({
            ledgerRepository: repository,
            publishService: { publishPost },
            tenantBoundaryAuthorizer: vi.fn(),
            now: () => new Date('2026-05-14T12:00:00.000Z')
        });

        await expect(publisher.run({ actor: actor(), auto_publish_enabled: true }))
            .rejects.toMatchObject({ code: 'TENANT_BOUNDARY_INVALID', status: 400 });
        expect(claim).not.toHaveBeenCalled();
        expect(publishPost).not.toHaveBeenCalled();
    });
});
