import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Story acceptance coverage for story-session-hook-provisioning-backfill.
 *
 * SessionStart hook (session-start-copy-plugins.sh) が、brainbase 以外のプロジェクト
 * worktree(settings.json が git-tracked で存在しない)に対して hook 登録ファイル
 * (settings.json / run-hook.sh / activity-bridge .mjs) を L2 から補完することを検証する。
 * これが無いと activity-bridge フックが発火せず稼働インジケータが永久に無印になる。
 *
 * 純 node コンテキスト(child_process で実 hook を一時 worktree で実行)。ブラウザ未使用。
 */

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const HOOK = path.join(repoRoot, '.claude/hooks/session-start-copy-plugins.sh');

function runHookIn(dir: string) {
    return spawnSync('bash', [HOOK], { cwd: dir, encoding: 'utf-8', timeout: 60000 });
}

function mkTempWorktree(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookprov-'));
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    return dir;
}

test.describe('story-session-hook-provisioning-backfill e2e contract', () => {
    test('story-session-hook-provisioning-backfill ac:1 settings.json が無い worktree では SessionStart hook が settings.json と run-hook.sh を L2 から補完する', () => {
        const dir = mkTempWorktree();
        try {
            expect(fs.existsSync(path.join(dir, '.claude/settings.json')), '初期状態は settings.json が無い').toBe(false);
            const res = runHookIn(dir);
            expect(res.status, 'SessionStart hook が正常終了する').toBe(0);
            expect(fs.existsSync(path.join(dir, '.claude/settings.json')), 'settings.json が L2 から補完される').toBe(true);
            expect(fs.existsSync(path.join(dir, '.claude/scripts/run-hook.sh')), 'run-hook.sh が補完される').toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('story-session-hook-provisioning-backfill ac:2 補完された settings.json は activity-bridge PostToolUse フックを登録している', () => {
        const dir = mkTempWorktree();
        try {
            runHookIn(dir);
            const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf-8'));
            const ptCmds = (settings.hooks?.PostToolUse ?? []).flatMap((e: any) => (e.hooks ?? []).map((h: any) => h.command || ''));
            const hasBridge = ptCmds.some((c: string) => /activity-bridge/.test(c));
            expect(hasBridge, '補完された settings.json が activity-bridge PostToolUse を登録している').toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('story-session-hook-provisioning-backfill ac:3 settings.json が既存(brainbase worktree)なら上書きしない(dirty 退行防止)', () => {
        const dir = mkTempWorktree();
        try {
            const sentinel = '{"_sentinel":"do-not-clobber"}';
            fs.writeFileSync(path.join(dir, '.claude/settings.json'), sentinel);
            const res = runHookIn(dir);
            expect(res.status, 'hook が正常終了する').toBe(0);
            const after = fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf-8');
            expect(after, '既存 settings.json は上書きされない(brainbase worktree の dirty 退行を防ぐ)').toBe(sentinel);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('story-session-hook-provisioning-backfill ac:4 activity-bridge .mjs バンドルも補完され run-hook.sh が node 高速経路を使える', () => {
        const dir = mkTempWorktree();
        try {
            runHookIn(dir);
            const mjs = path.join(dir, '.claude/scripts/hooks/post-tool-use/activity-bridge.mjs');
            expect(fs.existsSync(mjs), 'activity-bridge .mjs バンドルが補完される(run-hook.sh の node 高速経路)').toBe(true);
            const runHook = fs.readFileSync(path.join(dir, '.claude/scripts/run-hook.sh'), 'utf-8');
            expect(runHook, '補完された run-hook.sh は .mjs を node で実行する分岐を持つ').toMatch(/exec node "\$HOOK_BUNDLE"/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
