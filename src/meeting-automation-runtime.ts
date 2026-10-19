import { createHash } from 'node:crypto';

import {
  assertMeetingCandidatesInput,
  normalizeDecisionCandidates,
  normalizeFollowUpDraft,
  normalizeTaskCandidates,
  verifyMeetingReviewPackage,
  type MeetingReviewPackage,
  type VerifiedMeetingReviewPackage,
} from './meeting-automation.js';

export const MEETING_AUTOMATION_RUNTIME_VERSION = 'brainbase.meeting-automation-runtime.v1' as const;

type UnknownRecord = Record<string, unknown>;
type MaybePromise<T> = T | Promise<T>;

export interface MeetingAutomationRuntimeInput {
  readonly org_id: string;
  readonly project_id: string;
  readonly review_package: MeetingReviewPackage;
  readonly loop_intent_repository: Parameters<typeof verifyMeetingReviewPackage>[0]['repository'];
  readonly source_event?: UnknownRecord;
  readonly case_scope?: string | null;
  readonly actor_id?: string | null;
  readonly idempotency_key?: string | null;
  readonly evidence_refs?: readonly unknown[];
}
export interface MeetingAutomationRuntimeRecord {
  readonly record_id: string;
  readonly idempotency_key: string;
  /** Fingerprint of the normalized package before owner resolution. */
  readonly input_fingerprint?: string;
  readonly fingerprint: string;
  readonly org_id: string;
  readonly project_id: string;
  readonly state: 'waiting_human';
  readonly review_package: UnknownRecord;
  readonly verified_loop_intents: readonly string[];
  readonly created_at: string;
  readonly actor_id: string | null;
}

export interface MeetingAutomationRuntimeExecution {
  readonly record: MeetingAutomationRuntimeRecord;
  readonly attempts: number;
  readonly workflow: UnknownRecord | null;
  readonly knowledge: UnknownRecord | null;
}

export interface MeetingAutomationRuntimeClaimRequest {
  readonly idempotency_key: string;
  readonly fingerprint: string;
  readonly scope: { readonly org_id: string; readonly project_id: string };
  readonly execute: () => MaybePromise<MeetingAutomationRuntimeExecution>;
}

export interface MeetingAutomationRuntimeClaimResult {
  readonly status: 'persisted' | 'replayed';
  readonly execution: MeetingAutomationRuntimeExecution;
}

export interface MeetingAutomationRuntimePorts {
  readonly ledger: {
    /**
     * Atomically claims an idempotency key, executes the complete workflow,
     * and returns the durable execution on both the winner and replayers.
     * The host must back this with a durable transaction/claim, not a local
     * in-memory lock.
     */
    readonly claimOrReplay: (request: MeetingAutomationRuntimeClaimRequest) => MaybePromise<MeetingAutomationRuntimeClaimResult>;
    findByIdempotencyKey?: (key: string, scope: { org_id: string; project_id: string }) => MaybePromise<MeetingAutomationRuntimeRecord | null>;
    save: (record: MeetingAutomationRuntimeRecord) => MaybePromise<MeetingAutomationRuntimeRecord | void>;
    readonly readback: (recordId: string, scope: { org_id: string; project_id: string }) => MaybePromise<MeetingAutomationRuntimeRecord | null>;
  };
  readonly resolveTaskOwners?: (input: UnknownRecord, context: UnknownRecord) => MaybePromise<UnknownRecord>;
  readonly prepareWorkflow?: (input: UnknownRecord) => MaybePromise<UnknownRecord | void>;
  readonly bridgeKnowledge?: (input: UnknownRecord) => MaybePromise<UnknownRecord | void>;
  /**
   * The host implements this with a durable post-commit outbox/effect ledger.
   * It must persist the effect key across worker restarts; a process-local
   * mutex is not sufficient for knowledge bridge idempotency.
   */
  readonly runOnce?: <T>(effectKey: string, effect: () => MaybePromise<T>) => MaybePromise<T>;
  readonly now?: () => Date;
  readonly max_attempts?: number;
  readonly is_retryable?: (error: unknown) => boolean;
}

export class MeetingAutomationRuntimeError extends Error {
  readonly code: string;
  readonly details: UnknownRecord;

  constructor(code: string, message: string, details: UnknownRecord = {}) {
    super(message);
    this.name = 'MeetingAutomationRuntimeError';
    this.code = code;
    this.details = details;
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as UnknownRecord).sort().map((key) => [key, stable((value as UnknownRecord)[key])]));
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function requireScope(value: unknown, field: 'org_id' | 'project_id'): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new MeetingAutomationRuntimeError('invalid_scope', `${field} is required`, { field });
  }
  return value.trim();
}

function retryable(error: unknown, ports: MeetingAutomationRuntimePorts): boolean {
  return ports.is_retryable?.(error) ?? Boolean((error as { retryable?: boolean } | null)?.retryable);
}

