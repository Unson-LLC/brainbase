import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore - build script is plain .mjs
import { buildActivityBridgeHooks } from '../../.claude/scripts/build-activity-bridge-hooks.mjs';

/**
 * Story acceptance coverage for story-activity-bridge-hook-precompile.
 *
 * activity-bridge フックを tsx(毎回コンパイル)から事前バンドル .mjs(node)へ切替え、
 * CSRF をディスクキャッシュして PostToolUse の 3 秒 timeout 内に確実に収める変更を、
 * 実際の run-hook.sh / バンドル / ライブサーバ POST / 再ビルド比較で検証する。
 *
 * 純 node コンテキスト（child_process + fs + fetch、esbuild 再ビルド）。Playwright runner は
 * ハーネスとしてのみ使用し、ブラウザは使わない。
 */

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const HOOK = '.claude/scripts/hooks/post-tool-use/activity-bridge.ts';
const HOOK_MJS = '.claude/scripts/hooks/post-tool-use/activity-bridge.mjs';
const SID = 'session-hook-precompile-e2e';
const BASE = process.env.BRAINBASE_BASE_URL || 'http://localhost:31013';

function runHook(scriptRelTs: string) {
    return spawnSync('bash', ['.claude/scripts/run-hook.sh', scriptRelTs, '{"tool":"Read","parameters":{"file_path":"/tmp/x"}}'], {
        cwd: repoRoot,
        env: { ...process.env, BRAINBASE_SESSION_ID: SID, BRAINBASE_PORT: '31013' },
        encoding: 'utf-8',
        timeout: 10000
    });
}

test.describe('story-activity-bridge-hook-precompile e2e contract', () => {
    test('story-activity-bridge-hook-precompile ac:1 `run-hook.sh` は `.mjs` バンドルがあれば `node` で実行し、無ければ tsx に fallback する', () => {
        const script = fs.readFileSync(path.join(repoRoot, '.claude/scripts/run-hook.sh'), 'utf-8');
        expect(script, 'run-hook.sh が .mjs を node で exec する分岐を持つ(無ければ tsx に fallback)').toMatch(/exec node "\$HOOK_BUNDLE"/);
        expect(script, 'tsx fallback 経路が残っている').toMatch(/exec.*tsx/);
        // 実際に run-hook.sh を起動すると .mjs(node)経路で report_activity を POST する
        const res = runHook(HOOK);
        expect(res.status, 'run-hook.sh が .mjs を node で実行し正常終了する').toBe(0);
    });

    test('story-activity-bridge-hook-precompile ac:2 3 つのフック .mjs が .ts ソースと byte 一致する(古いバンドル混入をテストで防ぐ)', async () => {
        const built = await buildActivityBridgeHooks({ write: false });
        expect(built.length, '3 つのフック .mjs を再ビルドする').toBe(3);
        for (const b of built as Array<{ outPath: string; code: string; entry: string }>) {
            const committed = fs.readFileSync(b.outPath, 'utf-8');
            expect(committed, `${b.entry}: committed .mjs が .ts 再ビルドと byte 一致する`).toBe(b.code);
        }
    });

    test('story-activity-bridge-hook-precompile ac:3 CSRF token はディスクにキャッシュされ、TTL 内はサーバへ再取得しない', () => {
        const cacheFile = path.join(repoRoot, '.claude/hooks/data/activity-bridge/csrf-cache.json');
        try { fs.rmSync(cacheFile, { force: true }); } catch { /* noop */ }
        runHook(HOOK); // cold: fetch + write disk cache
        expect(fs.existsSync(cacheFile), 'CSRF token がディスク csrf-cache.json にキャッシュされる').toBe(true);
        const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        const ports = Object.keys(cache);
        expect(ports.length, 'CSRF キャッシュに port エントリがある(TTL 内は再取得しない)').toBeGreaterThan(0);
        expect(typeof cache[ports[0]].token, 'キャッシュされた CSRF token が文字列である').toBe('string');
    });

    test('story-activity-bridge-hook-precompile ac:4 POST が 403(再起動で token 失効)なら token を破棄して fresh fetch + リトライする', () => {
        const src = fs.readFileSync(path.join(repoRoot, '.claude/scripts/core/monitoring/brainbase-activity-bridge.ts'), 'utf-8');
        expect(src, 'postActivity が 403 で token を破棄して fresh fetch + リトライする契約を持つ').toMatch(/status === 403[\s\S]*invalidateCsrfToken[\s\S]*forceRefresh|true\)[\s\S]*postReportActivity/);
        // 出荷バンドルにも 403 リトライ契約が含まれる
        const bundle = fs.readFileSync(path.join(repoRoot, HOOK_MJS), 'utf-8');
        expect(bundle, 'バンドル .mjs にも 403 fresh fetch リトライ契約が含まれる').toContain('invalidateCsrfToken');
    });

    test('story-activity-bridge-hook-precompile ac:5 バンドル .mjs は `node` 単体で実行でき report_activity を POST できる(未解決 import なし)', async () => {
        const bundle = fs.readFileSync(path.join(repoRoot, HOOK_MJS), 'utf-8');
        expect(bundle, 'バンドル .mjs に未解決の相対 import が残っていない(node 単体で実行可能)').not.toMatch(/from\s+["']\.\.\//);
        // node で直接実行 → ライブサーバに report_activity を POST して working になる
        const res = spawnSync('node', [HOOK_MJS, '{"tool":"Read","parameters":{"file_path":"/tmp/x"}}'], {
            cwd: repoRoot,
            env: { ...process.env, BRAINBASE_SESSION_ID: SID, BRAINBASE_PORT: '31013' },
            encoding: 'utf-8',
            timeout: 10000
        });
        expect(res.status, 'バンドル .mjs が node 単体で実行でき report_activity を POST する').toBe(0);
        const r = await fetch(`${BASE}/api/sessions/status`);
        const map = await r.json() as Record<string, { isWorking?: boolean; lastEventType?: string }>;
        expect(map[SID]?.isWorking, 'バンドル経由の POST でセッションが working になる').toBe(true);
    });
});
