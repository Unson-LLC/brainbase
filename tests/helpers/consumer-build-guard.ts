import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Ensures `dist/` is built before packing a consumer tarball.
 *
 * CI and `npm run release:validate` already execute `npm run build` right before
 * invoking Vitest and pass `BRAINBASE_TEST_SKIP_BUILD=1`. Re-running `npm run build`
 * inside multiple parallel Vitest workers both wastes ~16s per test and overwrites
 * the shared `dist/` directory concurrently. When invoked locally without that flag,
 * or if `dist/index.js` is absent, this still runs `npm run build`.
 */
export function ensureBuiltPackage(
  root: string,
  execute: (command: string, args: string[], cwd?: string) => string
): void {
  if (process.env.BRAINBASE_TEST_SKIP_BUILD === '1' && existsSync(path.join(root, 'dist/index.js'))) {
    return;
  }
  execute('npm', ['run', 'build'], root);
}
