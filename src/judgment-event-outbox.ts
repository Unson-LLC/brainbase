import {
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import type { JudgmentKnowledgeEvent } from './judgment-event-adapter.js';

/** The queue format is intentionally independent of a Host, Task, or tenant. */
export const JUDGMENT_EVENT_OUTBOX_SCHEMA_VERSION = 'judgment_event_outbox.v1' as const;
export const JUDGMENT_EVENT_DELIVERY_RECEIPT_SCHEMA_VERSION = 'knowledge_event_delivery_receipt.v1' as const;
export const JUDGMENT_EVENT_READBACK_SCHEMA_VERSION = 'knowledge_cycle_receipt.v1' as const;

export interface JudgmentOutboxPaths {
  outboxDir: string;
  deadLetterDir: string;
  deliveryReceiptDir: string;
  lockPath: string;
}

export interface ResolveJudgmentOutboxPathsOptions {
  /** Repository/application root. Its `var/` directory is used when varDir is omitted. */
  root?: string;
  /** Explicit shared runtime state directory. This is the preferred production input. */
  varDir?: string;
  outboxDir?: string;
  deadLetterDir?: string;
  deliveryReceiptDir?: string;
  lockPath?: string;
}

export interface JudgmentOutboxStorage {
  mkdir(path: string, options: { recursive: true; mode: number }): void;
  readFile(path: string): string;
  readdir(path: string): string[];
  rename(from: string, to: string): void;
  unlink(path: string): void;
  writeFile(path: string, value: string, options: { mode: number }): void;
  writeExclusive(path: string, value: string, mode: number): void;
  /** Publish a fully written file without replacing an existing path. */
  link(from: string, to: string): void;
  stat(path: string): { mtimeMs: number };
}

const nodeStorage: JudgmentOutboxStorage = {
  mkdir: (path, options) => mkdirSync(path, options),
  readFile: (path) => readFileSync(path, 'utf8'),
  readdir: (path) => readdirSync(path),
  rename: (from, to) => renameSync(from, to),
  unlink: (path) => unlinkSync(path),
  writeFile: (path, value, options) => writeFileSync(path, value, options),
  writeExclusive: (path, value, mode) => {
    const descriptor = openSync(path, 'wx', mode);
    try {
      writeFileSync(descriptor, value);
    } finally {
      closeSync(descriptor);
    }
  },
  link: (from, to) => linkSync(from, to),
  stat: (path) => statSync(path)
};

const OUTBOX_DIRNAME = 'knowledge-event-outbox';
const DEAD_LETTER_DIRNAME = 'knowledge-event-dead-letter';
const DELIVERY_RECEIPT_DIRNAME = 'knowledge-event-delivery-receipt';
const DEFAULT_CHANNEL = 'codex-judgment';
const JSON_SUFFIX = '.json';
const DEFAULT_STALE_LOCK_MS = 10 * 60 * 1000;

/** Resolve shared state paths without importing any runtime or repository code. */
export function resolveJudgmentKnowledgeEventOutboxPaths(
  options: ResolveJudgmentOutboxPathsOptions = {}
): JudgmentOutboxPaths {
  const stateRoot = options.varDir ?? (options.root ? join(options.root, 'var') : null);
  const outboxDir = options.outboxDir ?? (stateRoot ? join(stateRoot, OUTBOX_DIRNAME, DEFAULT_CHANNEL) : null);
  if (!outboxDir) throw new TypeError('judgment outbox requires varDir, root, or outboxDir');
  const sharedRoot = stateRoot ?? dirname(dirname(outboxDir));
  return {
    outboxDir,
    deadLetterDir: options.deadLetterDir ?? join(sharedRoot, DEAD_LETTER_DIRNAME, basename(outboxDir)),
    deliveryReceiptDir: options.deliveryReceiptDir ?? join(sharedRoot, DELIVERY_RECEIPT_DIRNAME, basename(outboxDir)),
    lockPath: options.lockPath ?? `${outboxDir}.sender.lock`
  };
}

export interface JudgmentOutboxPostAck {
  event_id: string;
  candidate_id: string;
  http_status?: number | null;
  received_at: string;
  [key: string]: unknown;
}

export interface JudgmentOutboxReadback {
  schema_version: typeof JUDGMENT_EVENT_READBACK_SCHEMA_VERSION;
  event_id: string;
  candidate_id: string;
  processing_stage: 'retrievable';
  semantic_state: 'active';
  readback_at: string;
  [key: string]: unknown;
}

/**
 * Runtime adapters own HTTP/auth/org/Task concerns. The common core only
 * asks an adapter to post and to perform the canonical readback.
 */
export interface JudgmentOutboxDeliveryPort {
  post(event: JudgmentKnowledgeEvent): Promise<JudgmentOutboxPostAck>;
  readback(input: {
    event: JudgmentKnowledgeEvent;
    post: JudgmentOutboxPostAck;
  }): Promise<JudgmentOutboxReadback>;
}

export interface JudgmentOutboxDeliveryError extends Error {
  code?: string;
  phase?: 'post' | 'readback';
  transport?: boolean;
  httpStatus?: number | null;
}

export interface JudgmentQueuedEvent {
  event: JudgmentKnowledgeEvent;
  delivery: {
    attempt: number;
    queued_at: string;
    post_ack?: JudgmentOutboxPostAck;
    phase?: 'readback_pending';
    readback_attempt?: number;
    ack_saved_at?: string;
    last_failed_at?: string;
    last_status?: number | null;
    last_error_code?: string;
    consecutive_failures?: number;
    next_attempt_at?: string;
  };
}

export interface JudgmentOutboxOperationResult {
  status: 'queued' | 'existing';
  path: string;
}

export interface JudgmentOutboxDeliveryResult {
  status: 'unavailable' | 'busy' | 'processed';
  delivered: number;
  failed: number;
  retryable: number;
  dead_lettered: number;
  pending: number;
  deferred?: number;
  last_error_code?: string;
}

export interface JudgmentOutboxDeliveryOptions {
  paths: JudgmentOutboxPaths;
  delivery?: JudgmentOutboxDeliveryPort;
  storage?: JudgmentOutboxStorage;
  maxAttempts?: number;
  limit?: number;
  backoff?: { baseMs: number; maxMs: number } | null;
  now?: () => Date;
  staleLockAfterMs?: number;
  /** Set false only for an adapter that already owns a surrounding lock. */
  acquireLock?: boolean;
}

function jsonFiles(directory: string, storage: JudgmentOutboxStorage): string[] {
  try {
    return storage.readdir(directory).filter((name) => name.endsWith(JSON_SUFFIX)).sort();
  } catch (error) {
    if (isCode(error, 'ENOENT')) return [];
    throw error;
  }
}

function isCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function atomicWrite(
  target: string,
  value: unknown,
  storage: JudgmentOutboxStorage
): void {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  storage.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  storage.rename(temporary, target);
}

/**
 * Publish a new queue item without replacing a file another sender created.
 * The temporary file is complete before the hardlink makes the target visible,
 * so readers see either the old file or the complete new file.
 */
function atomicPublishNoReplace(
  target: string,
  value: unknown,
  storage: JudgmentOutboxStorage
): void {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  storage.writeFile(temporary, serialized, { mode: 0o600 });
  try {
    // Hard-link publication is required. A writeExclusive fallback can expose
    // a partial target to a concurrent reader, so custom storage adapters must
    // implement this port or fail closed before production use.
    if (typeof storage.link !== 'function') throw new Error('judgment_event_outbox_atomic_link_required');
    storage.link(temporary, target);
  } finally {
    try { storage.unlink(temporary); } catch { /* publication may have failed */ }
  }
}

function parseJson(path: string, storage: JudgmentOutboxStorage): unknown {
  return JSON.parse(storage.readFile(path));
}

const SAFE_EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

function queuedEvent(value: unknown, expectedFile?: string): JudgmentQueuedEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('judgment_event_outbox_invalid');
  const candidate = value as Record<string, unknown>;
  if (candidate.schema_version !== JUDGMENT_EVENT_OUTBOX_SCHEMA_VERSION) {
    throw new Error('judgment_event_outbox_schema_invalid');
  }
  if (!candidate.event || typeof candidate.event !== 'object' || Array.isArray(candidate.event)) {
    throw new Error('judgment_event_outbox_event_missing');
  }
  const event = candidate.event as Record<string, unknown>;
  if (typeof event.event_id !== 'string' || !SAFE_EVENT_ID.test(event.event_id)) {
    throw new Error('judgment_event_outbox_event_id_invalid');
  }
  if (expectedFile && expectedFile !== `${event.event_id}${JSON_SUFFIX}`) {
    throw new Error('judgment_event_outbox_filename_mismatch');
  }
  if (!candidate.delivery || typeof candidate.delivery !== 'object' || Array.isArray(candidate.delivery)) {
    throw new Error('judgment_event_outbox_delivery_missing');
  }
  return candidate as unknown as JudgmentQueuedEvent;
}

