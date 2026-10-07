import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

/** Public normal-judgment history contract. Value-proof records use a separate contract. */
export const JUDGMENT_HISTORY_RECORD_SCHEMA = 'brainbase-judgment-history-record-v1' as const;
export const JUDGMENT_HISTORY_CONTRACT_VERSION = 'brainbase.judgment-history.v1' as const;
export const JUDGMENT_HISTORY_FEEDBACK_SCHEMA = 'brainbase-judgment-history-feedback-v1' as const;

export const JUDGMENT_HISTORY_ENTRYPOINTS = Object.freeze([
  'codex',
  'claude_code',
  'mana',
  'company_os',
  'unknown'
] as const);

export type JudgmentHistoryEntrypoint = typeof JUDGMENT_HISTORY_ENTRYPOINTS[number];
export type JudgmentHistoryStatus = 'available' | 'partial' | 'unavailable';
export type JudgmentHistoryStorage = 'local' | 'server';
export type JudgmentHistoryPeriod = 'week' | 'past30days' | 'all';
export type JudgmentHistoryReferenceAvailability = 'recorded' | 'permission_denied' | 'unavailable' | 'unknown';
export type JudgmentHistoryExecutionStatus = 'pending' | 'completed' | 'failed' | 'held' | 'cancelled' | 'unknown';
export type JudgmentHistoryOutcomeStatus = 'unconfirmed' | 'confirmed' | 'unknown';
export type JudgmentHistoryFeedbackKind = 'feedback' | 'result' | 'correction';

export interface JudgmentHistoryFeedbackContent {
  readonly summary: string;
  readonly outcome_status?: JudgmentHistoryOutcomeStatus;
}

/** Public feedback event. Storage timestamps and digests are deliberately omitted. */
export interface JudgmentHistoryFeedbackEvent {
  readonly record_id: string;
  readonly event_id: string;
  readonly kind: JudgmentHistoryFeedbackKind;
  readonly content: JudgmentHistoryFeedbackContent;
}

export interface JudgmentHistoryFeedbackWriteResult {
  readonly event: JudgmentHistoryFeedbackEvent;
  readonly created: boolean;
  readonly status: 'saved' | 'already_saved';
}

export interface JudgmentHistoryReference {
  readonly ref: string;
  readonly kind: string | null;
  readonly version: string | null;
  readonly digest: string | null;
  readonly why: string | null;
  readonly usage: string | null;
  readonly availability: JudgmentHistoryReferenceAvailability;
}

export interface JudgmentHistoryAlternative {
  readonly label: string;
  readonly evaluation: string | null;
  readonly adopted: boolean | null;
}

export interface JudgmentHistoryJudgment {
  readonly status: 'resolved' | 'needs_clarification' | 'unknown';
  readonly summary: string | null;
  readonly reason: string | null;
  readonly selected_references: readonly JudgmentHistoryReference[] | null;
  readonly alternatives: readonly JudgmentHistoryAlternative[] | null;
}

export interface JudgmentHistoryExecution {
  readonly status: JudgmentHistoryExecutionStatus;
  readonly result_summary: string | null;
  readonly outcome_status: JudgmentHistoryOutcomeStatus;
}

export interface JudgmentHistoryRecord {
  readonly schema_version: typeof JUDGMENT_HISTORY_RECORD_SCHEMA;
  readonly record_id: string;
  readonly entrypoint: JudgmentHistoryEntrypoint;
  readonly recorded_at: string;
  readonly project_code: string | null;
  readonly turn_ref: string;
  readonly judgment: JudgmentHistoryJudgment;
  readonly execution: JudgmentHistoryExecution;
  readonly missing_fields: readonly string[];
  /** Append-only result/correction events linked to this normal record. */
  readonly feedback_events?: readonly JudgmentHistoryFeedbackEvent[];
}

export interface JudgmentHistorySourceInfo {
  readonly entrypoint: JudgmentHistoryEntrypoint;
  readonly status: JudgmentHistoryStatus;
  readonly reason: string | null;
}

export interface JudgmentHistoryCoverage {
  readonly complete: boolean;
  readonly storage: JudgmentHistoryStorage;
  readonly reason: string | null;
  readonly sources: readonly JudgmentHistorySourceInfo[];
  /** Null means the adapter cannot prove the total under this scope/filter. */
  readonly total: number | null;
}

export interface JudgmentHistorySourceSnapshot {
  readonly status: JudgmentHistoryStatus;
  readonly records: readonly JudgmentHistoryRecord[] | null;
  readonly coverage: JudgmentHistoryCoverage;
  /** Stable source revision used to bind pagination cursors. */
  readonly snapshot_id?: string;
}

export interface JudgmentHistorySource {
  readonly storage: JudgmentHistoryStorage;
  readonly read: () => Promise<JudgmentHistorySourceSnapshot>;
}

export interface JudgmentHistoryQuery {
  readonly period?: JudgmentHistoryPeriod;
  readonly project?: string;
  readonly entrypoint?: JudgmentHistoryEntrypoint;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface JudgmentHistoryFilters {
  readonly period: JudgmentHistoryPeriod;
  readonly project: string | null;
  readonly entrypoint: JudgmentHistoryEntrypoint | null;
}

export interface JudgmentHistoryPagination {
  readonly cursor: string | null;
  readonly next_cursor: string | null;
  readonly limit: number;
  readonly has_more: boolean;
}

export interface JudgmentHistoryHome {
  readonly contract_version: typeof JUDGMENT_HISTORY_CONTRACT_VERSION;
  readonly status: JudgmentHistoryStatus;
  readonly records: readonly JudgmentHistoryRecord[] | null;
  readonly coverage: JudgmentHistoryCoverage;
  readonly pagination: JudgmentHistoryPagination;
  readonly filters: JudgmentHistoryFilters;
}

export interface JudgmentHistoryDetail {
  readonly contract_version: typeof JUDGMENT_HISTORY_CONTRACT_VERSION;
  readonly status: JudgmentHistoryStatus;
  readonly record: JudgmentHistoryRecord | null;
  readonly coverage: JudgmentHistoryCoverage;
}

export interface JudgmentHistoryReaderOptions {
  readonly source: JudgmentHistorySource;
  readonly now?: () => Date;
  /** Organization adapters provide trusted scope authorization here. */
  readonly authorizeProject?: (project: string) => boolean | Promise<boolean>;
}

export interface JudgmentHistoryReader {
  readonly home: (query?: JudgmentHistoryQuery) => Promise<JudgmentHistoryHome>;
  readonly detail: (recordId: string) => Promise<JudgmentHistoryDetail>;
}

export class JudgmentHistoryReaderError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'JudgmentHistoryReaderError';
  }
}

