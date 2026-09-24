import { createHash } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  placeJudgmentValueProof,
  validateJudgmentValueProof,
  type JudgmentValueProof
} from './judgment-value-proof.js';
import { defaultDataDir } from './paths.js';

export const JUDGMENT_VALUE_PROOF_FILE_SUFFIX = '.value-proof.json';
export const JUDGMENT_VALUE_PROOF_FEEDBACK_SCHEMA = 'brainbase-judgment-value-proof-feedback-v1';
export const JUDGMENT_VALUE_PROOF_FEEDBACK_FILE = 'judgment-value-proof-feedback.jsonl';

const FEEDBACK_SUMMARY_LIMIT = 500;
const DEFAULT_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export type JudgmentValueProofReviewSection = 'needs_human' | 'blocked' | 'continued' | 'other';
export type JudgmentValueProofFeedbackStatus = 'accepted' | 'corrected' | 'next_time_ask' | 'reverted';

const FEEDBACK_STATUSES: readonly JudgmentValueProofFeedbackStatus[] = [
  'accepted',
  'corrected',
  'next_time_ask',
  'reverted'
];
const SUMMARY_REQUIRED: readonly JudgmentValueProofFeedbackStatus[] = ['corrected', 'reverted'];

export interface JudgmentValueProofJournalEntry {
  readonly file: string;
  readonly proof: JudgmentValueProof;
}

export interface JudgmentValueProofJournalRejection {
  readonly file: string;
  readonly reason: string;
}

export type JudgmentValueProofJournalRead =
  | { readonly status: 'unavailable'; readonly root: string; readonly reason: string }
  | {
    readonly status: 'available';
    readonly root: string;
    readonly entries: readonly JudgmentValueProofJournalEntry[];
    readonly rejected: readonly JudgmentValueProofJournalRejection[];
    readonly latest_recorded_at: string | null;
  };

export interface JudgmentValueProofFeedbackRecord {
  readonly schema_version: typeof JUDGMENT_VALUE_PROOF_FEEDBACK_SCHEMA;
  readonly feedback_id: string;
  readonly intent_id: string;
  readonly decision_attempt_id: string;
  readonly status: JudgmentValueProofFeedbackStatus;
  readonly summary: string | null;
  readonly recorded_at: string;
}

export interface JudgmentValueProofFeedbackInput {
  readonly dataDir?: string;
  readonly intent_id: string;
  readonly decision_attempt_id: string;
  readonly status: JudgmentValueProofFeedbackStatus;
  readonly summary?: string | null;
  readonly now?: Date;
}

export interface JudgmentValueProofReviewItem {
  readonly file: string;
  readonly section: JudgmentValueProofReviewSection;
  readonly proof: JudgmentValueProof;
  readonly feedback_history: readonly JudgmentValueProofFeedbackRecord[];
}

export type JudgmentValueProofReviewHome =
  | { readonly status: 'unavailable'; readonly root: string; readonly reason: string }
  | {
    readonly status: 'available';
    readonly root: string;
    readonly coverage: {
      readonly saved: number;
      readonly rejected: number;
      readonly latest_recorded_at: string | null;
      readonly possibly_stalled: boolean;
    };
    readonly sections: Readonly<Record<JudgmentValueProofReviewSection, readonly JudgmentValueProofReviewItem[]>>;
    readonly rejected: readonly JudgmentValueProofJournalRejection[];
  };

