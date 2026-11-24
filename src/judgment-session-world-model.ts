/**
 * RFC-001 v2.0 PR-B: Lightweight 2-Layer Ephemeral Session Mini World Model v2.
 *
 * - Schema & rendering (`renderSessionMiniWorldModelPinV2`, <= 850 Unicode code points,
 *   `invariant_constraints` protected last, valid JSON arrays, intact footer,
 *   credential & audit-prefix filtering).
 * - Atomic session-scoped journal persistence (`journalRoot/<sessionRef>/session-world-model.json`)
 *   protected by a dedicated lock (`journalRoot/<sessionRef>/.session-world-model.lock`),
 *   strict monotonic `turn_sequence` guard, `0o600` tmp + `fsyncSync` + `renameSync`,
 *   and fail-open reading.
 * - PR #1044 upstream evidence draft adapter (`toLearningCandidateEvidenceDraftFromSessionWMV2`),
 *   producing a human-authorization-gated evidence draft only (never writes to Graph or auto-adopts).
 */

import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { containsJudgmentFrameCredential } from './judgment-frame.js';
import { AUDIT_LINE_STRIP_PREFIX } from './judgment-reasoning-gate-prompt.js';

export const SESSION_MINI_WORLD_MODEL_SCHEMA_VERSION_V2 =
  'brainbase-session-mini-world-model.v2' as const;

export const SESSION_WORLD_MODEL_FILENAME = 'session-world-model.json' as const;
export const SESSION_WORLD_MODEL_LOCK_FILENAME = '.session-world-model.lock' as const;
export const DEFAULT_SESSION_WORLD_MODEL_UPDATE_TIMEOUT_MS = 1500;

export const WM_V2_LIMITS = {
  MAX_INVARIANT_ITEMS: 3,
  MAX_INVARIANT_CHARS: 50,
  MAX_SUPERSEDED_ITEMS: 2,
  MAX_SUPERSEDED_CHARS: 60,
  MAX_PIN_ITEMS: 4,
  MAX_ITEM_CHARS: 60,
  MAX_THESIS_CHARS: 100,
  MAX_PIN_TOTAL_CHARS: 850,
} as const;

/**
 * PR-B v2 Lightweight 2-Layer Ephemeral Session Mini World Model (Exp-04 & Exp-06).
 * Separates `invariant_constraints` (ConstraintRot shield) and compact `superseded_edges`
 * from general `confirmed_edges`, while keeping rendered pin <= 850 chars.
 */
export interface SessionMiniWorldModelV2 {
  readonly schema_version: typeof SESSION_MINI_WORLD_MODEL_SCHEMA_VERSION_V2;
  readonly session_ref: string;
  /** Monotonic per-session sequence to reject out-of-order async Stop overwrites. */
  readonly turn_sequence: number;
  readonly updated_after_turn_id: string;
  readonly updated_at: string;
  readonly steelman_thesis: string;
  /** Non-negotiable constraints / hard boundaries (max 3, <= 50 chars each; trimmed LAST). */
  readonly invariant_constraints: readonly string[];
  /** Compact revision chain `"old->new(eval-id)"` (max 2, <= 60 chars each). */
  readonly superseded_edges: readonly string[];
  /** Verified facts or mutually agreed causal edges (max 4, <= 60 chars each). */
  readonly confirmed_edges: readonly string[];
  /** Unverified causal links or missing measurements (max 4, <= 60 chars each). */
  readonly open_edges: readonly string[];
  /** Value/normative questions explicitly separated from causal analysis (max 4). */
  readonly separated_normative_questions: readonly string[];
  /** False premises / over-assertions already rejected in prior turns (max 4). */
  readonly rejected_false_premises: readonly string[];
  /** Optional Graph refutation IDs (`ref-*`) surfaced during the session (links to PR #1044). */
  readonly referenced_refutation_ids?: readonly string[];
  /** Optional evaluation/evidence IDs (`eval-*`) surfaced during the session. */
  readonly referenced_eval_ids?: readonly string[];
}

