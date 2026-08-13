import { describe, expect, it, vi } from 'vitest';

import { LearningService } from '../../../server/services/learning-service.js';

const WRITABLE_PILLARS = ['document', 'skill'];
const MEMORY_TIERS = ['wiki', 'graph', 'episode', 'personal_kg', 'ledger'];

function promotionCandidate(pillar) {
    return {
        id: `prm_${pillar}`,
        pillar,
        target_ref: pillar === 'skill' ? '.claude/skills/example/SKILL.md' : 'docs/example.md',
        status: 'evaluated',
        canonical_summary: '再利用する手続きを記録する',
        semantic_scope: `${pillar}:brainbase`,
        merged_episode_count: 1,
        source_episode_ids: ['lep_1'],
        linked_wiki_candidate_id: null,
        linked_candidate_ids: [],
        proposed_content: '# example',
        evaluation_summary: {},
        risk_level: 'low',
        doc_type: pillar === 'skill' ? 'procedure' : 'architecture',
        target_project_id: 'brainbase',
        apply_mode: 'manual',
        apply_error: null,
        materialized_ref: null
    };
}

describe('promotion_candidates persistence boundary', () => {
    it.each(WRITABLE_PILLARS)('新規保存ではpillar=%sだけを受け付ける', async (pillar) => {
        const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) };
        const service = new LearningService({ pool });

        await service._insertCandidate(promotionCandidate(pillar));

        expect(pool.query).toHaveBeenCalledTimes(1);
        expect(pool.query.mock.calls[0][0]).toContain('INSERT INTO promotion_candidates');
        expect(pool.query.mock.calls[0][1][1]).toBe(pillar);
    });

    it.each(MEMORY_TIERS)('新規保存ではmemory tierのpillar=%sを拒否する', async (pillar) => {
        const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) };
        const service = new LearningService({ pool });

        await expect(service._insertCandidate(promotionCandidate(pillar)))
            .rejects.toThrow(/pillar/i);
        expect(pool.query).not.toHaveBeenCalled();
    });
});

describe('promotion_candidates legacy read compatibility', () => {
    it('旧DB行pillar=wikiを公開読取りではdocumentへ正規化する', async () => {
        const legacyRow = {
            ...promotionCandidate('wiki'),
            id: 'prm_legacy_wiki',
            created_at: '2026-08-01T00:00:00.000Z',
            updated_at: '2026-08-01T00:00:00.000Z'
        };
        const pool = {
            query: vi.fn(async (sql) => {
                if (sql.includes('FROM promotion_candidates')) {
                    return { rows: [legacyRow], rowCount: 1 };
                }
                return { rows: [], rowCount: 0 };
            })
        };
        const service = new LearningService({ pool });

        const candidate = await service.getPromotion('prm_legacy_wiki');

        expect(candidate).toMatchObject({
            id: 'prm_legacy_wiki',
            pillar: 'document'
        });
        expect(candidate.target_ref).toBe('docs/example.md');
    });
});
