#!/usr/bin/env node
/**
 * activity-bridge フックの事前バンドル。
 *
 * なぜ: フックは PostToolUse の 3 秒 timeout 内で実行される。従来は run-hook.sh が
 * `tsx`（毎回 esbuild でその場 TypeScript コンパイル, cold start 約 400〜900ms,
 * CPU 飽和時はさらに増大）で .ts を実行しており、並列サブエージェント等で飽和すると
 * 3 秒を超えて Claude Code に kill され heartbeat が失われていた（インジケータ消失の一因）。
 *
 * 対策: 3 つのフック entrypoint を esbuild で self-contained な .mjs にバンドルし、
 * run-hook.sh は .mjs があれば `node`（約 65ms, コンパイル無し）で実行する。
 * .mjs は git にコミットしてセッション worktree へ配布する。
 *
 * 使い方:
 *   node .claude/scripts/build-activity-bridge-hooks.mjs        # .mjs を書き出す
 *   import { buildActivityBridgeHooks } from ...                # テストで write:false 比較
 *
 * 注意: フックの .ts を編集したら必ず再ビルドしてコミットすること。
 * `tests/unit/activity-bridge-hook-bundles.test.js` が committed .mjs と
 * 再ビルド結果の byte 一致を検証する（古いバンドルの混入を防ぐ）。
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

// entrypoint(.ts) -> bundle(.mjs)。run-hook.sh は `${hook%.ts}.mjs` を参照する。
export const HOOK_ENTRYPOINTS = [
  'hooks/post-tool-use/activity-bridge.ts',
  'hooks/user-prompt-submit/activity-bridge.ts',
  'hooks/stop/activity-bridge.ts',
];

// 決定的な出力にするため build と test で同一 config を共有する。
function buildOptionsFor(entryRel) {
  return {
    entryPoints: [path.join(scriptsDir, entryRel)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'bundle',
    legalComments: 'none',
    sourcemap: false,
    minify: false,
    write: false,
    absWorkingDir: scriptsDir,
  };
}

/**
 * @param {{ write?: boolean }} [opts]
 * @returns {Promise<Array<{ entry: string, outPath: string, code: string }>>}
 */
export async function buildActivityBridgeHooks(opts = {}) {
  const results = [];
  for (const entryRel of HOOK_ENTRYPOINTS) {
    const result = await esbuild.build(buildOptionsFor(entryRel));
    const code = result.outputFiles[0].text;
    const outPath = path.join(scriptsDir, entryRel.replace(/\.ts$/, '.mjs'));
    if (opts.write) {
      const fs = await import('node:fs');
      fs.writeFileSync(outPath, code);
    }
    results.push({ entry: entryRel, outPath, code });
  }
  return results;
}

const isMain = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '');
if (isMain) {
  buildActivityBridgeHooks({ write: true })
    .then((r) => {
      for (const { outPath } of r) console.log(`built ${path.relative(scriptsDir, outPath)}`);
    })
    .catch((err) => {
      console.error('build failed:', err);
      process.exit(1);
    });
}
