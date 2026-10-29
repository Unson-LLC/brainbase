import { createHash } from 'node:crypto';
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  checkJudgmentPublicFrame,
  judgmentFramePublicFrameDigest,
  containsJudgmentFrameCredential,
  publicFrameTextHasControlCharacters,
  MAX_PUBLIC_FRAME_TEXT,
  type JudgmentFramePublicFrame
} from './judgment-frame.js';
import { canonicalJson, type JudgmentHistoryEntrypoint } from './judgment-history.js';

/**
 * RQ-119 Story S1: the common emission port that turns a Worker turn into the
 * shared judgment receipt contract, derives its idempotency keys, and writes it
 * to a local outbox before any delivery. Delivery is an injected transport; the
 * OSS default is local-only (nothing is sent). Tool-specific adapters (S2/S3),
 * the organization transport and receiving endpoint (S4), and retry/visibility
 * (S5) are intentionally out of this module.
 */
export const WORKER_JUDGMENT_RECEIPT_SCHEMA = 'brainbase-worker-judgment-receipt-v1' as const;
export const WORKER_JUDGMENT_OUTBOX_SCHEMA = 'brainbase-worker-judgment-outbox-v1' as const;
export const WORKER_JUDGMENT_SKIP_SCHEMA = 'brainbase-worker-judgment-skip-v1' as const;

/** Only Worker tools emit through this port. `opencode` is the shared enum value for DeepSeek via opencode. */
export const WORKER_JUDGMENT_ENTRYPOINTS = Object.freeze(['claude_code', 'opencode'] as const);
export type WorkerJudgmentEntrypoint = typeof WORKER_JUDGMENT_ENTRYPOINTS[number];

/** Delivery states shared with §7. S1 only ever writes `pending` locally; a transport may advance it. */
export type WorkerJudgmentDeliveryStatus = 'pending' | 'saved' | 'already_saved' | 'blocked_credential' | 'failed';

/** Reason codes left in the outbox when a turn is deliberately not sent. The judgment body is never stored. */
export type WorkerJudgmentSkipReason =
  | 'worker_public_frame_absent'
  | 'frame_public_invalid'
  | 'worker_meta_invalid'
  | 'worker_project_code_invalid'
  | 'worker_resolved_at_missing'
  | 'worker_resolved_at_invalid'
  | 'worker_resolved_at_before_boundary';

/** Execution metadata kept beside a judgment. The real model name lives here, never in the entrypoint. */
export interface WorkerJudgmentMeta {
  /** Real model name, e.g. `deepseek/deepseek-flash`. Never a secret value. */
  readonly model?: string;
  /** The acting agent member id (agent subject), kept as metadata only. */
  readonly agent_member_id?: string;
}

export interface WorkerJudgmentInput {
  readonly entrypoint: WorkerJudgmentEntrypoint;
  readonly session_id: string;
  readonly turn_id: string;
  /** ISO time the judgment was resolved. The §8 boundary is decided by this, not by delivery time. */
  readonly resolved_at: string;
  readonly project_code?: string | null;
  /** The explicitly recorded public frame. Absent/empty means the turn is not sent. */
  readonly public_frame?: unknown;
  readonly meta?: WorkerJudgmentMeta;
}

/** The deterministic receipt shape shared with the organization `judgment_receipts` projection (§4.3). */
export interface WorkerJudgmentReceipt {
  readonly schema_version: typeof WORKER_JUDGMENT_RECEIPT_SCHEMA;
  readonly resolution_id: string;
  readonly entrypoint: WorkerJudgmentEntrypoint;
  readonly turn_ref: string;
  readonly project_code: string | null;
  readonly resolved_at: string;
  readonly public_frame: JudgmentFramePublicFrame;
  readonly content_digest: `sha256:${string}`;
  readonly meta: { readonly model: string | null; readonly agent_member_id: string | null };
  /** sha256 of the canonical JSON of every field above; the §6 conflict check compares this. */
  readonly receipt_digest: string;
}

export type WorkerJudgmentBuild =
  | { readonly outcome: 'receipt'; readonly receipt: WorkerJudgmentReceipt }
  | { readonly outcome: 'skipped'; readonly reason_code: WorkerJudgmentSkipReason; readonly detail: string };

/**
 * A delivery transport. The OSS build injects none, so judgments stay local.
 * The organization build injects one that records to `judgment_receipts` (S4).
 */
export interface WorkerJudgmentTransport {
  send(receipt: WorkerJudgmentReceipt): Promise<WorkerJudgmentTransportResult> | WorkerJudgmentTransportResult;
}

export type WorkerJudgmentTransportResult =
  | { readonly status: 'saved' | 'already_saved' }
  | { readonly status: 'blocked_credential' | 'failed'; readonly reason_code: string };

