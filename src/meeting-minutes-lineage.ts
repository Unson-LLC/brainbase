import { createHash } from 'node:crypto';
import { initializePersonalOs, mutatePersonalOsWithSidecar, readPersonalOsSidecar } from './ssot.js';

/**
 * The minutes lineage ledger stores references and lifecycle events only.
 * Meeting body content, judgment state, Task state, and execution receipts
 * remain owned by their existing providers.
 */
export const MEETING_MINUTES_LINEAGE_CONTRACT_VERSION = '0.1.0' as const;
export const MEETING_MINUTES_LINEAGE_CATALOG_VERSION = 1 as const;
export const MEETING_MINUTES_LINEAGE_SIDECAR = 'evidence/meeting-minutes-lineage.json' as const;

export type MinutesLineageCandidateKind = 'judgment' | 'task';
export type MinutesLineageEpistemicStatus = 'confirmed' | 'inferred';
export type MinutesLineageConfirmationStatus = 'unconfirmed' | 'confirmed';
export type MinutesLineageAdoptionStatus = 'not_adopted' | 'adopted';
export type MinutesLineageExecutionStatus = 'unrecorded' | 'actual';
export type MinutesLineageResultStatus = 'unrecorded' | 'accepted';
export type MinutesLineageReviewStatus = 'clear' | 'review_required';

export interface MinutesLineageAccess {
  readonly principal: string;
  readonly [key: string]: unknown;
}

export interface MinutesLineageActor {
  readonly type: 'person' | 'agent' | 'service' | 'system';
  readonly id: string;
}

/**
 * A source-owned, exact minutes reference. `contentDigest: null` preserves a
 * source that did not record a digest; the lineage layer never calculates a
 * replacement digest and labels it as source evidence.
 */
export interface MinutesVersionReference {
  readonly meetingId: string;
  readonly minutesId: string;
  readonly versionId: string;
  readonly contentDigest: string | null;
  readonly locator: unknown;
  readonly provenance: MinutesProvenance;
}

export interface MinutesProvenance {
  readonly providerKind: string;
  readonly providerId: string;
  readonly revision?: string;
  readonly digest?: string;
}

export interface MinutesVersionRead {
  readonly reference: MinutesVersionReference;
}

/** The native minutes owner must enforce its current ACL before returning. */
export interface MinutesVersionPort {
  readExact(reference: MinutesVersionReference, access: MinutesLineageAccess): Promise<MinutesVersionRead | null>;
}

export interface JudgmentTargetReference {
  readonly kind: 'judgment';
  readonly id: string;
  readonly revision: string;
  readonly digest: string;
}

export interface TaskTargetReference {
  readonly kind: 'task';
  readonly id: string;
  readonly version: number;
  readonly digest?: string;
}

export type MinutesLineageTargetReference = JudgmentTargetReference | TaskTargetReference;

export interface AdoptionReference {
  readonly kind: 'judgment_adoption' | 'task_adoption';
  readonly id: string;
  readonly revision: string;
  readonly digest: string;
}

export interface JudgmentAdoptionResult {
  readonly target: JudgmentTargetReference;
  readonly adoption: AdoptionReference;
}

export interface TaskAdoptionResult {
  readonly target: TaskTargetReference;
  readonly adoption: AdoptionReference;
}

export interface JudgmentLineagePort {
  /** Adapt the existing Knowledge promotion or learning adoption service. */
  adopt(input: {
    readonly candidate: MinutesLineageCandidate;
    readonly idempotencyKey: string;
    readonly actor: MinutesLineageActor;
    readonly access: MinutesLineageAccess;
  }): Promise<JudgmentAdoptionResult>;
  /** Re-read the exact target with the provider's current ACL. */
  readExact(target: JudgmentTargetReference, access: MinutesLineageAccess): Promise<unknown | null>;
}

export interface TaskLineagePort {
  /** Adapt the existing Canonical Task service. */
  create(input: {
    readonly candidate: MinutesLineageCandidate;
    readonly idempotencyKey: string;
    readonly actor: MinutesLineageActor;
    readonly access: MinutesLineageAccess;
  }): Promise<TaskAdoptionResult>;
  /** Re-read the exact Task version with the provider's current ACL. */
  readExact(target: TaskTargetReference, access: MinutesLineageAccess): Promise<unknown | null>;
}

export interface ExecutionReceiptReference {
  readonly id: string;
  readonly digest: string;
}

export interface ExecutionReceiptRead {
  readonly reference: ExecutionReceiptReference;
  readonly runId: string;
  readonly target: MinutesLineageTargetReference;
}

export interface ExecutionReceiptPort {
  read(reference: ExecutionReceiptReference, access: MinutesLineageAccess): Promise<ExecutionReceiptRead | null>;
}

export interface ResultReference {
  readonly id: string;
  readonly digest: string;
}

export interface ResultRead {
  readonly reference: ResultReference;
  readonly target: MinutesLineageTargetReference;
}

export interface ResultPort {
  read(reference: ResultReference, access: MinutesLineageAccess): Promise<ResultRead | null>;
}

export interface MinutesLineageStoreOptions {
  readonly dataDir: string;
  readonly minutes: MinutesVersionPort;
  readonly judgment?: JudgmentLineagePort;
  readonly task?: TaskLineagePort;
  readonly receipt?: ExecutionReceiptPort;
  readonly result?: ResultPort;
  readonly now?: () => string;
}

export interface CreateMinutesLineageCandidateRequest {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly actor: MinutesLineageActor;
  readonly evidence: MinutesVersionReference;
  readonly kind: MinutesLineageCandidateKind;
  readonly proposal: unknown;
  readonly epistemicStatus: MinutesLineageEpistemicStatus;
  readonly access: MinutesLineageAccess;
}

export interface MinutesLineageCandidate {
  readonly version: typeof MEETING_MINUTES_LINEAGE_CATALOG_VERSION;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly actor: MinutesLineageActor;
  readonly evidence: MinutesVersionReference;
  readonly evidenceDigest: string;
  readonly kind: MinutesLineageCandidateKind;
  readonly proposal: unknown;
  readonly proposalDigest: string;
  readonly epistemicStatus: MinutesLineageEpistemicStatus;
  readonly createdAt: string;
  readonly digest: string;
}

export interface ConfirmMinutesLineageCandidateRequest {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly candidateId: string;
  readonly actor: MinutesLineageActor;
  readonly evidenceDigest: string;
  readonly access: MinutesLineageAccess;
}

export interface MinutesLineageConfirmation {
  readonly version: typeof MEETING_MINUTES_LINEAGE_CATALOG_VERSION;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly candidateId: string;
  readonly candidateDigest: string;
  readonly actor: MinutesLineageActor;
  readonly evidenceDigest: string;
  readonly confirmedAt: string;
  readonly digest: string;
}

export interface AdoptMinutesLineageRequest {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly candidateId: string;
  readonly actor: MinutesLineageActor;
  readonly access: MinutesLineageAccess;
}

