// @ts-check
import { describe, expect, it } from 'vitest';

import { PromotionGateService } from '../../../server/services/candidate-store/promotion-gate-service.js';
import { InMemoryCandidateRepository } from '../../../server/services/candidate-store/candidate-repository.js';
import { InMemorySnsPostingLedgerRepository } from '../../../server/services/sns/posting-ledger-repository.js';
import {
    buildSnsFeedbackCandidateDraft,
    SnsFeedbackLearningService
} from '../../../server/services/sns/feedback-learning-service.js';

const ACCESS = Object.freeze({
    owner_person_id: 'sato_keigo',
    actor_person_id: 'sato_keigo',
    organization_id: 'unson',
    org_ids: ['unson'],
    role: 'ceo',
    projectCodes: ['brainbase']
});

const OTHER_PERSON_ACCESS = Object.freeze({
    owner_person_id: 'other_person',
    actor_person_id: 'other_person',
    organization_id: 'unson',
    org_ids: ['unson'],
    role: 'member',
    projectCodes: ['brainbase']
});

const OTHER_ORGANIZATION_ACCESS = Object.freeze({
    owner_person_id: 'sato_keigo',
    actor_person_id: 'sato_keigo',
    organization_id: 'other_org',
    org_ids: ['other_org'],
    role: 'member',
    projectCodes: ['brainbase']
});

function seedReadyPost(ledgerRepository, authority, overrides = {}) {
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
    }, authority);
    const post = ledgerRepository.listPosts({}, authority)[0];
    ledgerRepository.updatePost(post.id, {
        status: 'approved'
    }, authority);
    ledgerRepository.updatePost(post.id, {
        status: 'scheduled'
    }, authority);
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
    }, authority);
    const ready = ledgerRepository.updatePost(post.id, {
        status: 'learning_ready',
        ...overrides
    }, authority);
    return ready;
}

function makeReadyPost(overrides = {}) {
    const ledgerRepository = new InMemorySnsPostingLedgerRepository({ authority: ACCESS });
    const post = seedReadyPost(ledgerRepository, ACCESS, overrides);
    return { ledgerRepository, post };
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
        const ledgerRepository = new InMemorySnsPostingLedgerRepository({ authority: ACCESS });
        ledgerRepository.upsertReviewPack({
            account_id: 'acc_x_sato',
            drafts: [{
                date: '2026-05-14',
                slot_index: 1,
                lane: 'trust_balance',
                body: 'まだ投稿していない'
            }]
        }, ACCESS);
        const post = ledgerRepository.listPosts({}, ACCESS)[0];

        expect(() => buildSnsFeedbackCandidateDraft(post, ACCESS))
            .toThrow('learning_ready');
    });

    it('does not expose another person or organization SNS post to learning', async () => {
        const ledgerRepository = new InMemorySnsPostingLedgerRepository({ authority: ACCESS });
        const ownPost = seedReadyPost(ledgerRepository, ACCESS);
        const otherPersonPost = seedReadyPost(ledgerRepository, {
            ...OTHER_PERSON_ACCESS,
            account_id: 'acc_x_other_person'
        });
        const otherOrganizationPost = seedReadyPost(ledgerRepository, {
            ...OTHER_ORGANIZATION_ACCESS,
            account_id: 'acc_x_other_org'
        });
        const candidateRepository = new InMemoryCandidateRepository();
        const candidateService = new PromotionGateService({ repository: candidateRepository });
        const service = new SnsFeedbackLearningService({ ledgerRepository, candidateService });

        const visible = await service.createLearningCandidatesForDate('2026-05-14', ACCESS);

        expect(visible.map((result) => result.post.id)).toEqual([ownPost.id]);
        expect(visible.map((result) => result.post.id)).not.toContain(otherPersonPost.id);
        expect(visible.map((result) => result.post.id)).not.toContain(otherOrganizationPost.id);
        await expect(service.createLearningCandidateForPost(otherPersonPost.id, ACCESS))
            .rejects.toThrow('SNS post not found');
        await expect(service.createLearningCandidateForPost(otherOrganizationPost.id, ACCESS))
            .rejects.toThrow('SNS post not found');
    });
});