/** Queue one event. Repeating the same event is idempotent; changing its body is a conflict. */
export function enqueueJudgmentKnowledgeEvent(
  event: JudgmentKnowledgeEvent,
  options: { directory: string; now?: () => Date; storage?: JudgmentOutboxStorage }
): JudgmentOutboxOperationResult {
  if (!event || typeof event.event_id !== 'string' || !event.event_id) {
    throw new Error('knowledge event_id is required');
  }
  if (!options.directory) throw new Error('knowledge event outbox directory is required');
  if (!SAFE_EVENT_ID.test(event.event_id)) {
    throw new Error('knowledge event_id is invalid');
  }
  const storage = options.storage ?? nodeStorage;
  const now = options.now ?? (() => new Date());
  storage.mkdir(options.directory, { recursive: true, mode: 0o700 });
  const target = join(options.directory, `${event.event_id}.json`);
  try {
    const existing = queuedEvent(parseJson(target, storage));
    if (JSON.stringify(existing.event) !== JSON.stringify(event)) {
      throw new Error('knowledge_event_outbox_conflict');
    }
    return { status: 'existing', path: target };
  } catch (error) {
    if (!isCode(error, 'ENOENT')) throw error;
  }
  const value = {
    schema_version: JUDGMENT_EVENT_OUTBOX_SCHEMA_VERSION,
    event,
    delivery: { attempt: 1, queued_at: now().toISOString() }
  };
  try {
    atomicPublishNoReplace(target, value, storage);
    return { status: 'queued', path: target };
  } catch (error) {
    if (!isCode(error, 'EEXIST')) throw error;
    // Another process won publication. Re-read its complete record and only
    // accept it when the event body is identical; never overwrite a winner.
    const existing = queuedEvent(parseJson(target, storage), `${event.event_id}${JSON_SUFFIX}`);
    if (JSON.stringify(existing.event) !== JSON.stringify(event)) {
      throw new Error('knowledge_event_outbox_conflict');
    }
    return { status: 'existing', path: target };
  }
}

