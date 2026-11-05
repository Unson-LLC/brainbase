import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { draftReleaseNote, checkReleaseNotes } from '../scripts/lib/release-notes.mjs';

test('CLI accepts stdin and files, writes JSON only and rejects missing notes', async () => {
 const root = await mkdtemp(join(tmpdir(), 'uns435-cli-'));
 try {
  const body = '## リリースノート\n検索を改善\n';
  const file = join(root, 'body.md');
  await writeFile(file, body);
  const script = new URL('../scripts/draft-release-note.mjs', import.meta.url).pathname;
  for (const args of [[], [file]]) {
   const result = spawnSync(process.execPath, [script, '0.41.8', ...args], {input: body, encoding:'utf8'});
   assert.equal(result.status, 0, result.stderr);
   assert.match(JSON.parse(result.stdout).versionHistory, /検索を改善/);
  }
  const invalid = spawnSync(process.execPath, [script, '0.41.8'], {input:'no notes', encoding:'utf8'});
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
 } finally { await rm(root, {recursive:true,force:true}); }
});

test('extracts only release section, preserves subheadings and stops at next section', () => {
 const d = draftReleaseNote('secret outside\n## リリースノート\n### 変更概要\n検索を改善\n## 検証\nprivate', '0.41.8');
 assert.equal(d.versionHistory, '## Unreleased — develop\n\n### 変更概要\n検索を改善\n');
 assert.equal(d.releasePath, 'docs/releases/0.41.8.md');
 assert.match(d.release, /candidate/);
 assert.doesNotMatch(JSON.stringify(d), /secret|private/);
});
test('missing section, empty template and invalid versions fail', () => {
 for (const text of ['body', '## リリースノート\n<!-- guide -->']) assert.throws(() => draftReleaseNote(text, '1.2.3'));
 assert.throws(() => draftReleaseNote('## リリースノート\nnote', '../x'));
 const d = draftReleaseNote('```md\n## リリースノート\nexample\n```\n## リリースノート\nreal', '1.2.3');
 assert.doesNotMatch(d.release, /example/);
});
test('detects both directions of version drift and duplicate history', async () => {
 const root = await mkdtemp(join(tmpdir(), 'uns435-'));
 try {
  await mkdir(join(root, 'docs/manual/reference'), {recursive:true});
  await mkdir(join(root, 'docs/releases'), {recursive:true});
  const history = join(root, 'docs/manual/reference/version-history.md');
  await writeFile(history, '## 0.41.4 candidate\n\na\n## 0.41.5 candidate\n\nb\n## 0.41.7 candidate\n\nc\n');
  await assert.rejects(checkReleaseNotes(root), /0\.41\.4, 0\.41\.5, 0\.41\.7/);
  for (const version of ['0.41.4','0.41.5','0.41.7']) await writeFile(join(root, `docs/releases/${version}.md`), 'note');
  await checkReleaseNotes(root);
  await writeFile(join(root,'docs/releases/9.9.9.md'), 'extra');
  await assert.rejects(checkReleaseNotes(root), /absent from version-history \[9.9.9\]/);
  await writeFile(history, '## 0.41.7\na\n## 0.41.7\nb\n');
  await assert.rejects(checkReleaseNotes(root), /duplicate/);
 } finally { await rm(root, {recursive:true,force:true}); }
});

test('ignores fake release headings until a matching closing fence', () => {
 for (const fence of ['````', '~~~~']) {
  for (const fakeClose of [fence.slice(1), fence + 'md']) {
   const body = [fence + 'md', fakeClose, '## リリースノート', 'example', fence, '## リリースノート', 'real'].join('\n');
   const draft = draftReleaseNote(body, '1.2.3');
   assert.match(draft.release, /real/);
   assert.doesNotMatch(draft.release, /example/);
  }
 }
});
