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
/** What the owner's feedback asks to change. `delegation` is the ask/continue boundary. */
export type JudgmentValueProofFeedbackLayer =
  | 'delegation'
  | 'method'
  | 'objective'
  | 'world_model'
  | 'philosophy'
  | 'other';

const FEEDBACK_STATUSES: readonly JudgmentValueProofFeedbackStatus[] = [
  'accepted',
  'corrected',
  'next_time_ask',
  'reverted'
];
const SUMMARY_REQUIRED: readonly JudgmentValueProofFeedbackStatus[] = ['corrected', 'reverted'];
export const JUDGMENT_VALUE_PROOF_FEEDBACK_LAYERS: readonly JudgmentValueProofFeedbackLayer[] = [
  'delegation',
  'method',
  'objective',
  'world_model',
  'philosophy',
  'other'
];

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
  /** Absent on records written before the layer was introduced. */
  readonly target_layer?: JudgmentValueProofFeedbackLayer | null;
  readonly recorded_at: string;
}

export interface JudgmentValueProofFeedbackInput {
  readonly dataDir?: string;
  readonly intent_id: string;
  readonly decision_attempt_id: string;
  readonly status: JudgmentValueProofFeedbackStatus;
  readonly summary?: string | null;
  readonly target_layer?: JudgmentValueProofFeedbackLayer | null;
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
    readonly delegation_map: JudgmentDelegationMap;
    readonly rejected: readonly JudgmentValueProofJournalRejection[];
  };

/** Whether Brainbase currently proceeds on a kind of judgment, is being checked, or asks the owner. */
export type JudgmentDelegationState = 'delegated' | 'verifying' | 'returned';
/** Rows are kinds when recorded; otherwise the reason code, which is not a kind and is shown apart. */
export type JudgmentDelegationRowSource = 'judgment_kind' | 'reason_code' | 'unrecorded';

export type JudgmentDelegationStateBasis =
  | { readonly reason: 'latest_judgment_returned'; readonly at: string }
  | {
    readonly reason: 'latest_feedback';
    readonly status: JudgmentValueProofFeedbackStatus;
    readonly target_layer: JudgmentValueProofFeedbackLayer | null;
    readonly at: string;
  }
  | { readonly reason: 'no_feedback' };

export interface JudgmentDelegationItemRef {
  readonly intent_id: string;
  readonly decision_attempt_id: string;
  readonly row_key: string;
}

export interface JudgmentDelegationRow {
  readonly key: string;
  readonly source: JudgmentDelegationRowSource;
  /** Kind label or reason code; null for judgments that recorded neither. */
  readonly label: string | null;
  readonly state: JudgmentDelegationState;
  readonly state_basis: JudgmentDelegationStateBasis;
  readonly counts: {
    readonly continued: number;
    readonly returned: number;
    readonly rated: number;
    readonly by_feedback: Readonly<Record<JudgmentValueProofFeedbackStatus, number>>;
    readonly corrected_or_reverted: number;
    readonly inherited: number;
  };
  readonly latest_recorded_at: string;
  /** Newest first. */
  readonly items: readonly JudgmentDelegationItemRef[];
}

export interface JudgmentDelegationMap {
  readonly judged: number;
  readonly kind_recorded: number;
  readonly rated: number;
  /** Kind rows first, then reason-code rows, then the unrecorded row. */
  readonly rows: readonly JudgmentDelegationRow[];
  /** Continued without asking, then corrected or reverted by the owner (P14). */
  readonly corrected_after_continue: readonly JudgmentDelegationItemRef[];
  /** Continued without asking after the owner asked to be asked for that row. */
  readonly continued_after_ask: readonly JudgmentDelegationItemRef[];
}

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

/**
 * `next_time_ask` always targets the delegation boundary; `corrected` must say what it corrects;
 * `accepted` and `reverted` carry no layer.
 */
function normalizeTargetLayer(
  status: JudgmentValueProofFeedbackStatus,
  layer: JudgmentValueProofFeedbackLayer | null | undefined
): JudgmentValueProofFeedbackLayer | null {
  if (layer !== undefined && layer !== null && !JUDGMENT_VALUE_PROOF_FEEDBACK_LAYERS.includes(layer)) {
    throw new TypeError(`unsupported feedback target_layer: ${String(layer)}`);
  }
  if (status === 'next_time_ask') {
    if (layer && layer !== 'delegation') throw new TypeError('next_time_ask feedback targets delegation');
    return 'delegation';
  }
  if (status === 'corrected') {
    if (!layer) throw new TypeError('corrected feedback requires target_layer');
    return layer;
  }
  if (layer) throw new TypeError(`${status} feedback does not take target_layer`);
  return null;
}