export interface WorkerJudgmentEmitterOptions {
  /** Worker journal root. Receipts live under `<sha256(session)>/<sha256(turn)>/`. */
  readonly journalRoot: string;
  /** ISO activation boundary; judgments resolved before it are not sent (§8, no backfill). */
  readonly effectiveAfter: string;
  /** Injected delivery port. Omitted in OSS; the receipt is only written locally. */
  readonly transport?: WorkerJudgmentTransport;
  readonly now?: () => Date;
  /** How far ahead of `now` a `resolved_at` may be before it is rejected as invalid. */
  readonly maxFutureSkewMs?: number;
}

export type WorkerJudgmentEmission =
  | {
      readonly outcome: 'emitted';
      readonly status: WorkerJudgmentDeliveryStatus;
      readonly receipt: WorkerJudgmentReceipt;
      readonly path: string;
      /** True when an identical receipt was already on disk (idempotent re-emit). */
      readonly deduped: boolean;
      readonly last_error_code?: string;
    }
  | { readonly outcome: 'skipped'; readonly reason_code: WorkerJudgmentSkipReason; readonly path: string };

export class WorkerJudgmentEmitterError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'WorkerJudgmentEmitterError';
    this.code = code;
  }
}

/** Raised when the same resolution id is already stored with a different receipt (§6 conflict). We never overwrite. */
export class WorkerJudgmentConflictError extends WorkerJudgmentEmitterError {
  readonly resolution_id: string;
  constructor(resolutionId: string) {
    super('worker_judgment_receipt_conflict', `A different receipt is already stored for resolution ${resolutionId}`);
    this.name = 'WorkerJudgmentConflictError';
    this.resolution_id = resolutionId;
  }
}

const MAX_META_TEXT = 200;
const DEFAULT_MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Accept only an explicit calendar date-time that carries a timezone (`Z` or a
 * numeric offset). A zone-less value like `2026-10-01T00:00:00` would otherwise
 * be read in the host timezone, so the §8 boundary and the receipt_digest would
 * differ between a UTC runner and an Asia/Tokyo laptop. Calendar fields are
 * checked against a UTC round-trip so a rolled-over date (`2026-02-30`,
 * hour `25`) is rejected rather than silently carried forward. The accepted
 * value is returned normalized to a UTC ISO string; it is never rewritten
 * beyond that canonicalization.
 */
const ISO_DATETIME_WITH_TZ = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function normalizeIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = ISO_DATETIME_WITH_TZ.exec(trimmed);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day
    || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) {
    return null;
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WorkerJudgmentEmitterError('worker_judgment_input_invalid', `${field} is required`);
  }
  return value;
}

/** `null` = not provided; a string = accepted; `undefined` = provided but unusable (rejected). */
function normalizeMetaField(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_META_TEXT
    || publicFrameTextHasControlCharacters(value) || containsJudgmentFrameCredential(value)) {
    return undefined;
  }
  return value;
}

/**
 * `project_code` is stored in the receipt and handed to any injected transport,
 * so it gets the same secret/control-character/length screen as meta. An
 * absent, null, or blank value is "not recorded" (`null`); a non-empty string
 * that fails the screen is rejected (`undefined`) instead of being stored.
 */
function normalizeProjectCode(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) return null;
  if (value.length > MAX_META_TEXT || publicFrameTextHasControlCharacters(value) || containsJudgmentFrameCredential(value)) {
    return undefined;
  }
  return value;
}

/**
 * Build the deterministic receipt from a turn, or decide not to send it.
 * Pure: the same input and `effectiveAfter` always yield the same receipt and
 * the same `resolution_id`. `now` only bounds how far into the future a
 * `resolved_at` may sit; it never enters the receipt.
 */
