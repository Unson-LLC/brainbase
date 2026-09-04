// @ts-check
import { describe, expect, it } from 'vitest';

import { InMemorySnsPostingLedgerRepository } from '../../../server/services/sns/posting-ledger-repository.js';
import { maybeRecordFeedback, parseArgs, parseMetrics, validateArgs } from '../../../scripts/process-sns-feedback-to-learning.js';

const ACCESS = {
    owner_person_id: 'sato_keigo',
    actor_person_id: 'sato_keigo',
    organization_id: 'unson',
    org_ids: ['unson']
};

function makeLedgerPost(status = 'review_needed') {
    const repository = new InMemorySnsPostingLedgerRepository();
    repository.upsertReviewPack({
        account_id: 'acc_x_sato',
        drafts: [{
            date: '2026-05-14',
            slot_index: 1,
            lane: 'trust_balance',
            body: 'Claude Codeを会社で使うならレビュー境界が本体'
        }]
    });
    let post = repository.listPosts({})[0];
    if (status === 'approved' || status === 'scheduled' || status === 'posted' || status === 'learning_ready') {
        post = repository.updatePost(post.id, { status: 'approved' }, { actor_person_id: 'sato_keigo' });
    }
    if (status === 'scheduled' || status === 'posted' || status === 'learning_ready') {
        post = repository.updatePost(post.id, { status: 'scheduled' }, { actor_person_id: 'sato_keigo' });
    }
    if (status === 'posted' || status === 'learning_ready') {
        post = repository.updatePost(post.id, {
            status: 'posted',
            posted_url: 'https://x.com/AIBizNavigator/status/2053781211001323851',
            metrics_snapshot: { impressions: 10 }
        }, { actor_person_id: 'sato_keigo' });
    }
    if (status === 'learning_ready') {
        post = repository.updatePost(post.id, { status: 'learning_ready' }, { actor_person_id: 'sato_keigo' });
    }
    return { repository, post };
}

describe('process-sns-feedback-to-learning', () => {
    it('parses feedback and learning handoff arguments', () => {
        expect(parseArgs([
            '--date', '2026-05-14',
            '--post-id', 'sns_1',
            '--posted-url', 'https://x.com/AIBizNavigator/status/1',
            '--metrics-json', '{"impressions":1200,"likes":35}',
            '--learning-ready',
            '--dry-run',
            '--json'
        ])).toMatchObject({
            date: '2026-05-14',
            postId: 'sns_1',
            postedUrl: 'https://x.com/AIBizNavigator/status/1',
            metricsJson: '{"impressions":1200,"likes":35}',
            learningReady: true,
            dryRun: true,
            json: true
        });
    });

    it('parses inline metrics JSON', () => {
        expect(parseMetrics('{"impressions":1200,"likes":35,"replies":3}')).toEqual({
            impressions: 1200,
            likes: 35,
            replies: 3
        });
    });

    it('rejects feedback fields without a target post', () => {
        expect(() => validateArgs(parseArgs([
            '--posted-url', 'https://x.com/AIBizNavigator/status/2053781211001323851'
        ]))).toThrow('--post-id is required');
    });

    it('records manual feedback for an approved post through allowed ledger transitions', async () => {
        const { repository, post } = makeLedgerPost('approved');

        const result = await maybeRecordFeedback(repository, {
            ...parseArgs([
                '--post-id', post.id,
                '--posted-url', 'https://x.com/AIBizNavigator/status/2053781211001323851',
                '--metrics-json', '{"impressions":1200,"likes":35}',
                '--learning-ready'
            ]),
            postedAt: '2026-05-14T03:00:00.000Z'
        }, ACCESS);

        expect(result.post).toMatchObject({
            id: post.id,
            status: 'learning_ready',
            posted_url: 'https://x.com/AIBizNavigator/status/2053781211001323851'
        });
        expect(result.post.metrics_snapshots).toHaveLength(1);
    });
});