export interface SessionWorldModelUpdateEventV2 {
  readonly session_ref: string;
  readonly turn_id: string;
  readonly turn_sequence: number;
  /** Sourced from `episode.adoption.request.request`. */
  readonly user_prompt: string;
  /** Sourced from `normalizedAnswerBody(answer, expectedAuditLines)`. */
  readonly final_answer: string;
  readonly previous_state: SessionMiniWorldModelV2 | null;
}

/**
 * MUST be invoked AFTER `withTurnLock` is released (and only when `paths.final`
 * is persisted with `owner_audit_complete`, skipping replay Stops where
 * `previous_state.updated_after_turn_id === turn_id`).
 * Wrap caller invocation in `try/catch` + `Promise.race` timeout with `clearTimeout`.
 * Short-lived CLI (`src/cli.ts judgment:hook`) must never run in-process LLM calls.
 */
export interface SessionWorldModelUpdaterV2 {
  enqueue(event: SessionWorldModelUpdateEventV2): Promise<void> | void;
}

/**
 * Upstream evidence draft produced from a v2 session mini world model.
 * Separate from `LearningCandidateInput` (`src/company-os-learning-adoption.ts`):
 * callers must supply `id`, `sourceEvaluationRef`, `target`, `proposedChange`, `applicability`,
 * and pass human authorization. Never writes to Graph or auto-adopts.
 */
export interface SessionWMLearningEvidenceDraftV2 {
  readonly proposedChangeNote: string;
  /** Guaranteed non-empty (`normalizeCandidateInput` requireOne=true). Merges invariant + confirmed + superseded. */
  readonly grounds: readonly string[];
  /** May be empty (`requireOne=false`); merges observed counterexamples + rejected premises. */
  readonly counterexamples: readonly string[];
  /** Guaranteed non-empty (`normalizeCandidateInput` requireOne=true). */
  readonly uncertainty: readonly string[];
  readonly addressedRefutationIds?: readonly string[];
  readonly addressedEvalIds?: readonly string[];
  readonly competingModels?: ReadonlyArray<{
    readonly ref?: string;
    readonly hypothesis: string;
    readonly comparison: string;
  }>;
}

export type SessionWMLearningEvidenceDraftResultV2 =
  | { readonly ok: true; readonly draft: SessionWMLearningEvidenceDraftV2 }
  | { readonly ok: false; readonly missing_required_fields: readonly ('grounds' | 'uncertainty')[] };

export type SessionWorldModelWriteResult =
  | { readonly written: true; readonly state: SessionMiniWorldModelV2 }
  | {
    readonly written: false;
    readonly reason: 'stale_turn_sequence' | 'session_ref_mismatch' | 'invalid_state';
  };

export interface SessionWorldModelPaths {
  readonly directory: string;
  readonly filePath: string;
  readonly lockPath: string;
}

const SAFE_SESSION_REF = /^[^/\\\u0000-\u001f\u007f]+$/u;
const MAX_SESSION_WORLD_MODEL_FILE_BYTES = 256 * 1024;
const DEFAULT_LOCK_MAX_ATTEMPTS = 100;
const DEFAULT_LOCK_RETRY_DELAY_MS = 10;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSafeSessionRef(sessionRef: string): boolean {
  return (
    typeof sessionRef === 'string'
    && sessionRef.length > 0
    && sessionRef.length <= 512
    && sessionRef !== '.'
    && sessionRef !== '..'
    && SAFE_SESSION_REF.test(sessionRef)
  );
}

export function sessionWorldModelPaths(
  journalRootDir: string,
  sessionRef: string,
): SessionWorldModelPaths {
  if (!isSafeSessionRef(sessionRef)) {
    throw new Error('session_world_model_invalid_session_ref');
  }
  const directory = join(journalRootDir, sessionRef);
  return {
    directory,
    filePath: join(directory, SESSION_WORLD_MODEL_FILENAME),
    lockPath: join(directory, SESSION_WORLD_MODEL_LOCK_FILENAME),
  };
}