export function buildWorkerJudgmentReceipt(
  input: WorkerJudgmentInput,
  config: { readonly effectiveAfter: string; readonly now?: () => Date; readonly maxFutureSkewMs?: number }
): WorkerJudgmentBuild {
  if (!WORKER_JUDGMENT_ENTRYPOINTS.includes(input.entrypoint)) {
    throw new WorkerJudgmentEmitterError('worker_judgment_entrypoint_invalid', `entrypoint must be one of ${WORKER_JUDGMENT_ENTRYPOINTS.join(', ')}`);
  }
  const sessionId = requireId(input.session_id, 'session_id');
  const turnId = requireId(input.turn_id, 'turn_id');
  const boundary = normalizeIso(config.effectiveAfter);
  if (!boundary) {
    throw new WorkerJudgmentEmitterError('worker_judgment_effective_after_invalid', 'effectiveAfter must be an ISO time');
  }

  const frameCheck = checkJudgmentPublicFrame(input.public_frame);
  if (!frameCheck.ok) {
    const reason_code: WorkerJudgmentSkipReason = frameCheck.code === 'frame_public_absent'
      ? 'worker_public_frame_absent'
      : 'frame_public_invalid';
    return { outcome: 'skipped', reason_code, detail: frameCheck.detail };
  }

  const model = normalizeMetaField(input.meta?.model);
  const agentMemberId = normalizeMetaField(input.meta?.agent_member_id);
  if (model === undefined || agentMemberId === undefined) {
    return { outcome: 'skipped', reason_code: 'worker_meta_invalid', detail: 'meta contains an invalid or credential-like value' };
  }

  const projectCode = normalizeProjectCode(input.project_code);
  if (projectCode === undefined) {
    return { outcome: 'skipped', reason_code: 'worker_project_code_invalid', detail: 'project_code is invalid or credential-like' };
  }

  if (input.resolved_at === undefined || input.resolved_at === null
    || (typeof input.resolved_at === 'string' && !input.resolved_at.trim())) {
    return { outcome: 'skipped', reason_code: 'worker_resolved_at_missing', detail: 'resolved_at was not provided' };
  }
  const resolvedAt = normalizeIso(input.resolved_at);
  if (!resolvedAt) {
    return { outcome: 'skipped', reason_code: 'worker_resolved_at_invalid', detail: 'resolved_at is not a valid ISO time' };
  }
  const now = (config.now ?? (() => new Date()))();
  const skew = config.maxFutureSkewMs ?? DEFAULT_MAX_FUTURE_SKEW_MS;
  if (Date.parse(resolvedAt) > now.getTime() + skew) {
    return { outcome: 'skipped', reason_code: 'worker_resolved_at_invalid', detail: 'resolved_at is too far in the future' };
  }
  if (Date.parse(resolvedAt) < Date.parse(boundary)) {
    return { outcome: 'skipped', reason_code: 'worker_resolved_at_before_boundary', detail: 'resolved_at is before the activation boundary' };
  }

  const contentDigest = judgmentFramePublicFrameDigest(frameCheck.frame);
  const resolutionId = sha256Hex(canonicalJson({
    content_digest: contentDigest,
    entrypoint: input.entrypoint,
    session_id: sessionId,
    turn_id: turnId
  }));
  const core = {
    schema_version: WORKER_JUDGMENT_RECEIPT_SCHEMA,
    resolution_id: resolutionId,
    entrypoint: input.entrypoint,
    turn_ref: `${sha256Hex(sessionId)}/${sha256Hex(turnId)}`,
    project_code: projectCode,
    resolved_at: resolvedAt,
    public_frame: frameCheck.frame,
    content_digest: contentDigest,
    meta: { model, agent_member_id: agentMemberId }
  };
  const receiptDigest = sha256Hex(canonicalJson(core));
  return { outcome: 'receipt', receipt: { ...core, receipt_digest: receiptDigest } };
}

/** Resolve the per-turn outbox directory. Session and turn are hashed so neither raw id reaches the path. */
export function resolveWorkerJudgmentTurnDir(journalRoot: string, sessionId: string, turnId: string): string {
  return join(journalRoot, sha256Hex(requireId(sessionId, 'session_id')), sha256Hex(requireId(turnId, 'turn_id')));
}

function atomicWriteReplace(target: string, value: unknown, now: () => Date): void {
  const temporary = `${target}.${process.pid}.${now().getTime()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, target);
}

/**
 * Publish a receipt without replacing one another writer created. The temp file
 * is complete before the hard link makes it visible, so a reader sees either the
 * old file or the complete new file — the same discipline as the judgment event
 * outbox.
 */
function atomicPublishNoReplace(target: string, value: unknown, now: () => Date): void {
  const temporary = `${target}.${process.pid}.${now().getTime()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    linkSync(temporary, target);
  } finally {
    try { unlinkSync(temporary); } catch { /* publication may have failed */ }
  }
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === code);
}

interface StoredOutboxState {
  readonly receipt_digest: string;
  readonly status: WorkerJudgmentDeliveryStatus;
  readonly last_error_code?: string;
}

const DELIVERY_STATUSES: readonly WorkerJudgmentDeliveryStatus[] =
  ['pending', 'saved', 'already_saved', 'blocked_credential', 'failed'];

/**
 * Read the digest and the recorded delivery state of a receipt already on disk.
 * A re-emit must compare the digest (§6 conflict) and must not undo delivery
 * progress, so the stored status is read too. Returns `null` when the file is
 * unreadable or does not carry a comparable receipt_digest.
 */
