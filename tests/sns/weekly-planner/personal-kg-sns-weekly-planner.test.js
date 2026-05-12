// @ts-check
import { describe, it, expect } from 'vitest';

import { makeService, baseDraft } from '../../candidate-store/_helpers.js';
import { PersonalKnowledgeGraphReader } from '../../../server/services/sns/personal-knowledge-graph-reader.js';
import {
    PersonalKgSnsWeeklyPlanner,
    DEFAULT_WEEKLY_CONTENT_MIX,
    classifyPeerSignalBand
} from '../../../server/services/sns/personal-kg-sns-weekly-planner.js';

const viewer = {
    sub: 'sato_keigo',
    role: 'ceo',
    workspace: 'unson',
    org_ids: ['unson', 'salestailor', 'techknight', 'zeims', 'ncom-catalyst'],
    project_ids: ['brainbase', 'salestailor', 'techknight', 'zeims', 'ncom-catalyst', 'unson-board'],
    interests: ['Claude Code', 'AI PM', 'AI駆動経営', 'ナレッジグラフ'],
    persona: 'AI導入を任された事業責任者 / PM / 経営者'
};

function sourceEntity(id, body, overrides = {}) {
    return {
        id,
        source_candidate_id: id.replace('candidate:', ''),
        cognitive_type: 'claim',
        body,
        derived_from: [`seed:${id}`],
        source_event_ids: [`seed:${id}`],
        evidence_ids: [{ raw_event_id: `raw:${id}`, uri: `brainbase:test:${id}`, hash: `sha256:${id}` }],
        agency_level: 'synthesize',
        sensitivity: 'internal',
        owner_person_id: 'sato_keigo',
        visibility: 'owner',
        org_ids: ['unson'],
        project_ids: ['brainbase'],
        created_at: '2026-05-12T00:00:00.000Z',
        reuse_count: 0,
        ...overrides
    };
}

const kgSources = [
    sourceEntity('candidate:claude-code', 'Claude Code法人導入はTipsではなく、CLAUDE.md、Skills、権限、レビュー、検収の運用設計が本体。'),
    sourceEntity('candidate:ai-pm', 'AI PMはタスク管理ではない。責任分界、意思決定ログ、レビュー境界、学習の戻し先を設計する仕事。'),
    sourceEntity('candidate:kg', 'ナレッジグラフの価値は、人間が情報を見に行くことではなく、AIが必要な文脈をgraph traversalで持ってくること。'),
    sourceEntity('candidate:own-proof', 'Own Proof: knowledge-graph-kernel M1-M4でACL、Candidate Store、SNS posting engineまで通した。'),
    sourceEntity('candidate:vibepro', 'Own Proof: VibeProはStory、Architecture、Spec、Graphify、Gate、PR evidenceを通して変更を進める。'),
    sourceEntity('candidate:persona', 'Persona Brainで考える。相手が今何を見て、何を誤解し、何を怖がり、何なら自然に動けるかを先に立ち上げる。'),
    sourceEntity('candidate:org-unit', 'AIはツールではなく組織ユニットとして扱う。役割、権限、記憶、承認、証跡を持って継続稼働する単位。'),
    sourceEntity('candidate:incident', 'develop直pushのsilent drop事故から、注意喚起ではなくdeterministic guardで再発防止した。'),
    sourceEntity('candidate:trust-score', 'SalesTailorでは、人間営業が生む信頼を会社の資産として扱い、信頼スコアにする。')
];

const peerSignals = [
    {
        id: 'too-small',
        kind: 'peer_post',
        author_handle: '@small_ai_pm',
        author_followers: 900,
        text: 'AI PM導入のメモ',
        url: 'https://x.com/small/status/1',
        topic: 'AI PM'
    },
    {
        id: 'primary-peer',
        kind: 'peer_post',
        author_handle: '@near_peer_ai_pm',
        author_followers: 8200,
        text: 'AI PMは運用設計が大事という話',
        url: 'https://x.com/near/status/1',
        topic: 'AI PM'
    },
    {
        id: 'too-large',
        kind: 'peer_post',
        author_handle: '@mega_ai',
        author_followers: 220000,
        text: 'AIトレンド',
        url: 'https://x.com/mega/status/1',
        topic: 'AI'
    }
];