/**
 * Validates and normalizes an untrusted JSON payload into `SessionMiniWorldModelV2`.
 * Returns `null` if the payload does not match the v2 schema.
 */
export function parseSessionMiniWorldModelV2(value: unknown): SessionMiniWorldModelV2 | null {
  if (!isPlainRecord(value)) return null;
  if (value.schema_version !== SESSION_MINI_WORLD_MODEL_SCHEMA_VERSION_V2) return null;
  if (typeof value.session_ref !== 'string' || !isSafeSessionRef(value.session_ref)) return null;
  if (
    typeof value.turn_sequence !== 'number'
    || !Number.isSafeInteger(value.turn_sequence)
    || value.turn_sequence < 1
  ) {
    return null;
  }
  if (typeof value.updated_after_turn_id !== 'string' || value.updated_after_turn_id.trim().length === 0) {
    return null;
  }
  if (typeof value.updated_at !== 'string' || value.updated_at.trim().length === 0) return null;
  if (typeof value.steelman_thesis !== 'string') return null;

  if (
    !isStringArray(value.invariant_constraints)
    || !isStringArray(value.superseded_edges)
    || !isStringArray(value.confirmed_edges)
    || !isStringArray(value.open_edges)
    || !isStringArray(value.separated_normative_questions)
    || !isStringArray(value.rejected_false_premises)
  ) {
    return null;
  }

  if (value.referenced_refutation_ids !== undefined && !isStringArray(value.referenced_refutation_ids)) {
    return null;
  }
  if (value.referenced_eval_ids !== undefined && !isStringArray(value.referenced_eval_ids)) {
    return null;
  }

  return {
    schema_version: SESSION_MINI_WORLD_MODEL_SCHEMA_VERSION_V2,
    session_ref: value.session_ref,
    turn_sequence: value.turn_sequence,
    updated_after_turn_id: value.updated_after_turn_id,
    updated_at: value.updated_at,
    steelman_thesis: value.steelman_thesis,
    invariant_constraints: [...value.invariant_constraints],
    superseded_edges: [...value.superseded_edges],
    confirmed_edges: [...value.confirmed_edges],
    open_edges: [...value.open_edges],
    separated_normative_questions: [...value.separated_normative_questions],
    rejected_false_premises: [...value.rejected_false_premises],
    ...(value.referenced_refutation_ids !== undefined
      ? { referenced_refutation_ids: [...value.referenced_refutation_ids] }
      : {}),
    ...(value.referenced_eval_ids !== undefined
      ? { referenced_eval_ids: [...value.referenced_eval_ids] }
      : {}),
  };
}

/**
 * Fail-open reader for `journalRoot/<sessionRef>/session-world-model.json`.
 * Never throws on ENOENT, corrupted JSON, schema mismatch, symlink, or IO error.
 */
export function readSessionMiniWorldModelV2(
  journalRootDir: string,
  sessionRef: string,
): SessionMiniWorldModelV2 | null {
  try {
    const { filePath } = sessionWorldModelPaths(journalRootDir, sessionRef);
    const stats = lstatSync(filePath);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_SESSION_WORLD_MODEL_FILE_BYTES) {
      return null;
    }
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    const state = parseSessionMiniWorldModelV2(parsed);
    if (!state || state.session_ref !== sessionRef) return null;
    return state;
  } catch {
    return null;
  }
}

/**
 * Dedicated session-world-model file lock (independent of per-turn `.lock`).
 */
