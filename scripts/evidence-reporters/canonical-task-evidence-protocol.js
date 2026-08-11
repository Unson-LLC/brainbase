import { createHash } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RUNNER_PROTOCOL = 'canonical-task-runner-evidence-v1';
export const RUNNER_SCHEMA_VERSION = '1.0.0';
export const FINAL_EVENT_KIND = 'canonical-task-evidence-final';
export const EVIDENCE_ATTACHMENT_NAME = 'canonical-task-evidence-final';
export const EVIDENCE_ANNOTATION_TYPE = 'canonical-task-evidence-final';
export const EVIDENCE_CONTENT_TYPE = 'application/vnd.brainbase.canonical-task-evidence+json';
export const EVIDENCE_ENV_NAMES = [
  'VIBEPRO_EVIDENCE_ID',
  'VIBEPRO_EVIDENCE_NONCE',
  'VIBEPRO_EVIDENCE_RESULT',
];

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function validateEvidenceEnvironment(env = process.env) {
  const evidenceId = env.VIBEPRO_EVIDENCE_ID;
  const resultPath = env.VIBEPRO_EVIDENCE_RESULT;
  const nonce = env.VIBEPRO_EVIDENCE_NONCE;

  if (!evidenceId || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(evidenceId)) {
    throw new Error('VIBEPRO_EVIDENCE_ID is missing or malformed');
  }
  if (!resultPath || resultPath.includes('\0')) {
    throw new Error('VIBEPRO_EVIDENCE_RESULT is missing or malformed');
  }
  if (!nonce || !/^[a-f0-9]{64}$/.test(nonce)) {
    throw new Error('VIBEPRO_EVIDENCE_NONCE must be 64 lowercase hex characters');
  }

  return { evidenceId, resultPath, nonce, nonceHash: sha256(nonce) };
}

export function createFinalEvent(evidenceId, nonce) {
  return {
    protocol: RUNNER_PROTOCOL,
    kind: FINAL_EVENT_KIND,
    evidence_id: evidenceId,
    nonce,
    marker: `VIBEPRO_ASSERT:${evidenceId}:${nonce}`,
  };
}

function attachmentBody(value) {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString('utf8');
  }
  return null;
}

export function parseFinalEventEnvelope(value, expected) {
  const body = attachmentBody(value);
  if (body === null) return null;

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return null;
  }

  const marker = `VIBEPRO_ASSERT:${expected.evidenceId}:${expected.nonce}`;
  if (
    event?.protocol !== RUNNER_PROTOCOL
    || event?.kind !== FINAL_EVENT_KIND
    || event?.evidence_id !== expected.evidenceId
    || event?.nonce !== expected.nonce
    || event?.marker !== marker
  ) {
    return null;
  }

  return {
    kind: FINAL_EVENT_KIND,
    evidence_id: expected.evidenceId,
    nonce: expected.nonce,
    marker,
  };
}

export async function atomicWriteFile(targetPath, bytes) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw new Error(`Failed to atomically write ${targetPath}: ${error.message}`, { cause: error });
  }
}

export async function atomicWriteJson(targetPath, value) {
  await atomicWriteFile(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

export function createRunnerResult(adapter, evidence, tests) {
  return {
    protocol: RUNNER_PROTOCOL,
    schema_version: RUNNER_SCHEMA_VERSION,
    adapter,
    evidence_id: evidence.evidenceId,
    nonce_hash: evidence.nonceHash,
    tests,
  };
}