export interface MinutesLineageAdoption {
  readonly version: typeof MEETING_MINUTES_LINEAGE_CATALOG_VERSION;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly candidateId: string;
  readonly candidateDigest: string;
  readonly kind: MinutesLineageCandidateKind;
  readonly target: MinutesLineageTargetReference;
  readonly adoption: AdoptionReference;
  readonly actor: MinutesLineageActor;
  readonly adoptedAt: string;
  readonly digest: string;
}

export interface RecordMinutesLineageExecutionRequest {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly candidateId: string;
  readonly receiptRef: ExecutionReceiptReference;
  readonly actor: MinutesLineageActor;
  readonly access: MinutesLineageAccess;
}

export interface MinutesLineageExecution {
  readonly version: typeof MEETING_MINUTES_LINEAGE_CATALOG_VERSION;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly candidateId: string;
  readonly adoptionId: string;
  readonly target: MinutesLineageTargetReference;
  readonly receiptRef: ExecutionReceiptReference;
  readonly runId: string;
  readonly actor: MinutesLineageActor;
  readonly executedAt: string;
  readonly digest: string;
}

export interface AcceptMinutesLineageResultRequest {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly executionId: string;
  readonly resultRef: ResultReference;
  readonly actor: MinutesLineageActor;
  readonly access: MinutesLineageAccess;
}

export interface MinutesLineageResult {
  readonly version: typeof MEETING_MINUTES_LINEAGE_CATALOG_VERSION;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly executionId: string;
  readonly resultRef: ResultReference;
  readonly target: MinutesLineageTargetReference;
  readonly actor: MinutesLineageActor;
  readonly acceptedAt: string;
  readonly digest: string;
}

export interface MarkMinutesLineageCorrectionRequest {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly previousVersion: MinutesVersionReference;
  readonly replacementVersion: MinutesVersionReference;
  readonly actor: MinutesLineageActor;
  readonly reason: string;
  readonly access: MinutesLineageAccess;
}

export interface MinutesLineageCorrection {
  readonly version: typeof MEETING_MINUTES_LINEAGE_CATALOG_VERSION;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly previousVersion: MinutesVersionReference;
  readonly replacementVersion: MinutesVersionReference;
  readonly affectedCandidateIds: readonly string[];
  readonly actor: MinutesLineageActor;
  readonly reason: string;
  readonly correctedAt: string;
  readonly digest: string;
}

export interface MinutesLineageCandidateView {
  readonly candidate: MinutesLineageCandidate;
  readonly confirmation?: MinutesLineageConfirmation;
  readonly adoption?: MinutesLineageAdoption;
  readonly execution?: MinutesLineageExecution;
  readonly result?: MinutesLineageResult;
  readonly confirmationStatus: MinutesLineageConfirmationStatus;
  readonly adoptionStatus: MinutesLineageAdoptionStatus;
  readonly executionStatus: MinutesLineageExecutionStatus;
  readonly resultStatus: MinutesLineageResultStatus;
  readonly reviewStatus: MinutesLineageReviewStatus;
  readonly targetStatus?: LineageTargetStatus;
}

export interface LineageTargetStatus {
  readonly status: 'available' | 'unavailable' | 'denied';
  readonly reason?: string;
}

export interface MinutesLineageByMinutesVersionView {
  readonly evidence: MinutesVersionReference;
  readonly candidates: readonly MinutesLineageCandidateView[];
  readonly corrections: readonly MinutesLineageCorrection[];
}

export interface MinutesLineageByTargetView {
  readonly target: MinutesLineageTargetReference;
  readonly adoptions: readonly MinutesLineageAdoption[];
  readonly candidates: readonly MinutesLineageCandidateView[];
  readonly sourceStatuses: Readonly<Record<string, LineageTargetStatus>>;
}

export interface MinutesLineageStore {
  createCandidate(request: CreateMinutesLineageCandidateRequest): Promise<MinutesLineageCandidate>;
  readCandidate(id: string, access: MinutesLineageAccess): Promise<MinutesLineageCandidate | null>;
  confirmCandidate(request: ConfirmMinutesLineageCandidateRequest): Promise<MinutesLineageConfirmation>;
  adoptJudgment(request: AdoptMinutesLineageRequest): Promise<MinutesLineageAdoption>;
  adoptTask(request: AdoptMinutesLineageRequest): Promise<MinutesLineageAdoption>;
  recordExecution(request: RecordMinutesLineageExecutionRequest): Promise<MinutesLineageExecution>;
  acceptResult(request: AcceptMinutesLineageResultRequest): Promise<MinutesLineageResult>;
  markCorrection(request: MarkMinutesLineageCorrectionRequest): Promise<MinutesLineageCorrection>;
  readByMinutesVersion(reference: MinutesVersionReference, access: MinutesLineageAccess): Promise<MinutesLineageByMinutesVersionView>;
  readByTarget(target: MinutesLineageTargetReference, access: MinutesLineageAccess): Promise<MinutesLineageByTargetView>;
}

export type MeetingMinutesLineageErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'authorization_denied'
  | 'source_unavailable'
  | 'source_not_found'
  | 'target_unavailable'
  | 'provider_unavailable'
  | 'integrity_mismatch'
  | 'revision_conflict'
  | 'corrupt_record'
  | 'readback_mismatch';

export class MeetingMinutesLineageError extends Error {
  readonly code: MeetingMinutesLineageErrorCode;

  constructor(code: MeetingMinutesLineageErrorCode, message: string) {
    super(message);
    this.name = 'MeetingMinutesLineageError';
    this.code = code;
  }
}

interface LineageLedger {
  readonly version: typeof MEETING_MINUTES_LINEAGE_CATALOG_VERSION;
  readonly candidates: readonly MinutesLineageCandidate[];
  readonly confirmations: readonly MinutesLineageConfirmation[];
  readonly adoptions: readonly MinutesLineageAdoption[];
  readonly executions: readonly MinutesLineageExecution[];
  readonly results: readonly MinutesLineageResult[];
  readonly corrections: readonly MinutesLineageCorrection[];
}

const EMPTY_LEDGER: LineageLedger = {
  version: MEETING_MINUTES_LINEAGE_CATALOG_VERSION,
  candidates: [],
  confirmations: [],
  adoptions: [],
  executions: [],
  results: [],
  corrections: [],
};

export function createMeetingMinutesLineageStore(options: MinutesLineageStoreOptions): MinutesLineageStore {
  if (!options || !isNonEmptyString(options.dataDir)) throw new MeetingMinutesLineageError('invalid_input', 'dataDir is required');
  if (!options.minutes || typeof options.minutes.readExact !== 'function') {
    throw new MeetingMinutesLineageError('invalid_input', 'minutes.readExact is required');
  }
  return new GraphMeetingMinutesLineageStore(options);
}

class GraphMeetingMinutesLineageStore implements MinutesLineageStore {
  private readonly now: () => string;

