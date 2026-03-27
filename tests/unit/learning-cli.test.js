import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    collectBulletLines,
    deriveReviewOutcome,
    materializePromotions,
    normalizeVerifyFirstArtifact,
    renderPromotionManifest
} from '../../cli/learning.js';

describe('learning CLI helpers', () => {
    let tempDir;

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('renders a promotion manifest with frontmatter and content block', () => {
        const output = renderPromotionManifest({
            id: 'prm_1',
            pillar: 'wiki',
            target_ref: 'brainbase/learning/test',
            status: 'evaluated',
            risk_level: 'medium',
            doc_type: 'architecture',
            target_project_id: 'brainbase',
            apply_mode: 'manual',
            apply_error: '',
            materialized_ref: '',
            source_episode_ids: ['lep_1'],
            linked_wiki_candidate_id: null,
            linked_candidate_ids: [],
            evaluation_summary: { wiki_first_passed: true },
            proposed_content: '# Test'
        });

        expect(output).toContain('candidate_id: prm_1');
        expect(output).toContain('doc_type: architecture');
        expect(output).toContain('```md');
    });

    it('materializes manifest and skill file into the repository tree', () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-learning-'));
        const result = materializePromotions([
            {
                id: 'prm_1',
                pillar: 'skill',
                target_ref: '.claude/skills/test-skill/SKILL.md',
                status: 'evaluated',
                risk_level: 'high',
                doc_type: 'procedure',
                target_project_id: 'brainbase',
                apply_mode: 'manual',
                apply_error: '',
                materialized_ref: '',
                source_episode_ids: ['lep_1'],
                linked_wiki_candidate_id: 'prm_w1',
                linked_candidate_ids: ['prm_w1'],
                evaluation_summary: { wiki_first_passed: true },
                proposed_content: '# test-skill'
            }
        ], tempDir);

        expect(result.some(file => file.endsWith('docs/learning-promotions/prm_1.md'))).toBe(true);
        expect(fs.existsSync(path.join(tempDir, '.claude/skills/test-skill/SKILL.md'))).toBe(true);
    });

    it('extracts bullet steps from markdown', () => {
        expect(collectBulletLines('- first\n- second\nplain')).toEqual(['first', 'second']);
    });

    it('normalizes a verify-first bug directory into a review episode payload', () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-verify-first-'));
        fs.writeFileSync(path.join(tempDir, 'review_report.json'), JSON.stringify({
            review_result: {
                phase3: { status: 'critical', issues: ['バグタイプ特定不足'] }
            },
            replan_details: [
                { issue: 'バグタイプ特定不足', feedback: '候補を追加して再検証する' }
            ]
        }), 'utf-8');
        fs.writeFileSync(path.join(tempDir, 'phase5_root_cause.md'), '# Root Cause\n再接続条件を固定していなかった。', 'utf-8');
        fs.writeFileSync(path.join(tempDir, 'phase6_fix.md'), '- xterm を再fitする\n- resize は戻る時だけ走らせる', 'utf-8');

        const payload = normalizeVerifyFirstArtifact(tempDir, { projectId: 'brainbase' });

        expect(payload.source_type).toBe('review');
        expect(payload.outcome).toBe('failure');
        expect(payload.promotion_hint).toBe('both');
        expect(payload.evidence.proposed_rule).toContain('再接続条件');
        expect(payload.evidence.proposed_steps).toContain('xterm を再fitする');
        expect(payload.ingestion.adapter_name).toBe('verify-first');
    });

    it('derives review outcome from review statuses', () => {
        expect(deriveReviewOutcome({
            review_result: { phase1: { status: 'critical' } }
        })).toBe('failure');
        expect(deriveReviewOutcome({
            review_result: { phase1: { status: 'minor' } }
        })).toBe('partial');
        expect(deriveReviewOutcome({
            review_result: { phase1: { status: 'approved' } }
        })).toBe('success');
    });
});