export interface LocalJudgmentHistorySourceOptions {
  readonly root: string;
  readonly entrypoint?: JudgmentHistoryEntrypoint;
  /** Maximum number of candidate journal files inspected in one read. */
  readonly max_files?: number;
  /** Maximum size of one journal artifact, in bytes. */
  readonly max_record_bytes?: number;
}

export interface LocalJudgmentHistoryFeedbackWriterOptions {
  readonly root: string;
  readonly reader: JudgmentHistoryReader;
  readonly now?: () => Date;
}

export type JudgmentHistoryFeedbackWriter = (input: unknown) => Promise<JudgmentHistoryFeedbackWriteResult>;

export class JudgmentHistoryFeedbackError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'JudgmentHistoryFeedbackError';
  }
}

export class JudgmentHistoryFeedbackConflictError extends JudgmentHistoryFeedbackError {
  constructor(readonly existing: JudgmentHistoryFeedbackEvent) {
    super(409, 'feedback_conflict', 'The event_id is already recorded with different content');
    this.name = 'JudgmentHistoryFeedbackConflictError';
  }
}

interface JsonObject {
  [key: string]: unknown;
}

interface LocalSourceReadResult {
  readonly records: JudgmentHistoryRecord[];
  readonly invalidCount: number;
  readonly candidateCount: number;
  readonly capped: boolean;
  readonly contentDigest: string;
}

interface StoredFeedbackEvent extends JudgmentHistoryFeedbackEvent {
  readonly recorded_at: string;
}

interface LocalFeedbackReadResult {
  readonly events: ReadonlyMap<string, readonly JudgmentHistoryFeedbackEvent[]>;
  readonly invalidCount: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
export const DEFAULT_LOCAL_JUDGMENT_HISTORY_SCAN_CAP = 4_096;
export const DEFAULT_LOCAL_JUDGMENT_HISTORY_RECORD_BYTES = 1_024 * 1_024;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SAFE_ID = /^[^/\\\u0000-\u001f\u007f]+$/u;
const ADOPTION_FILE = /^[a-f0-9]{64}\.json$/u;
const FINAL_FILE = /^(.+)\.final\.json$/u;
const FEEDBACK_DIR = 'feedback';
const FEEDBACK_RECORD_DIR = /^[a-f0-9]{64}$/u;
const FEEDBACK_FILE = /^([a-f0-9]{64})\.json$/u;
const FEEDBACK_KINDS = ['feedback', 'result', 'correction'] as const;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number in canonical JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError('unsupported value in canonical JSON');
}

function parseIso(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate || !Number.isFinite(Date.parse(candidate))) return null;
  return new Date(candidate).toISOString();
}

function entrypoint(value: unknown, fallback: JudgmentHistoryEntrypoint = 'unknown'): JudgmentHistoryEntrypoint {
  const candidate = text(value);
  return candidate && (JUDGMENT_HISTORY_ENTRYPOINTS as readonly string[]).includes(candidate)
    ? candidate as JudgmentHistoryEntrypoint
    : fallback;
}

function safeId(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate || candidate.length > 512 || !SAFE_ID.test(candidate)) return null;
  return candidate;
}

function feedbackKind(value: unknown): JudgmentHistoryFeedbackKind | null {
  const candidate = text(value);
  return candidate && (FEEDBACK_KINDS as readonly string[]).includes(candidate)
    ? candidate as JudgmentHistoryFeedbackKind
    : null;
}

function normalizeFeedbackContent(value: unknown): JudgmentHistoryFeedbackContent | null {
  if (!isObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'summary' && key !== 'outcome_status')) return null;
  const summary = stringOrNull(value.summary);
  if (!summary) return null;
  const content: JudgmentHistoryFeedbackContent = { summary };
  if ('outcome_status' in value) {
    const outcome = text(value.outcome_status);
    if (outcome !== 'unknown' && outcome !== 'unconfirmed' && outcome !== 'confirmed') return null;
    return { ...content, outcome_status: outcome };
  }
  return content;
}

function normalizeFeedbackEvent(value: unknown): JudgmentHistoryFeedbackEvent | null {
  if (!isObject(value)) return null;
  const recordId = safeId(value.record_id);
  const eventId = safeId(value.event_id);
  const kind = feedbackKind(value.kind);
  const content = normalizeFeedbackContent(value.content);
  if (!recordId || !eventId || !kind || !content) return null;
  return { record_id: recordId, event_id: eventId, kind, content };
}

function normalizeFeedbackInput(value: unknown): JudgmentHistoryFeedbackEvent {
  if (!isObject(value)) throw new JudgmentHistoryFeedbackError(400, 'invalid_feedback', 'Feedback body must be an object');
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'record_id' && key !== 'event_id' && key !== 'kind' && key !== 'content')) {
    throw new JudgmentHistoryFeedbackError(400, 'invalid_feedback', 'Feedback body contains unsupported fields');
  }
  const event = normalizeFeedbackEvent(value);
  if (!event) throw new JudgmentHistoryFeedbackError(400, 'invalid_feedback', 'Feedback fields are invalid');
  return event;
}

function feedbackPathKey(value: string): string {
  return sha256(value);
}

function stringOrNull(value: unknown): string | null {
  const candidate = text(value);
  return candidate && candidate.length <= 16_384 ? candidate : null;
}

function publicBlock(...values: unknown[]): JsonObject | null {
  for (const value of values) if (isObject(value)) return value;
  return null;
}

function field(object: JsonObject | null, ...names: string[]): unknown {
  if (!object) return undefined;
  for (const name of names) if (name in object) return object[name];
  return undefined;
}

function normalizeAvailability(value: unknown): JudgmentHistoryReferenceAvailability {
  const candidate = text(value);
  return candidate === 'recorded' || candidate === 'permission_denied' || candidate === 'unavailable' || candidate === 'unknown'
    ? candidate
    : 'unknown';
}

function normalizeReference(value: unknown): JudgmentHistoryReference | null {
  if (!isObject(value)) return null;
  const ref = safeId(value.ref);
  if (!ref) return null;
  return {
    ref,
    kind: stringOrNull(value.kind),
    version: stringOrNull(value.version),
    digest: stringOrNull(value.digest),
    why: stringOrNull(value.why),
    usage: stringOrNull(value.usage),
    availability: normalizeAvailability(value.availability)
  };
}

function normalizeAlternative(value: unknown): JudgmentHistoryAlternative | null {
  if (!isObject(value)) return null;
  const label = stringOrNull(value.label ?? value.option ?? value.name);
  if (!label) return null;
  const adoptedValue = value.adopted ?? value.selected;
  const adopted = typeof adoptedValue === 'boolean'
    ? adoptedValue
    : text(adoptedValue)?.toLowerCase() === 'adopted' || text(adoptedValue)?.toLowerCase() === 'selected'
      ? true
      : text(adoptedValue)?.toLowerCase() === 'rejected' || text(adoptedValue)?.toLowerCase() === 'not_selected'
        ? false
        : null;
  return {
    label,
    evaluation: stringOrNull(value.evaluation ?? value.assessment),
    adopted
  };
}