  constructor(private readonly options: MinutesLineageStoreOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async createCandidate(request: CreateMinutesLineageCandidateRequest): Promise<MinutesLineageCandidate> {
    const access = assertAccess(request.access);
    const input = normalizeCandidateRequest(request);
    await this.readExactMinutes(input.evidence, access);
    const requestDigest = digestJson({
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      actor: input.actor,
      principal: access.principal,
      evidence: input.evidence,
      kind: input.kind,
      proposal: input.proposal,
      epistemicStatus: input.epistemicStatus,
    });
    const candidate: MinutesLineageCandidate = {
      version: MEETING_MINUTES_LINEAGE_CATALOG_VERSION,
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      requestDigest,
      actor: cloneJson(input.actor),
      evidence: cloneJson(input.evidence),
      evidenceDigest: digestJson(input.evidence),
      kind: input.kind,
      proposal: cloneJson(input.proposal),
      proposalDigest: digestJson(input.proposal),
      epistemicStatus: input.epistemicStatus,
      createdAt: this.now(),
      digest: '',
    };
    const complete = withDigest(candidate);
    let committed: MinutesLineageCandidate | undefined;
    await this.mutateLedger((ledger) => {
      const byId = ledger.candidates.find((item) => item.id === complete.id);
      const byKey = ledger.candidates.find((item) => item.idempotencyKey === complete.idempotencyKey);
      if (byId || byKey) {
        const existing = byId ?? byKey!;
        if (existing.requestDigest !== complete.requestDigest) {
          throw new MeetingMinutesLineageError('revision_conflict', `Candidate ${existing.id} already exists with different content`);
        }
        committed = cloneJson(existing);
        return { ledger, result: committed };
      }
      committed = complete;
      return { ledger: { ...ledger, candidates: [...ledger.candidates, complete] }, result: complete };
    });
    if (!committed) throw new MeetingMinutesLineageError('readback_mismatch', `Candidate ${input.id} was not committed`);
    const readback = await this.readCandidate(committed.id, access);
    if (!readback || readback.digest !== committed.digest) {
      throw new MeetingMinutesLineageError('readback_mismatch', `Candidate ${input.id} was not readable after commit`);
    }
    return readback;
  }

  async readCandidate(id: string, access: MinutesLineageAccess): Promise<MinutesLineageCandidate | null> {
    const context = assertAccess(access);
    const candidateId = requireId(id, 'candidate id');
    const ledger = await this.readLedger();
    const candidate = ledger.candidates.find((item) => item.id === candidateId);
    if (!candidate) return null;
    assertDigest(candidate, 'candidate');
    await this.readExactMinutes(candidate.evidence, context);
    return cloneJson(candidate);
  }

  async confirmCandidate(request: ConfirmMinutesLineageCandidateRequest): Promise<MinutesLineageConfirmation> {
    const access = assertAccess(request.access);
    const input = normalizeConfirmationRequest(request);
    const candidate = await this.requireCandidate(input.candidateId, access);
    if (input.evidenceDigest !== candidate.evidenceDigest) {
      throw new MeetingMinutesLineageError('integrity_mismatch', `Candidate ${candidate.id} evidence digest does not match`);
    }
    const requestDigest = digestJson({
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      candidateId: input.candidateId,
      candidateDigest: candidate.digest,
      actor: input.actor,
      principal: access.principal,
      evidenceDigest: input.evidenceDigest,
    });
    const confirmation: MinutesLineageConfirmation = {
      version: MEETING_MINUTES_LINEAGE_CATALOG_VERSION,
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      requestDigest,
      candidateId: candidate.id,
      candidateDigest: candidate.digest,
      actor: cloneJson(input.actor),
      evidenceDigest: input.evidenceDigest,
      confirmedAt: this.now(),
      digest: '',
    };
    const complete = withDigest(confirmation);
    let committed: MinutesLineageConfirmation | undefined;
    await this.mutateLedger((ledger) => {
      const existing = ledger.confirmations.find((item) => item.idempotencyKey === complete.idempotencyKey || item.id === complete.id);
      if (existing) {
        if (existing.requestDigest !== complete.requestDigest) throw new MeetingMinutesLineageError('revision_conflict', `Confirmation ${existing.id} already exists with different content`);
        committed = cloneJson(existing);
        return { ledger, result: committed };
      }
      const existingForCandidate = ledger.confirmations.find((item) => item.candidateId === complete.candidateId);
      if (existingForCandidate) {
        if (existingForCandidate.candidateDigest !== complete.candidateDigest) throw new MeetingMinutesLineageError('integrity_mismatch', `Candidate ${candidate.id} changed before confirmation`);
        committed = cloneJson(existingForCandidate);
        return { ledger, result: committed };
      }
      committed = complete;
      return { ledger: { ...ledger, confirmations: [...ledger.confirmations, complete] }, result: complete };
    });
    if (!committed) throw new MeetingMinutesLineageError('readback_mismatch', `Confirmation ${input.id} was not committed`);
    return committed;
  }

  async adoptJudgment(request: AdoptMinutesLineageRequest): Promise<MinutesLineageAdoption> {
    return this.adopt(request, 'judgment');
  }

  async adoptTask(request: AdoptMinutesLineageRequest): Promise<MinutesLineageAdoption> {
    return this.adopt(request, 'task');
  }

  private async adopt(request: AdoptMinutesLineageRequest, kind: MinutesLineageCandidateKind): Promise<MinutesLineageAdoption> {
    const access = assertAccess(request.access);
    const input = normalizeAdoptionRequest(request);
    const candidate = await this.requireCandidate(input.candidateId, access);
    if (candidate.kind !== kind) throw new MeetingMinutesLineageError('invalid_input', `Candidate ${candidate.id} is not a ${kind} candidate`);
    const confirmation = await this.readConfirmation(candidate.id, access);
    if (!confirmation) throw new MeetingMinutesLineageError('invalid_input', `Candidate ${candidate.id} requires explicit confirmation before adoption`);
    const requestDigest = digestJson({
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      candidateId: candidate.id,
      candidateDigest: candidate.digest,
      kind,
      actor: input.actor,
      principal: access.principal,
    });
    const ledger = await this.readLedger();
    const existingByKey = ledger.adoptions.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (existingByKey) {
      if (existingByKey.requestDigest !== requestDigest) throw new MeetingMinutesLineageError('revision_conflict', `Adoption key ${input.idempotencyKey} was used with different content`);
      await this.assertTargetReadable(existingByKey.target, access);
      return cloneJson(existingByKey);
    }
    // A candidate is the unit of adoption idempotency. The same minutes
    // version may intentionally produce several candidates and targets, but
    // retrying one candidate with a new transport key must not call the
    // provider a second time.
    const existingForCandidate = ledger.adoptions.find((item) => item.candidateId === candidate.id);
    if (existingForCandidate) {
      if (existingForCandidate.kind !== kind) throw new MeetingMinutesLineageError('revision_conflict', `Candidate ${candidate.id} already has a different adoption kind`);
      await this.assertTargetReadable(existingForCandidate.target, access);
      return cloneJson(existingForCandidate);
    }
    let adopted: JudgmentAdoptionResult | TaskAdoptionResult;
    try {
      if (kind === 'judgment') {
        const provider = this.options.judgment;
        if (!provider) throw new MeetingMinutesLineageError('provider_unavailable', 'judgment adoption provider is not connected');
        adopted = await provider.adopt({ candidate, idempotencyKey: input.idempotencyKey, actor: input.actor, access });
      } else {
        const provider = this.options.task;
        if (!provider) throw new MeetingMinutesLineageError('provider_unavailable', 'task adoption provider is not connected');
        adopted = await provider.create({ candidate, idempotencyKey: input.idempotencyKey, actor: input.actor, access });
      }
    } catch (error) {
      throw mapProviderError(error, `${kind} adoption provider is unavailable`, 'target_unavailable');
    }
    const target = normalizeTarget(adopted?.target);
    if (target.kind !== kind) throw new MeetingMinutesLineageError('integrity_mismatch', `${kind} adoption returned a different target kind`);
    const adoptionReference = normalizeAdoptionReference(adopted?.adoption, kind);
    await this.assertTargetReadable(target, access);
    const record: MinutesLineageAdoption = {
      version: MEETING_MINUTES_LINEAGE_CATALOG_VERSION,
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      requestDigest,
      candidateId: candidate.id,
      candidateDigest: candidate.digest,
      kind,
      target,
      adoption: adoptionReference,
      actor: cloneJson(input.actor),
      adoptedAt: this.now(),
      digest: '',
    };
    const complete = withDigest(record);
    let committed: MinutesLineageAdoption | undefined;
    await this.mutateLedger((nextLedger) => {
      const sameKey = nextLedger.adoptions.find((item) => item.idempotencyKey === complete.idempotencyKey);
      if (sameKey) {
        if (sameKey.requestDigest !== complete.requestDigest) throw new MeetingMinutesLineageError('revision_conflict', `Adoption key ${input.idempotencyKey} was used with different content`);
        committed = cloneJson(sameKey);
        return { ledger: nextLedger, result: committed };
      }
      const sameCandidate = nextLedger.adoptions.find((item) => item.candidateId === complete.candidateId);
      if (sameCandidate) {
        if (sameCandidate.target.kind !== complete.target.kind || !sameTarget(sameCandidate.target, complete.target)) {
          throw new MeetingMinutesLineageError('revision_conflict', `Candidate ${candidate.id} already has a different adoption`);
        }
        committed = cloneJson(sameCandidate);
        return { ledger: nextLedger, result: committed };
      }
      committed = complete;
      return { ledger: { ...nextLedger, adoptions: [...nextLedger.adoptions, complete] }, result: complete };
    });
    if (!committed) throw new MeetingMinutesLineageError('readback_mismatch', `Adoption ${input.id} was not committed`);
    const readback = await this.readAdoption(committed.id, access);
    if (!readback || readback.digest !== committed.digest) throw new MeetingMinutesLineageError('readback_mismatch', `Adoption ${input.id} was not readable after commit`);
    void confirmation;
    return readback;
  }

  async recordExecution(request: RecordMinutesLineageExecutionRequest): Promise<MinutesLineageExecution> {
    const access = assertAccess(request.access);
    const input = normalizeExecutionRequest(request);
    const candidate = await this.requireCandidate(input.candidateId, access);
    const adoption = await this.requireAdoption(candidate.id, access);
    if (!this.options.receipt) throw new MeetingMinutesLineageError('provider_unavailable', 'Execution receipt provider is not connected');
    let receipt: ExecutionReceiptRead | null;
    try {
      receipt = await this.options.receipt.read(input.receiptRef, access);
    } catch (error) {
      throw mapProviderError(error, 'Execution receipt provider is unavailable', 'target_unavailable');
    }
    if (!receipt) throw new MeetingMinutesLineageError('target_unavailable', `Execution receipt ${input.receiptRef.id} is unavailable`);
    const receiptReference = normalizeReceiptReference(receipt.reference);
    if (!sameJson(receiptReference, input.receiptRef)) throw new MeetingMinutesLineageError('integrity_mismatch', `Execution receipt ${input.receiptRef.id} changed`);
    const receiptTarget = normalizeTarget(receipt.target);
    if (!sameTarget(receiptTarget, adoption.target)) throw new MeetingMinutesLineageError('integrity_mismatch', `Execution receipt ${input.receiptRef.id} used a different target version`);
    const runId = requireId(receipt.runId, 'receipt runId');
    const requestDigest = digestJson({
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      candidateId: input.candidateId,
      adoptionId: adoption.id,
      target: adoption.target,
      receiptRef: input.receiptRef,
      runId,
      actor: input.actor,
      principal: access.principal,
    });
    const record: MinutesLineageExecution = {
      version: MEETING_MINUTES_LINEAGE_CATALOG_VERSION,
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      requestDigest,
      candidateId: candidate.id,
      adoptionId: adoption.id,
      target: cloneJson(adoption.target),
      receiptRef: receiptReference,
      runId,
      actor: cloneJson(input.actor),
      executedAt: this.now(),
      digest: '',
    };
    const complete = withDigest(record);
    let committed: MinutesLineageExecution | undefined;
    await this.mutateLedger((ledger) => {
      const existing = ledger.executions.find((item) => item.idempotencyKey === complete.idempotencyKey || item.id === complete.id);
      if (existing) {
        if (existing.requestDigest !== complete.requestDigest) throw new MeetingMinutesLineageError('revision_conflict', `Execution ${existing.id} already exists with different content`);
        committed = cloneJson(existing);
        return { ledger, result: committed };
      }
      committed = complete;
      return { ledger: { ...ledger, executions: [...ledger.executions, complete] }, result: complete };
    });
    if (!committed) throw new MeetingMinutesLineageError('readback_mismatch', `Execution ${input.id} was not committed`);
    const readback = await this.readExecution(committed.id, access);
    if (!readback || readback.digest !== committed.digest) throw new MeetingMinutesLineageError('readback_mismatch', `Execution ${input.id} was not readable after commit`);
    return readback;
  }

  async acceptResult(request: AcceptMinutesLineageResultRequest): Promise<MinutesLineageResult> {
    const access = assertAccess(request.access);
    const input = normalizeResultRequest(request);
    const execution = await this.requireExecution(input.executionId, access);
    if (!this.options.result) throw new MeetingMinutesLineageError('provider_unavailable', 'Result provider is not connected');
    let result: ResultRead | null;
    try {
      result = await this.options.result.read(input.resultRef, access);
    } catch (error) {
      throw mapProviderError(error, 'Result provider is unavailable', 'target_unavailable');
    }
    if (!result) throw new MeetingMinutesLineageError('target_unavailable', `Result ${input.resultRef.id} is unavailable`);
    const resultReference = normalizeResultReference(result.reference);
    if (!sameJson(resultReference, input.resultRef)) throw new MeetingMinutesLineageError('integrity_mismatch', `Result ${input.resultRef.id} changed`);
    const resultTarget = normalizeTarget(result.target);
    if (!sameTarget(resultTarget, execution.target)) throw new MeetingMinutesLineageError('integrity_mismatch', `Result ${input.resultRef.id} points to a different target version`);
    const requestDigest = digestJson({
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      executionId: input.executionId,
      resultRef: input.resultRef,
      target: execution.target,
      actor: input.actor,
      principal: access.principal,
    });
    const record: MinutesLineageResult = {
      version: MEETING_MINUTES_LINEAGE_CATALOG_VERSION,
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      requestDigest,
      executionId: execution.id,
      resultRef: resultReference,
      target: cloneJson(execution.target),
      actor: cloneJson(input.actor),
      acceptedAt: this.now(),
      digest: '',
    };
    const complete = withDigest(record);
    let committed: MinutesLineageResult | undefined;
    await this.mutateLedger((ledger) => {
      const existing = ledger.results.find((item) => item.idempotencyKey === complete.idempotencyKey || item.id === complete.id);
      if (existing) {
        if (existing.requestDigest !== complete.requestDigest) throw new MeetingMinutesLineageError('revision_conflict', `Result ${existing.id} already exists with different content`);
        committed = cloneJson(existing);
        return { ledger, result: committed };
      }
      const existingExecution = ledger.results.find((item) => item.executionId === complete.executionId);
      if (existingExecution) {
        if (!sameJson(existingExecution.resultRef, complete.resultRef)) throw new MeetingMinutesLineageError('revision_conflict', `Execution ${complete.executionId} already has a different accepted result`);
        committed = cloneJson(existingExecution);
        return { ledger, result: committed };
      }
      committed = complete;
      return { ledger: { ...ledger, results: [...ledger.results, complete] }, result: complete };
    });
    if (!committed) throw new MeetingMinutesLineageError('readback_mismatch', `Result ${input.id} was not committed`);
    return committed;
  }

  async markCorrection(request: MarkMinutesLineageCorrectionRequest): Promise<MinutesLineageCorrection> {
    const access = assertAccess(request.access);
    const input = normalizeCorrectionRequest(request);
    await this.readExactMinutes(input.previousVersion, access);
    await this.readExactMinutes(input.replacementVersion, access);
    if (sameMinutesReference(input.previousVersion, input.replacementVersion)) {
      throw new MeetingMinutesLineageError('invalid_input', 'A correction must point to a different exact minutes version');
    }
    const ledger = await this.readLedger();
    const affectedCandidateIds = ledger.candidates
      .filter((candidate) => sameMinutesReference(candidate.evidence, input.previousVersion))
      .map((candidate) => candidate.id);
    const requestDigest = digestJson({
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      previousVersion: input.previousVersion,
      replacementVersion: input.replacementVersion,
      affectedCandidateIds,
      actor: input.actor,
      principal: access.principal,
      reason: input.reason,
    });
    const record: MinutesLineageCorrection = {
      version: MEETING_MINUTES_LINEAGE_CATALOG_VERSION,
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      requestDigest,
      previousVersion: cloneJson(input.previousVersion),
      replacementVersion: cloneJson(input.replacementVersion),
      affectedCandidateIds: [...affectedCandidateIds],
      actor: cloneJson(input.actor),
      reason: input.reason,
      correctedAt: this.now(),
      digest: '',
    };
    const complete = withDigest(record);
    let committed: MinutesLineageCorrection | undefined;
    await this.mutateLedger((nextLedger) => {
      const existing = nextLedger.corrections.find((item) => item.idempotencyKey === complete.idempotencyKey || item.id === complete.id);
      if (existing) {
        if (existing.requestDigest !== complete.requestDigest) throw new MeetingMinutesLineageError('revision_conflict', `Correction ${existing.id} already exists with different content`);
        committed = cloneJson(existing);
        return { ledger: nextLedger, result: committed };
      }
      committed = complete;
      return { ledger: { ...nextLedger, corrections: [...nextLedger.corrections, complete] }, result: complete };
    });
    if (!committed) throw new MeetingMinutesLineageError('readback_mismatch', `Correction ${input.id} was not committed`);
    return committed;
  }

  async readByMinutesVersion(reference: MinutesVersionReference, access: MinutesLineageAccess): Promise<MinutesLineageByMinutesVersionView> {
    const context = assertAccess(access);
    const evidence = normalizeMinutesReference(reference);
    await this.readExactMinutes(evidence, context);
    const ledger = await this.readLedger();
    const candidates = ledger.candidates.filter((candidate) => sameMinutesReference(candidate.evidence, evidence));
    const views = await Promise.all(candidates.map((candidate) => this.projectCandidate(candidate, ledger, context)));
    const corrections = ledger.corrections.filter((correction) =>
      sameMinutesReference(correction.previousVersion, evidence) || sameMinutesReference(correction.replacementVersion, evidence));
    return { evidence: cloneJson(evidence), candidates: views, corrections: cloneJson(corrections) };
  }

  async readByTarget(target: MinutesLineageTargetReference, access: MinutesLineageAccess): Promise<MinutesLineageByTargetView> {
    const context = assertAccess(access);
    const normalizedTarget = normalizeTarget(target);
    await this.assertTargetReadable(normalizedTarget, context);
    const ledger = await this.readLedger();
    const adoptions = ledger.adoptions.filter((item) => sameTarget(item.target, normalizedTarget));
    const candidates: MinutesLineageCandidateView[] = [];
    const sourceStatuses: Record<string, LineageTargetStatus> = {};
    for (const adoption of adoptions) {
      const candidate = ledger.candidates.find((item) => item.id === adoption.candidateId);
      if (!candidate) throw new MeetingMinutesLineageError('integrity_mismatch', `Adoption ${adoption.id} points to missing candidate`);
      try {
        await this.readExactMinutes(candidate.evidence, context);
        sourceStatuses[candidate.id] = { status: 'available' };
      } catch (error) {
        sourceStatuses[candidate.id] = statusFromError(error);
      }
      candidates.push(await this.projectCandidate(candidate, ledger, context, { targetAlreadyRead: true }));
    }
    return { target: normalizedTarget, adoptions: cloneJson(adoptions), candidates, sourceStatuses };
  }

  private async projectCandidate(
    candidate: MinutesLineageCandidate,
    ledger: LineageLedger,
    access: MinutesLineageAccess,
    options: { targetAlreadyRead?: boolean } = {}
  ): Promise<MinutesLineageCandidateView> {
    assertDigest(candidate, 'candidate');
    const confirmation = ledger.confirmations.find((item) => item.candidateId === candidate.id);
    if (confirmation) assertDigest(confirmation, 'confirmation');
    const adoption = ledger.adoptions.find((item) => item.candidateId === candidate.id);
    if (adoption) assertDigest(adoption, 'adoption');
    const execution = adoption ? ledger.executions.find((item) => item.adoptionId === adoption.id) : undefined;
    if (execution) assertDigest(execution, 'execution');
    const result = execution ? ledger.results.find((item) => item.executionId === execution.id) : undefined;
    if (result) assertDigest(result, 'result');
    const reviewRequired = ledger.corrections.some((correction) => correction.affectedCandidateIds.includes(candidate.id));
    let targetStatus: LineageTargetStatus | undefined;
    if (adoption && !options.targetAlreadyRead) targetStatus = await this.targetStatus(adoption.target, access);
    return {
      candidate: cloneJson(candidate),
      ...(confirmation ? { confirmation: cloneJson(confirmation) } : {}),
      ...(adoption ? { adoption: cloneJson(adoption) } : {}),
      ...(execution ? { execution: cloneJson(execution) } : {}),
      ...(result ? { result: cloneJson(result) } : {}),
      confirmationStatus: confirmation ? 'confirmed' : 'unconfirmed',
      adoptionStatus: adoption ? 'adopted' : 'not_adopted',
      executionStatus: execution ? 'actual' : 'unrecorded',
      resultStatus: result ? 'accepted' : 'unrecorded',
      reviewStatus: reviewRequired ? 'review_required' : 'clear',
      ...(targetStatus ? { targetStatus } : {}),
    };
  }

  private async readConfirmation(candidateId: string, access: MinutesLineageAccess): Promise<MinutesLineageConfirmation | null> {
    const ledger = await this.readLedger();
    const confirmation = ledger.confirmations.find((item) => item.candidateId === candidateId);
    if (!confirmation) return null;
    const candidate = await this.requireCandidate(candidateId, access);
    if (confirmation.candidateDigest !== candidate.digest) throw new MeetingMinutesLineageError('integrity_mismatch', `Confirmation ${confirmation.id} points to an old candidate`);
    assertDigest(confirmation, 'confirmation');
    return cloneJson(confirmation);
  }

  private async readAdoption(id: string, access: MinutesLineageAccess): Promise<MinutesLineageAdoption | null> {
    const adoptionId = requireId(id, 'adoption id');
    const ledger = await this.readLedger();
    const adoption = ledger.adoptions.find((item) => item.id === adoptionId);
    if (!adoption) return null;
    const candidate = await this.requireCandidate(adoption.candidateId, access);
    if (adoption.candidateDigest !== candidate.digest) throw new MeetingMinutesLineageError('integrity_mismatch', `Adoption ${adoption.id} points to an old candidate`);
    await this.assertTargetReadable(adoption.target, access);
    assertDigest(adoption, 'adoption');
    return cloneJson(adoption);
  }

  private async readExecution(id: string, access: MinutesLineageAccess): Promise<MinutesLineageExecution | null> {
    const executionId = requireId(id, 'execution id');
    const ledger = await this.readLedger();
    const execution = ledger.executions.find((item) => item.id === executionId);
    if (!execution) return null;
    const adoption = await this.requireAdoption(execution.candidateId, access);
    if (adoption.id !== execution.adoptionId || !sameTarget(adoption.target, execution.target)) throw new MeetingMinutesLineageError('integrity_mismatch', `Execution ${execution.id} points to a different adoption`);
    await this.assertTargetReadable(execution.target, access);
    if (!this.options.receipt) throw new MeetingMinutesLineageError('provider_unavailable', 'Execution receipt provider is not connected');
    let receipt: ExecutionReceiptRead | null;
    try {
      receipt = await this.options.receipt.read(execution.receiptRef, access);
    } catch (error) {
      throw mapProviderError(error, 'Execution receipt provider is unavailable', 'target_unavailable');
    }
    if (!receipt || !sameJson(normalizeReceiptReference(receipt.reference), execution.receiptRef) || !sameTarget(normalizeTarget(receipt.target), execution.target)) {
      throw new MeetingMinutesLineageError('integrity_mismatch', `Execution receipt ${execution.receiptRef.id} is not readable at the exact version`);
    }
    assertDigest(execution, 'execution');
    return cloneJson(execution);
  }

  private async requireExecution(id: string, access: MinutesLineageAccess): Promise<MinutesLineageExecution> {
    const execution = await this.readExecution(id, access);
    if (!execution) throw new MeetingMinutesLineageError('not_found', `Execution ${id} was not found`);
    return execution;
  }

  private async requireCandidate(id: string, access: MinutesLineageAccess): Promise<MinutesLineageCandidate> {
    const candidate = await this.readCandidate(id, access);
    if (!candidate) throw new MeetingMinutesLineageError('not_found', `Candidate ${id} was not found`);
    return candidate;
  }

  private async requireAdoption(candidateId: string, access: MinutesLineageAccess): Promise<MinutesLineageAdoption> {
    const ledger = await this.readLedger();
    const adoption = ledger.adoptions.find((item) => item.candidateId === candidateId);
    if (!adoption) throw new MeetingMinutesLineageError('not_found', `Candidate ${candidateId} has no adopted target`);
    const readback = await this.readAdoption(adoption.id, access);
    if (!readback) throw new MeetingMinutesLineageError('readback_mismatch', `Adoption ${adoption.id} was not readable`);
    return readback;
  }

  private async assertTargetReadable(target: MinutesLineageTargetReference, access: MinutesLineageAccess): Promise<void> {
    const provider = target.kind === 'judgment' ? this.options.judgment : this.options.task;
    if (!provider) throw new MeetingMinutesLineageError('provider_unavailable', `${target.kind} provider is not connected`);
    try {
      const record = await provider.readExact(target as never, access);
      if (!record) throw new MeetingMinutesLineageError('target_unavailable', `${target.kind} ${target.id} is unavailable`);
    } catch (error) {
      if (error instanceof MeetingMinutesLineageError) throw error;
      throw mapProviderError(error, `${target.kind} ${target.id} is unavailable`, 'target_unavailable');
    }
  }

  private async targetStatus(target: MinutesLineageTargetReference, access: MinutesLineageAccess): Promise<LineageTargetStatus> {
    try {
      await this.assertTargetReadable(target, access);
      return { status: 'available' };
    } catch (error) {
      return statusFromError(error);
    }
  }

  private async readExactMinutes(reference: MinutesVersionReference, access: MinutesLineageAccess): Promise<MinutesVersionRead> {
    let resolved: MinutesVersionRead | null;
    try {
      resolved = await this.options.minutes.readExact(reference, access);
    } catch (error) {
      throw mapProviderError(error, `Minutes version ${reference.versionId} is unavailable`);
    }
    if (!resolved) throw new MeetingMinutesLineageError('source_not_found', `Minutes version ${reference.versionId} was not found`);
    const actual = normalizeMinutesReference(resolved.reference);
    if (!sameMinutesReference(actual, reference)) {
      throw new MeetingMinutesLineageError('integrity_mismatch', `Minutes version ${reference.versionId} was not returned at the requested exact version`);
    }
    return { reference: actual };
  }

  private async readLedger(): Promise<LineageLedger> {
    const content = await readPersonalOsSidecar(this.options.dataDir, MEETING_MINUTES_LINEAGE_SIDECAR);
    return parseLedger(content);
  }

  private async mutateLedger<T>(mutator: (ledger: LineageLedger) => { ledger: LineageLedger; result: T }): Promise<T> {
    let result!: T;
    let completed = false;
    await mutatePersonalOsWithSidecar(this.options.dataDir, MEETING_MINUTES_LINEAGE_SIDECAR, (current, content) => {
      const ledger = parseLedger(content);
      const outcome = mutator(ledger);
      assertLedger(outcome.ledger);
      result = cloneJson(outcome.result);
      completed = true;
      return { next: current, sidecarContent: serializeLedger(outcome.ledger), result: outcome.result };
    });
    if (!completed) throw new MeetingMinutesLineageError('readback_mismatch', 'Lineage mutation did not complete');
    return result;
  }
}

export async function initializeMeetingMinutesLineageStore(dataDir: string): Promise<void> {
  await initializePersonalOs(dataDir);
  const content = await readPersonalOsSidecar(dataDir, MEETING_MINUTES_LINEAGE_SIDECAR);
  if (content === undefined) {
    await mutatePersonalOsWithSidecar(dataDir, MEETING_MINUTES_LINEAGE_SIDECAR, (current) => ({
      next: current,
      sidecarContent: serializeLedger(EMPTY_LEDGER),
      result: undefined,
    }));
  } else {
    parseLedger(content);
  }
}

function normalizeCandidateRequest(request: CreateMinutesLineageCandidateRequest) {
  if (!request || typeof request !== 'object') throw new MeetingMinutesLineageError('invalid_input', 'candidate request is required');
  return {
    id: requireId(request.id, 'candidate id'),
    idempotencyKey: requireId(request.idempotencyKey, 'candidate idempotencyKey'),
    actor: normalizeActor(request.actor),
    evidence: normalizeMinutesReference(request.evidence),
    kind: requireEnum(request.kind, ['judgment', 'task'] as const, 'candidate kind'),
    proposal: cloneJson(request.proposal),
    epistemicStatus: requireEnum(request.epistemicStatus, ['confirmed', 'inferred'] as const, 'epistemicStatus'),
  };
}

function normalizeConfirmationRequest(request: ConfirmMinutesLineageCandidateRequest) {
  return {
    id: requireId(request?.id, 'confirmation id'),
    idempotencyKey: requireId(request?.idempotencyKey, 'confirmation idempotencyKey'),
    candidateId: requireId(request?.candidateId, 'candidate id'),
    actor: normalizeActor(request?.actor),
    evidenceDigest: requireDigest(request?.evidenceDigest, 'evidenceDigest'),
  };
}

function normalizeAdoptionRequest(request: AdoptMinutesLineageRequest) {
  return {
    id: requireId(request?.id, 'adoption id'),
    idempotencyKey: requireId(request?.idempotencyKey, 'adoption idempotencyKey'),
    candidateId: requireId(request?.candidateId, 'candidate id'),
    actor: normalizeActor(request?.actor),
  };
}

function normalizeExecutionRequest(request: RecordMinutesLineageExecutionRequest) {
  return {
    id: requireId(request?.id, 'execution id'),
    idempotencyKey: requireId(request?.idempotencyKey, 'execution idempotencyKey'),
    candidateId: requireId(request?.candidateId, 'candidate id'),
    receiptRef: normalizeReceiptReference(request?.receiptRef),
    actor: normalizeActor(request?.actor),
  };
}

function normalizeResultRequest(request: AcceptMinutesLineageResultRequest) {
  return {
    id: requireId(request?.id, 'result id'),
    idempotencyKey: requireId(request?.idempotencyKey, 'result idempotencyKey'),
    executionId: requireId(request?.executionId, 'execution id'),
    resultRef: normalizeResultReference(request?.resultRef),
    actor: normalizeActor(request?.actor),
  };
}

function normalizeCorrectionRequest(request: MarkMinutesLineageCorrectionRequest) {
  const reason = requireString(request?.reason, 'correction reason');
  if (reason.length > 4000) throw new MeetingMinutesLineageError('invalid_input', 'correction reason is too long');
  return {
    id: requireId(request?.id, 'correction id'),
    idempotencyKey: requireId(request?.idempotencyKey, 'correction idempotencyKey'),
    previousVersion: normalizeMinutesReference(request?.previousVersion),
    replacementVersion: normalizeMinutesReference(request?.replacementVersion),
    actor: normalizeActor(request?.actor),
    reason,
  };
}

function normalizeMinutesReference(value: MinutesVersionReference): MinutesVersionReference {
  if (!value || typeof value !== 'object') throw new MeetingMinutesLineageError('invalid_input', 'exact minutes reference is required');
  return {
    meetingId: requireId(value.meetingId, 'meetingId'),
    minutesId: requireId(value.minutesId, 'minutesId'),
    versionId: requireId(value.versionId, 'versionId'),
    contentDigest: value.contentDigest === null ? null : requireDigest(value.contentDigest, 'contentDigest'),
    locator: cloneJson(value.locator),
    provenance: normalizeProvenance(value.provenance),
  };
}

function normalizeProvenance(value: MinutesProvenance): MinutesProvenance {
  if (!value || typeof value !== 'object') throw new MeetingMinutesLineageError('invalid_input', 'minutes provenance is required');
  return {
    providerKind: requireString(value.providerKind, 'provenance.providerKind'),
    providerId: requireString(value.providerId, 'provenance.providerId'),
    ...(value.revision === undefined ? {} : { revision: requireString(value.revision, 'provenance.revision') }),
    ...(value.digest === undefined ? {} : { digest: requireDigest(value.digest, 'provenance.digest') }),
  };
}

function normalizeActor(value: MinutesLineageActor): MinutesLineageActor {
  if (!value || typeof value !== 'object') throw new MeetingMinutesLineageError('invalid_input', 'actor is required');
  return {
    type: requireEnum(value.type, ['person', 'agent', 'service', 'system'] as const, 'actor.type'),
    id: requireId(value.id, 'actor.id'),
  };
}

function normalizeTarget(value: MinutesLineageTargetReference): MinutesLineageTargetReference {
  if (!value || typeof value !== 'object') throw new MeetingMinutesLineageError('invalid_input', 'exact target reference is required');
  if (value.kind === 'judgment') {
    return {
      kind: 'judgment',
      id: requireId(value.id, 'judgment target id'),
      revision: requireId(value.revision, 'judgment target revision'),
      digest: requireDigest(value.digest, 'judgment target digest'),
    };
  }
  if (value.kind === 'task') {
    if (!Number.isInteger(value.version) || value.version < 1) throw new MeetingMinutesLineageError('invalid_input', 'task target version must be a positive integer');
    return {
      kind: 'task',
      id: requireId(value.id, 'task target id'),
      version: value.version,
      ...(value.digest === undefined ? {} : { digest: requireDigest(value.digest, 'task target digest') }),
    };
  }
  throw new MeetingMinutesLineageError('invalid_input', 'target kind must be judgment or task');
}

function normalizeAdoptionReference(value: AdoptionReference, kind: MinutesLineageCandidateKind): AdoptionReference {
  if (!value || typeof value !== 'object') throw new MeetingMinutesLineageError('invalid_input', 'adoption provider must return an exact adoption reference');
  const expected = kind === 'judgment' ? 'judgment_adoption' : 'task_adoption';
  if (value.kind !== expected) throw new MeetingMinutesLineageError('integrity_mismatch', `Adoption reference kind must be ${expected}`);
  return { kind: expected, id: requireId(value.id, 'adoption reference id'), revision: requireId(value.revision, 'adoption reference revision'), digest: requireDigest(value.digest, 'adoption reference digest') };
}

function normalizeReceiptReference(value: ExecutionReceiptReference): ExecutionReceiptReference {
  if (!value || typeof value !== 'object') throw new MeetingMinutesLineageError('invalid_input', 'receipt reference is required');
  return { id: requireId(value.id, 'receipt id'), digest: requireDigest(value.digest, 'receipt digest') };
}

function normalizeResultReference(value: ResultReference): ResultReference {
  if (!value || typeof value !== 'object') throw new MeetingMinutesLineageError('invalid_input', 'result reference is required');
  return { id: requireId(value.id, 'result id'), digest: requireDigest(value.digest, 'result digest') };
}

function parseLedger(content?: string): LineageLedger {
  if (content === undefined) return EMPTY_LEDGER;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new MeetingMinutesLineageError('corrupt_record', 'Meeting minutes lineage sidecar is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new MeetingMinutesLineageError('corrupt_record', 'Meeting minutes lineage sidecar must be an object');
  const value = parsed as Record<string, unknown>;
  if (value.version !== MEETING_MINUTES_LINEAGE_CATALOG_VERSION) throw new MeetingMinutesLineageError('corrupt_record', 'Unsupported meeting minutes lineage catalog version');
  for (const field of ['candidates', 'confirmations', 'adoptions', 'executions', 'results', 'corrections']) {
    if (!Array.isArray(value[field])) throw new MeetingMinutesLineageError('corrupt_record', `Lineage sidecar field ${field} must be an array`);
  }
  const ledger = {
    version: MEETING_MINUTES_LINEAGE_CATALOG_VERSION,
    candidates: cloneJson(value.candidates),
    confirmations: cloneJson(value.confirmations),
    adoptions: cloneJson(value.adoptions),
    executions: cloneJson(value.executions),
    results: cloneJson(value.results),
    corrections: cloneJson(value.corrections),
  } as unknown as LineageLedger;
  assertLedger(ledger);
  return ledger;
}

function assertLedger(ledger: LineageLedger): void {
  if (!ledger || ledger.version !== MEETING_MINUTES_LINEAGE_CATALOG_VERSION) throw new MeetingMinutesLineageError('corrupt_record', 'Invalid meeting minutes lineage ledger version');
  for (const collection of [ledger.candidates, ledger.confirmations, ledger.adoptions, ledger.executions, ledger.results, ledger.corrections]) {
    if (!Array.isArray(collection)) throw new MeetingMinutesLineageError('corrupt_record', 'Invalid meeting minutes lineage ledger collection');
    for (const record of collection) assertDigest(record, 'lineage record');
  }
}

function serializeLedger(ledger: LineageLedger): string {
  return `${JSON.stringify(ledger, null, 2)}\n`;
}

function withDigest<T extends { readonly digest: string }>(record: T): T {
  return { ...record, digest: digestJson({ ...record, digest: '' }) };
}

function assertDigest(value: unknown, label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { digest?: unknown }).digest !== 'string') {
    throw new MeetingMinutesLineageError('corrupt_record', `${label} is malformed`);
  }
  const record = value as Record<string, unknown>;
  if (digestJson({ ...record, digest: '' }) !== record.digest) throw new MeetingMinutesLineageError('corrupt_record', `${label} digest does not match`);
}