function normalizeReviewPackage(input: MeetingAutomationRuntimeInput): UnknownRecord {
  const reviewPackage = input.review_package as UnknownRecord;
  assertMeetingCandidatesInput(reviewPackage);
  const caseScope = input.case_scope ?? (typeof reviewPackage.case_scope === 'string' ? reviewPackage.case_scope : null);
  const evidenceRefs = Array.isArray(input.evidence_refs) ? [...input.evidence_refs] : [];
  const normalizedTaskCandidates = normalizeTaskCandidates(reviewPackage.task_candidates, {
    caseScope,
    evidenceRefs,
  });
  const normalizedDecisionCandidates = normalizeDecisionCandidates(reviewPackage.decision_candidates, {
    caseScope,
    evidenceRefs,
  });
  return {
    ...reviewPackage,
    task_candidates: normalizedTaskCandidates,
    decision_candidates: normalizedDecisionCandidates,
    follow_up_draft: normalizeFollowUpDraft(reviewPackage.follow_up_draft),
  };
}

async function saveWithRetry(
  record: MeetingAutomationRuntimeRecord,
  ports: MeetingAutomationRuntimePorts,
): Promise<{ record: MeetingAutomationRuntimeRecord; attempts: number }> {
  const maxAttempts = Math.max(1, Math.min(5, ports.max_attempts ?? 2));
  let attempts = 0;
  let lastError: unknown;
  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const saved = await ports.ledger.save(record);
      return { record: saved ?? record, attempts };
    } catch (error) {
      lastError = error;
      if (!retryable(error, ports) || attempts >= maxAttempts) throw error;
    }
  }
  throw new MeetingAutomationRuntimeError('persist_failed', 'meeting automation record could not be persisted', {
    attempts,
    cause: lastError instanceof Error ? lastError.message : String(lastError),
  });
}

export interface MeetingAutomationRuntimeResult {
  readonly status: 'persisted' | 'replayed';
  readonly idempotent: boolean;
  readonly attempts: number;
  readonly record: MeetingAutomationRuntimeRecord;
  readonly readback: MeetingAutomationRuntimeRecord;
  readonly verified: VerifiedMeetingReviewPackage;
  readonly workflow: UnknownRecord | null;
  readonly knowledge: UnknownRecord | null;
}

/**
 * Provider-independent orchestration for meeting review package ingestion.
 * The host owns workflow, Graph, identity and durable ledger ports; this core
 * owns validation, normalization, replay keys, retry and persisted readback.
 */
