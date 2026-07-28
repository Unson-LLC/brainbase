// @ts-check
import { describe, it, expect } from 'vitest';
import { makeCurator, sourceInsight, viewer } from '../_helpers.js';

describe('sns-curator INV-7: lifelog integrity is required before review', () => {
    it('INV-7: generateDrafts keeps source fidelity and a passing lifelog check', async () => {
        const source = sourceInsight();
        const { curator } = makeCurator({ entities: [source] });

        const drafts = await curator.generateDrafts(viewer(), { limit: 1 });

        expect(drafts).toHaveLength(1);
        expect(drafts[0].body).toBe(source.body);
        expect(drafts[0].lifelog_check).toMatchObject({
            decision: 'pass',
            source_id: source.id,
            source_category: 'work_log',
            first_person_evidence: true,
            risks: []
        });
        expect(drafts[0].persona_brain).toBeUndefined();
    });

    it('INV-7: save rejects a draft without a passing lifelog check', async () => {
        const { curator, candidateService } = makeCurator();
        const uncheckedDraft = {
            source_entity_id: 'ent_without_check',
            cognitive_type: 'observation',
            body: '今日は記録した。',
            score: 1,
            breakdown: {},
            derived_from: ['ent_without_check']
        };

        await expect(curator.saveDraftsToCandidateStore([uncheckedDraft], viewer()))
            .rejects
            .toThrow('lifelog_check pass required');
        expect(candidateService.listCandidates({}, null)).toHaveLength(0);
    });

    it('INV-7: policy statements and advice are not generated as drafts', async () => {
        const { curator } = makeCurator({
            entities: [
                sourceInsight('policy', { category: 'content_design', body: '投稿は毎日作る。' }),
                sourceInsight('advice', { body: '今日は考えた。あなたも記録すべきだ。' })
            ]
        });

        const drafts = await curator.generateDrafts(viewer(), { limit: 5 });
        expect(drafts).toEqual([]);
    });
});