function normalizeErrorCode(error: unknown, fallback: string): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return typeof code === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/u.test(code) ? code : fallback;
}

function errorPhase(error: unknown, fallback: 'post' | 'readback'): 'post' | 'readback' {
  const phase = error && typeof error === 'object' && 'phase' in error ? error.phase : null;
  return phase === 'post' || phase === 'readback' ? phase : fallback;
}

function isTransportError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'transport' in error && error.transport === true)
    || normalizeErrorCode(error, '') === 'knowledge_event_delivery_transport_failed';
}

function errorStatus(error: unknown): number | null {
  const status = error && typeof error === 'object' && 'httpStatus' in error ? error.httpStatus : null;
  return typeof status === 'number' && Number.isInteger(status) ? status : null;
}

function confirmedReceipt(
  value: unknown,
  eventId: string,
  candidateId: string,
  projectCode: string | null
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  const post = receipt.post && typeof receipt.post === 'object' ? receipt.post as Record<string, unknown> : null;
  const readback = receipt.readback && typeof receipt.readback === 'object'
    ? receipt.readback as Record<string, unknown>
    : null;
  return receipt.schema_version === JUDGMENT_EVENT_DELIVERY_RECEIPT_SCHEMA_VERSION
    && receipt.status === 'confirmed'
    && receipt.event_id === eventId
    && receipt.candidate_id === candidateId
    && receipt.project_code === projectCode
    && post?.event_id === eventId
    && post.candidate_id === candidateId
    && readback?.schema_version === JUDGMENT_EVENT_READBACK_SCHEMA_VERSION
    && readback.event_id === eventId
    && readback.candidate_id === candidateId
    && readback.processing_stage === 'retrievable'
    && readback.semantic_state === 'active';
}

