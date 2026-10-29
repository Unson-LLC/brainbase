import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

// An open tab may keep a kit cached from before workspaceLoadingStage existed.
it.each([
  ['judgment-history.js', 'createJudgmentHistoryUI'],
  ['foundation-overview.js', 'renderFoundationOverview'],
])('loads %s after the unqualified old kit is already cached', (file, entry) => {
  const dir = mkdtempSync(join(tmpdir(), 'loading-stage-module-cache-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    writeFileSync(join(dir, 'workspace-kit.js'), 'export const oldKit = true;');
    writeFileSync(join(dir, 'fresh-kit.txt'), readFileSync(new URL('../../ui/workspace-kit.js', import.meta.url)));
    writeFileSync(join(dir, file), readFileSync(new URL(`../../ui/${file}`, import.meta.url)));
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { readFileSync, writeFileSync } from 'node:fs';
      import assert from 'node:assert/strict';
      const old = await import('./workspace-kit.js');
      assert.equal(old.oldKit, true);
      writeFileSync('workspace-kit.js', readFileSync('fresh-kit.txt'));
      const screen = await import('./${file}');
      assert.equal(typeof screen.${entry}, 'function');
      assert.equal((await import('./workspace-kit.js')).oldKit, true);
      const fresh = await import('./workspace-kit.js?capability=loading-stage-v1');
      assert.equal(typeof fresh.workspaceLoadingStage, 'function');
    `], { cwd: dir, encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
