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
  readonly fingerprint: string;
  readonly org_id: string;
  readonly project_id: string;
  readonly state: 'waiting_human';
  readonly review_package: UnknownRecord;
  readonly verified_loop_intents: readonly string[];
  readonly created_at: string;
  readonly actor_id: string | null;
}

export interface MeetingAutomationRuntimePorts {
  readonly ledger: {
    findByIdempotencyKey?: (key: string, scope: { org_id: string; project_id: string }) => MaybePromise<MeetingAutomationRuntimeRecord | null>;
    save: (record: MeetingAutomationRuntimeRecord) => MaybePromise<MeetingAutomationRuntimeRecord | void>;
    readback?: (recordId: string, scope: { org_id: string; project_id: string }) => MaybePromise<MeetingAutomationRuntimeRecord | null>;
  };
  readonly resolveTaskOwners?: (input: UnknownRecord, context: UnknownRecord) => MaybePromise<UnknownRecord>;
  readonly prepareWorkflow?: (input: UnknownRecord) => MaybePromise<UnknownRecord | void>;
  readonly bridgeKnowledge?: (input: UnknownRecord) => MaybePromise<UnknownRecord | void>;
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
  const normalizedPackage = normalizeReviewPackage(input);
  const ownerResolved = ports.resolveTaskOwners
    ? await ports.resolveTaskOwners({ task_candidates: normalizedPackage.task_candidates }, { org_id: orgId, project_id: projectId })
    : null;
  const reviewPackageWithOwners = ownerResolved?.task_candidates
    ? { ...normalizedPackage, task_candidates: ownerResolved.task_candidates }
    : normalizedPackage;
  const verified = verifyMeetingReviewPackage({
    repository: input.loop_intent_repository,
    reviewPackage: normalizedPackage as MeetingReviewPackage,
    orgId,
    projectId,
  });
  const fingerprint = digest({ org_id: orgId, project_id: projectId, review_package: reviewPackageWithOwners });
  const idempotencyKey = typeof input.idempotency_key === 'string' && input.idempotency_key.trim()
    ? input.idempotency_key.trim()
    : `meeting-review:${orgId}:${projectId}:${fingerprint}`;
  const scope = { org_id: orgId, project_id: projectId };
  const replay = await ports.ledger.findByIdempotencyKey?.(idempotencyKey, scope);
  if (replay) {
    const readback = await ports.ledger.readback?.(replay.record_id, scope) ?? replay;
    if (readback.fingerprint !== fingerprint) {
      throw new MeetingAutomationRuntimeError('idempotency_conflict', 'idempotency key is already bound to a different review package', {
        idempotency_key: idempotencyKey,
      });
    }
    return {
      status: 'replayed',
      idempotent: true,
      attempts: 0,
      record: replay,
      readback,
      verified,
      workflow: null,
      knowledge: null,
    };
  }

  const workflow = await ports.prepareWorkflow?.({ org_id: orgId, project_id: projectId, review_package: reviewPackageWithOwners }) ?? null;
  const knowledge = await ports.bridgeKnowledge?.({ org_id: orgId, project_id: projectId, review_package: reviewPackageWithOwners }) ?? null;
  const now = (ports.now ?? (() => new Date()))().toISOString();
  const record: MeetingAutomationRuntimeRecord = {
    record_id: `mrev_${fingerprint.slice(0, 32)}`,
    idempotency_key: idempotencyKey,
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
  const readback = await ports.ledger.readback?.(persisted.record.record_id, scope) ?? persisted.record;
  if (readback.fingerprint !== persisted.record.fingerprint) {
    throw new MeetingAutomationRuntimeError('readback_mismatch', 'meeting automation ledger readback did not match the persisted record', {
      record_id: persisted.record.record_id,
    });
  }
  return {
    status: 'persisted',
    idempotent: false,
    attempts: persisted.attempts,
    record: persisted.record,
    readback,
    verified,
    workflow,
    knowledge,
  };
}
