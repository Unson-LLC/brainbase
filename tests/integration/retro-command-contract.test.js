import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('retro command contract', () => {
    it('Codex Automation内で完結し、廃止済みの制御面へ書き込まない', () => {
        const command = fs.readFileSync(path.join(repoRoot, '.claude/commands/retro.md'), 'utf8');

        expect(command).toContain('Codex Automationのタスク本文');
        expect(command).toContain('automation memory');
        expect(command).toContain('Brainbaseの旧session archive、archive finalizer、worktree状態をBlockの入力にしない');

        expect(command).not.toContain('http://localhost:31013/api/wiki/page');
        expect(command).not.toContain('_common/retros/');
        expect(command).not.toContain('scripts/archive-blocked-report.mjs');
        expect(command).not.toMatch(/scripts\/bin\/bb-report-submit\.mjs/);
        expect(command).not.toMatch(/node cli\/index\.js learn (apply|reject)/);
    });

    it('Learn候補を現行SSOT分類へルーティングする', () => {
        const command = fs.readFileSync(path.join(repoRoot, '.claude/commands/retro.md'), 'utf8');

        for (const destination of ['graph', 'owning_repo', 'team_drive', 'workspace_home', 'reject', 'hold']) {
            expect(command).toContain(`\`${destination}\``);
        }
    });
});
