// @ts-check
import { describe, expect, it } from 'vitest';

import { PromotionGateService } from '../../../server/services/candidate-store/promotion-gate-service.js';
import { InMemoryCandidateRepository } from '../../../server/services/candidate-store/candidate-repository.js';
import { InMemorySnsPostingLedgerRepository } from '../../../server/services/sns/posting-ledger-repository.js';
import {
    buildSnsFeedbackCandidateDraft,
    SnsFeedbackLearningService
} from '../../../server/services/sns/feedback-learning-service.js';

const ACCESS = {
    owner_person_id: 'sato_keigo',
    actor_person_id: 'sato_keigo',
    organization_id: 'unson',
    org_ids: ['unson']
};

function makeReadyPost(overrides = {}) {
    const ledgerRepository = new InMemorySnsPostingLedgerRepository();
    ledgerRepository.upsertReviewPack({
        account_id: 'acc_x_sato',
        account_handle: '@AIBizNavigator',
        drafts: [{
            date: '2026-05-14',
            slot_index: 1,
            lane: 'trust_balance',
            body: 'Claude Codeを会社で使うならレビュー境界が本体',
            title: 'Claude Code運用設計',
            persona_brain: { target_person: 'AI導入を任されたPM' },
            graph_check: { status: 'ok' },
            quality_gate: { status: 'pass' },
            safety: { persona_affect: { likely_reader_feeling: '現場の迷いが言語化された' } }
        }]
    });
    const post = ledgerRepository.listPosts({})[0];
    ledgerRepository.updatePost(post.id, {
        status: 'approved'
    }, { actor_person_id: 'sato_keigo' });
    ledgerRepository.updatePost(post.id, {
        status: 'scheduled'
    }, { actor_person_id: 'sato_keigo' });
    ledgerRepository.updatePost(post.id, {
        status: 'posted',
        posted_url: 'https://x.com/AIBizNavigator/status/1',
        posted_at: '2026-05-14T03:00:00.000Z',
        metrics_snapshot: {
            impressions: 1200,
            likes: 35,
            replies: 3,
            reposts: 2,
            bookmarks: 11
        }
    }, { actor_person_id: 'sato_keigo' });
    const ready = ledgerRepository.updatePost(post.id, {
        status: 'learning_ready',
        ...overrides
    }, { actor_person_id: 'sato_keigo' });
    return { ledgerRepository, post: ready };
}

describe('SNS feedback learning service', () => {
    it('builds a candidate-store observation from a learning-ready SNS post without Graph mutation', () => {
        const { post } = makeReadyPost();

        const draft = buildSnsFeedbackCandidateDraft(post, ACCESS);

        expect(draft).toMatchObject({
            id: `cand_sns_feedback_${post.id}`,
            cognitive_type: 'observation',
            owner_person_id: 'sato_keigo',
            actor_person_id: 'sato_keigo',
            organization_id: 'unson',
            source_system: 'sns-feedback',
            source_event_ids: [`sns-post:${post.id}`],
            visibility: 'owner',
            sensitivity: 'internal'
        });
        expect(draft.body).toContain('impressions: 1200');
        expect(draft.body).toContain('engagement_rate: 0.0425');
        expect(draft.permission_snapshot.sns.posted_url).toBe('https://x.com/AIBizNavigator/status/1');
    });

    it('creates the candidate through PromotionGateService and links it back to the ledger', async () => {
        const { ledgerRepository, post } = makeReadyPost();
        const candidateRepository = new InMemoryCandidateRepository();
        const candidateService = new PromotionGateService({ repository: candidateRepository });
        const service = new SnsFeedbackLearningService({ ledgerRepository, candidateService });

        const result = await service.createLearningCandidateForPost(post.id, ACCESS);

        expect(result.created).toBe(true);
        expect(result.candidate.source_system).toBe('sns-feedback');
        expect(result.candidate.promotion_status).toBe('candidate');
        expect(result.post.learning_candidate_id).toBe(result.candidate.id);
        expect(candidateRepository.list({ cognitive_type: 'observation' })).toHaveLength(1);
    });

    it('requires explicit Personal KG identity before candidate handoff', () => {
        const { post } = makeReadyPost();

        expect(() => buildSnsFeedbackCandidateDraft(post))
            .toThrow('personal_kg_access_context_required');
        expect(() => buildSnsFeedbackCandidateDraft(post, {
            owner_person_id: 'sato_keigo',
            actor_person_id: 'sato_keigo'
        })).toThrow('personal_kg_organization_id_required');
    });

    it('rejects handoff before posted URL and metrics are available', () => {
        const ledgerRepository = new InMemorySnsPostingLedgerRepository();
        ledgerRepository.upsertReviewPack({
            account_id: 'acc_x_sato',
            drafts: [{
                date: '2026-05-14',
                slot_index: 1,
                lane: 'trust_balance',
                body: 'まだ投稿していない'
            }]
        });
        const post = ledgerRepository.listPosts({})[0];

        expect(() => buildSnsFeedbackCandidateDraft(post, ACCESS))
            .toThrow('learning_ready');
    });
});