function feedbackId(
  decisionAttemptId: string,
  status: JudgmentValueProofFeedbackStatus,
  layer: JudgmentValueProofFeedbackLayer | null,
  summary: string | null
): string {
  return `sha256:${createHash('sha256').update(`${decisionAttemptId}\n${status}\n${layer ?? ''}\n${summary ?? ''}`).digest('hex')}`;
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
    || !(value.summary === null || typeof value.summary === 'string')
    || !(value.target_layer === undefined || value.target_layer === null
      || JUDGMENT_VALUE_PROOF_FEEDBACK_LAYERS.includes(value.target_layer))) {
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
  const targetLayer = normalizeTargetLayer(input.status, input.target_layer);
  const id = feedbackId(decisionAttemptId, input.status, targetLayer, summary);

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
    target_layer: targetLayer,
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

  const delegationMap = buildJudgmentDelegationMap(
    [...sections.needs_human, ...sections.blocked, ...sections.continued],
    feedback
  );

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
    delegation_map: delegationMap,
    rejected: journal.rejected
  };
}

function delegationRowIdentity(proof: JudgmentValueProof): {
  readonly key: string;
  readonly source: JudgmentDelegationRowSource;
  readonly label: string | null;
} {
  const kind = proof.decision.judgment_kind;
  if (kind) return { key: `kind:${kind.key}`, source: 'judgment_kind', label: kind.label };
  const reason = proof.interruption.reason_code?.trim();
  if (reason) return { key: `reason:${reason}`, source: 'reason_code', label: reason };
  return { key: 'unrecorded', source: 'unrecorded', label: null };
}

function laterFeedback(
  left: { readonly record: JudgmentValueProofFeedbackRecord; readonly order: number } | null,
  right: { readonly record: JudgmentValueProofFeedbackRecord; readonly order: number }
): boolean {
  return !left || right.record.recorded_at > left.record.recorded_at
    || (right.record.recorded_at === left.record.recorded_at && right.order > left.order);
}

function returnsDelegation(record: JudgmentValueProofFeedbackRecord): boolean {
  return record.status === 'next_time_ask' || record.status === 'reverted'
    || (record.status === 'corrected' && record.target_layer === 'delegation');
}

function newestFirst(entries: readonly { readonly ref: JudgmentDelegationItemRef; readonly at: string }[]): JudgmentDelegationItemRef[] {
  return [...entries].sort((left, right) => compareRecordedAtDesc(left.at, right.at)).map((entry) => entry.ref);
}

function itemRef(item: JudgmentValueProofReviewItem, rowKey: string): JudgmentDelegationItemRef {
  return { intent_id: item.proof.intent_id, decision_attempt_id: item.proof.decision_attempt_id, row_key: rowKey };
}

/**
 * Groups reviewable judgments by kind and decides, per kind, whether Brainbase is trusted to
 * proceed, is still being checked, or returns the judgment to the owner. Deterministic: the state
 * follows only the newest judgment and the newest owner feedback in the row.
 */