export function defaultJudgmentJournalRoot(dataDir: string = defaultDataDir()): string {
  return join(resolve(dataDir), 'judgment-journal');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function compareRecordedAtDesc(left: string, right: string): number {
  return left < right ? 1 : left > right ? -1 : 0;
}

async function readProofFile(file: string): Promise<JudgmentValueProofJournalEntry | JudgmentValueProofJournalRejection> {
  try {
    const proof = validateJudgmentValueProof(JSON.parse(await readFile(file, 'utf8')) as JudgmentValueProof);
    return { file, proof };
  } catch (error) {
    return { file, reason: errorMessage(error) };
  }
}

/**
 * Reads saved judgment value proofs from `<root>/*.value-proof.json` and
 * `<root>/<session>/*.value-proof.json`. The journal is read-only here.
 */
export async function readJudgmentValueProofJournal(
  options: { readonly root?: string } = {}
): Promise<JudgmentValueProofJournalRead> {
  const root = resolve(options.root ?? defaultJudgmentJournalRoot());
  let topLevel;
  try {
    topLevel = await readdir(root, { withFileTypes: true });
  } catch (error) {
    const code = errorCode(error);
    const reason = code === 'ENOENT'
      ? 'judgment_journal_not_found'
      : code === 'ENOTDIR'
        ? 'judgment_journal_not_directory'
        : `judgment_journal_unreadable:${code ?? errorMessage(error)}`;
    return { status: 'unavailable', root, reason };
  }

  const files: string[] = [];
  for (const entry of topLevel) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name.endsWith(JUDGMENT_VALUE_PROOF_FILE_SUFFIX)) {
      files.push(path);
    } else if (entry.isDirectory()) {
      const nested = await readdir(path, { withFileTypes: true });
      for (const child of nested) {
        if (child.isFile() && child.name.endsWith(JUDGMENT_VALUE_PROOF_FILE_SUFFIX)) {
          files.push(join(path, child.name));
        }
      }
    }
  }

  const results = await Promise.all(files.sort().map(readProofFile));
  const entries = results
    .filter((result): result is JudgmentValueProofJournalEntry => 'proof' in result)
    .sort((left, right) => compareRecordedAtDesc(left.proof.recorded_at, right.proof.recorded_at)
      || left.file.localeCompare(right.file));
  const rejected = results.filter((result): result is JudgmentValueProofJournalRejection => 'reason' in result);

  return {
    status: 'available',
    root,
    entries,
    rejected,
    latest_recorded_at: entries[0]?.proof.recorded_at ?? null
  };
}

export function classifyJudgmentValueProof(proof: JudgmentValueProof): JudgmentValueProofReviewSection {
  if (placeJudgmentValueProof(proof).web_surface === 'none') return 'other';
  if (proof.state === 'waiting_human') return 'needs_human';
  if (proof.state === 'blocked') return 'blocked';
  if (proof.interruption.resolution === 'continued_without_human') return 'continued';
  return 'other';
}

function feedbackFile(dataDir?: string): string {
  return join(resolve(dataDir ?? defaultDataDir()), JUDGMENT_VALUE_PROOF_FEEDBACK_FILE);
}

function requiredId(value: string, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
}

function normalizeSummary(status: JudgmentValueProofFeedbackStatus, summary: string | null | undefined): string | null {
  const normalized = typeof summary === 'string' ? summary.trim() : '';
  if (!normalized && SUMMARY_REQUIRED.includes(status)) {
    throw new TypeError(`${status} feedback requires summary`);
  }
  if (Array.from(normalized).length > FEEDBACK_SUMMARY_LIMIT) {
    throw new TypeError(`feedback summary must be at most ${FEEDBACK_SUMMARY_LIMIT} characters`);
  }
  return normalized || null;
}

function feedbackId(decisionAttemptId: string, status: JudgmentValueProofFeedbackStatus, summary: string | null): string {
  return `sha256:${createHash('sha256').update(`${decisionAttemptId}\n${status}\n${summary ?? ''}`).digest('hex')}`;
}

function parseFeedbackRecord(line: string, lineNumber: number): JudgmentValueProofFeedbackRecord {
  let value: Partial<JudgmentValueProofFeedbackRecord>;
  try {
    value = JSON.parse(line) as Partial<JudgmentValueProofFeedbackRecord>;
  } catch (error) {
    throw new Error(`judgment_value_proof_feedback_corrupt:line_${lineNumber}`, { cause: error });
  }
  if (value.schema_version !== JUDGMENT_VALUE_PROOF_FEEDBACK_SCHEMA
    || !FEEDBACK_STATUSES.includes(value.status as JudgmentValueProofFeedbackStatus)
    || typeof value.feedback_id !== 'string'
    || typeof value.intent_id !== 'string'
    || typeof value.decision_attempt_id !== 'string'
    || typeof value.recorded_at !== 'string'
    || !(value.summary === null || typeof value.summary === 'string')) {
    throw new Error(`judgment_value_proof_feedback_invalid:line_${lineNumber}`);
  }
  return value as JudgmentValueProofFeedbackRecord;
}