export async function withSessionWorldModelLock<T>(
  lockPath: string,
  operation: () => Promise<T> | T,
  options: {
    readonly maxAttempts?: number;
    readonly retryDelayMs?: number;
  } = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_LOCK_MAX_ATTEMPTS);
  const retryDelayMs = Math.max(1, options.retryDelayMs ?? DEFAULT_LOCK_RETRY_DELAY_MS);
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  let descriptor: number | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      descriptor = openSync(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      writeFileSync(descriptor, `${process.pid}\n`);
      break;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      if (attempt + 1 < maxAttempts) {
        await new Promise((resolveWait) => setTimeout(resolveWait, retryDelayMs));
      }
    }
  }
  if (descriptor === null) throw new Error('session_world_model_lock_timeout');
  let operationError: unknown;
  try {
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    let releaseError: unknown;
    try {
      closeSync(descriptor);
    } catch (error) {
      releaseError = error;
    }
    try {
      unlinkSync(lockPath);
    } catch (error) {
      releaseError ??= error;
    }
    if (releaseError && operationError === undefined) {
      throw new Error('session_world_model_lock_release_failed', { cause: releaseError });
    }
  }
}

/**
 * Atomically persists a v2 session mini world model under the dedicated lock
 * `journalRoot/<sessionRef>/.session-world-model.lock`.
 *
 * Enforces strict monotonic `turn_sequence`: rejects/skips any write where
 * `existing.turn_sequence >= incoming.turn_sequence` to prevent out-of-order
 * async Stop overwrites. Writes via temp file (`0o600`) + `fsyncSync` + `renameSync`.
 */
export async function writeSessionMiniWorldModelV2(
  journalRootDir: string,
  sessionRef: string,
  incoming: SessionMiniWorldModelV2,
  options: {
    readonly lockMaxAttempts?: number;
    readonly lockRetryDelayMs?: number;
  } = {},
): Promise<SessionWorldModelWriteResult> {
  const validated = parseSessionMiniWorldModelV2(incoming);
  if (!validated) {
    return { written: false, reason: 'invalid_state' };
  }
  if (!isSafeSessionRef(sessionRef) || validated.session_ref !== sessionRef) {
    return { written: false, reason: 'session_ref_mismatch' };
  }

  const { directory, filePath, lockPath } = sessionWorldModelPaths(journalRootDir, sessionRef);
  return withSessionWorldModelLock(
    lockPath,
    () => {
      const existing = readSessionMiniWorldModelV2(journalRootDir, sessionRef);
      if (existing !== null && existing.turn_sequence >= validated.turn_sequence) {
        return { written: false, reason: 'stale_turn_sequence' as const };
      }

      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const tempPath = join(
        directory,
        `.${SESSION_WORLD_MODEL_FILENAME}.${process.pid}.${randomUUID()}.tmp`,
      );
      let descriptor: number | null = null;
      let renamed = false;
      try {
        descriptor = openSync(
          tempPath,
          fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
          0o600,
        );
        writeFileSync(descriptor, `${JSON.stringify(validated)}\n`);
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = null;
        renameSync(tempPath, filePath);
        renamed = true;
      } finally {
        if (descriptor !== null) {
          try {
            closeSync(descriptor);
          } catch {
            // Preserve the primary write error.
          }
        }
        if (!renamed) {
          try {
            unlinkSync(tempPath);
          } catch {
            // Best-effort temp cleanup.
          }
        }
      }
      return { written: true, state: validated };
    },
    {
      maxAttempts: options.lockMaxAttempts,
      retryDelayMs: options.lockRetryDelayMs,
    },
  );
}

function clipText(value: string, maxChars: number): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').trim();
  const chars = [...cleaned];
  return chars.length <= maxChars ? cleaned : `${chars.slice(0, Math.max(1, maxChars - 1)).join('')}…`;
}