function sameMinutesReference(left: MinutesVersionReference, right: MinutesVersionReference): boolean {
  return sameJson(normalizeMinutesReference(left), normalizeMinutesReference(right));
}

function sameTarget(left: MinutesLineageTargetReference, right: MinutesLineageTargetReference): boolean {
  return sameJson(normalizeTarget(left), normalizeTarget(right));
}

function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  assertJsonValue(value);
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortJson(entry)]));
  }
  return value;
}

function assertJsonValue(value: unknown, path = 'value'): asserts value is null | boolean | number | string | unknown[] | Record<string, unknown> {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new MeetingMinutesLineageError('invalid_input', `${path} must be finite`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new MeetingMinutesLineageError('invalid_input', `${path} must be JSON data`);
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) throw new MeetingMinutesLineageError('invalid_input', `${path}.${key} cannot be undefined`);
      assertJsonValue(entry, `${path}.${key}`);
    }
    return;
  }
  throw new MeetingMinutesLineageError('invalid_input', `${path} must be JSON data`);
}

function cloneJson<T>(value: T): T {
  assertJsonValue(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertAccess(value: MinutesLineageAccess): MinutesLineageAccess {
  if (!value || typeof value !== 'object') throw new MeetingMinutesLineageError('authorization_denied', 'Current access context is required');
  return { ...value, principal: requireId(value.principal, 'access principal') };
}

function statusFromError(error: unknown): LineageTargetStatus {
  if (error instanceof MeetingMinutesLineageError) {
    if (error.code === 'authorization_denied') return { status: 'denied', reason: error.code };
    return { status: 'unavailable', reason: error.code };
  }
  return { status: 'unavailable', reason: 'provider_unavailable' };
}

function mapProviderError(
  error: unknown,
  fallback: string,
  notFoundCode: 'source_not_found' | 'target_unavailable' = 'source_not_found',
): MeetingMinutesLineageError {
  if (error instanceof MeetingMinutesLineageError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (code === 'authorization_denied' || code === 'forbidden' || code === 'permission_denied') return new MeetingMinutesLineageError('authorization_denied', fallback);
  if (code === 'not_found' || code === 'source_not_found' || code === 'task_not_found') return new MeetingMinutesLineageError(notFoundCode, fallback);
  if (code === 'integrity_mismatch' || code === 'revision_conflict' || code === 'readback_mismatch') return new MeetingMinutesLineageError(code, fallback);
  return new MeetingMinutesLineageError(notFoundCode === 'target_unavailable' ? 'target_unavailable' : 'source_unavailable', fallback);
}

function requireId(value: unknown, label: string): string {
  return requireString(value, label, true);
}

function requireString(value: unknown, label: string, trim = false): string {
  if (typeof value !== 'string') throw new MeetingMinutesLineageError('invalid_input', `${label} must be a string`);
  const result = trim ? value.normalize('NFKC').trim() : value;
  if (!result) throw new MeetingMinutesLineageError('invalid_input', `${label} is required`);
  if (/^[\u0000-\u001f\u007f]/u.test(result)) throw new MeetingMinutesLineageError('invalid_input', `${label} contains control characters`);
  return result;
}

function requireDigest(value: unknown, label: string): string {
  const result = requireString(value, label, true);
  if (!/^[a-z0-9][a-z0-9._:-]{3,}$/iu.test(result)) throw new MeetingMinutesLineageError('invalid_input', `${label} must be a stable digest`);
  return result;
}

function requireEnum<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new MeetingMinutesLineageError('invalid_input', `${label} is invalid`);
  return value as T[number];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
