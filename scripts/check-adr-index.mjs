#!/usr/bin/env node
// Placement and numbering policy: brainbase-project/docs/architecture/adr-authoring.md.
// Only the frozen legacy mapping is repo-specific. Do not add new exceptions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const config = {
  "directory": "docs/architecture",
  "legacy": {
    "docs/architecture/ADR-story-brainbase-local-ssot-atomic-commit.md": 1,
    "docs/architecture/ADR-story-brainbase-oss-npm-release.md": 2
  },
  "baselineMax": 2,
  "baseline": [
    "docs/architecture/ADR-story-brainbase-local-ssot-atomic-commit.md",
    "docs/architecture/ADR-story-brainbase-oss-npm-release.md"
  ]
};

function adrFiles(root) {
  const files = [];
  function walk(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      // Audit copies and distributed templates are not this repository's decisions.
      if (['audit-artifacts', 'playbooks'].includes(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /^adr[-_].*\.md$/i.test(entry.name)
        && entry.name !== 'adr-authoring.md') {
        files.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  }
  walk(path.join(root, 'docs'));
  return files.sort();
}

export function checkAdrIndex(root, policy = config) {
  const errors = [];
  const index = path.join(root, policy.directory, 'README.md');
  if (!fs.existsSync(index)) return ['ADR index README is missing'];
  const markdown = fs.readFileSync(index, 'utf8');
  const blocks = [...markdown.matchAll(/<!-- adr-index:start -->([\s\S]*?)<!-- adr-index:end -->/g)];
  if (blocks.length !== 1) return ['Expected exactly one adr-index block'];
  const files = adrFiles(root);
  const discovered = new Set(files);
  const seenIds = new Set();
  const seenFiles = new Set();
  for (const line of blocks[0][1].split('\n')) {
    if (!line.trim() || /^\| 管理番号 /.test(line) || /^\|(?:\s*:?-+:?\s*\|)+$/.test(line)) continue;
    const row = /^\| ADR-(\d{3,}) \| \[([^\]]+)\]\(([^)]+)\) \| ([^|]+) \|$/.exec(line);
    if (!row) { errors.push(`Malformed ADR index row: ${line}`); continue; }
    const number = Number(row[1]);
    if (!Number.isSafeInteger(number) || number < 1) errors.push(`Invalid ADR number: ${row[1]}`);
    if (seenIds.has(number)) errors.push(`Duplicate ADR number: ${row[1]}`);
    seenIds.add(number);
    // Local links only; normalized paths must stay under docs/.
    const target = path.posix.normalize(path.posix.join(policy.directory, row[3]));
    if (!target.startsWith('docs/') || /[\\:#?%]/.test(row[3]) || path.posix.isAbsolute(row[3])) {
      errors.push(`Invalid ADR link: ${row[3]}`); continue;
    }
    if (seenFiles.has(target)) errors.push(`Duplicate ADR file: ${target}`);
    seenFiles.add(target);
    if (!discovered.has(target)) errors.push(`Missing or non-ADR target: ${target}`);
    if (!policy.baseline.includes(target) && number <= policy.baselineMax) {
      errors.push(`Reserved historical number: ${row[1]}`);
    }
    const legacyNumber = policy.legacy[target];
    if (legacyNumber !== undefined) {
      if (number !== legacyNumber) errors.push(`Frozen legacy number changed: ${target}`);
    } else {
      if (path.posix.dirname(target) !== policy.directory) errors.push(`Wrong ADR directory: ${target}`);
      const name = /^ADR-(\d{3,})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.exec(path.posix.basename(target));
      if (!name || Number(name[1]) !== number) errors.push(`ADR filename/number mismatch: ${target}`);
    }
  }
  for (const file of files) if (!seenFiles.has(file)) errors.push(`ADR missing from index: ${file}`);
  for (const file of Object.keys(policy.legacy)) {
    if (!discovered.has(file)) errors.push(`Frozen legacy ADR missing: ${file}`);
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const errors = checkAdrIndex(root);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('ADR index: OK');
}
