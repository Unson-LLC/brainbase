#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { draftReleaseNote } from './lib/release-notes.mjs';
// Input: PR body or full merge commit message, via file or stdin. Output only.
try {
  const [version, input] = process.argv.slice(2);
  let text;
  if (input) text = await readFile(input, 'utf8');
  else {
    process.stdin.setEncoding('utf8');
    text = '';
    for await (const chunk of process.stdin) text += chunk;
  }
  process.stdout.write(JSON.stringify(draftReleaseNote(text, version), null, 2) + '\n');
} catch (error) { console.error(error.message); process.exitCode = 1; }