export async function runMeetingAutomationRuntime(
  input: MeetingAutomationRuntimeInput,
  ports: MeetingAutomationRuntimePorts,
): Promise<MeetingAutomationRuntimeResult> {
  const orgId = requireScope(input.org_id, 'org_id');
  const projectId = requireScope(input.project_id, 'project_id');
  if (!ports?.ledger || typeof ports.ledger.save !== 'function') {
    throw new MeetingAutomationRuntimeError('invalid_ports', 'a meeting review ledger save port is required');
  }
  if (typeof ports.ledger.claimOrReplay !== 'function' || typeof ports.ledger.readback !== 'function') {
    throw new MeetingAutomationRuntimeError(
      'invalid_ports',
      'meeting review ledger claimOrReplay and durable readback ports are required',
    );
  }
  const normalizedPackage = normalizeReviewPackage(input);
  // Keep the incoming contract separate from the persisted post-owner
  // fingerprint. Owner resolution may add fields, while an explicit
  // idempotency key must still reject a replay carrying a different input
  // package. Ingestion time is intentionally excluded.
  const inputFingerprint = digest({ org_id: orgId, project_id: projectId, review_package: normalizedPackage });

  // An explicit key can be replayed before owner/Graph work.  This keeps a
  // duplicate delivery from doing any host-side resolution while the atomic
  // claim below remains the authority for a concurrent miss.
  const explicitIdempotencyKey = typeof input.idempotency_key === 'string' && input.idempotency_key.trim()
    ? input.idempotency_key.trim()
    : null;
  const earlyReplay = explicitIdempotencyKey && ports.ledger.findByIdempotencyKey
    ? await ports.ledger.findByIdempotencyKey(explicitIdempotencyKey, { org_id: orgId, project_id: projectId })
    : null;
  if (earlyReplay) {
    const readback = await ports.ledger.readback(earlyReplay.record_id, { org_id: orgId, project_id: projectId });
    if (!readback) {
      throw new MeetingAutomationRuntimeError('readback_mismatch', 'meeting automation ledger replay was not durable', {
        record_id: earlyReplay.record_id,
      });
    }
    if (readback.input_fingerprint && readback.input_fingerprint !== inputFingerprint) {
      throw new MeetingAutomationRuntimeError('idempotency_conflict', 'meeting automation replay input differs from the claimed key', {
        idempotency_key: explicitIdempotencyKey,
      });
    }
    const replayPackage = readback.review_package as MeetingReviewPackage;
    const verified = verifyMeetingReviewPackage({
      repository: input.loop_intent_repository,
      reviewPackage: replayPackage,
      orgId,
      projectId,
    });
    if (readback.idempotency_key !== explicitIdempotencyKey) {
      throw new MeetingAutomationRuntimeError('idempotency_conflict', 'idempotency key replay returned a different key', {
        idempotency_key: explicitIdempotencyKey,
      });
    }
    const knowledge = await runKnowledgeBridge({
      ports,
      orgId,
      projectId,
      reviewPackage: replayPackage,
      record: readback,
      idempotencyKey: explicitIdempotencyKey,
    });
    return {
      status: 'replayed',
      idempotent: true,
      attempts: 0,
      record: readback,
      readback,
      verified,
      workflow: null,
      knowledge,
    };
  }

  const ownerResolved = ports.resolveTaskOwners
    ? await ports.resolveTaskOwners({ task_candidates: normalizedPackage.task_candidates }, { org_id: orgId, project_id: projectId })
    : null;
  const reviewPackageWithOwners = ownerResolved?.task_candidates
    ? { ...normalizedPackage, task_candidates: ownerResolved.task_candidates }
    : normalizedPackage;
  // Owner resolution is an injected host port.  Re-run the candidate input
  // contract after it returns so a resolver cannot replace the normalized
  // package with an invalid candidate shape before the review verification.
  assertMeetingCandidatesInput(reviewPackageWithOwners);
  const verified = verifyMeetingReviewPackage({
    repository: input.loop_intent_repository,
    // Owner resolution changes the contract being persisted.  Verify the
    // resolved package itself so an injected/host resolver cannot bypass the
    // review-package contract.
    reviewPackage: reviewPackageWithOwners as MeetingReviewPackage,
    orgId,
    projectId,
  });
  const fingerprint = digest({ org_id: orgId, project_id: projectId, review_package: reviewPackageWithOwners });
  const idempotencyKey = explicitIdempotencyKey
    ? explicitIdempotencyKey
    : `meeting-review:${orgId}:${projectId}:${fingerprint}`;
  const scope = { org_id: orgId, project_id: projectId };

  const claim = await ports.ledger.claimOrReplay({
    idempotency_key: idempotencyKey,
    fingerprint,
    scope,
    execute: async () => {
      const workflow = await ports.prepareWorkflow?.({
        org_id: orgId,
        project_id: projectId,
        review_package: reviewPackageWithOwners,
        idempotency_key: idempotencyKey,
      }) ?? null;
      const now = (ports.now ?? (() => new Date()))().toISOString();
      const record: MeetingAutomationRuntimeRecord = {
        record_id: `mrev_${fingerprint.slice(0, 32)}`,
        idempotency_key: idempotencyKey,
        input_fingerprint: inputFingerprint,
        fingerprint,
        org_id: orgId,
        project_id: projectId,
        state: 'waiting_human',
        review_package: reviewPackageWithOwners,
        verified_loop_intents: verified.loopIntents.map(({ loop_intent }) => String(loop_intent.id ?? '')),
        created_at: now,
        actor_id: input.actor_id ?? null,
      };
      const persisted = await saveWithRetry(record, ports);
      return {
        record: persisted.record,
        attempts: persisted.attempts,
        workflow,
        knowledge: null,
      };
    },
  });
  const execution = claim.execution;
  if (execution.record.input_fingerprint && execution.record.input_fingerprint !== inputFingerprint) {
    throw new MeetingAutomationRuntimeError('idempotency_conflict', 'meeting automation claim returned a different input package', {
      idempotency_key: idempotencyKey,
    });
  }
  const readback = await ports.ledger.readback(execution.record.record_id, scope);
  if (!readback || readback.fingerprint !== execution.record.fingerprint) {
    throw new MeetingAutomationRuntimeError('readback_mismatch', 'meeting automation ledger readback did not match the persisted record', {
      record_id: execution.record.record_id,
    });
  }
  const knowledge = await runKnowledgeBridge({
    ports,
    orgId,
    projectId,
    reviewPackage: execution.record.review_package as MeetingReviewPackage,
    record: readback,
    idempotencyKey,
  });
  return {
    status: claim.status,
    idempotent: claim.status === 'replayed',
    attempts: claim.status === 'replayed' ? 0 : execution.attempts,
    record: execution.record,
    readback,
    verified,
    workflow: claim.status === 'replayed' ? null : execution.workflow,
    knowledge,
  };
}

async function runKnowledgeBridge({
  ports,
  orgId,
  projectId,
  reviewPackage,
  record,
  idempotencyKey,
}: {
  ports: MeetingAutomationRuntimePorts;
  orgId: string;
  projectId: string;
  reviewPackage: MeetingReviewPackage;
  record: MeetingAutomationRuntimeRecord;
  idempotencyKey: string;
}): Promise<UnknownRecord | null> {
  if (!ports.bridgeKnowledge) return null;
  if (!ports.runOnce) {
    throw new MeetingAutomationRuntimeError(
      'invalid_ports',
      'meeting automation knowledge bridge requires a durable post-commit runOnce port',
    );
  }
  const knowledge = await ports.runOnce(
    `meeting-review:${idempotencyKey}:knowledge-bridge`,
    () => ports.bridgeKnowledge?.({
      org_id: orgId,
      project_id: projectId,
      review_package: reviewPackage,
      record,
      idempotency_key: idempotencyKey,
    }) ?? null,
  );
  return (knowledge ?? null) as UnknownRecord | null;
}
