// @ts-check
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createSnsGrowthRouter } from '../../../server/routes/sns-growth.js';
import { InMemorySnsPostingLedgerRepository } from '../../../server/services/sns/posting-ledger-repository.js';

function makeApp() {
    const repository = new InMemorySnsPostingLedgerRepository();
    const app = express();
    app.use(express.json());
    app.use('/api/sns-growth', createSnsGrowthRouter({ repository }));
    return { app, repository };
}

function makePublishingApp({ publishResult = { success: true, url: 'https://x.com/i/web/status/2055000000000000001' } } = {}) {
    const repository = new InMemorySnsPostingLedgerRepository();
    const app = express();
    app.use(express.json());
    const calls = [];
    const publishService = {
        async publishPost(postId, options) {
            calls.push({ postId, options });
            if (options.dry_run) {
                const post = repository.findById(postId);
                return { post, dry_run: true, publish_result: { dry_run: true, text: post.body } };
            }
            const current = repository.findById(postId);
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

    it('updates a post body and status through the operational API', async () => {
        const { app, repository } = makeApp();
        repository.upsertReviewPack({
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
        const post = repository.listPosts({})[0];

        const res = await request(app)
            .patch(`/api/sns-growth/posts/${post.id}`)
            .send({
                body: 'Claude Codeを会社で使うなら、権限とレビュー境界を先に決める',
                status: 'approved'
            })
            .expect(200);

        expect(res.body.post.status).toBe('approved');
        expect(res.body.post.body).toContain('レビュー境界');
        expect(res.body.post.revisions).toHaveLength(1);
    });

    it('dry-runs publishing without mutating the approved Ledger post', async () => {
        const { app, repository, calls } = makePublishingApp();
        repository.upsertReviewPack({
            account_id: 'acc_x_sato',
            drafts: [{
                date: '2026-05-14',
                slot_index: 1,
                lane: 'trust_balance',
                body: 'Claude Codeを会社で使うなら、レビュー境界を先に決める'
            }]
        });
        const post = repository.updatePost(repository.listPosts({})[0].id, { status: 'approved' }, { actor_person_id: 'sato_keigo' });

        const res = await request(app)
            .post(`/api/sns-growth/posts/${post.id}/publish`)
            .send({ dry_run: true })
            .expect(200);

        expect(calls[0]).toMatchObject({ postId: post.id, options: { dry_run: true } });
        expect(res.body.dry_run).toBe(true);
        expect(res.body.post.status).toBe('approved');
        expect(repository.findById(post.id).status).toBe('approved');
    });

    it('publishes a confirmed approved Ledger post and returns the posted URL', async () => {
        const { app, repository, calls } = makePublishingApp();
        repository.upsertReviewPack({
            account_id: 'acc_x_sato',
            drafts: [{
                date: '2026-05-14',
                slot_index: 1,
                lane: 'trust_balance',
                body: 'Claude Codeを会社で使うなら、レビュー境界を先に決める'
            }]
        });
        const post = repository.updatePost(repository.listPosts({})[0].id, { status: 'approved' }, { actor_person_id: 'sato_keigo' });

        const res = await request(app)
            .post(`/api/sns-growth/posts/${post.id}/publish`)
            .send({ confirm_public_post: true })
            .expect(200);

        expect(calls[0].options.confirm_public_post).toBe(true);
        expect(res.body.post.status).toBe('posted');
        expect(res.body.post.posted_url).toBe('https://x.com/i/web/status/2055000000000000001');
    });
});