function projectCode(event: JudgmentKnowledgeEvent): string | null {
  const candidate = event as unknown as Record<string, unknown>;
  if (typeof candidate.project_code === 'string' && candidate.project_code) return candidate.project_code;
  const scope = candidate.applicability_scope;
  if (scope && typeof scope === 'object' && !Array.isArray(scope)) {
    const value = (scope as Record<string, unknown>).project_code;
    return typeof value === 'string' && value ? value : null;
  }
  return null;
}

function readConfirmedReceipt(
  path: string,
  eventId: string,
  candidateId: string,
  code: string | null,
  storage: JudgmentOutboxStorage
): boolean {
  try {
    return confirmedReceipt(parseJson(path, storage), eventId, candidateId, code);
  } catch {
    return false;
  }
}

function moveToDeadLetter(
  target: string,
  file: string,
  directory: string,
  storage: JudgmentOutboxStorage
): void {
  storage.mkdir(directory, { recursive: true, mode: 0o700 });
  storage.rename(target, join(directory, file));
}

function deliverCore(options: Required<Pick<JudgmentOutboxDeliveryOptions, 'paths'>> & Omit<JudgmentOutboxDeliveryOptions, 'paths'>): Promise<JudgmentOutboxDeliveryResult> {
  const storage = options.storage ?? nodeStorage;
  const now = options.now ?? (() => new Date());
  const maxAttempts = options.maxAttempts ?? 5;
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const backoff = options.backoff ?? null;
  const allFiles = jsonFiles(options.paths.outboxDir, storage);
  const delivery = options.delivery;
  if (!delivery) {
    return Promise.resolve({
      status: 'unavailable',
      delivered: 0,
      failed: 0,
      retryable: allFiles.length,
      dead_lettered: 0,
      pending: allFiles.length
    });
  }

  let delivered = 0;
  let failed = 0;
  let retryable = 0;
  let deadLettered = 0;
  let deferred = 0;
  let processed = 0;
  let lastErrorCode: string | undefined;

  const process = async (): Promise<JudgmentOutboxDeliveryResult> => {
    for (const file of allFiles) {
      if (processed >= limit) break;
      const target = join(options.paths.outboxDir, file);
      let queued: JudgmentQueuedEvent;
      try {
        queued = queuedEvent(parseJson(target, storage), file);
      } catch {
        processed += 1;
        failed += 1;
        moveToDeadLetter(target, file, options.paths.deadLetterDir, storage);
        deadLettered += 1;
        continue;
      }
      const dueAt = Date.parse(queued.delivery.next_attempt_at ?? '');
      if (backoff && Number.isFinite(dueAt) && dueAt > now().getTime()) {
        deferred += 1;
        continue;
      }
      processed += 1;
      const eventId = queued.event.event_id;
      const code = projectCode(queued.event);
      const postAck = queued.delivery.post_ack;
      const attempt = queued.delivery.attempt || 1;
      const readbackAttempt = queued.delivery.readback_attempt || 1;
      if (!postAck && attempt > maxAttempts) {
        failed += 1;
        moveToDeadLetter(target, file, options.paths.deadLetterDir, storage);
        deadLettered += 1;
        continue;
      }
      const receiptPath = join(options.paths.deliveryReceiptDir, `${eventId}.json`);
      if (postAck && readConfirmedReceipt(receiptPath, eventId, postAck.candidate_id, code, storage)) {
        try {
          storage.unlink(target);
          delivered += 1;
          continue;
        } catch {
          // The confirmed receipt remains authoritative; retain the queue for retry.
        }
      }

      let failureKind: 'post' | 'readback' = postAck ? 'readback' : 'post';
      let lastStatus: number | null = null;
      let codeForError = 'knowledge_event_delivery_unknown_error';
      try {
        let confirmedPost = postAck;
        if (!confirmedPost) {
          failureKind = 'post';
          confirmedPost = await delivery.post(queued.event);
          if (confirmedPost.event_id !== eventId || !confirmedPost.candidate_id) {
            const error = new Error('knowledge_event_delivery_ack_identity_mismatch') as JudgmentOutboxDeliveryError;
            error.code = 'knowledge_event_delivery_ack_identity_mismatch';
            error.phase = 'post';
            throw error;
          }
          lastStatus = typeof confirmedPost.http_status === 'number' ? confirmedPost.http_status : null;
          const savedAt = now().toISOString();
          const ackQueued: JudgmentQueuedEvent = {
            ...queued,
            delivery: {
              ...queued.delivery,
              post_ack: confirmedPost,
              phase: 'readback_pending',
              readback_attempt: queued.delivery.readback_attempt || 1,
              ack_saved_at: savedAt
            }
          };
          atomicWrite(target, ackQueued, storage);
          queued = ackQueued;
        }

        failureKind = 'readback';
        const readback = await delivery.readback({ event: queued.event, post: confirmedPost });
        if (readback.schema_version !== JUDGMENT_EVENT_READBACK_SCHEMA_VERSION
          || readback.event_id !== eventId
          || readback.candidate_id !== confirmedPost.candidate_id
          || readback.processing_stage !== 'retrievable'
          || readback.semantic_state !== 'active') {
          const error = new Error('knowledge_event_readback_identity_or_state_mismatch') as JudgmentOutboxDeliveryError;
          error.code = 'knowledge_event_readback_identity_or_state_mismatch';
          error.phase = 'readback';
          throw error;
        }
        const receipt = {
          schema_version: JUDGMENT_EVENT_DELIVERY_RECEIPT_SCHEMA_VERSION,
          status: 'confirmed' as const,
          event_id: eventId,
          candidate_id: confirmedPost.candidate_id,
          project_code: code,
          post: confirmedPost,
          readback,
          confirmed_at: now().toISOString()
        };
        storage.mkdir(options.paths.deliveryReceiptDir, { recursive: true, mode: 0o700 });
        atomicWrite(receiptPath, receipt, storage);
        storage.unlink(target);
        delivered += 1;
      } catch (error) {
        failed += 1;
        codeForError = normalizeErrorCode(error, codeForError);
        const phase = errorPhase(error, failureKind);
        const transport = isTransportError(error);
        const nextAttempt = attempt + (phase === 'readback' || transport ? 0 : 1);
        const nextReadbackAttempt = readbackAttempt + (phase === 'readback' && !transport ? 1 : 0);
        const consecutiveFailures = (queued.delivery.consecutive_failures ?? 0) + 1;
        const failedAt = now();
        const next: JudgmentQueuedEvent = {
          ...queued,
          delivery: {
            ...queued.delivery,
            attempt: nextAttempt,
            ...(phase === 'readback' ? { readback_attempt: nextReadbackAttempt } : {}),
            last_failed_at: failedAt.toISOString(),
            last_status: errorStatus(error) ?? lastStatus,
            last_error_code: codeForError,
            ...(backoff ? {
              consecutive_failures: consecutiveFailures,
              next_attempt_at: new Date(failedAt.getTime() + Math.min(
                backoff.baseMs * 2 ** (consecutiveFailures - 1),
                backoff.maxMs
              )).toISOString()
            } : {})
          }
        };
        const shouldDeadLetter = (!phase || phase === 'post')
          && (errorStatus(error) === 409 || next.delivery.attempt > maxAttempts)
          || (phase === 'readback' && next.delivery.readback_attempt !== undefined
            && next.delivery.readback_attempt > maxAttempts);
        atomicWrite(target, next, storage);
        if (shouldDeadLetter) {
          moveToDeadLetter(target, file, options.paths.deadLetterDir, storage);
          deadLettered += 1;
        } else {
          retryable += 1;
        }
        lastErrorCode = codeForError;
        if (transport) break;
      }
    }
    return {
      status: 'processed',
      delivered,
      failed,
      retryable,
      dead_lettered: deadLettered,
      deferred,
      pending: jsonFiles(options.paths.outboxDir, storage).length,
      ...(lastErrorCode ? { last_error_code: lastErrorCode } : {})
    };
  };
  return process();
}

