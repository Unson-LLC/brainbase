import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { draftReleaseNotes } from '../scripts/draft-release-notes.mjs';

it('extracts only release notes through next peer or parent heading', () => {
  for (const end of ['## テスト', '# 終了']) {
    const draft = draftReleaseNotes(139, `secret\n## リリースノート\n変更概要：改善\n### 補足\n詳細\n${end}\nexcluded`);
    expect(draft).toMatch(/変更概要：改善\n### 補足\n詳細/);
    expect(draft).not.toMatch(/secret|excluded/);
  }
});
it('missing or empty section needs review without body fallback', () => {
  for (const body of ['secret', '## リリースノート\n\n## テスト\nsecret', readFileSync('.github/PULL_REQUEST_TEMPLATE.md', 'utf8')]) {
    expect(draftReleaseNotes(1, body)).toMatch(/要確認/);
    expect(draftReleaseNotes(1, body)).not.toMatch(/secret/);
  }
});
it('fenced headings do not start or end a section', () => {
  expect(draftReleaseNotes(1, '```md\n## リリースノート\nexample\n```')).toMatch(/要確認/);
  expect(draftReleaseNotes(1, '## リリースノート\n```md\n## example\n```\nafter')).toMatch(/after/);
});
it('same PR produces stable marker', () => {
  expect(draftReleaseNotes(139, 'a').split('\n')[0]).toBe(draftReleaseNotes(139, 'b').split('\n')[0]);
});
it('CLI supports args, Markdown stdin, JSON stdin, help and invalid PR', () => {
  const run = (args, input) => spawnSync(process.execPath, ['scripts/draft-release-notes.mjs', ...args], { input, encoding: 'utf8' });
  const body = '## リリースノート\n変更概要：改善';
  for (const [args, input] of [[['--pr', '2', '--body', body]], [['--pr', '2'], body], [[], JSON.stringify({ pr: 2, body })]]) {
    const result = run(args, input);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(draftReleaseNotes(2, body));
  }
  expect(run(['--help']).stdout).toMatch(/Usage:/);
  expect(run(['--pr', 'bad', '--body', body]).status).toBe(1);
});
