// @ts-check
import { describe, it, expect } from 'vitest';

import { makeService, baseDraft } from '../../candidate-store/_helpers.js';
import { PersonalKnowledgeGraphReader } from '../../../server/services/sns/personal-knowledge-graph-reader.js';
import {
    PersonalKgSnsWeeklyPlanner,
    DEFAULT_WEEKLY_CONTENT_MIX,
    classifyPeerSignalBand,
    evaluatePersonaAffect,
    evaluateXAlgorithmFit
} from '../../../server/services/sns/personal-kg-sns-weekly-planner.js';

const viewer = {
    sub: 'sato_keigo',
    owner_person_id: 'sato_keigo',
    actor_person_id: 'sato_keigo',
    organization_id: 'unson',
    role: 'ceo',
    workspace: 'unson',
    org_ids: ['unson'],
    project_ids: ['brainbase']
};

function sourceEntity(id, body, category, overrides = {}) {
    return {
        id,
        source_candidate_id: id.replace('candidate:', ''),
        cognitive_type: 'insight',
        body,
        category,
        derived_from: [`seed:${id}`],
        evidence_ids: [{ raw_event_id: `raw:${id}`, uri: `brainbase:test:${id}`, hash: `sha256:${id}` }],
        source_system: 'brainbase',
        created_at: '2026-07-28T00:00:00.000Z',
        ...overrides
    };
}

describe('PersonalKgSnsWeeklyPlanner', () => {
    it('moves only real first-person lifelog sources into a manual review pack', async () => {
        const sources = [
            sourceEntity('candidate:today', '今日は生成方針を全部見直した。助言を書こうとすると、自分の記録から離れる感じがした。', 'daily_log'),
            sourceEntity('candidate:work', '昨日はテストが一度止まった。原因をメモしてから直したら、次の確認が楽になった。', 'work_log'),
            sourceEntity('candidate:policy', '投稿は週21本を目標にする。', 'content_design'),
            sourceEntity('candidate:general', 'AI導入では責任境界が重要である。', 'work_log')
        ];
        const planner = new PersonalKgSnsWeeklyPlanner({
            graphReader: { listRecentEntities: async () => sources }
        });

        const pack = await planner.buildWeeklyDraftPack(viewer, {
            startDate: '2026-07-28',
            peerSignals: [{ id: 'peer-1' }],
            newsSignals: [{ id: 'news-1' }]
        });

        expect(pack.days).toHaveLength(7);
        expect(pack.drafts).toHaveLength(2);
        expect(pack.summary.content_mix).toEqual(DEFAULT_WEEKLY_CONTENT_MIX);
        expect(pack.summary.external_prompts_ignored_for_drafts).toBe(2);
        expect(pack.drafts.map((draft) => draft.body)).toEqual([
            sources[0].body,
            sources[1].body
        ]);
        for (const draft of pack.drafts) {
            expect(draft.publish_intent).toBe('manual_review_only');
            expect(draft.format).toBe('first_person_lifelog');
            expect(draft.signal).toBeNull();
            expect(draft.lifelog_check).toMatchObject({
                decision: 'pass',
                first_person_evidence: true
            });
            expect(draft.algorithm_fit).toMatchObject({
                decision: 'reviewable',
                candidate_source: 'personal_kg_lifelog',
                predicted_positive_actions: [],
                graph_edge_goal: null,
                optimization_policy: 'none'
            });
        }
    });

    it('returns zero posts when no first-person lifelog source exists', async () => {
        const planner = new PersonalKgSnsWeeklyPlanner({
            graphReader: {
                listRecentEntities: async () => [
                    sourceEntity('candidate:policy', '人は毎日記録を残すべきだ。', 'operating_principle')
                ]
            }
        });

        const pack = await planner.buildWeeklyDraftPack(viewer, { startDate: '2026-07-28' });

        expect(pack.drafts).toEqual([]);
        expect(pack.summary.no_source_reason).toBe('no_first_person_lifelog_source');
        expect(pack.days.every((day) => day.drafts.length === 0)).toBe(true);
    });

    it('does not turn external signals into drafts', async () => {
        const planner = new PersonalKgSnsWeeklyPlanner({
            graphReader: { listRecentEntities: async () => [] }
        });

        const pack = await planner.buildWeeklyDraftPack(viewer, {
            startDate: '2026-07-28',
            peerSignals: [{ id: 'peer-1', text: '役立つ話' }],
            newsSignals: [{ id: 'news-1', title: '今日のニュース' }]
        });

        expect(pack.drafts).toHaveLength(0);
        expect(pack.summary.external_prompts_ignored_for_drafts).toBe(2);
    });

    it('blocks advice while accepting a first-person record', () => {
        const advice = evaluatePersonaAffect({ body: '私はこうした。あなたも毎日記録すべきだ。' });
        expect(advice.decision).toBe('blocked');
        expect(advice.negative_feeling_risks).toContain('advice_or_instruction');

        const record = evaluatePersonaAffect({ body: '今日は書くことがなくて、投稿しないと決めた。' });
        expect(record.decision).toBe('pass');
        expect(record.check_type).toBe('lifelog_integrity');

        const compatibility = evaluateXAlgorithmFit({ body: '今日は書くことがなくて、投稿しないと決めた。', personaAffect: record });
        expect(compatibility.optimization_policy).toBe('none');
    });

    it('reads lifelog category through PersonalKnowledgeGraphReader', async () => {
        const { service } = makeService();
        await service.createCandidate(baseDraft({
            cognitive_type: 'insight',
            body: '今日は公開ライフログの方針を決めた。自分の経験だけを残すことにした。',
            source_event_ids: ['seed:reader:lifelog'],
            permission_snapshot: {
                seed: { category: 'work_log' }
            }
        }));
        await service.createCandidate(baseDraft({
            cognitive_type: 'claim',
            body: '読者には結論を先に示す。',
            source_event_ids: ['seed:reader:policy'],
            permission_snapshot: {
                seed: { category: 'content_design' }
            }
        }));

        const reader = new PersonalKnowledgeGraphReader({ candidateService: service });
        const planner = new PersonalKgSnsWeeklyPlanner({ graphReader: reader });
        const pack = await planner.buildWeeklyDraftPack(viewer, { startDate: '2026-07-28' });

        expect(pack.drafts).toHaveLength(1);
        expect(pack.drafts[0].lane).toBe('work_log');
        expect(pack.drafts[0].body).toContain('自分の経験だけ');
    });

    it('keeps the legacy peer band helper stable without using it for generation', () => {
        expect(classifyPeerSignalBand({ author_followers: 2000 })).toBe('primary');
        expect(classifyPeerSignalBand({ author_followers: 35000 })).toBe('secondary');
        expect(classifyPeerSignalBand({ author_followers: 50001 })).toBe('out_of_band');
    });
});
