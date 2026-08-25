#!/usr/bin/env node
import { syncPublicMessage } from './lib/public-message.mjs';

const write = process.argv.includes('--write');
const rootIndex = process.argv.indexOf('--root');
const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : process.cwd();

if (rootIndex >= 0 && !root) {
  throw new Error('--root requires a path');
}

const result = await syncPublicMessage(root, { write });
if (write) {
  process.stdout.write(`${JSON.stringify({
    status: 'synchronized',
    candidate_id: result.message.candidate_id,
    changed_files: result.changedFiles
  }, null, 2)}\n`);
} else {
  process.stdout.write(`${JSON.stringify({
    status: 'in_sync',
    candidate_id: result.message.candidate_id,
    changed_files: []
  }, null, 2)}\n`);
}