export function buildJudgmentDelegationMap(
  items: readonly JudgmentValueProofReviewItem[],
  feedback: readonly JudgmentValueProofFeedbackRecord[]
): JudgmentDelegationMap {
  const order = new Map(feedback.map((record, index) => [record, index]));
  const sorted = [...items].sort((left, right) => compareRecordedAtDesc(left.proof.recorded_at, right.proof.recorded_at)
    || left.file.localeCompare(right.file));
  const groups = new Map<string, { identity: ReturnType<typeof delegationRowIdentity>; items: JudgmentValueProofReviewItem[] }>();
  for (const item of sorted) {
    const identity = delegationRowIdentity(item.proof);
    const group = groups.get(identity.key) ?? { identity, items: [] };
    group.items.push(item);
    groups.set(identity.key, group);
  }

  const correctedAfterContinue: { ref: JudgmentDelegationItemRef; at: string }[] = [];
  const continuedAfterAsk: { ref: JudgmentDelegationItemRef; at: string }[] = [];
  const rows: JudgmentDelegationRow[] = [];
  for (const { identity, items: rowItems } of groups.values()) {
    const byFeedback: Record<JudgmentValueProofFeedbackStatus, number> = { accepted: 0, corrected: 0, next_time_ask: 0, reverted: 0 };
    let latestFeedback: { record: JudgmentValueProofFeedbackRecord; order: number } | null = null;
    let latestAsk: { record: JudgmentValueProofFeedbackRecord; order: number } | null = null;
    let continued = 0;
    let returned = 0;
    let rated = 0;
    let inherited = 0;
    for (const item of rowItems) {
      const resolution = item.proof.interruption.resolution;
      if (resolution === 'continued_without_human') continued += 1;
      if (resolution === 'human_required') returned += 1;
      if ((item.proof.decision.inheritance?.sources.length ?? 0) > 0) inherited += 1;
      const latest = item.feedback_history.at(-1);
      if (latest) {
        rated += 1;
        byFeedback[latest.status] += 1;
        if (resolution === 'continued_without_human' && (latest.status === 'corrected' || latest.status === 'reverted')) {
          correctedAfterContinue.push({ ref: itemRef(item, identity.key), at: item.proof.recorded_at });
        }
      }
      for (const record of item.feedback_history) {
        const candidate = { record, order: order.get(record) ?? -1 };
        if (laterFeedback(latestFeedback, candidate)) latestFeedback = candidate;
        if (record.status === 'next_time_ask' && laterFeedback(latestAsk, candidate)) latestAsk = candidate;
      }
    }
    if (latestAsk) {
      for (const item of rowItems) {
        if (item.proof.interruption.resolution === 'continued_without_human'
          && item.proof.recorded_at > latestAsk.record.recorded_at
          && item.feedback_history.at(-1)?.status !== 'accepted') {
          continuedAfterAsk.push({ ref: itemRef(item, identity.key), at: item.proof.recorded_at });
        }
      }
    }

    const newest = rowItems[0].proof;
    let state: JudgmentDelegationState;
    let basis: JudgmentDelegationStateBasis;
    const feedbackBasis = (record: JudgmentValueProofFeedbackRecord): JudgmentDelegationStateBasis => ({
      reason: 'latest_feedback',
      status: record.status,
      target_layer: record.target_layer ?? (record.status === 'next_time_ask' ? 'delegation' : null),
      at: record.recorded_at
    });
    if (newest.interruption.resolution === 'human_required') {
      state = 'returned';
      basis = { reason: 'latest_judgment_returned', at: newest.recorded_at };
    } else if (latestFeedback && returnsDelegation(latestFeedback.record)) {
      state = 'returned';
      basis = feedbackBasis(latestFeedback.record);
    } else if (newest.interruption.resolution === 'continued_without_human' && latestFeedback?.record.status === 'accepted') {
      state = 'delegated';
      basis = feedbackBasis(latestFeedback.record);
    } else {
      state = 'verifying';
      basis = latestFeedback ? feedbackBasis(latestFeedback.record) : { reason: 'no_feedback' };
    }

    rows.push({
      key: identity.key,
      source: identity.source,
      // The newest judgment names a kind row, so a relabelled kind shows its current label.
      label: identity.source === 'judgment_kind' ? newest.decision.judgment_kind?.label ?? identity.label : identity.label,
      state,
      state_basis: basis,
      counts: {
        continued,
        returned,
        rated,
        by_feedback: byFeedback,
        corrected_or_reverted: byFeedback.corrected + byFeedback.reverted,
        inherited
      },
      latest_recorded_at: newest.recorded_at,
      items: rowItems.map((item) => itemRef(item, identity.key))
    });
  }

  const sourceRank: Record<JudgmentDelegationRowSource, number> = { judgment_kind: 0, reason_code: 1, unrecorded: 2 };
  rows.sort((left, right) => sourceRank[left.source] - sourceRank[right.source]
    || compareRecordedAtDesc(left.latest_recorded_at, right.latest_recorded_at)
    || left.key.localeCompare(right.key));

  return {
    judged: sorted.length,
    kind_recorded: sorted.filter((item) => item.proof.decision.judgment_kind).length,
    rated: rows.reduce((total, row) => total + row.counts.rated, 0),
    rows,
    corrected_after_continue: newestFirst(correctedAfterContinue),
    continued_after_ask: newestFirst(continuedAfterAsk)
  };
}

export interface JudgmentValueProofFeedbackSummary {
  /** Decisions with at least one feedback record; each counts once, by its latest feedback. */
  readonly rated: number;
  readonly by_status: Readonly<Record<JudgmentValueProofFeedbackStatus, number>>;
  /** Latest `corrected` and `next_time_ask` feedback by the layer they ask to change. */
  readonly by_layer: Readonly<Record<JudgmentValueProofFeedbackLayer | 'unrecorded', number>>;
}

/** Counts the latest feedback per decision, for deciding where revisions should live. */
export function summarizeJudgmentValueProofFeedback(
  records: readonly JudgmentValueProofFeedbackRecord[]
): JudgmentValueProofFeedbackSummary {
  const latest = new Map<string, JudgmentValueProofFeedbackRecord>();
  for (const record of records) latest.set(`${record.intent_id}\u0000${record.decision_attempt_id}`, record);

  const byStatus: Record<JudgmentValueProofFeedbackStatus, number> = { accepted: 0, corrected: 0, next_time_ask: 0, reverted: 0 };
  const byLayer: Record<JudgmentValueProofFeedbackLayer | 'unrecorded', number> = {
    delegation: 0, method: 0, objective: 0, world_model: 0, philosophy: 0, other: 0, unrecorded: 0
  };
  for (const record of latest.values()) {
    byStatus[record.status] += 1;
    if (record.status === 'corrected' || record.status === 'next_time_ask') {
      byLayer[record.target_layer ?? (record.status === 'next_time_ask' ? 'delegation' : 'unrecorded')] += 1;
    }
  }
  return { rated: latest.size, by_status: byStatus, by_layer: byLayer };
}