const newsSignals = [
    {
        id: 'claude-code-news',
        kind: 'news',
        title: 'Claude Codeのチーム導入事例が話題',
        url: 'https://example.com/claude-code-team',
        topic: 'Claude Code'
    },
    {
        id: 'ai-management-news',
        kind: 'news',
        title: '海外でAI management workflowの事例が伸びている',
        url: 'https://example.com/ai-management',
        topic: 'AI駆動経営'
    }
];

describe('PersonalKgSnsWeeklyPlanner', () => {
    it('builds a 7-day review pack with the canonical weekly content mix', async () => {
        const planner = new PersonalKgSnsWeeklyPlanner({
            graphReader: { listRecentEntities: async () => kgSources }
        });

        const pack = await planner.buildWeeklyDraftPack(viewer, {
            startDate: '2026-05-18',
            peerSignals,
            newsSignals
        });

        expect(pack.week_start).toBe('2026-05-18');
        expect(pack.days).toHaveLength(7);
        expect(pack.drafts).toHaveLength(21);
        expect(pack.summary.by_lane).toEqual({
            trust_balance: 5,
            peer_circle: 6,
            own_proof: 4,
            philosophy: 3,
            learn_in_public: 2,
            soft_cta: 1
        });
        expect(pack.summary.content_mix).toEqual(DEFAULT_WEEKLY_CONTENT_MIX);
        expect(pack.summary.news_signal_slots).toBeLessThanOrEqual(7);

        for (const draft of pack.drafts) {
            expect(draft.status).toBe('draft_review');
            expect(draft.publish_intent).toBe('manual_review_only');
            expect(draft.kg_source_entity_id).toMatch(/^candidate:/);
            expect(draft.derived_from).toContain(draft.kg_source_entity_id);
            expect(draft.evidence_ids.length).toBeGreaterThan(0);
            expect(draft.persona_brain.target_person).toBe(viewer.persona);
            expect(Object.values(draft.persona_brain).every((value) => typeof value === 'string' && value.length > 0)).toBe(true);
            expect(draft.safety.requires_human_review).toBe(true);
            expect(draft.body.length).toBeLessThanOrEqual(280);
            expect(draft.body).not.toMatch(/APIで投稿|AIで投稿を書いて|自動投稿/);
        }
    });

    it('uses near-peer quote repost slots before too-small or mega accounts', async () => {
        const planner = new PersonalKgSnsWeeklyPlanner({
            graphReader: { listRecentEntities: async () => kgSources }
        });

        const pack = await planner.buildWeeklyDraftPack(viewer, {
            startDate: '2026-05-18',
            peerSignals
        });

        const peerDrafts = pack.drafts.filter((draft) => draft.lane === 'peer_circle');
        expect(peerDrafts).toHaveLength(6);
        expect(peerDrafts.every((draft) => draft.format === 'quote_repost_commentary')).toBe(true);
        expect(peerDrafts.every((draft) => draft.signal?.author_handle === '@near_peer_ai_pm')).toBe(true);
        expect(peerDrafts.every((draft) => draft.body.includes('相手の読者に向けて言い換えると'))).toBe(true);
    });

    it('can use the PersonalKnowledgeGraphReader as the weekly planner source', async () => {
        const { service } = makeService();
        await service.createCandidate(baseDraft({
            cognitive_type: 'claim',
            body: 'Claude Code法人導入はツール導入ではなく、権限、レビュー、検収の運用設計が本体。',
            source_event_ids: ['seed:reader:claude-code']
        }));
        await service.createCandidate(baseDraft({
            cognitive_type: 'insight',
            body: 'Own Proof: VibeProでStory、Spec、Graphify、Gateを通して実装を進めた。',
            source_event_ids: ['seed:reader:vibepro']
        }));

        const reader = new PersonalKnowledgeGraphReader({ candidateService: service });
        const planner = new PersonalKgSnsWeeklyPlanner({ graphReader: reader });
        const pack = await planner.buildWeeklyDraftPack(viewer, { startDate: '2026-05-18' });

        expect(pack.drafts).toHaveLength(21);
        expect(pack.drafts.some((draft) => draft.body.includes('Claude Code'))).toBe(true);
        expect(pack.drafts.some((draft) => draft.body.includes('VibePro'))).toBe(true);
    });

    it('classifies peer signals by the agreed amplifier target band', () => {
        expect(classifyPeerSignalBand({ author_followers: 1500 })).toBe('out_of_band');
        expect(classifyPeerSignalBand({ author_followers: 2000 })).toBe('primary');
        expect(classifyPeerSignalBand({ author_followers: 20000 })).toBe('primary');
        expect(classifyPeerSignalBand({ author_followers: 35000 })).toBe('secondary');
        expect(classifyPeerSignalBand({ author_followers: 50001 })).toBe('out_of_band');
    });

    it('shapes KG memory into publishable copy instead of copying the memory fragment', async () => {
        const planner = new PersonalKgSnsWeeklyPlanner({
            graphReader: { listRecentEntities: async () => kgSources }
        });

        const pack = await planner.buildWeeklyDraftPack(viewer, { startDate: '2026-05-18' });
        const trustDraft = pack.drafts.find((draft) => draft.lane === 'trust_balance' && draft.body.includes('AI PM'));
        expect(trustDraft).toBeTruthy();
        expect(trustDraft.body).toContain('\n');
        expect(trustDraft.body).toContain('たぶん本体はそこじゃない');
        expect(trustDraft.body).toContain('境界設計');
        expect(trustDraft.body).not.toMatch(/^Claude Code \/ AI PM \/ AI経営で大事なのは、/);
        expect(trustDraft.body).not.toContain('Own Proof:');
    });

    it('does not reuse the same KG source twice on the same day', async () => {
        const planner = new PersonalKgSnsWeeklyPlanner({
            graphReader: { listRecentEntities: async () => kgSources }
        });

        const pack = await planner.buildWeeklyDraftPack(viewer, { startDate: '2026-05-18' });
        for (const day of pack.days) {
            const ids = day.drafts.map((draft) => draft.kg_source_entity_id);
            expect(new Set(ids).size).toBe(ids.length);
        }
    });

    it('keeps lane-specific source selection clean for philosophy and soft CTA slots', async () => {
        const planner = new PersonalKgSnsWeeklyPlanner({
            graphReader: { listRecentEntities: async () => kgSources }
        });

        const pack = await planner.buildWeeklyDraftPack(viewer, { startDate: '2026-05-18' });
        const philosophyDrafts = pack.drafts.filter((draft) => draft.lane === 'philosophy');
        expect(philosophyDrafts).toHaveLength(3);
        expect(philosophyDrafts.every((draft) => !draft.body.includes('Own Proof:'))).toBe(true);
        expect(philosophyDrafts.some((draft) => draft.body.includes('AIはツールではなく'))).toBe(true);

        const softCta = pack.drafts.find((draft) => draft.lane === 'soft_cta');
        expect(softCta.body).toContain('最初の1業務');
        expect(softCta.body).not.toMatch(/投稿設計|今日の3投稿|1週間単位/);
    });

    it('keeps public copy free from internal labels, needless English, and sentence periods', async () => {
        const planner = new PersonalKgSnsWeeklyPlanner({
            graphReader: { listRecentEntities: async () => kgSources }
        });

        const pack = await planner.buildWeeklyDraftPack(viewer, {
            startDate: '2026-05-18',
            peerSignals,
            newsSignals
        });

        for (const draft of pack.drafts) {
            expect(draft.body).not.toMatch(/Peer Circle|Own Proof|Learn in Public|Soft CTA|Graph traversal|graph traversal|entity|Candidate Store|SNS posting engine|PR evidence|Tips|Skills|knowledge-graph-kernel|ACL|M1-M4|Persona Brain|Story|Architecture|Spec|Graphify|Gate/);
            expect(draft.body).not.toMatch(/候補|同じ界隈の少し上の人の投稿を探す|見つけたら/);
            expect(draft.body).not.toContain('。');
        }
    });

    it('does not invent a quote repost body before the peer post exists', async () => {
        const planner = new PersonalKgSnsWeeklyPlanner({
            graphReader: { listRecentEntities: async () => kgSources }
        });

        const pack = await planner.buildWeeklyDraftPack(viewer, { startDate: '2026-05-18' });
        const peerDrafts = pack.drafts.filter((draft) => draft.lane === 'peer_circle');
        expect(peerDrafts).toHaveLength(6);
        expect(peerDrafts.every((draft) => draft.format === 'peer_research_prompt')).toBe(true);
        expect(peerDrafts.every((draft) => draft.body === '')).toBe(true);
    });
});