function normalizeReferences(value: unknown): readonly JudgmentHistoryReference[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value.map(normalizeReference).filter((item): item is JudgmentHistoryReference => item !== null);
  return normalized.length === value.length ? normalized : null;
}

function normalizeAlternatives(value: unknown): readonly JudgmentHistoryAlternative[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value.map(normalizeAlternative).filter((item): item is JudgmentHistoryAlternative => item !== null);
  return normalized.length === value.length ? normalized : null;
}

function normalizeExecution(value: unknown): JudgmentHistoryExecution {
  const object = isObject(value) ? value : null;
  const statusValue = text(field(object, 'status'));
  const status: JudgmentHistoryExecutionStatus = statusValue === 'pending'
    || statusValue === 'completed'
    || statusValue === 'failed'
    || statusValue === 'held'
    || statusValue === 'cancelled'
    || statusValue === 'unknown'
    ? statusValue
    : 'unknown';
  const outcomeValue = text(field(object, 'outcome_status', 'outcomeStatus'));
  const outcome_status: JudgmentHistoryOutcomeStatus = outcomeValue === 'unconfirmed' || outcomeValue === 'confirmed' || outcomeValue === 'unknown'
    ? outcomeValue
    : 'unknown';
  return {
    status,
    result_summary: stringOrNull(field(object, 'result_summary', 'resultSummary')),
    outcome_status
  };
}

function missingFields(record: Omit<JudgmentHistoryRecord, 'missing_fields'>, explicit: unknown): string[] {
  const values = new Set<string>(Array.isArray(explicit) ? explicit.filter((value): value is string => typeof value === 'string') : []);
  if (record.entrypoint === 'unknown') values.add('entrypoint');
  if (record.project_code === null) values.add('project_code');
  if (record.judgment.status === 'unknown') values.add('judgment.status');
  if (!record.judgment.summary) values.add('judgment.summary');
  if (!record.judgment.reason) values.add('judgment.reason');
  if (record.judgment.selected_references === null) values.add('judgment.selected_references');
  if (record.judgment.alternatives === null) values.add('judgment.alternatives');
  if (record.execution.status === 'unknown') values.add('execution.status');
  if (!record.execution.result_summary) values.add('execution.result_summary');
  if (record.execution.outcome_status === 'unknown') values.add('execution.outcome_status');
  return [...values].sort();
}

function normalizeRecord(
  adoption: JsonObject,
  sessionRef: string,
  fileName: string,
  configuredEntrypoint: JudgmentHistoryEntrypoint
): JudgmentHistoryRecord | null {
  const request = isObject(adoption.request) ? adoption.request : null;
  const context = request && isObject(request.conversation_context) ? request.conversation_context : null;
  const receipt = isObject(adoption.receipt) ? adoption.receipt : null;
  if (!request || !context || !receipt) return null;
  const requestText = text(request.request);
  const turnId = text(request.turn_id);
  const resolutionId = safeId(receipt.resolution_id);
  const requestDigest = text(adoption.request_text_digest);
  if (!requestText || !turnId || !resolutionId || !requestDigest || requestDigest !== sha256(requestText)) return null;
  if (text(context.session_ref) !== sessionRef) return null;
  const receiptDigest = text(adoption.receipt_digest);
  if (adoption.schema_version === 'brainbase-judgment-adoption-v2') {
    if (!receiptDigest || receiptDigest !== sha256(canonicalJson(receipt))) return null;
  }
  const recordedAt = parseIso(receipt.resolved_at) ?? parseIso(adoption.accepted_at);
  if (!recordedAt) return null;
  const explicitEntrypoint = entrypoint(
    adoption.entrypoint ?? receipt.entrypoint ?? request.entrypoint ?? context.entrypoint,
    configuredEntrypoint
  );
  const projectCode = stringOrNull(receipt.project_code ?? request.project_code);
  const publicJudgment = publicBlock(
    adoption.public_judgment,
    adoption.judgment,
    receipt.public_judgment,
    receipt.judgment,
    adoption.normal_judgment
  );
  const ownerAudit = isObject(adoption.owner_audit) ? adoption.owner_audit : null;
  const summary = stringOrNull(field(publicJudgment, 'summary', 'decision_summary', 'display_summary'))
    ?? stringOrNull(ownerAudit?.decision);
  const reasonValue = field(publicJudgment, 'reason', 'decision_reason', 'why');
  const reason = stringOrNull(reasonValue)
    ?? (Array.isArray(receipt.reconciliation_reasons)
      ? receipt.reconciliation_reasons.filter((value): value is string => typeof value === 'string').join(' / ') || null
      : null);
  const selectedReferencesValue = field(publicJudgment, 'selected_references', 'selectedReferences');
  const alternativesValue = field(publicJudgment, 'alternatives', 'options');
  const selectedReferences = selectedReferencesValue === undefined
    ? null
    : normalizeReferences(selectedReferencesValue);
  const alternatives = alternativesValue === undefined ? null : normalizeAlternatives(alternativesValue);
  const judgmentStatusValue = text(field(publicJudgment, 'status')) ?? text(receipt.status);
  const judgmentStatus = judgmentStatusValue === 'resolved' || judgmentStatusValue === 'needs_clarification'
    ? judgmentStatusValue
    : 'unknown';
  const executionValue = publicBlock(
    adoption.execution,
    receipt.execution,
    adoption.public_execution,
    receipt.public_execution
  );
  const judgment: JudgmentHistoryJudgment = {
    status: judgmentStatus,
    summary,
    reason,
    selected_references: selectedReferences,
    alternatives
  };
  const execution = normalizeExecution(executionValue);
  const baseRecord: Omit<JudgmentHistoryRecord, 'missing_fields'> = {
    schema_version: JUDGMENT_HISTORY_RECORD_SCHEMA,
    record_id: resolutionId,
    entrypoint: explicitEntrypoint,
    recorded_at: recordedAt,
    project_code: projectCode,
    turn_ref: `${sessionRef}/${sha256(turnId)}`,
    judgment,
    execution
  };
  const explicitMissing = field(publicJudgment, 'missing_fields') ?? adoption.missing_fields;
  void fileName;
  return { ...baseRecord, missing_fields: missingFields(baseRecord, explicitMissing) };
}

interface JournalGroup {
  readonly sessionRef: string;
  readonly key: string;
  adoption?: JsonObject;
  episode?: JsonObject;
  final?: JsonObject;
  turnInput?: JsonObject;
  events: JsonObject[];
  invalid: number;
  eventDirectorySeen: boolean;
}

interface BoundedJsonResult {
  readonly value: JsonObject | null;
  readonly missing: boolean;
  readonly invalid: boolean;
}

