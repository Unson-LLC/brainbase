// @vitest-environment node
// esbuild は jsdom/happy-dom 環境では動かない（TextEncoder invariant）。node 環境で実行する。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
    HOOK_ENTRYPOINTS,
    buildActivityBridgeHooks
} from '../../.claude/scripts/build-activity-bridge-hooks.mjs';

/**
 * activity-bridge フックの事前バンドル(.mjs)が .ts ソースと同期しているか検証する。
 *
 * run-hook.sh は .mjs があれば tsx ではなく node で実行する（3秒 timeout 内に収めるため）。
 * .ts を編集して .mjs を再ビルドし忘れると、古い挙動のバンドルが本番フックとして走り、
 * heartbeat の挙動がソースと乖離する。これを防ぐため、現在の esbuild config で再ビルドした
 * 結果が committed .mjs と byte 一致することを保証する。
 *
 * 失敗したら `npm run build:hooks` を実行して .mjs を再生成・コミットすること。
 */
describe('activity-bridge hook bundles', () => {
    it('committed .mjs が .ts ソースと一致する (古いバンドル混入防止)', async () => {
        const built = await buildActivityBridgeHooks({ write: false });
        expect(built.length).toBe(HOOK_ENTRYPOINTS.length);
        for (const { entry, outPath, code } of built) {
            expect(fs.existsSync(outPath), `${entry}: committed .mjs が存在しない → npm run build:hooks`).toBe(true);
            const committed = fs.readFileSync(outPath, 'utf-8');
            expect(
                committed,
                `${entry}: committed .mjs が .ts と不一致 → npm run build:hooks で再生成してコミット`
            ).toBe(code);
        }
    });

    it('各 .mjs が node で実行可能な ESM である (構文健全性)', async () => {
        const built = await buildActivityBridgeHooks({ write: false });
        for (const { entry, code } of built) {
            // バンドルは self-contained で外部 import を残さない（node 単体で動く前提）
            expect(code.length, `${entry}: バンドルが空`).toBeGreaterThan(0);
            expect(code, `${entry}: 未解決の bare import が残っている`).not.toMatch(/from\s+["']\.\.\//);
        }
    });
});