function acquireSenderLock(
  lockPath: string,
  storage: JudgmentOutboxStorage,
  now: () => Date,
  staleAfterMs: number
): (() => void) | null {
  storage.mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      storage.writeExclusive(lockPath, `${process.pid} ${now().toISOString()}\n`, 0o600);
      return () => {
        try { storage.unlink(lockPath); } catch { /* another sender released it */ }
      };
    } catch (error) {
      if (!isCode(error, 'EEXIST')) throw error;
      let stale = true;
      try { stale = now().getTime() - storage.stat(lockPath).mtimeMs > staleAfterMs; } catch { /* stale */ }
      if (!stale) return null;
      try { storage.unlink(lockPath); } catch { /* another sender replaced it */ }
    }
  }
  return null;
}

/** Execute an operation under the shared sender lock, or return busy. */
export async function withJudgmentOutboxSenderLock<T>(
  options: {
    lockPath: string;
    run: () => Promise<T> | T;
    storage?: JudgmentOutboxStorage;
    now?: () => Date;
    staleAfterMs?: number;
  }
): Promise<T | { status: 'busy' }> {
  const release = acquireSenderLock(
    options.lockPath,
    options.storage ?? nodeStorage,
    options.now ?? (() => new Date()),
    options.staleAfterMs ?? DEFAULT_STALE_LOCK_MS
  );
  if (!release) return { status: 'busy' };
  try {
    return await options.run();
  } finally {
    release();
  }
}