function withoutDigest(value: JsonObject, digestKey: string): JsonObject {
  const projection = { ...value };
  delete projection[digestKey];
  return projection;
}

function verifyArtifactDigest(value: JsonObject, digestKey: string): boolean {
  const digest = text(value[digestKey]);
  return !digest || digest === sha256(canonicalJson(withoutDigest(value, digestKey)));
}

async function readBoundedJson(path: string, maxBytes: number): Promise<BoundedJsonResult> {
  let fileStats;
  try {
    fileStats = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { value: null, missing: true, invalid: false };
    return { value: null, missing: false, invalid: true };
  }
  if (fileStats.isSymbolicLink() || !fileStats.isFile() || fileStats.size > maxBytes) {
    return { value: null, missing: false, invalid: true };
  }
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return isObject(parsed)
      ? { value: parsed, missing: false, invalid: false }
      : { value: null, missing: false, invalid: true };
  } catch {
    return { value: null, missing: false, invalid: true };
  }
}

function normalizeStoredFeedback(value: JsonObject, recordPathKey: string, eventPathKey: string): StoredFeedbackEvent | null {
  if (value.schema_version !== JUDGMENT_HISTORY_FEEDBACK_SCHEMA) return null;
  if (!verifyArtifactDigest(value, 'feedback_digest')) return null;
  const event = normalizeFeedbackEvent(value);
  if (!event || feedbackPathKey(event.record_id) !== recordPathKey || feedbackPathKey(event.event_id) !== eventPathKey) return null;
  const recordedAt = parseIso(value.recorded_at);
  if (!recordedAt) return null;
  return { ...event, recorded_at: recordedAt };
}

async function readLocalFeedback(
  root: string,
  records: readonly JudgmentHistoryRecord[],
  maxRecordBytes: number,
  consume: () => boolean
): Promise<LocalFeedbackReadResult> {
  const byRecordPath = new Map(records.map((record) => [feedbackPathKey(record.record_id), record.record_id]));
  const events = new Map<string, Map<string, StoredFeedbackEvent>>();
  const feedbackRoot = join(root, FEEDBACK_DIR);
  let feedbackStats;
  try {
    feedbackStats = await lstat(feedbackRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { events: new Map(), invalidCount: 0 };
    return { events: new Map(), invalidCount: 1 };
  }
  if (feedbackStats.isSymbolicLink() || !feedbackStats.isDirectory()) return { events: new Map(), invalidCount: 1 };
  let recordEntries;
  try {
    recordEntries = await readdir(feedbackRoot, { withFileTypes: true });
  } catch {
    return { events: new Map(), invalidCount: 1 };
  }
  let invalidCount = 0;
  outer: for (const recordEntry of recordEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!FEEDBACK_RECORD_DIR.test(recordEntry.name)) continue;
    const recordId = byRecordPath.get(recordEntry.name);
    if (!recordId || recordEntry.isSymbolicLink() || !recordEntry.isDirectory()) {
      invalidCount += 1;
      continue;
    }
    let eventEntries;
    try {
      eventEntries = await readdir(join(feedbackRoot, recordEntry.name), { withFileTypes: true });
    } catch {
      invalidCount += 1;
      continue;
    }
    for (const eventEntry of eventEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      const eventMatch = FEEDBACK_FILE.exec(eventEntry.name);
      if (!eventMatch) continue;
      if (consume()) break outer;
      if (eventEntry.isSymbolicLink() || !eventEntry.isFile()) {
        invalidCount += 1;
        continue;
      }
      const result = await readBoundedJson(join(feedbackRoot, recordEntry.name, eventEntry.name), maxRecordBytes);
      const event = result.value && normalizeStoredFeedback(result.value, recordEntry.name, eventMatch[1]);
      if (result.invalid || !event) {
        invalidCount += 1;
        continue;
      }
      const recordEvents = events.get(recordId) ?? new Map<string, StoredFeedbackEvent>();
      if (recordEvents.has(event.event_id)) {
        invalidCount += 1;
        continue;
      }
      recordEvents.set(event.event_id, event);
      events.set(recordId, recordEvents);
    }
  }
  const publicEvents = new Map<string, readonly JudgmentHistoryFeedbackEvent[]>();
  for (const [recordId, recordEvents] of events) {
    const ordered = [...recordEvents.values()]
      .sort((left, right) => left.event_id.localeCompare(right.event_id))
      .map(({ record_id, event_id, kind, content }) => ({ record_id, event_id, kind, content }));
    publicEvents.set(recordId, ordered);
  }
  return { events: publicEvents, invalidCount };
}

function groupFor(groups: Map<string, JournalGroup>, sessionRef: string, key: string): JournalGroup {
  const groupKey = `${sessionRef}\u0000${key}`;
  const existing = groups.get(groupKey);
  if (existing) return existing;
  const group: JournalGroup = { sessionRef, key, events: [], invalid: 0, eventDirectorySeen: false };
  groups.set(groupKey, group);
  return group;
}

function sourceBlocks(value: JsonObject | undefined): JsonObject[] {
  if (!value) return [];
  const blocks: JsonObject[] = [];
  for (const key of ['public_judgment', 'judgment', 'public_selection', 'selection', 'evaluation']) {
    if (isObject(value[key])) blocks.push(value[key] as JsonObject);
  }
  // Some writers put the public fields directly on the final/event envelope.
  if (['summary', 'reason', 'selected_references', 'selectedReferences', 'alternatives', 'status'].some((key) => key in value)) {
    blocks.push(value);
  }
  return blocks;
}

function executionBlocks(value: JsonObject | undefined): JsonObject[] {
  if (!value) return [];
  const blocks: JsonObject[] = [];
  for (const key of ['execution', 'public_execution']) {
    if (isObject(value[key])) blocks.push(value[key] as JsonObject);
  }
  if (['result_summary', 'resultSummary', 'outcome_status', 'outcomeStatus'].some((key) => key in value)) blocks.push(value);
  return blocks;
}

function firstPresent(blocks: readonly JsonObject[], ...names: string[]): unknown {
  for (const block of blocks) {
    for (const name of names) {
      if (name in block) return block[name];
    }
  }
  return undefined;
}

function normalizeStatus(value: unknown): JudgmentHistoryJudgment['status'] {
  const candidate = text(value);
  return candidate === 'resolved' || candidate === 'needs_clarification' ? candidate : 'unknown';
}

