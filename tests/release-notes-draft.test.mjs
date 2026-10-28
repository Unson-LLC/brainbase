import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { draftReleaseNotes } from '../scripts/draft-release-notes.mjs';

test('extracts only release notes through next peer or parent heading', () => {
  for (const end of ['## テスト', '# 終了']) {
    const draft = draftReleaseNotes(139, `secret\n## リリースノート\n変更概要：改善\n### 補足\n詳細\n${end}\nexcluded`);
    assert.match(draft, /変更概要：改善\n### 補足\n詳細/);
    assert.doesNotMatch(draft, /secret|excluded/);
  }
});
test('missing or empty section needs review without body fallback', () => {
  for (const body of ['secret', '## リリースノート\n\n## テスト\nsecret', readFileSync('.github/PULL_REQUEST_TEMPLATE.md', 'utf8')]) {
    assert.match(draftReleaseNotes(1, body), /要確認/);
    assert.doesNotMatch(draftReleaseNotes(1, body), /secret/);
  }
});
test('fenced headings do not start or end a section', () => {
  assert.match(draftReleaseNotes(1, '```md\n## リリースノート\nexample\n```'), /要確認/);
  assert.match(draftReleaseNotes(1, '## リリースノート\n```md\n## example\n```\nafter'), /after/);
});
test('same PR produces stable marker', () => {
  assert.equal(draftReleaseNotes(139, 'a').split('\n')[0], draftReleaseNotes(139, 'b').split('\n')[0]);
});
test('CLI supports args, Markdown stdin, JSON stdin, help and invalid PR', () => {
  const run = (args, input) => spawnSync(process.execPath, ['scripts/draft-release-notes.mjs', ...args], { input, encoding: 'utf8' });
  const body = '## リリースノート\n変更概要：改善';
  for (const [args, input] of [[['--pr', '2', '--body', body]], [['--pr', '2'], body], [[], JSON.stringify({ pr: 2, body })]]) {
    const result = run(args, input);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, draftReleaseNotes(2, body));
  }
  assert.match(run(['--help']).stdout, /Usage:/);
  assert.equal(run(['--pr', 'bad', '--body', body]).status, 1);
});
