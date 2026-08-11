import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveSnsRoot, resolveWikiRoots, resolveWorkspaceRoot } from '../../scripts/workspace-paths.js';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');

function read(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('Distribution Model contract', () => {
    it('workspace SNS and Wiki defaults stay outside the retired shared tree', () => {
        const env = { BRAINBASE_WORKSPACE_ROOT: '/tmp/workspace' };
        expect(resolveWorkspaceRoot(env)).toBe('/tmp/workspace');
        expect(resolveSnsRoot(env)).toBe('/tmp/workspace/sns');
        expect(resolveWikiRoots(env)).toEqual(['/tmp/workspace/wiki']);
    });

    it('explicit SNS and Wiki overrides remain available for isolated tests and installations', () => {
        const env = {
            BRAINBASE_WORKSPACE_ROOT: '/tmp/workspace',
            BRAINBASE_SNS_ROOT: '/tmp/private-sns',
            LOCAL_SSOT_WIKI_ROOTS: '/tmp/wiki-a, /tmp/wiki-b'
        };
        expect(resolveSnsRoot(env)).toBe('/tmp/private-sns');
        expect(resolveWikiRoots(env)).toEqual(['/tmp/wiki-a', '/tmp/wiki-b']);
    });

    it('active SNS generators, Skills, and stories do not reference the retired shared tree', () => {
        const activeFiles = [
            'scripts/build-sns-generation-context.js',
            'scripts/generate-sns-ohayo-brief.js',
            'scripts/import-sns-review-pack-to-ledger.js',
            'scripts/local-data-server-ssot-inventory.js',
            '.claude/skills/brainbase-content-ssot/SKILL.md',
            '.claude/skills/brainbase-marketing-10x-ops/SKILL.md',
            '.claude/skills/branch-worktree-rules/SKILL.md',
            '.claude/skills/marketing-ops/SKILL.md',
            '.claude/skills/marketing-ops/agents/analytics_specialist.md',
            '.claude/skills/marketing-ops/agents/campaign_manager.md',
            '.claude/skills/marketing-ops/agents/content_creator.md',
            '.claude/skills/ops-daily/agents/infrastructure_manager.md',
            '.claude/skills/ops-daily/agents/knowledge_analyst.md',
            '.claude/skills/ops-daily/agents/repo_sync.md',
            '.claude/skills/sns-account-factory/SKILL.md',
            '.claude/skills/sns-workflow/SKILL.md',
            '.claude/skills/x-article-buzz-strategy/SKILL.md',
            'docs/stories/sns-learning-informed-generation-story.md'
        ];
        for (const relativePath of activeFiles) {
            expect(read(relativePath), relativePath).not.toMatch(/shared\/_codex|_codex\/sns/);
        }
    });

    it('CLAUDE.md and AGENTS.md are identical and include the Distribution Model', () => {
        const claude = read('CLAUDE.md');
        expect(read('AGENTS.md')).toBe(claude);
        expect(claude).toContain('## 0.5. Distribution Model');
        expect(claude).toContain('ファイル共有（shared/・submodule方式）は廃止済み');
    });
});