function mergeJudgment(
  fallback: JudgmentHistoryJudgment,
  blocks: readonly JsonObject[],
  explicitMissing: unknown
): JudgmentHistoryJudgment {
  const statusValue = firstPresent(blocks, 'status');
  const summaryValue = firstPresent(blocks, 'summary', 'decision_summary', 'display_summary');
  const reasonValue = firstPresent(blocks, 'reason', 'decision_reason', 'why');
  const referencesValue = firstPresent(blocks, 'selected_references', 'selectedReferences', 'references');
  const alternativesValue = firstPresent(blocks, 'alternatives', 'options');
  return {
    status: statusValue === undefined ? fallback.status : normalizeStatus(statusValue),
    summary: summaryValue === undefined ? fallback.summary : stringOrNull(summaryValue),
    reason: reasonValue === undefined ? fallback.reason : stringOrNull(reasonValue),
    selected_references: referencesValue === undefined ? fallback.selected_references : normalizeReferences(referencesValue),
    alternatives: alternativesValue === undefined ? fallback.alternatives : normalizeAlternatives(alternativesValue)
  };
}

function mergeExecution(
  fallback: JudgmentHistoryExecution,
  blocks: readonly JsonObject[],
  completed: boolean
): JudgmentHistoryExecution {
  const statusValue = firstPresent(blocks, 'status');
  const resultValue = firstPresent(blocks, 'result_summary', 'resultSummary');
  const outcomeValue = firstPresent(blocks, 'outcome_status', 'outcomeStatus');
  const projected = normalizeExecution({
    ...(statusValue === undefined ? {} : { status: statusValue }),
    ...(resultValue === undefined ? {} : { result_summary: resultValue }),
    ...(outcomeValue === undefined ? {} : { outcome_status: outcomeValue })
  });
  const status = statusValue === undefined
    ? (completed && fallback.status === 'unknown' ? 'completed' : fallback.status)
    : projected.status;
  return {
    status,
    result_summary: resultValue === undefined ? fallback.result_summary : projected.result_summary,
    outcome_status: outcomeValue === undefined ? fallback.outcome_status : projected.outcome_status
  };
}

function finalTurnId(final: JsonObject, key: string): string | null {
  return text(final.turn_id) ?? safeId(key);
}

function finalRecordId(final: JsonObject, sessionRef: string, turnId: string): string {
  return safeId(final.record_id ?? final.resolution_id ?? final.decision_id ?? final.final_digest)
    ?? sha256(`${sessionRef}/${turnId}`);
}

function normalizeFinalRecord(
  final: JsonObject,
  sessionRef: string,
  key: string,
  configuredEntrypoint: JudgmentHistoryEntrypoint,
  turnInput: JsonObject | undefined,
  events: readonly JsonObject[]
): JudgmentHistoryRecord | null {
  if (!verifyArtifactDigest(final, 'final_digest')) return null;
  const finalSession = text(final.session_ref);
  if (finalSession && finalSession !== sessionRef) return null;
  const turnId = finalTurnId(final, key);
  const recordedAt = parseIso(final.finalized_at ?? final.recorded_at);
  if (!turnId || !recordedAt) return null;
  if (typeof final.event_count === 'number' && Number.isInteger(final.event_count) && final.event_count !== events.length) return null;
  if (text(final.event_set_digest) && text(final.event_set_digest) !== sha256(canonicalJson(events))) return null;
  const eventBlocks = events.flatMap((event) => sourceBlocks(event)).reverse();
  const blocks = [...sourceBlocks(final), ...eventBlocks];
  const explicitEntrypoint = entrypoint(
    final.entrypoint ?? final.source_entrypoint ?? turnInput?.entrypoint,
    configuredEntrypoint
  );
  const projectCode = stringOrNull(final.project_code ?? final.project ?? turnInput?.project_code);
  const judgment: JudgmentHistoryJudgment = {
    status: 'unknown',
    summary: null,
    reason: null,
    selected_references: null,
    alternatives: null
  };
  const execution: JudgmentHistoryExecution = { status: 'unknown', result_summary: null, outcome_status: 'unknown' };
  const completed = text(final.completion_status) === 'complete';
  const baseRecord: Omit<JudgmentHistoryRecord, 'missing_fields'> = {
    schema_version: JUDGMENT_HISTORY_RECORD_SCHEMA,
    record_id: finalRecordId(final, sessionRef, turnId),
    entrypoint: explicitEntrypoint,
    recorded_at: recordedAt,
    project_code: projectCode,
    turn_ref: `${sessionRef}/${sha256(turnId)}`,
    judgment: mergeJudgment(judgment, blocks, field(blocks[0] ?? null, 'missing_fields')),
    execution: mergeExecution(execution, [...executionBlocks(final), ...events.flatMap((event) => executionBlocks(event)).reverse()], completed)
  };
  return { ...baseRecord, missing_fields: missingFields(baseRecord, firstPresent(blocks, 'missing_fields')) };
}

function mergeRecordWithFinal(
  adoptionRecord: JudgmentHistoryRecord,
  final: JsonObject,
  turnInput: JsonObject | undefined,
  events: readonly JsonObject[]
): JudgmentHistoryRecord | null {
  const projected = normalizeFinalRecord(final, adoptionRecord.turn_ref.split('/').at(0) ?? '', adoptionRecord.turn_ref.split('/').at(1) ?? '', adoptionRecord.entrypoint, turnInput, events);
  if (!projected) return null;
  const blocks = [...sourceBlocks(final), ...events.flatMap((event) => sourceBlocks(event)).reverse()];
  const execution = mergeExecution(
    adoptionRecord.execution,
    [...executionBlocks(final), ...events.flatMap((event) => executionBlocks(event)).reverse()],
    text(final.completion_status) === 'complete'
  );
  const baseRecord: Omit<JudgmentHistoryRecord, 'missing_fields'> = {
    ...adoptionRecord,
    recorded_at: projected.recorded_at,
    project_code: adoptionRecord.project_code ?? projected.project_code,
    entrypoint: adoptionRecord.entrypoint === 'unknown' ? projected.entrypoint : adoptionRecord.entrypoint,
    judgment: mergeJudgment(adoptionRecord.judgment, blocks, undefined),
    execution
  };
  return { ...baseRecord, missing_fields: missingFields(baseRecord, firstPresent(blocks, 'missing_fields')) };
}

