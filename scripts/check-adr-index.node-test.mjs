import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkAdrIndex } from './check-adr-index.mjs';

const policy = { directory: 'docs/architecture', legacy: {}, baseline: [], baselineMax: 0 };
function fixture(files, rows) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-index-test-'));
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), '# Fixture decision\n');
  }
  fs.mkdirSync(path.join(root, policy.directory), { recursive: true });
  fs.writeFileSync(path.join(root, policy.directory, 'README.md'),
    `<!-- adr-index:start -->\n| 管理番号 | 文書 | 旧名・旧配置 |\n|---|---|---|\n${rows.join('\n')}\n<!-- adr-index:end -->\n`);
  return root;
}
const row = (id, file) => `| ADR-${id} | [Fixture](${file}) | — |`;

test('accepts a correctly numbered decision and ignores archived copies/templates', () => {
  const root = fixture(['docs/architecture/ADR-001-test.md',
    'docs/management/audit-artifacts/example/ADR-001-copy.md',
    'docs/playbooks/example/ADR-template.md', 'docs/architecture/adr-authoring.md'],
  [row('001', 'ADR-001-test.md')]);
  assert.deepEqual(checkAdrIndex(root, policy), []);
});
test('detects a decision omitted from the index, including lowercase legacy-style names', () => {
  const root = fixture(['docs/architecture/adr-unlisted.md'], []);
  assert.match(checkAdrIndex(root, policy).join('\n'), /missing from index/);
});
test('detects duplicate logical numbers even when filenames differ', () => {
  const root = fixture(['docs/architecture/ADR-001-one.md', 'docs/architecture/ADR-001-two.md'],
    [row('001', 'ADR-001-one.md'), row('001', 'ADR-001-two.md')]);
  assert.match(checkAdrIndex(root, policy).join('\n'), /Duplicate ADR number/);
});
test('detects duplicate links and broken targets', () => {
  const root = fixture(['docs/architecture/ADR-001-one.md'],
    [row('001', 'ADR-001-one.md'), row('002', 'ADR-001-one.md'), row('003', 'ADR-003-missing.md')]);
  const errors = checkAdrIndex(root, policy).join('\n');
  assert.match(errors, /Duplicate ADR file/);
  assert.match(errors, /Missing or non-ADR target/);
});
test('rejects new files outside the selected directory', () => {
  const root = fixture(['docs/adr/ADR-001-one.md'], [row('001', '../adr/ADR-001-one.md')]);
  assert.match(checkAdrIndex(root, policy).join('\n'), /Wrong ADR directory/);
});
test('rejects unnumbered new files and filename/index number mismatch', () => {
  const root = fixture(['docs/architecture/ADR-story-one.md', 'docs/architecture/ADR-003-three.md'],
    [row('001', 'ADR-story-one.md'), row('002', 'ADR-003-three.md')]);
  assert.equal(checkAdrIndex(root, policy).filter(e => e.includes('filename/number mismatch')).length, 2);
});
test('accepts only the exact frozen legacy path and logical number', () => {
  const root = fixture(['docs/adr/adr-old.md'], [row('025', '../adr/adr-old.md')]);
  const legacy = { 'docs/adr/adr-old.md': 25 };
  assert.deepEqual(checkAdrIndex(root, { ...policy, legacy }), []);
  assert.match(checkAdrIndex(root, { ...policy, legacy: { 'docs/adr/adr-old.md': 26 } }).join('\n'), /Frozen legacy number changed/);
});
test('detects disappearance of a legacy decision', () => {
  const root = fixture([], []);
  assert.match(checkAdrIndex(root, { ...policy, legacy: { 'docs/adr/adr-old.md': 25 } }).join('\n'), /Frozen legacy ADR missing/);
});
test('rejects external links and traversal out of docs', () => {
  for (const target of ['https://example.com/a.md', '../../outside.md', '/tmp/ADR-001-one.md']) {
    const root = fixture([], [row('001', target)]);
    assert.match(checkAdrIndex(root, policy).join('\n'), /Invalid ADR link/);
  }
});
test('rejects malformed and repeated index blocks', () => {
  const root = fixture([], ['| ADR-001 | not a link | — |']);
  assert.match(checkAdrIndex(root, policy).join('\n'), /Malformed ADR index row/);
  fs.appendFileSync(path.join(root, policy.directory, 'README.md'), '<!-- adr-index:start --><!-- adr-index:end -->');
  assert.match(checkAdrIndex(root, policy).join('\n'), /exactly one/);
});
test('does not reuse reserved historical gaps', () => {
  const root = fixture(['docs/architecture/ADR-003-three.md'], [row('003', 'ADR-003-three.md')]);
  assert.match(checkAdrIndex(root, { ...policy, baselineMax: 35 }).join('\n'), /Reserved historical number/);
});
