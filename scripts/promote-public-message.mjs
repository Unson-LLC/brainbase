#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  PUBLIC_MESSAGE_HISTORY_DIR,
  PUBLIC_MESSAGE_PATH,
  PUBLIC_MESSAGE_SYNC_TARGETS,
  canonicalize,
  loadPublicMessage,
  pathExists,
  readJson,
  sha256,
  syncPublicMessage,
  validatePublicMessage,
  writeJsonAtomic
} from './lib/public-message.mjs';

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

const candidatePath = argumentValue('--candidate');
const expectedCandidateId = argumentValue('--expected-candidate-id');
const root = resolve(argumentValue('--root') ?? process.cwd());
const apply = process.argv.includes('--apply');
const planOnly = process.argv.includes('--plan') || !apply;

if (!candidatePath) {
  throw new Error('--candidate is required');
}
if (apply && process.argv.includes('--plan')) {
  throw new Error('choose exactly one of --plan or --apply');
}

const candidate = validatePublicMessage(await readJson(resolve(candidatePath)), {
  requireGraphSource: true
});
if (expectedCandidateId && candidate.candidate_id !== expectedCandidateId) {
  throw new Error(
    `candidate_id mismatch: expected ${expectedCandidateId}, got ${candidate.candidate_id}`
  );
}

const current = await loadPublicMessage(root);
const changedCopyFields = Object.keys(candidate.copy).filter(
  (key) => candidate.copy[key] !== current.copy[key]
);
const historyPath = `${PUBLIC_MESSAGE_HISTORY_DIR}/${candidate.candidate_id}.json`;
const targetFiles = [
  PUBLIC_MESSAGE_PATH,
  historyPath,
  ...PUBLIC_MESSAGE_SYNC_TARGETS
];
const plan = {
  status: changedCopyFields.length > 0 ? 'copy_change' : 'metadata_only',
  candidate_id: candidate.candidate_id,
  candidate_digest: sha256(candidate),
  current_candidate_id: current.candidate_id,
  current_digest: sha256(current),
  source: {
    entity_id: candidate.source.entity_id,
    entity_version: candidate.source.entity_version ?? null,
    snapshot_hash: candidate.source.snapshot_hash,
    exported_at: candidate.source.exported_at,
    scope: candidate.source.scope
  },
  approval: candidate.approval,
  changed_copy_fields: changedCopyFields,
  target_files: targetFiles
};

if (planOnly) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.exit(0);
}

const historyAbsolutePath = join(root, historyPath);
if (await pathExists(historyAbsolutePath)) {
  const existing = JSON.parse(await readFile(historyAbsolutePath, 'utf8'));
  if (canonicalize(existing) !== canonicalize(candidate)) {
    throw new Error(`history conflict: ${historyPath} already exists with different content`);
  }
} else {
  await writeJsonAtomic(historyAbsolutePath, candidate);
}

await writeJsonAtomic(join(root, PUBLIC_MESSAGE_PATH), candidate);
const synchronized = await syncPublicMessage(root, { write: true });
await syncPublicMessage(root, { write: false });

process.stdout.write(`${JSON.stringify({
  ...plan,
  status: 'applied',
  synchronized_files: synchronized.changedFiles,
  history_path: historyPath
}, null, 2)}\n`);