async function readLocalRecords(
  root: string,
  configuredEntrypoint: JudgmentHistoryEntrypoint,
  maxFiles: number,
  maxRecordBytes: number
): Promise<LocalSourceReadResult> {
  const sessions = await readdir(root, { withFileTypes: true });
  const groups = new Map<string, JournalGroup>();
  let invalidCount = 0;
  let candidateCount = 0;
  let capped = false;
  const stop = (): boolean => {
    if (candidateCount >= maxFiles) {
      capped = true;
      return true;
    }
    candidateCount += 1;
    return false;
  };
  outer: for (const session of sessions.sort((left, right) => left.name.localeCompare(right.name))) {
    if (session.isSymbolicLink()) {
      invalidCount += 1;
      continue;
    }
    if (!session.isDirectory() || !SAFE_ID.test(session.name)) continue;
    const sessionPath = join(root, session.name);
    let names;
    try {
      names = await readdir(sessionPath, { withFileTypes: true });
    } catch {
      invalidCount += 1;
      continue;
    }
    const groupMap = new Map<string, JournalGroup>();
    const recognized = names.map((entry) => {
      const name = entry.name;
      if (ADOPTION_FILE.test(name)) return { entry, kind: 'adoption' as const, key: name.slice(0, -5) };
      const finalMatch = FINAL_FILE.exec(name);
      if (finalMatch) return { entry, kind: 'final' as const, key: finalMatch[1] };
      const episodeMatch = /^(.+)\.episode\.json$/u.exec(name);
      if (episodeMatch) return { entry, kind: 'episode' as const, key: episodeMatch[1] };
      const inputMatch = /^(.+)\.turn-input\.json$/u.exec(name);
      if (inputMatch) return { entry, kind: 'turnInput' as const, key: inputMatch[1] };
      if (name.endsWith('.events')) return { entry, kind: 'events' as const, key: name.slice(0, -7) };
      return null;
    }).filter((candidate): candidate is { entry: typeof names[number]; kind: 'adoption' | 'final' | 'episode' | 'turnInput' | 'events'; key: string } => candidate !== null)
      .sort((left, right) => left.entry.name.localeCompare(right.entry.name));
    for (const candidate of recognized) {
      const key = safeId(candidate.key);
      if (!key) {
        invalidCount += 1;
        continue;
      }
      if (stop()) break outer;
      const group = groupMap.get(key) ?? groupFor(groups, session.name, key);
      groupMap.set(key, group);
      const path = join(sessionPath, candidate.entry.name);
      if (candidate.kind === 'events') {
        group.eventDirectorySeen = true;
        if (candidate.entry.isSymbolicLink() || !candidate.entry.isDirectory()) {
          group.invalid += 1;
          continue;
        }
        let eventEntries;
        try {
          eventEntries = await readdir(path, { withFileTypes: true });
        } catch {
          group.invalid += 1;
          continue;
        }
        for (const eventEntry of eventEntries.sort((left, right) => left.name.localeCompare(right.name))) {
          if (!eventEntry.name.endsWith('.json')) continue;
          if (stop()) break outer;
          const eventResult = await readBoundedJson(join(path, eventEntry.name), maxRecordBytes);
          if (eventResult.invalid || !eventResult.value || !verifyArtifactDigest(eventResult.value, 'event_digest')) {
            group.invalid += 1;
            continue;
          }
          group.events.push(eventResult.value);
        }
        continue;
      }
      const result = await readBoundedJson(path, maxRecordBytes);
      if (result.invalid || !result.value) {
        group.invalid += 1;
        continue;
      }
      if (candidate.kind === 'adoption') group.adoption = result.value;
      else if (candidate.kind === 'final') group.final = result.value;
      else if (candidate.kind === 'episode') group.episode = result.value;
      else group.turnInput = result.value;
    }
  }
  const records: JudgmentHistoryRecord[] = [];
  const seen = new Set<string>();
  for (const group of groups.values()) {
    let adoption = group.adoption;
    if (!adoption && group.episode && isObject(group.episode.adoption)) adoption = group.episode.adoption as JsonObject;
    let record: JudgmentHistoryRecord | null = null;
    if (adoption) {
      record = normalizeRecord(adoption, group.sessionRef, `${group.key}.json`, configuredEntrypoint);
      if (!record) group.invalid += 1;
    }
    if (group.final) {
      const finalRecord = record
        ? mergeRecordWithFinal(record, group.final, group.turnInput, group.events)
        : normalizeFinalRecord(group.final, group.sessionRef, group.key, configuredEntrypoint, group.turnInput, group.events);
      record = finalRecord ?? record;
      if (!finalRecord) group.invalid += 1;
    }
    if (!record) {
      if (group.invalid === 0 && (adoption || group.final || group.episode || group.turnInput || group.events.length > 0)) group.invalid += 1;
      invalidCount += group.invalid;
      continue;
    }
    invalidCount += group.invalid;
    if (seen.has(record.record_id)) {
      invalidCount += 1;
      continue;
    }
    seen.add(record.record_id);
    records.push(record);
  }
  if (!capped) {
    const feedback = await readLocalFeedback(root, records, maxRecordBytes, stop);
    invalidCount += feedback.invalidCount;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const events = feedback.events.get(record.record_id);
      if (events && events.length > 0) records[index] = { ...record, feedback_events: events };
    }
  }
  records.sort(compareRecords);
  const contentDigest = sha256(canonicalJson({ records, candidateCount, invalidCount, capped }));
  return { records, invalidCount, candidateCount, capped, contentDigest };
}

function compareRecords(left: JudgmentHistoryRecord, right: JudgmentHistoryRecord): number {
  const dateOrder = right.recorded_at.localeCompare(left.recorded_at);
  return dateOrder || right.record_id.localeCompare(left.record_id);
}

function sourceSnapshotId(value: unknown): string {
  return sha256(canonicalJson(value));
}

function unavailableCoverage(storage: JudgmentHistoryStorage, reason: string): JudgmentHistoryCoverage {
  return {
    complete: false,
    storage,
    reason,
    sources: [{ entrypoint: 'unknown', status: 'unavailable', reason }],
    total: null
  };
}

/** Reads only the configured local owner journal; it never searches or uploads another journal. */
export function createLocalJudgmentHistorySource(options: LocalJudgmentHistorySourceOptions): JudgmentHistorySource {
  if (typeof options.root !== 'string' || !options.root.trim()) throw new TypeError('root is required');
  const configuredEntrypoint = options.entrypoint ?? 'unknown';
  if (!(JUDGMENT_HISTORY_ENTRYPOINTS as readonly string[]).includes(configuredEntrypoint)) {
    throw new TypeError('entrypoint is invalid');
  }
  const maxFiles = options.max_files ?? DEFAULT_LOCAL_JUDGMENT_HISTORY_SCAN_CAP;
  const maxRecordBytes = options.max_record_bytes ?? DEFAULT_LOCAL_JUDGMENT_HISTORY_RECORD_BYTES;
  if (!Number.isInteger(maxFiles) || maxFiles < 1) throw new TypeError('max_files must be a positive integer');
  if (!Number.isInteger(maxRecordBytes) || maxRecordBytes < 1) throw new TypeError('max_record_bytes must be a positive integer');
  const root = resolve(options.root);
  return {
    storage: 'local',
    async read(): Promise<JudgmentHistorySourceSnapshot> {
      try {
        const rootStats = await lstat(root);
        if (rootStats.isSymbolicLink()) {
          return { status: 'unavailable', records: null, coverage: unavailableCoverage('local', 'journal_symlink_rejected') };
        }
        if (!rootStats.isDirectory()) return { status: 'unavailable', records: null, coverage: unavailableCoverage('local', 'journal_not_directory') };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return { status: 'unavailable', records: null, coverage: unavailableCoverage('local', 'journal_unavailable') };
        }
        return { status: 'unavailable', records: null, coverage: unavailableCoverage('local', 'journal_unreadable') };
      }
      let result: LocalSourceReadResult;
      try {
        result = await readLocalRecords(root, configuredEntrypoint, maxFiles, maxRecordBytes);
      } catch {
        return { status: 'unavailable', records: null, coverage: unavailableCoverage('local', 'journal_unreadable') };
      }
      const status: JudgmentHistoryStatus = result.invalidCount > 0 || result.capped ? 'partial' : 'available';
      const reason = result.capped ? 'journal_scan_capped' : result.invalidCount > 0 ? 'some_journal_records_unreadable' : null;
      const entrypoints = [...new Set(result.records.map((record) => record.entrypoint))];
      const sources = (entrypoints.length > 0 ? entrypoints : [configuredEntrypoint]).map((sourceEntrypoint) => ({
        entrypoint: sourceEntrypoint,
        status,
        reason
      }));
      const coverage: JudgmentHistoryCoverage = {
        complete: status === 'available',
        storage: 'local',
        reason,
        sources,
        total: status === 'available' ? result.records.length : null
      };
      return {
        status,
        records: result.records,
        coverage,
        snapshot_id: sourceSnapshotId({
          status,
          records: result.records,
          coverage,
          candidate_count: result.candidateCount,
          invalid_count: result.invalidCount,
          capped: result.capped,
          content_digest: result.contentDigest
        })
      };
    }
  };
}