function readStoredOutboxState(path: string): StoredOutboxState | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const receipt = (parsed as { receipt?: unknown }).receipt;
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
    const digest = (receipt as { receipt_digest?: unknown }).receipt_digest;
    if (typeof digest !== 'string') return null;
    const delivery = (parsed as { delivery?: unknown }).delivery;
    const rawStatus = delivery && typeof delivery === 'object' && !Array.isArray(delivery)
      ? (delivery as { status?: unknown }).status
      : undefined;
    const status = DELIVERY_STATUSES.includes(rawStatus as WorkerJudgmentDeliveryStatus)
      ? (rawStatus as WorkerJudgmentDeliveryStatus)
      : 'pending';
    const rawError = delivery && typeof delivery === 'object' && !Array.isArray(delivery)
      ? (delivery as { last_error_code?: unknown }).last_error_code
      : undefined;
    return { receipt_digest: digest, status, ...(typeof rawError === 'string' ? { last_error_code: rawError } : {}) };
  } catch { /* unreadable or malformed; treat as no comparable receipt */ }
  return null;
}

/**
 * Turn a Worker turn into a receipt and write it to the local outbox, then —
 * only if a transport is injected — attempt a single delivery and record its
 * status. With no transport the receipt stays `pending` locally. Re-emitting
 * the identical turn is idempotent; a different receipt under the same
 * resolution id is a loud conflict. Nothing here writes the raw session/turn
 * ids, the prompt, the response, or any credential.
 */
export async function emitWorkerJudgment(
  input: WorkerJudgmentInput,
  options: WorkerJudgmentEmitterOptions
): Promise<WorkerJudgmentEmission> {
  if (!options.journalRoot) throw new WorkerJudgmentEmitterError('worker_judgment_journal_root_required', 'journalRoot is required');
  const now = options.now ?? (() => new Date());
  const built = buildWorkerJudgmentReceipt(input, {
    effectiveAfter: options.effectiveAfter,
    now,
    maxFutureSkewMs: options.maxFutureSkewMs
  });

  const dir = resolveWorkerJudgmentTurnDir(options.journalRoot, input.session_id, input.turn_id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  if (built.outcome === 'skipped') {
    const target = join(dir, 'skip.json');
    atomicWriteReplace(target, {
      schema_version: WORKER_JUDGMENT_SKIP_SCHEMA,
      entrypoint: input.entrypoint,
      turn_ref: `${sha256Hex(input.session_id)}/${sha256Hex(input.turn_id)}`,
      reason_code: built.reason_code,
      recorded_at: now().toISOString()
    }, now);
    return { outcome: 'skipped', reason_code: built.reason_code, path: target };
  }

  const receipt = built.receipt;
  const target = join(dir, `${receipt.resolution_id}.json`);
  let deduped = false;
  let stored: StoredOutboxState | null = null;
  try {
    atomicPublishNoReplace(target, {
      schema_version: WORKER_JUDGMENT_OUTBOX_SCHEMA,
      receipt,
      delivery: { status: 'pending' as WorkerJudgmentDeliveryStatus, attempt: 1, queued_at: now().toISOString() }
    }, now);
  } catch (error) {
    if (!isErrno(error, 'EEXIST')) throw error;
    stored = readStoredOutboxState(target);
    if (!stored || stored.receipt_digest !== receipt.receipt_digest) throw new WorkerJudgmentConflictError(receipt.resolution_id);
    deduped = true;
  }

  // A receipt already delivered must never be downgraded by a later re-emit:
  // keep the stored success and do not re-send or overwrite the record.
  if (stored && (stored.status === 'saved' || stored.status === 'already_saved')) {
    return {
      outcome: 'emitted',
      status: stored.status,
      receipt,
      path: target,
      deduped,
      ...(stored.last_error_code ? { last_error_code: stored.last_error_code } : {})
    };
  }

  if (!options.transport) {
    // On a re-emit the receipt stays whatever was already recorded (e.g. a prior
    // success), not a fresh `pending`. A first write is `pending`.
    const status = stored ? stored.status : 'pending';
    return {
      outcome: 'emitted',
      status,
      receipt,
      path: target,
      deduped,
      ...(stored?.last_error_code ? { last_error_code: stored.last_error_code } : {})
    };
  }

  let status: WorkerJudgmentDeliveryStatus = 'pending';
  let lastErrorCode: string | undefined;
  try {
    const result = await options.transport.send(receipt);
    status = result.status;
    if (result.status === 'blocked_credential' || result.status === 'failed') lastErrorCode = result.reason_code;
  } catch (error) {
    status = 'failed';
    lastErrorCode = error instanceof WorkerJudgmentEmitterError ? error.code : 'worker_judgment_transport_error';
  }
  atomicWriteReplace(target, {
    schema_version: WORKER_JUDGMENT_OUTBOX_SCHEMA,
    receipt,
    delivery: {
      status,
      attempt: 1,
      queued_at: now().toISOString(),
      ...(lastErrorCode ? { last_error_code: lastErrorCode } : {})
    }
  }, now);
  return { outcome: 'emitted', status, receipt, path: target, deduped, ...(lastErrorCode ? { last_error_code: lastErrorCode } : {}) };
}
