// @ts-check
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createSnsGrowthRouter } from '../../../server/routes/sns-growth.js';
import { AccountService } from '../../../server/services/account/account-service.js';
import { InMemoryAccountRepository } from '../../../server/services/account/account-repository.js';
import { InMemorySnsPostingLedgerRepository } from '../../../server/services/sns/posting-ledger-repository.js';

const DEFAULT_ACCESS = Object.freeze({
    personId: 'sato_keigo',
    organizationId: 'unson',
    role: 'ceo',
    projectCodes: ['brainbase']
});

const DEFAULT_AUTHORITY = Object.freeze({
    owner_person_id: 'sato_keigo',
    actor_person_id: 'sato_keigo',
    organization_id: 'unson',
    sub: 'sato_keigo',
    role: 'ceo',
    org_ids: ['unson'],
    projectCodes: ['brainbase']
});

function installTestAccess(app, access = DEFAULT_ACCESS) {
    app.use((req, _res, next) => {
        req.access = { ...access };
        next();
    });
}

function upsertReviewPack(repository, input, authority = DEFAULT_AUTHORITY) {
    return repository.upsertReviewPack(input, authority);
}

function listPosts(repository, filters = {}, authority = DEFAULT_AUTHORITY) {
    return repository.listPosts(filters, authority);
}

function findPost(repository, postId, authority = DEFAULT_AUTHORITY) {
    return repository.findById(postId, authority);
}

function updatePost(repository, postId, patch, authority = DEFAULT_AUTHORITY) {
    return repository.updatePost(postId, patch, authority);
}

function makeApp({ access = DEFAULT_ACCESS } = {}) {
    const repository = new InMemorySnsPostingLedgerRepository();
    const app = express();
    app.use(express.json());
    installTestAccess(app, access);
    app.use('/api/sns-growth', createSnsGrowthRouter({ repository }));
    return { app, repository };
}

function makePublishingApp({ publishResult = { success: true, url: 'https://x.com/i/web/status/2055000000000000001' }, access = DEFAULT_ACCESS } = {}) {
    const repository = new InMemorySnsPostingLedgerRepository();
    const app = express();
    app.use(express.json());
    installTestAccess(app, access);
    const calls = [];
    const publishService = {
        async publishPost(postId, options) {
            calls.push({ postId, options });
            if (options.dry_run) {
                const post = repository.findById(postId, options.actor);
                return { post, dry_run: true, publish_result: { dry_run: true, text: post.body } };
            }
            const current = repository.findById(postId, options.actor);
            let post = current;
            if (post.status === 'approved') {
                post = repository.updatePost(post.id, { status: 'scheduled' }, options.actor);
            }
            post = repository.updatePost(post.id, {
                status: 'posted',
                posted_url: publishResult.url,
                posted_at: '2026-05-14T03:00:00.000Z'
            }, options.actor);
            return { post, publish_result: publishResult };
        }
    };
    app.use('/api/sns-growth', createSnsGrowthRouter({ repository, publishService }));
    return { app, repository, calls };
}