function feedbackPayload(event: JudgmentHistoryFeedbackEvent, recordedAt: string): JsonObject {
  const withoutDigest: JsonObject = {
    schema_version: JUDGMENT_HISTORY_FEEDBACK_SCHEMA,
    record_id: event.record_id,
    event_id: event.event_id,
    kind: event.kind,
    content: event.content,
    recorded_at: recordedAt
  };
  return { ...withoutDigest, feedback_digest: sha256(canonicalJson(withoutDigest)) };
}

function sameFeedbackEvent(left: JudgmentHistoryFeedbackEvent, right: JudgmentHistoryFeedbackEvent): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function requireDirectory(path: string, code: string): Promise<void> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new JudgmentHistoryFeedbackError(503, code, 'Feedback storage is unavailable');
    }
    await mkdir(path, { recursive: true });
    stats = await lstat(path);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new JudgmentHistoryFeedbackError(503, code, 'Feedback storage is unavailable');
  }
}

/**
 * Append-only local feedback writer for normal judgment records. It writes a
 * separate immutable event file below the configured journal and always
 * confirms the event through the same reader before returning success.
 */
export function createLocalJudgmentHistoryFeedbackWriter(
  options: LocalJudgmentHistoryFeedbackWriterOptions
): JudgmentHistoryFeedbackWriter {
  if (!options || typeof options.root !== 'string' || !options.root.trim()) throw new TypeError('root is required');
  if (!options.reader || typeof options.reader.detail !== 'function') throw new TypeError('reader is required');
  const root = resolve(options.root);
  const now = options.now ?? (() => new Date());
  return async (input: unknown): Promise<JudgmentHistoryFeedbackWriteResult> => {
    const event = normalizeFeedbackInput(input);
    const before = await options.reader.detail(event.record_id);
    if (before.status === 'unavailable' || !before.record) {
      if (before.status === 'unavailable') {
        throw new JudgmentHistoryFeedbackError(503, 'judgment_history_unavailable', 'The source record is unavailable');
      }
      throw new JudgmentHistoryFeedbackError(404, 'judgment_history_not_found', 'No judgment history record matches this id');
    }
    const existingBefore = before.record.feedback_events?.find((candidate) => candidate.event_id === event.event_id);
    if (existingBefore) {
      if (!sameFeedbackEvent(existingBefore, event)) throw new JudgmentHistoryFeedbackConflictError(existingBefore);
      return { event: existingBefore, created: false, status: 'already_saved' };
    }

    let rootStats;
    try {
      rootStats = await lstat(root);
    } catch {
      throw new JudgmentHistoryFeedbackError(503, 'feedback_storage_unavailable', 'Feedback storage is unavailable');
    }
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      throw new JudgmentHistoryFeedbackError(503, 'feedback_storage_unavailable', 'Feedback storage is unavailable');
    }
    const feedbackRoot = join(root, FEEDBACK_DIR);
    await requireDirectory(feedbackRoot, 'feedback_storage_unavailable');
    const recordDirectory = join(feedbackRoot, feedbackPathKey(event.record_id));
    await requireDirectory(recordDirectory, 'feedback_storage_unavailable');
    const eventPath = join(recordDirectory, `${feedbackPathKey(event.event_id)}.json`);
    const recordedAtDate = now();
    if (!(recordedAtDate instanceof Date) || !Number.isFinite(recordedAtDate.getTime())) {
      throw new JudgmentHistoryFeedbackError(500, 'feedback_clock_invalid', 'Feedback clock is invalid');
    }
    const recordedAt = recordedAtDate.toISOString();
    const payload = feedbackPayload(event, recordedAt);
    let created = false;
    try {
      await writeFile(eventPath, `${canonicalJson(payload)}\n`, { encoding: 'utf8', flag: 'wx' });
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new JudgmentHistoryFeedbackError(503, 'feedback_storage_unavailable', 'Feedback storage is unavailable');
      }
      const existingResult = await readBoundedJson(eventPath, DEFAULT_LOCAL_JUDGMENT_HISTORY_RECORD_BYTES);
      const existing = existingResult.value
        ? normalizeStoredFeedback(existingResult.value, feedbackPathKey(event.record_id), feedbackPathKey(event.event_id))
        : null;
      if (!existing) throw new JudgmentHistoryFeedbackError(409, 'feedback_conflict', 'The event_id is already occupied by an invalid event');
      if (!sameFeedbackEvent(existing, event)) throw new JudgmentHistoryFeedbackConflictError(existing);
    }

    const after = await options.reader.detail(event.record_id);
    if (after.status === 'unavailable' || !after.record) {
      throw new JudgmentHistoryFeedbackError(503, 'feedback_readback_missing', 'Feedback was not readable from the canonical source');
    }
    const readBack = after.record.feedback_events?.find((candidate) => candidate.event_id === event.event_id);
    if (!readBack) throw new JudgmentHistoryFeedbackError(500, 'feedback_readback_missing', 'Feedback was not readable from the canonical source');
    if (!sameFeedbackEvent(readBack, event)) throw new JudgmentHistoryFeedbackConflictError(readBack);
    return { event: readBack, created, status: created ? 'saved' : 'already_saved' };
  };
}

export async function appendLocalJudgmentHistoryFeedback(
  options: LocalJudgmentHistoryFeedbackWriterOptions & { readonly input: unknown }
): Promise<JudgmentHistoryFeedbackWriteResult> {
  return createLocalJudgmentHistoryFeedbackWriter(options)(options.input);
}