/** Deliver queued events while keeping retry, receipt, and lock behavior in the common core. */
export async function deliverJudgmentKnowledgeEventOutbox(
  options: JudgmentOutboxDeliveryOptions
): Promise<JudgmentOutboxDeliveryResult> {
  const now = options.now ?? (() => new Date());
  const run = () => deliverCore(options);
  if (options.acquireLock === false) return run();
  const result = await withJudgmentOutboxSenderLock({
    lockPath: options.paths.lockPath,
    storage: options.storage,
    now,
    staleAfterMs: options.staleLockAfterMs,
    run
  });
  if ('status' in result && result.status === 'busy') {
    return {
      status: 'busy',
      delivered: 0,
      failed: 0,
      retryable: 0,
      dead_lettered: 0,
      pending: jsonFiles(options.paths.outboxDir, options.storage ?? nodeStorage).length
    };
  }
  return result as JudgmentOutboxDeliveryResult;
}

export interface JudgmentOutboxSummary {
  pending: number;
  failing: number;
  dead_lettered: number;
  last_error_code: string | null;
}

/** Local summary used by Host diagnostics; it never calls the network. */
export function summarizeJudgmentKnowledgeEventOutbox(options: {
  paths: Pick<JudgmentOutboxPaths, 'outboxDir' | 'deadLetterDir'>;
  now?: () => Date;
  overdueAfterMs?: number;
  storage?: JudgmentOutboxStorage;
}): JudgmentOutboxSummary {
  const storage = options.storage ?? nodeStorage;
  const now = options.now ?? (() => new Date());
  const overdueAfterMs = options.overdueAfterMs ?? 15 * 60 * 1000;
  let failing = 0;
  let overdue = 0;
  let latest: { failedAt: string; code: string | null } | null = null;
  const files = jsonFiles(options.paths.outboxDir, storage);
  for (const file of files) {
    let queued: JudgmentQueuedEvent;
    try { queued = queuedEvent(parseJson(join(options.paths.outboxDir, file), storage), file); } catch { failing += 1; continue; }
    const failedAt = queued.delivery.last_failed_at;
    if (!failedAt) {
      const queuedAt = Date.parse(queued.delivery.queued_at);
      if (Number.isFinite(queuedAt) && now().getTime() - queuedAt > overdueAfterMs) overdue += 1;
      continue;
    }
    failing += 1;
    if (!latest || failedAt > latest.failedAt) latest = { failedAt, code: queued.delivery.last_error_code ?? null };
  }
  return {
    pending: files.length,
    failing: failing + overdue,
    dead_lettered: jsonFiles(options.paths.deadLetterDir, storage).length,
    last_error_code: latest?.code ?? (overdue > 0 ? 'knowledge_event_delivery_overdue' : null)
  };
}

