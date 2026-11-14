#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

// Ignore fenced examples when identifying Markdown section boundaries.
export function headings(markdown) {
  const result = [];
  let fence;
  let offset = 0;
  for (const line of markdown.split('\n')) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (delimiter && delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && /^ {0,3}(?:`+|~+)\s*$/.test(line)) fence = undefined;
    } else if (delimiter) {
      fence = delimiter[1];
    } else {
      const match = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (match) result.push({ level: match[1].length, title: match[2], start: offset, end: offset + line.length });
    }
    offset += line.length + 1;
  }
  return result;
}

export function draftReleaseNotes(pr, body) {
  if (!/^[1-9]\d*$/.test(String(pr))) throw new Error('PR number must be a positive integer');
  if (typeof body !== 'string') throw new Error('PR body must be Markdown text');
  const sections = headings(body);
  const index = sections.findIndex(h => h.level === 2 && h.title === 'リリースノート');
  const section = sections[index];
  const next = sections.slice(index + 1).find(h => h.level <= 2);
  let content = section ? body.slice(section.end, next?.start).trim() : '';
  // Comments and unfilled template labels are not release notes.
  const meaningful = content.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*(?:#{1,6}\s+|[-*]\s*)?(?:変更概要|互換性|利用者操作)\s*[:：]?\s*$/gm, '').trim();
  if (meaningful) content = content.replace(/^(\s*(?:変更概要|互換性|利用者操作)\s*[:：])\s*$/gm, '$1 要確認');
  if (!meaningful) content = '要確認（リリースノート見出し欠落または空欄）';
  return `<!-- release-notes:brainbase#${pr} -->\n### PR #${pr}\n\n${content}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/draft-release-notes.mjs --pr N [--body MARKDOWN]\nWithout --body, reads Markdown from stdin. With no arguments, stdin accepts JSON {"pr":N,"body":"Markdown"}. Outputs a draft only; human review required.');
    return;
  }
  let pr, body;
  for (let i = 0; i < args.length; i += 2) {
    if (!['--pr', '--body'].includes(args[i]) || args[i + 1] === undefined) throw new Error('Expected --pr N [--body MARKDOWN]; see --help');
    if (args[i] === '--pr') pr = args[i + 1];
    else body = args[i + 1];
  }
  if (body === undefined) {
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    if (!args.length) ({ pr, body } = JSON.parse(input));
    else body = input;
  }
  process.stdout.write(draftReleaseNotes(pr, body));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
