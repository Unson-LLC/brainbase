import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('loads a new lazy minutes screen after the unqualified old kit is already cached', () => {
  const dir = mkdtempSync(join(tmpdir(), 'minutes-module-cache-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    writeFileSync(join(dir, 'workspace-kit.js'), 'export const oldKit = true;');
    writeFileSync(join(dir, 'fresh-kit.txt'), readFileSync(new URL('../../ui/workspace-kit.js', import.meta.url)));
    writeFileSync(join(dir, 'meeting-minutes.js'), readFileSync(new URL('../../ui/meeting-minutes.js', import.meta.url)));
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { readFileSync, writeFileSync } from 'node:fs';
      import assert from 'node:assert/strict';
      const old = await import('./workspace-kit.js');
      assert.equal(old.oldKit, true);
      writeFileSync('workspace-kit.js', readFileSync('fresh-kit.txt'));
      const minutes = await import('./meeting-minutes.js');
      assert.equal(typeof minutes.createMeetingMinutesUI, 'function');
      assert.equal((await import('./workspace-kit.js')).oldKit, true);
      const fresh = await import('./workspace-kit.js?capability=search-band-v1');
      assert.equal(typeof fresh.workspaceSearchBand, 'function');
      assert.equal(typeof fresh.workspaceCombobox, 'function');
      writeFileSync('baseline-kit.js', readFileSync('fresh-kit.txt'));
      const baseline = await import('./baseline-kit.js');
      const element = () => ({ className: '', attributes: {}, children: [],
        classList: { add() {} }, setAttribute(k, v) { this.attributes[k] = String(v); },
        append(...nodes) { this.children.push(...nodes); }, addEventListener() {} });
      const doc = { createElement: element, body: element() };
      const originalDrawer = baseline.workspaceDetailDrawer(doc, { title: 'Host detail' });
      const freshDrawer = fresh.workspaceDetailDrawer(doc, { title: 'Meeting detail' });
      const originalId = originalDrawer.dialog.attributes['aria-labelledby'];
      const freshId = freshDrawer.dialog.attributes['aria-labelledby'];
      assert.notEqual(freshId, originalId);
      assert.equal(freshDrawer.dialog.children[0].children[0].attributes.id, freshId);
    `], { cwd: dir, encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