export async function listJudgmentKnowledgeEventOutboxExceptions(options: {
  directory: string;
  storage?: JudgmentOutboxStorage;
}): Promise<Array<{ code: string; event_id?: string; path: string; created_at?: string }>> {
  const storage = options.storage ?? nodeStorage;
  return jsonFiles(options.directory, storage).map((file) => {
    try {
      const queued = queuedEvent(parseJson(join(options.directory, file), storage), file);
      return {
        code: 'knowledge_event_outbox',
        event_id: queued.event.event_id,
        path: file,
        created_at: queued.delivery.queued_at
      };
    } catch {
      return { code: 'knowledge_event_outbox_corrupt', path: file };
    }
  });
}

export async function listKnowledgeEventDeadLetters(options: {
  directory: string;
  storage?: JudgmentOutboxStorage;
}): Promise<Array<{ code: string; event_id: string; path: string; created_at: string }>> {
  const storage = options.storage ?? nodeStorage;
  return jsonFiles(options.directory, storage).map((file) => {
    let queued: JudgmentQueuedEvent | null = null;
    try { queued = queuedEvent(parseJson(join(options.directory, file), storage), file); } catch { /* corrupt dead letter */ }
    return {
      code: 'knowledge_event_dead_letter',
      event_id: queued?.event.event_id ?? file.replace(/\.json$/u, ''),
      path: file,
      created_at: queued?.delivery.last_failed_at ?? queued?.delivery.queued_at ?? new Date().toISOString()
    };
  });
}

export interface JudgmentKnowledgeEventSink {
  enqueue(event: JudgmentKnowledgeEvent): JudgmentOutboxOperationResult | Promise<JudgmentOutboxOperationResult>;
}

/**
 * Host adapter candidate: the Host supplies only a completed event; runtime
 * path selection is injected here and can later be replaced without changing
 * the Host lifecycle or public response.
 */
export function createJudgmentKnowledgeEventOutboxSink(options: {
  paths: JudgmentOutboxPaths;
  storage?: JudgmentOutboxStorage;
  now?: () => Date;
}): JudgmentKnowledgeEventSink {
  return {
    enqueue: (event) => enqueueJudgmentKnowledgeEvent(event, {
      directory: options.paths.outboxDir,
      storage: options.storage,
      now: options.now
    })
  };
}
