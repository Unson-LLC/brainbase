import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { materializePromotions, renderPromotionManifest } from '../../cli/learning.js';

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
});