/** Reads all recorded feedback in append order. A missing file means no feedback has been recorded. */
export async function readJudgmentValueProofFeedback(
  options: { readonly dataDir?: string } = {}
): Promise<readonly JudgmentValueProofFeedbackRecord[]> {
  let text: string;
  try {
    text = await readFile(feedbackFile(options.dataDir), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
  return text.split('\n')
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim())
    .map(({ line, lineNumber }) => parseFeedbackRecord(line, lineNumber));
}

/**
 * Appends one owner feedback record without touching the judgment journal.
 * Re-sending the same attempt, status and summary returns the existing record.
 */
export async function recordJudgmentValueProofFeedback(
  input: JudgmentValueProofFeedbackInput
): Promise<{ readonly record: JudgmentValueProofFeedbackRecord; readonly created: boolean }> {
  const intentId = requiredId(input.intent_id, 'intent_id');
  const decisionAttemptId = requiredId(input.decision_attempt_id, 'decision_attempt_id');
  if (!FEEDBACK_STATUSES.includes(input.status)) {
    throw new TypeError(`unsupported feedback status: ${String(input.status)}`);
  }
  const summary = normalizeSummary(input.status, input.summary);
  const id = feedbackId(decisionAttemptId, input.status, summary);

  const existing = (await readJudgmentValueProofFeedback({ dataDir: input.dataDir }))
    .find((record) => record.feedback_id === id);
  if (existing) return { record: existing, created: false };

  const record: JudgmentValueProofFeedbackRecord = {
    schema_version: JUDGMENT_VALUE_PROOF_FEEDBACK_SCHEMA,
    feedback_id: id,
    intent_id: intentId,
    decision_attempt_id: decisionAttemptId,
    status: input.status,
    summary,
    recorded_at: (input.now ?? new Date()).toISOString()
  };
  const file = feedbackFile(input.dataDir);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');

  const readBack = (await readJudgmentValueProofFeedback({ dataDir: input.dataDir }))
    .find((entry) => entry.feedback_id === id);
  if (!readBack) throw new Error('judgment_value_proof_feedback_readback_missing');
  return { record: readBack, created: true };
}

/** Returns the proof with its latest owner feedback applied, plus the feedback history for that attempt. */
export function applyJudgmentValueProofFeedback(
  proof: JudgmentValueProof,
  records: readonly JudgmentValueProofFeedbackRecord[]
): { readonly proof: JudgmentValueProof; readonly history: readonly JudgmentValueProofFeedbackRecord[] } {
  const history = records.filter((record) => record.intent_id === proof.intent_id
    && record.decision_attempt_id === proof.decision_attempt_id);
  const latest = history.at(-1);
  if (!latest) return { proof, history };
  const applied: JudgmentValueProof = {
    ...proof,
    feedback: {
      status: latest.status,
      summary: latest.summary,
      evidence_ref: {
        kind: 'human_feedback',
        ref: `judgment-value-proof-feedback:${latest.feedback_id}`,
        status: 'verified',
        label: '本人の評価'
      }
    }
  };
  return { proof: validateJudgmentValueProof(applied), history };
}

export function buildJudgmentValueProofReviewHome(
  journal: JudgmentValueProofJournalRead,
  feedback: readonly JudgmentValueProofFeedbackRecord[],
  options: { readonly now?: Date; readonly staleAfterMs?: number } = {}
): JudgmentValueProofReviewHome {
  if (journal.status === 'unavailable') return journal;

  const sections: Record<JudgmentValueProofReviewSection, JudgmentValueProofReviewItem[]> = {
    needs_human: [],
    blocked: [],
    continued: [],
    other: []
  };
  for (const entry of journal.entries) {
    const { proof, history } = applyJudgmentValueProofFeedback(entry.proof, feedback);
    const section = classifyJudgmentValueProof(proof);
    sections[section].push({ file: entry.file, section, proof, feedback_history: history });
  }

  const now = (options.now ?? new Date()).getTime();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const latest = journal.latest_recorded_at === null ? null : Date.parse(journal.latest_recorded_at);
  const possiblyStalled = latest === null || Number.isNaN(latest) || now - latest > staleAfterMs;

  return {
    status: 'available',
    root: journal.root,
    coverage: {
      saved: journal.entries.length,
      rejected: journal.rejected.length,
      latest_recorded_at: journal.latest_recorded_at,
      possibly_stalled: possiblyStalled
    },
    sections,
    rejected: journal.rejected
  };
}