function sanitizeSafeItems(
  items: readonly string[] | undefined,
  containsCredential: (text: string) => boolean,
  maxItems: number,
  maxChars: number,
): string[] {
  if (!items) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    if (typeof raw !== 'string') continue;
    if (containsCredential(raw)) continue;
    const clipped = clipText(raw, maxChars);
    if (!clipped || containsCredential(clipped) || AUDIT_LINE_STRIP_PREFIX.test(clipped)) continue;
    if (seen.has(clipped)) continue;
    seen.add(clipped);
    out.push(clipped);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * Render an ephemeral 2-layer session mini world model for `UserPromptSubmit` `additionalContext`.
 * Reserves header & footer budget first, then trims elements in reverse priority order:
 *   normative -> open -> rejected -> superseded -> confirmed -> thesis -> invariant (protected LAST).
 * Guarantees valid JSON arrays, intact footer, credential filtering, and total length <= 850 code points.
 * Returns `null` when all fields are empty after sanitization.
 */
export function renderSessionMiniWorldModelPinV2(
  state: SessionMiniWorldModelV2,
  containsCredential: (text: string) => boolean = containsJudgmentFrameCredential,
): string | null {
  const rawThesis = typeof state.steelman_thesis === 'string' ? state.steelman_thesis : '';
  const thesisRaw = containsCredential(rawThesis)
    ? ''
    : clipText(rawThesis, WM_V2_LIMITS.MAX_THESIS_CHARS);
  const thesis = thesisRaw && !containsCredential(thesisRaw) && !AUDIT_LINE_STRIP_PREFIX.test(thesisRaw)
    ? thesisRaw
    : '';
  const invariant = sanitizeSafeItems(
    state.invariant_constraints,
    containsCredential,
    WM_V2_LIMITS.MAX_INVARIANT_ITEMS,
    WM_V2_LIMITS.MAX_INVARIANT_CHARS,
  );
  const superseded = sanitizeSafeItems(
    state.superseded_edges,
    containsCredential,
    WM_V2_LIMITS.MAX_SUPERSEDED_ITEMS,
    WM_V2_LIMITS.MAX_SUPERSEDED_CHARS,
  );
  const confirmed = sanitizeSafeItems(
    state.confirmed_edges,
    containsCredential,
    WM_V2_LIMITS.MAX_PIN_ITEMS,
    WM_V2_LIMITS.MAX_ITEM_CHARS,
  );
  const open = sanitizeSafeItems(
    state.open_edges,
    containsCredential,
    WM_V2_LIMITS.MAX_PIN_ITEMS,
    WM_V2_LIMITS.MAX_ITEM_CHARS,
  );
  const normative = sanitizeSafeItems(
    state.separated_normative_questions,
    containsCredential,
    WM_V2_LIMITS.MAX_PIN_ITEMS,
    WM_V2_LIMITS.MAX_ITEM_CHARS,
  );
  const rejected = sanitizeSafeItems(
    state.rejected_false_premises,
    containsCredential,
    WM_V2_LIMITS.MAX_PIN_ITEMS,
    WM_V2_LIMITS.MAX_ITEM_CHARS,
  );

  if (
    !thesis
    && invariant.length === 0
    && superseded.length === 0
    && confirmed.length === 0
    && open.length === 0
    && normative.length === 0
    && rejected.length === 0
  ) {
    return null;
  }

  const header = '[Session Mini World Model v2（不変制約保護・作業前提ピン留め・巻き戻し禁止）]';
  const footer =
    '※ invariant_constraints は厳守し、confirmed_edges / superseded_edges / rejected_false_premises を巻き戻さず、反証ID(ref-等)・評価ID(eval-等)と具体数値を明示引用して open_edges との差分だけ前へ進めること。';

  let t = thesis;
  const buckets = {
    invariant: [...invariant],
    confirmed: [...confirmed],
    superseded: [...superseded],
    rejected: [...rejected],
    open: [...open],
    normative: [...normative],
  };

  const build = (): string => [
    header,
    ...(t ? [`- Steelman 幹: ${t}`] : []),
    `- invariant_constraints: ${JSON.stringify(buckets.invariant)}`,
    `- confirmed_edges: ${JSON.stringify(buckets.confirmed)}`,
    ...(buckets.superseded.length > 0 ? [`- superseded_edges: ${JSON.stringify(buckets.superseded)}`] : []),
    `- open_edges: ${JSON.stringify(buckets.open)}`,
    ...(buckets.normative.length > 0 ? [`- separated_normative: ${JSON.stringify(buckets.normative)}`] : []),
    `- rejected_false_premises: ${JSON.stringify(buckets.rejected)}`,
    footer,
  ].join('\n');

  const preThesisTrimOrder: Array<keyof typeof buckets> = [
    'normative',
    'open',
    'rejected',
    'superseded',
    'confirmed',
  ];

  while ([...build()].length > WM_V2_LIMITS.MAX_PIN_TOTAL_CHARS) {
    let trimmed = false;
    for (const key of preThesisTrimOrder) {
      if (buckets[key].length > 0) {
        buckets[key].pop();
        trimmed = true;
        break;
      }
    }
    if (!trimmed) {
      const thesisCodePoints = [...t];
      if (thesisCodePoints.length > 0) {
        t = thesisCodePoints.length > 20 ? clipText(t, Math.floor(thesisCodePoints.length / 2)) : '';
      } else if (buckets.invariant.length > 0) {
        // Last resort only if invariant items themselves exceed the entire 850-char budget.
        buckets.invariant.pop();
      } else {
        break;
      }
    }
  }
  return build();
}

function sanitizeIds(
  ids: readonly string[] | undefined,
  containsCredential: (text: string) => boolean,
): string[] {
  if (!ids) return [];
  return [
    ...new Set(
      ids
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && !containsCredential(id)),
    ),
  ];
}

