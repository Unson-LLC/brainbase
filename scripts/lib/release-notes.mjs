import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export function versionSections(text) {
  return [...text.matchAll(/^## (\d+\.\d+\.\d+(?:-[\w.-]+)?)([^\n]*)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)]
    .map((m) => ({ version: m[1], heading: m[1] + m[2], body: m[3].trim() }));
}

export async function checkReleaseNotes(root) {
  const sections = versionSections(await readFile(join(root, 'docs/manual/reference/version-history.md'), 'utf8'));
  const versions = sections.map((s) => s.version);
  if (!versions.length || new Set(versions).size !== versions.length) throw new Error('Missing or duplicate version-history versions');
  const files = (await readdir(join(root, 'docs/releases'))).filter((f) => /^\d+\.\d+\.\d+(?:-[\w.-]+)?\.md$/.test(f)).map((f) => f.slice(0, -3));
  const missing = versions.filter((v) => !files.includes(v));
  const extra = files.filter((v) => !versions.includes(v));
  if (missing.length || extra.length) throw new Error(`Release history drift: missing release notes [${missing.join(', ')}]; absent from version-history [${extra.join(', ')}]`);
}

export function draftReleaseNote(text, version) {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Provide a semantic version');
  // Ignore headings inside fenced examples in PR bodies and merge messages.
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let fence = null, active = false;
  const notes = [];
  for (const line of lines) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*(`{3,}|~{3,})\s*$/.test(line)) fence = null; continue; }
    if (fence) continue;
    if (/^## リリースノート\s*$/.test(line)) { active = true; continue; }
    if (active && /^#{1,2} /.test(line)) break;
    if (active) notes.push(line);
  }
  const body = notes.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!body) throw new Error('Missing release-note content');
  return { versionHistory: `## Unreleased — develop\n\n${body}\n`, releasePath: `docs/releases/${version}.md`, release: `# ${version} candidate — npm公開前\n\n下書き。公開・配備の完了を意味しません。\n\n${body}\n` };
}