describe('sns-growth routes', () => {
    it('persists an ohayo review pack and lists it for the calendar range', async () => {
        const { app } = makeApp();

        await request(app)
            .post('/api/sns-growth/review-pack')
            .send({
                account_id: 'acc_x_sato',
                account_handle: '@AIBizNavigator',
                drafts: [{
                    id: 'week_2026-05-18_1_trust_balance',
                    date: '2026-05-18',
                    slot_index: 1,
                    lane: 'trust_balance',
                    format: 'standalone',
                    body: 'AI PMは管理ではなく境界設計になる',
                    kg_source_entity_id: 'candidate:ai-pm',
                    derived_from: ['candidate:ai-pm'],
                    evidence_ids: [{ uri: 'brainbase:test:ai-pm' }],
                    persona_brain: { target_person: 'AI導入を任されたPM' },
                    safety: { persona_affect: { likely_reader_feeling: '現場に接続できる' } }
                }]
            })
            .expect(201);

        const res = await request(app)
            .get('/api/sns-growth/posts?startDate=2026-05-18&endDate=2026-05-18')
            .expect(200);

        expect(res.body.posts).toHaveLength(1);
        expect(res.body.posts[0].status).toBe('review_needed');
        expect(res.body.posts[0].title).toContain('AI PM');
        expect(res.body.summary.by_status.review_needed).toBe(1);
    });

    it('rejects another person from reading or updating the same post ID', async () => {
        const { repository } = makeApp();
        upsertReviewPack(repository, {
            account_id: 'acc_x_sato',
            drafts: [{
                id: 'week_2026-05-18_1_person_scope',
                date: '2026-05-18',
                slot_index: 1,
                lane: 'trust_balance',
                body: 'person境界を越えてSNS投稿を読ませない'
            }]
        });
        const post = listPosts(repository)[0];
        const { app } = makeApp({
            access: {
                ...DEFAULT_ACCESS,
                personId: 'other_person'
            }
        });

        const list = await request(app)
            .get('/api/sns-growth/posts?startDate=2026-05-18&endDate=2026-05-18')
            .expect(200);
        expect(list.body.posts.map((item) => item.id)).not.toContain(post.id);

        const read = await request(app)
            .post(`/api/sns-growth/posts/${post.id}/feedback`)
            .send({ metrics_snapshot: { impressions: 1 } });
        expect([403, 404]).toContain(read.status);

        const update = await request(app)
            .patch(`/api/sns-growth/posts/${post.id}`)
            .send({ body: '別personによる更新は拒否する' });
        expect([403, 404]).toContain(update.status);
        expect(findPost(repository, post.id)?.body).toBe('person境界を越えてSNS投稿を読ませない');
    });

    it('rejects another organization from reading or updating the same post ID', async () => {
        const { repository } = makeApp();
        upsertReviewPack(repository, {
            account_id: 'acc_x_sato',
            drafts: [{
                id: 'week_2026-05-18_1_organization_scope',
                date: '2026-05-18',
                slot_index: 1,
                lane: 'trust_balance',
                body: 'organization境界を越えてSNS投稿を読ませない'
            }]
        });
        const post = listPosts(repository)[0];
        const { app } = makeApp({
            access: {
                ...DEFAULT_ACCESS,
                organizationId: 'org_other'
            }
        });

        const list = await request(app)
            .get('/api/sns-growth/posts?startDate=2026-05-18&endDate=2026-05-18')
            .expect(200);
        expect(list.body.posts.map((item) => item.id)).not.toContain(post.id);

        const read = await request(app)
            .post(`/api/sns-growth/posts/${post.id}/feedback`)
            .send({ metrics_snapshot: { impressions: 1 } });
        expect([403, 404]).toContain(read.status);

        const update = await request(app)
            .patch(`/api/sns-growth/posts/${post.id}`)
            .send({ body: '別organizationによる更新は拒否する' });
        expect([403, 404]).toContain(update.status);
        expect(findPost(repository, post.id)?.body).toBe('organization境界を越えてSNS投稿を読ませない');
    });

    it('reports duplicate review-pack rows as skipped instead of calendar posts', async () => {
        const { app, repository } = makeApp();
        upsertReviewPack(repository, {
            account_id: 'acc_x_sato',
            drafts: [{
                date: '2026-05-13',
                slot_index: 2,
                lane: 'trust_balance',
                body: 'Claude Codeを会社で使う時、小技を増やすより先に決めることがある'
            }]
        });

        const res = await request(app)
            .post('/api/sns-growth/review-pack')
            .send({
                account_id: 'acc_x_sato',
                account_handle: '@AIBizNavigator',
                drafts: [{
                    date: '2026-05-18',
                    slot_index: 1,
                    lane: 'trust_balance',
                    body: 'Claude Codeを会社で使う時、小技を増やすより先に決めることがある'
                }]
            })
            .expect(201);

        expect(res.body.created).toHaveLength(0);
        expect(res.body.updated).toHaveLength(0);
        expect(res.body.skipped).toHaveLength(1);
        expect(res.body.skipped[0].reason).toBe('duplicate_body');
        expect(listPosts(repository, { startDate: '2026-05-18', endDate: '2026-05-18' })).toHaveLength(0);
    });

    it('updates a post body and status through the operational API', async () => {
        const { app, repository } = makeApp();
        upsertReviewPack(repository, {
            account_id: 'acc_x_sato',
            drafts: [{
                id: 'week_2026-05-18_1_trust_balance',
                date: '2026-05-18',
                slot_index: 1,
                lane: 'trust_balance',
                body: 'Claude Codeは運用設計が本体',
                kg_source_entity_id: 'candidate:claude-code',
                derived_from: ['candidate:claude-code'],
                evidence_ids: [],
                persona_brain: { target_person: 'AI導入を任されたPM' },
                safety: { persona_affect: { likely_reader_feeling: '現場に接続できる' } }
            }]
        });
        const post = listPosts(repository)[0];

        const res = await request(app)
            .patch(`/api/sns-growth/posts/${post.id}`)
            .send({
                body: 'Claude Codeを会社で使うなら、権限とレビュー境界を先に決める',
                status: 'approved'
            })
            .expect(200);

        expect(res.body.post.status).toBe('scheduled');
        expect(res.body.post.body).toContain('レビュー境界');
        expect(res.body.post.revisions).toHaveLength(1);
    });

    it('dry-runs publishing without mutating the approved Ledger post', async () => {
        const { app, repository, calls } = makePublishingApp();
        upsertReviewPack(repository, {
            account_id: 'acc_x_sato',
            drafts: [{
                date: '2026-05-14',
                slot_index: 1,
                lane: 'trust_balance',
                body: 'Claude Codeを会社で使うなら、レビュー境界を先に決める'
            }]
        });
        const post = updatePost(repository, listPosts(repository)[0].id, { status: 'approved' });

        const res = await request(app)
            .post(`/api/sns-growth/posts/${post.id}/publish`)
            .send({ dry_run: true })
            .expect(200);

        expect(calls[0]).toMatchObject({ postId: post.id, options: { dry_run: true } });
        expect(res.body.dry_run).toBe(true);
        expect(res.body.post.status).toBe('approved');
        expect(findPost(repository, post.id).status).toBe('approved');
    });

    it('AC-005 rejects direct confirmed public publish without calling the provider', async () => {
        const { app, repository, calls } = makePublishingApp();
        upsertReviewPack(repository, {
            account_id: 'acc_x_sato',
            drafts: [{
                date: '2026-05-14',
                slot_index: 1,
                lane: 'trust_balance',
                body: 'Claude Codeを会社で使うなら、レビュー境界を先に決める'
            }]
        });
        const post = updatePost(repository, listPosts(repository)[0].id, { status: 'approved' });

        const res = await request(app)
            .post(`/api/sns-growth/posts/${post.id}/publish`)
            .send({ confirm_public_post: true })
            .expect(409);

        expect(res.body).toMatchObject({ code: 'sns_direct_public_publish_disabled' });
        expect(calls).toHaveLength(0);
        expect(findPost(repository, post.id).status).toBe('approved');
    });

    it('marks a posted Ledger record as deleted without clearing the posted URL', async () => {
        const { app, repository } = makeApp();
        upsertReviewPack(repository, {
            account_id: 'acc_x_sato',
            drafts: [{
                date: '2026-05-14',
                slot_index: 1,
                lane: 'trust_balance',
                body: 'Claude Codeを会社で使うなら、レビュー境界を先に決める'
            }]
        });
        let post = updatePost(repository, listPosts(repository)[0].id, { status: 'approved' });
        post = updatePost(repository, post.id, { status: 'scheduled' });
        post = updatePost(repository, post.id, {
            status: 'posted',
            posted_url: 'https://x.com/AIBizNavigator/status/2055000000000000001',
            posted_at: '2026-05-14T03:00:00.000Z'
        });

        const res = await request(app)
            .patch(`/api/sns-growth/posts/${post.id}`)
            .send({
                status: 'deleted',
                deleted_at: '2026-05-14T04:00:00.000Z',
                deletion_source: 'manual_x_delete',
                deletion_reason: 'X上で削除した'
            })
            .expect(200);

        expect(res.body.post).toMatchObject({
            status: 'deleted',
            posted_url: 'https://x.com/AIBizNavigator/status/2055000000000000001',
            deleted_at: '2026-05-14T04:00:00.000Z',
            deletion_source: 'manual_x_delete',
            deletion_reason: 'X上で削除した'
        });
    });

    it('records feedback metrics and advances a posted Ledger record to learning_ready', async () => {
        const { app, repository } = makeApp();
        upsertReviewPack(repository, {
            account_id: 'acc_x_sato',
            drafts: [{
                date: '2026-05-14',
                slot_index: 1,
                lane: 'learn_in_public',
                body: '投稿後の反応を学習候補に戻す'
            }]
        });
        let post = updatePost(repository, listPosts(repository)[0].id, { status: 'approved' });
        post = updatePost(repository, post.id, { status: 'scheduled' });
        post = updatePost(repository, post.id, {
            status: 'posted',
            posted_url: 'https://x.com/AIBizNavigator/status/2055000000000000001',
            posted_at: '2026-05-14T03:00:00.000Z'
        });

        const res = await request(app)
            .post(`/api/sns-growth/posts/${post.id}/feedback`)
            .send({
                metrics_snapshot: {
                    impressions: 1280,
                    likes: 84,
                    reposts: 9,
                    replies: 18,
                    bookmarks: 21
                },
                mark_learning_ready: true
            })
            .expect(200);

        expect(res.body.post.status).toBe('learning_ready');
        expect(res.body.post.metrics_snapshots).toHaveLength(1);
        expect(res.body.post.metrics_snapshots[0]).toMatchObject({
            impressions: 1280,
            likes: 84,
            reposts: 9,
            replies: 18,
            bookmarks: 21
        });
        expect(findPost(repository, post.id).status).toBe('learning_ready');
    });

    it('rejects learning_ready transition without metrics evidence', async () => {
        const { app, repository } = makeApp();
        upsertReviewPack(repository, {
            account_id: 'acc_x_sato',
            drafts: [{
                date: '2026-05-14',
                slot_index: 1,
                lane: 'learn_in_public',
                body: 'metricsなしで学習候補にしない'
            }]
        });
        let post = updatePost(repository, listPosts(repository)[0].id, { status: 'approved' });
        post = updatePost(repository, post.id, { status: 'scheduled' });
        post = updatePost(repository, post.id, {
            status: 'posted',
            posted_url: 'https://x.com/AIBizNavigator/status/2055000000000000001',
            posted_at: '2026-05-14T03:00:00.000Z'
        });

        const res = await request(app)
            .post(`/api/sns-growth/posts/${post.id}/feedback`)
            .send({ mark_learning_ready: true })
            .expect(400);

        expect(res.body.code).toBe('sns_feedback_metrics_required');
        expect(findPost(repository, post.id).status).toBe('posted');
    });

    it('lists visible X accounts with redacted credential refs and default-purpose flags', async () => {
        const accountRepository = new InMemoryAccountRepository();
        const accountService = new AccountService({ repository: accountRepository });
        const actor = { sub: 'sato_keigo', actor_person_id: 'sato_keigo', role: 'ceo', org_ids: ['unson'] };
        const account = await accountService.create({
            id: 'acc_x_sato',
            service: 'x',
            scope_type: 'personal',
            owner_person_id: 'sato_keigo',
            display_name: 'Keigo Sato X',
            external_account_id: 'x-user-1',
            external_handle: '@AIBizNavigator',
            credential_ref: { provider: 'env', path: 'SNS_X_ACCESS_TOKEN', env: 'SNS_X_ACCESS_TOKEN' },
            capabilities: ['post', 'read']
        }, actor);
        await accountService.setDefault({
            subject_type: 'person',
            subject_id: 'sato_keigo',
            service: 'x',
            purpose: 'sns_posting',
            account_id: account.id
        }, actor);
        const app = express();
        app.use(express.json());
        installTestAccess(app);
        app.use('/api/sns-growth', createSnsGrowthRouter({
            repository: new InMemorySnsPostingLedgerRepository(),
            accountService,
            env: { SNS_X_ACCESS_TOKEN: 'present-but-never-returned' }
        }));

        const res = await request(app)
            .get('/api/sns-growth/accounts')
            .expect(200);

        expect(res.body.accounts).toHaveLength(1);
        expect(res.body.accounts[0]).toMatchObject({
            id: 'acc_x_sato',
            service: 'x',
            display_name: 'Keigo Sato X',
            external_handle: '@AIBizNavigator',
            status: 'connected',
            capabilities: ['post', 'read'],
            defaults: { sns_posting: true, sns_metrics: false }
        });
        expect(res.body.accounts[0].credential_ref).toEqual({
            provider: 'env',
            path: 'SNS_X_ACCESS_TOKEN',
            env: 'SNS_X_ACCESS_TOKEN',
            env_present: true,
            posting_bridge_env_present: false
        });
        expect(JSON.stringify(res.body)).not.toContain('present-but-never-returned');
    });

    it('sets the default account for SNS posting through the account management API', async () => {
        const accountService = new AccountService({ repository: new InMemoryAccountRepository() });
        const actor = { sub: 'sato_keigo', actor_person_id: 'sato_keigo', role: 'ceo', org_ids: ['unson'] };
        await accountService.create({
            id: 'acc_x_sato',
            service: 'x',
            scope_type: 'personal',
            owner_person_id: 'sato_keigo',
            display_name: 'Keigo Sato X',
            credential_ref: { provider: 'infisical', path: '/brainbase/x/sato', version: 'v1' },
            capabilities: ['post', 'read']
        }, actor);
        const app = express();
        app.use(express.json());
        installTestAccess(app);
        app.use('/api/sns-growth', createSnsGrowthRouter({
            repository: new InMemorySnsPostingLedgerRepository(),
            accountService
        }));

        const res = await request(app)
            .post('/api/sns-growth/accounts/acc_x_sato/default')
            .send({ purpose: 'sns_metrics' })
            .expect(200);

        expect(res.body.account.defaults).toMatchObject({ sns_posting: false, sns_metrics: true });
        const audit = await accountService.listAudit('acc_x_sato');
        expect(audit.map((entry) => entry.action)).toContain('DEFAULT_CHANGED');
    });

    it('does not set defaults for an account outside the actor visible scope', async () => {
        const accountService = new AccountService({ repository: new InMemoryAccountRepository() });
        await accountService.create({
            id: 'acc_x_other',
            service: 'x',
            scope_type: 'personal',
            owner_person_id: 'other_person',
            display_name: 'Other X',
            credential_ref: { provider: 'infisical', path: '/brainbase/x/other', version: 'v1' },
            capabilities: ['post', 'read']
        }, { sub: 'other_person', actor_person_id: 'other_person', role: 'ceo', org_ids: [] });
        const app = express();
        app.use(express.json());
        installTestAccess(app);
        app.use('/api/sns-growth', createSnsGrowthRouter({
            repository: new InMemorySnsPostingLedgerRepository(),
            accountService
        }));

        await request(app)
            .post('/api/sns-growth/accounts/acc_x_other/default')
            .send({ purpose: 'sns_posting' })
            .expect(404);

        const audit = await accountService.listAudit('acc_x_other');
        expect(audit.map((entry) => entry.action)).not.toContain('DEFAULT_CHANGED');
    });

    it('does not health-check an account outside the actor visible scope', async () => {
        const accountService = new AccountService({ repository: new InMemoryAccountRepository() });
        await accountService.create({
            id: 'acc_x_other',
            service: 'x',
            scope_type: 'personal',
            owner_person_id: 'other_person',
            display_name: 'Other X',
            credential_ref: { provider: 'env', path: 'SNS_X_OTHER_TOKEN', env: 'SNS_X_OTHER_TOKEN' },
            capabilities: ['post', 'read']
        }, { sub: 'other_person', actor_person_id: 'other_person', role: 'ceo', org_ids: [] });
        const accountProvider = {
            healthCheck: vi.fn(async () => ({ ok: true })),
            getRateLimitStatus: vi.fn(async () => ({ remaining: 300, resetAt: '2026-05-15T12:15:00.000Z' }))
        };
        const app = express();
        app.use(express.json());
        installTestAccess(app);
        app.use('/api/sns-growth', createSnsGrowthRouter({
            repository: new InMemorySnsPostingLedgerRepository(),
            accountService,
            accountProvider
        }));

        await request(app)
            .post('/api/sns-growth/accounts/acc_x_other/health-check')
            .expect(404);

        expect(accountProvider.healthCheck).not.toHaveBeenCalled();
    });

    it('runs health check through the provider without exposing credential values', async () => {
        const accountService = new AccountService({ repository: new InMemoryAccountRepository() });
        const actor = { sub: 'sato_keigo', actor_person_id: 'sato_keigo', role: 'ceo', org_ids: ['unson'] };
        await accountService.create({
            id: 'acc_x_sato',
            service: 'x',
            scope_type: 'personal',
            owner_person_id: 'sato_keigo',
            display_name: 'Keigo Sato X',
            external_handle: '@AIBizNavigator',
            credential_ref: { provider: 'env', path: 'SNS_X_ACCESS_TOKEN', env: 'SNS_X_ACCESS_TOKEN' },
            capabilities: ['post', 'read']
        }, actor);
        const calls = [];
        const accountProvider = {
            async healthCheck(credentialRef) {
                calls.push(credentialRef);
                return { ok: true };
            },
            async getRateLimitStatus() {
                return { remaining: 299, resetAt: '2026-05-15T12:15:00.000Z' };
            }
        };
        const app = express();
        app.use(express.json());
        installTestAccess(app);
        app.use('/api/sns-growth', createSnsGrowthRouter({
            repository: new InMemorySnsPostingLedgerRepository(),
            accountService,
            accountProvider,
            env: { SNS_X_ACCESS_TOKEN: 'secret-token' }
        }));

        const res = await request(app)
            .post('/api/sns-growth/accounts/acc_x_sato/health-check')
            .expect(200);

        expect(calls[0]).toEqual({ provider: 'env', path: 'SNS_X_ACCESS_TOKEN', env: 'SNS_X_ACCESS_TOKEN' });
        expect(res.body.health).toEqual({
            ok: true,
            reason: null,
            credential_mode: null,
            rate_limit: { remaining: 299, resetAt: '2026-05-15T12:15:00.000Z' }
        });
        expect(JSON.stringify(res.body)).not.toContain('secret-token');
    });

    it('reports posting bridge credential health without exposing OAuth1 env values', async () => {
        const accountService = new AccountService({ repository: new InMemoryAccountRepository() });
        const actor = { sub: 'sato_keigo', actor_person_id: 'sato_keigo', role: 'ceo', org_ids: ['unson'] };
        await accountService.create({
            id: 'acc_x_sato',
            service: 'x',
            scope_type: 'personal',
            owner_person_id: 'sato_keigo',
            display_name: 'Keigo Sato X',
            external_handle: '@AIBizNavigator',
            credential_ref: { provider: 'env', path: 'SNS_X_ACCESS_TOKEN', env: 'SNS_X_ACCESS_TOKEN' },
            capabilities: ['post', 'read']
        }, actor);
        const accountProvider = {
            async healthCheck() {
                return { ok: true, reason: null, credential_mode: 'posting_bridge_oauth1' };
            },
            async getRateLimitStatus() {
                return { remaining: null, resetAt: null, reason: 'not_available_for_posting_bridge' };
            }
        };
        const env = {
            X_CONSUMER_KEY: 'consumer-key-secret',
            X_CONSUMER_SECRET: 'consumer-secret-secret',
            X_ACCESS_TOKEN: 'oauth1-token-secret',
            X_ACCESS_TOKEN_SECRET: 'oauth1-token-secret-value'
        };
        const app = express();
        app.use(express.json());
        installTestAccess(app);
        app.use('/api/sns-growth', createSnsGrowthRouter({
            repository: new InMemorySnsPostingLedgerRepository(),
            accountService,
            accountProvider,
            env
        }));

        const accounts = await request(app)
            .get('/api/sns-growth/accounts')
            .expect(200);
        expect(accounts.body.accounts[0].credential_ref).toMatchObject({
            env_present: false,
            posting_bridge_env_present: true
        });
        expect(JSON.stringify(accounts.body)).not.toContain('oauth1-token-secret');

        const res = await request(app)
            .post('/api/sns-growth/accounts/acc_x_sato/health-check')
            .expect(200);

        expect(res.body.health).toEqual({
            ok: true,
            reason: null,
            credential_mode: 'posting_bridge_oauth1',
            rate_limit: {
                remaining: null,
                resetAt: null,
                reason: 'not_available_for_posting_bridge'
            }
        });
        expect(JSON.stringify(res.body)).not.toContain('oauth1-token-secret');
    });

    it('keeps account health visible when rate-limit lookup is unavailable', async () => {
        const accountService = new AccountService({ repository: new InMemoryAccountRepository() });
        const actor = { sub: 'sato_keigo', actor_person_id: 'sato_keigo', role: 'ceo', org_ids: ['unson'] };
        await accountService.create({
            id: 'acc_x_sato',
            service: 'x',
            scope_type: 'personal',
            owner_person_id: 'sato_keigo',
            display_name: 'Keigo Sato X',
            credential_ref: { provider: 'env', path: 'SNS_X_ACCESS_TOKEN', env: 'SNS_X_ACCESS_TOKEN' },
            capabilities: ['post', 'read']
        }, actor);
        const app = express();
        app.use(express.json());
        installTestAccess(app);
        app.use('/api/sns-growth', createSnsGrowthRouter({
            repository: new InMemorySnsPostingLedgerRepository(),
            accountService,
            accountProvider: {
                async healthCheck() {
                    return { ok: true };
                },
                async getRateLimitStatus() {
                    const error = new Error('X rate headers unavailable');
                    error.code = 'rate_headers_missing';
                    throw error;
                }
            }
        }));

        const res = await request(app)
            .post('/api/sns-growth/accounts/acc_x_sato/health-check')
            .expect(200);

        expect(res.body.health).toMatchObject({
            ok: true,
            reason: null,
            credential_mode: null,
            rate_limit: { remaining: null, resetAt: null, reason: 'rate_headers_missing' }
        });
    });
});