export function toLearningCandidateEvidenceDraftFromSessionWMV2(
  state: SessionMiniWorldModelV2,
  options: {
    readonly proposedChangeNote: string;
    readonly observedCounterexamples?: readonly string[];
    readonly competingModels?: SessionWMLearningEvidenceDraftV2['competingModels'];
    /** Defaults to `containsJudgmentFrameCredential` from `src/judgment-frame.ts`. */
    readonly containsCredential?: (text: string) => boolean;
  },
): SessionWMLearningEvidenceDraftResultV2 {
  const containsCredential = options.containsCredential ?? containsJudgmentFrameCredential;
  const grounds = sanitizeSafeItems(
    [
      ...state.invariant_constraints,
      ...state.confirmed_edges,
      ...state.superseded_edges,
    ],
    containsCredential,
    24,
    400,
  );
  const uncertainty = sanitizeSafeItems(state.open_edges, containsCredential, 16, 400);

  const missing: Array<'grounds' | 'uncertainty'> = [];
  if (grounds.length === 0) missing.push('grounds');
  if (uncertainty.length === 0) missing.push('uncertainty');
  if (missing.length > 0) {
    return { ok: false, missing_required_fields: missing };
  }

  const counterexamples = sanitizeSafeItems(
    [...(options.observedCounterexamples ?? []), ...state.rejected_false_premises],
    containsCredential,
    16,
    400,
  );

  const addressedRefutationIds = sanitizeIds(state.referenced_refutation_ids, containsCredential);
  const addressedEvalIds = sanitizeIds(state.referenced_eval_ids, containsCredential);

  const competingModels = (options.competingModels ?? []).filter(
    (m) =>
      !containsCredential(m.hypothesis)
      && !containsCredential(m.comparison)
      && (!m.ref || !containsCredential(m.ref)),
  );

  return {
    ok: true,
    draft: {
      proposedChangeNote: containsCredential(options.proposedChangeNote)
        ? ''
        : options.proposedChangeNote.trim(),
      grounds,
      counterexamples,
      uncertainty,
      ...(addressedRefutationIds.length > 0 ? { addressedRefutationIds } : {}),
      ...(addressedEvalIds.length > 0 ? { addressedEvalIds } : {}),
      ...(competingModels.length > 0 ? { competingModels } : {}),
    },
  };
}
