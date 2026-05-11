// @ts-check
import { describe, it, expect } from 'vitest';
import { makeCurator, sourceInsight, viewer } from '../_helpers.js';

describe('sns-curator INV-7: persona brain is required before draft review', () => {
    it('INV-7: generateDrafts returns drafts with a complete persona_brain', async () => {
        const { curator } = makeCurator({ entities: [sourceInsight()] });

        const drafts = await curator.generateDrafts(viewer(), { limit: 1 });

        expect(drafts).toHaveLength(1);
        expect(drafts[0].persona_brain).toEqual(expect.objectContaining({
            target_person: expect.any(String),
            current_situation: expect.any(String),
            existing_belief: expect.any(String),
            misunderstanding: expect.any(String),
            fear: expect.any(String),
            blocker: expect.any(String),
            resonant_detail: expect.any(String),
            avoid_phrasing: expect.any(String),
            natural_next_action: expect.any(String),
            success_signal: expect.any(String)
        }));
    });

    it('INV-7: saveDraftsToCandidateStore rejects missing persona_brain before mutation', async () => {
        const { curator, candidateService } = makeCurator();
        const draftWithoutPersona = {
            source_entity_id: 'ent_without_persona',
            cognitive_type: 'claim',
            body: 'AI導入は業務フローから考える',
            score: 80,
            breakdown: {},
            derived_from: ['ent_without_persona']
        };

        await expect(curator.saveDraftsToCandidateStore([draftWithoutPersona], viewer()))
            .rejects
            .toThrow('persona_brain required');

        expect(candidateService.listCandidates({}, null)).toHaveLength(0);
    });

    it('INV-7: saved candidate keeps persona_brain in permission snapshot for review', async () => {
        const personaBrain = {
            target_person: 'AI導入を任されたDX責任者',
            current_situation: '社内でAIツールは試したが本番業務に乗っていない',
            existing_belief: '研修とツール配布でAI活用が進む',
            misunderstanding: 'AI活用の問題はスキル不足だけだと思っている',
            fear: '事故が起きた時に責任を取れない',
            blocker: 'どの業務から本番化すべきか分からない',
            resonant_detail: '禁止事項、承認ライン、監査ログ',
            avoid_phrasing: 'AIで全部自動化できます',
            natural_next_action: 'プロフィールと固定ポストを見る',
            success_signal: 'profile_visit'
        };
        const { curator, candidateService } = makeCurator({
            entities: [sourceInsight('ent_persona')],
            personaBrainProvider: () => personaBrain
        });

        const drafts = await curator.generateDrafts(viewer(), { limit: 1 });
        await curator.saveDraftsToCandidateStore(drafts, viewer());

        const [candidate] = candidateService.listCandidates({}, null);
        expect(candidate.permission_snapshot.sns.persona_brain).toEqual(personaBrain);
    });
});