function startOfJstDay(date: Date): Date {
  const shifted = new Date(date.getTime() + JST_OFFSET_MS);
  const utc = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
  return new Date(utc.getTime() - JST_OFFSET_MS);
}

function periodStart(period: JudgmentHistoryPeriod, now: Date): Date | null {
  if (period === 'all') return null;
  const day = startOfJstDay(now);
  if (period === 'past30days') return new Date(day.getTime() - 29 * 24 * 60 * 60 * 1000);
  const shifted = new Date(day.getTime() + JST_OFFSET_MS);
  const weekday = shifted.getUTCDay();
  const daysFromMonday = (weekday + 6) % 7;
  return new Date(day.getTime() - daysFromMonday * 24 * 60 * 60 * 1000);
}

type NormalizedJudgmentHistoryQuery = {
  readonly period: JudgmentHistoryPeriod;
  readonly project: string | null;
  readonly entrypoint: JudgmentHistoryEntrypoint | null;
  readonly cursor: string | null;
  readonly limit: number;
};

function normalizeQuery(query: JudgmentHistoryQuery | undefined): NormalizedJudgmentHistoryQuery {
  const period = query?.period ?? 'all';
  const project = query?.project ?? null;
  const selectedEntrypoint = query?.entrypoint ?? null;
  const limit = query?.limit ?? DEFAULT_LIMIT;
  if (period !== 'week' && period !== 'past30days' && period !== 'all') throw new JudgmentHistoryReaderError(400, 'invalid_period', 'period is invalid');
  if (project !== null && (!text(project) || project.length > 256 || /[\u0000-\u001f\u007f/\\]/u.test(project))) {
    throw new JudgmentHistoryReaderError(400, 'invalid_project', 'project is invalid');
  }
  if (selectedEntrypoint !== null && !(JUDGMENT_HISTORY_ENTRYPOINTS as readonly string[]).includes(selectedEntrypoint)) {
    throw new JudgmentHistoryReaderError(400, 'invalid_entrypoint', 'entrypoint is invalid');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new JudgmentHistoryReaderError(400, 'invalid_limit', 'limit must be between 1 and 100');
  return { period, project, entrypoint: selectedEntrypoint, cursor: query?.cursor ?? null, limit };
}

function filterKey(query: ReturnType<typeof normalizeQuery>): string {
  return canonicalJson({ period: query.period, project: query.project, entrypoint: query.entrypoint });
}

function encodeCursor(value: { filter: string; snapshot: string; offset: number }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(value: string, filter: string, snapshot: string): number {
  if (typeof value !== 'string' || value.length > 2048) throw new JudgmentHistoryReaderError(400, 'invalid_cursor', 'cursor is invalid');
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!isObject(decoded) || decoded.filter !== filter || decoded.snapshot !== snapshot || !Number.isInteger(decoded.offset) || (decoded.offset as number) < 0) {
      throw new Error('cursor binding mismatch');
    }
    return decoded.offset as number;
  } catch (error) {
    if (error instanceof JudgmentHistoryReaderError) throw error;
    throw new JudgmentHistoryReaderError(400, 'invalid_cursor', 'cursor is invalid or stale');
  }
}

function buildSourceSnapshot(snapshot: JudgmentHistorySourceSnapshot): Required<Pick<JudgmentHistorySourceSnapshot, 'status' | 'records' | 'coverage' | 'snapshot_id'>> {
  const records = snapshot.records;
  return {
    status: snapshot.status,
    records,
    coverage: snapshot.coverage,
    snapshot_id: snapshot.snapshot_id ?? sourceSnapshotId({ status: snapshot.status, records, coverage: snapshot.coverage })
  };
}

/** Reader shared by local, organization, Mana, and Company OS adapters. */
export function createJudgmentHistoryReader(options: JudgmentHistoryReaderOptions): JudgmentHistoryReader {
  if (!options?.source || typeof options.source.read !== 'function') throw new TypeError('source is required');
  const now = options.now ?? (() => new Date());
  return {
    async home(inputQuery = {}): Promise<JudgmentHistoryHome> {
      const query = normalizeQuery(inputQuery);
      if (query.project !== null && options.authorizeProject && !(await options.authorizeProject(query.project))) {
        throw new JudgmentHistoryReaderError(403, 'project_scope_forbidden', 'project is outside the trusted scope');
      }
      const source = buildSourceSnapshot(await options.source.read());
      const records = source.records;
      const filters: JudgmentHistoryFilters = { period: query.period, project: query.project, entrypoint: query.entrypoint };
      const base: JudgmentHistoryHome = {
        contract_version: JUDGMENT_HISTORY_CONTRACT_VERSION,
        status: source.status,
        records: null,
        coverage: { ...source.coverage, total: null },
        pagination: { cursor: query.cursor, next_cursor: null, limit: query.limit, has_more: false },
        filters
      };
      if (source.status === 'unavailable' || records === null) return base;
      const start = periodStart(query.period, now());
      const filtered = records.filter((record) => {
        if (query.project !== null && record.project_code !== query.project) return false;
        if (query.entrypoint !== null && record.entrypoint !== query.entrypoint) return false;
        if (start && Date.parse(record.recorded_at) < start.getTime()) return false;
        return true;
      });
      const filter = filterKey(query);
      const offset = query.cursor ? decodeCursor(query.cursor, filter, source.snapshot_id) : 0;
      const page = filtered.slice(offset, offset + query.limit);
      const hasMore = offset + page.length < filtered.length;
      const nextCursor = hasMore ? encodeCursor({ filter, snapshot: source.snapshot_id, offset: offset + page.length }) : null;
      const coverage: JudgmentHistoryCoverage = {
        ...source.coverage,
        total: source.coverage.complete ? filtered.length : null
      };
      return {
        ...base,
        records: page,
        coverage,
        pagination: { cursor: query.cursor, next_cursor: nextCursor, limit: query.limit, has_more: hasMore }
      };
    },
    async detail(recordId: string): Promise<JudgmentHistoryDetail> {
      const safeRecordId = safeId(recordId);
      if (!safeRecordId) throw new JudgmentHistoryReaderError(400, 'invalid_record_id', 'record_id is invalid');
      const source = buildSourceSnapshot(await options.source.read());
      if (source.status === 'unavailable' || source.records === null) {
        return {
          contract_version: JUDGMENT_HISTORY_CONTRACT_VERSION,
          status: source.status,
          record: null,
          coverage: source.coverage
        };
      }
      return {
        contract_version: JUDGMENT_HISTORY_CONTRACT_VERSION,
        status: source.status,
        record: source.records.find((record) => record.record_id === safeRecordId) ?? null,
        coverage: { ...source.coverage, total: source.coverage.complete ? source.records.length : null }
      };
    }
  };
}
