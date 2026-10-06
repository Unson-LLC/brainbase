import { createHash } from 'node:crypto';
import type {
  CanonicalTaskContext,
  CanonicalTaskCreateInput,
  CanonicalTaskRecord,
  CanonicalTaskService,
} from './canonical-task-service.js';
import type {
  CompanyOsLearningAdoptionStore,
  LearningAccessContext,
  LearningCandidateInput,
  LearningFinding,
  LearningModelDisposition,
  LearningTargetPort,
  LearningTargetReference,
  LearningValidationConclusion,
  LearningValidationInput,
} from './company-os-learning-adoption.js';
import type { FoundationScope } from './ontology-foundation.js';
import {
  MeetingMinutesLineageError,
  type JudgmentLineagePort,
  type JudgmentTargetReference,
  type MinutesLineageAccess,
  type MinutesLineageActor,
  type MinutesLineageCandidate,
  type MinutesVersionPort,
  type MinutesVersionRead,
  type MinutesVersionReference,
  type TaskLineagePort,
  type TaskTargetReference,
} from './meeting-minutes-lineage.js';

/**
 * Adapters in this module are integration seams only.  The learning store,
 * Canonical Task service, and native minutes store remain the respective
 * owners of their records and authorization decisions.
 */
export const MEETING_MINUTES_LINEAGE_ADAPTER_CONTRACT_VERSION = 'brainbase.meeting-minutes-lineage-adapters.v1' as const;

type MaybePromise<T> = T | Promise<T>;

export interface NativeMeetingMinutesRequestContext {
  /** Resolved by the host auth boundary; never read from request JSON. */
  readonly principal_id: string;
  readonly [key: string]: unknown;
}

export interface NativeMeetingMinutesSourceReference {
  readonly provider: string;
  readonly locator: string;
  readonly revision: string;
  readonly digest: string;
  readonly provenance?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export interface NativeMeetingMinutesVersionRecord {
  readonly version_id: string;
  readonly minutes_id: string;
  readonly meeting_id: string;
  readonly predecessor_version_id?: string;
  readonly body_digest?: string;
  readonly source_ref?: NativeMeetingMinutesSourceReference;
}

/**
 * Structural shape of the native core's already-authorized exact-version
 * port.  The native core owns its concrete type; this copy lets the optional
 * lineage package compose with it without making the native store depend on
 * this package.
 */
export interface NativeMeetingMinutesExactVersionPort {
  readExact(
    reference: MinutesVersionReference,
    access: { readonly principal: string; readonly [key: string]: unknown },
  ): Promise<{ readonly reference: MinutesVersionReference } | null>;
}

/** Structural copy of the core native store seam to keep this module stackable. */
export interface NativeMeetingMinutesVersionStore {
  get_version(
    meetingId: string,
    minutesId: string,
    versionId: string,
    context: NativeMeetingMinutesRequestContext,
  ): Promise<NativeMeetingMinutesVersionRecord>;
}

export interface NativeMeetingMinutesVersionPortOptions {
  readonly store: NativeMeetingMinutesVersionStore;
  readonly contextFor: (input: {
    readonly access: MinutesLineageAccess;
    readonly reference: MinutesVersionReference;
  }) => MaybePromise<NativeMeetingMinutesRequestContext>;
  /**
   * Organizations may preserve provider-specific provenance here.  The
   * default is truthful for native records and external source_ref records.
   */
  readonly referenceFor?: (record: NativeMeetingMinutesVersionRecord) => MinutesVersionReference;
}

/**
 * Bridges the native meeting-minutes owner to the lineage exact-version port.
 * `get_version` performs the current ACL check; a returned version is accepted
 * only when the adapter's exact reference equals the requested one.
 */
export function createNativeMeetingMinutesVersionPort(
  options: NativeMeetingMinutesVersionPortOptions,
): MinutesVersionPort {
  if (!options?.store || typeof options.store.get_version !== 'function') {
    throw new TypeError('store.get_version is required');
  }
  if (typeof options.contextFor !== 'function') throw new TypeError('contextFor is required');
  const referenceFor = options.referenceFor ?? nativeMeetingMinutesVersionReference;
  return {
    async readExact(reference, access): Promise<MinutesVersionRead | null> {
      const context = await options.contextFor({ access, reference });
      if (!context || typeof context.principal_id !== 'string' || context.principal_id.trim() === '') {
        throw new MeetingMinutesLineageError('authorization_denied', 'Native minutes context has no trusted principal');
      }
      let record: NativeMeetingMinutesVersionRecord;
      try {
        record = await options.store.get_version(reference.meetingId, reference.minutesId, reference.versionId, context);
      } catch (error) {
        throw mapAdapterError(error, 'Native meeting minutes version is unavailable', 'source_unavailable');
      }
      if (!record) return null;
      const actual = referenceFor(record);
      return sameJson(actual, reference) ? { reference: actual } : null;
    },
  };
}

/**
 * Adapts the native core's provider-neutral port to the lineage port.  This
 * is the preferred composition path when the host already has a
 * `createMeetingMinutesVersionPort(store)` result: ACL and exact-version
 * checks remain in the native core and are not duplicated here.
 */
export function adaptNativeMeetingMinutesVersionPort(
  port: NativeMeetingMinutesExactVersionPort,
): MinutesVersionPort {
  if (!port || typeof port.readExact !== 'function') throw new TypeError('port.readExact is required');
  return {
    async readExact(reference, access): Promise<MinutesVersionRead | null> {
      try {
        const result = await port.readExact(reference, access);
        if (!result) return null;
        return sameJson(result.reference, reference) ? { reference: result.reference } : null;
      } catch (error) {
        throw mapAdapterError(error, 'Native meeting minutes version is unavailable', 'source_unavailable');
      }
    },
  };
}

export function nativeMeetingMinutesVersionReference(record: NativeMeetingMinutesVersionRecord): MinutesVersionReference {
  const source = record.source_ref;
  if (source) {
    return {
      meetingId: record.meeting_id,
      minutesId: record.minutes_id,
      versionId: record.version_id,
      contentDigest: source.digest,
      locator: source.locator,
      provenance: {
        providerKind: source.provider,
        providerId: source.locator,
        revision: source.revision,
        digest: source.digest,
        ...(source.provenance ?? {}),
      },
    };
  }
  return {
    meetingId: record.meeting_id,
    minutesId: record.minutes_id,
    versionId: record.version_id,
    contentDigest: record.body_digest ?? null,
    locator: `${record.meeting_id}/${record.minutes_id}/${record.version_id}`,
    provenance: {
      providerKind: 'brainbase.native',
      providerId: `${record.meeting_id}/${record.minutes_id}`,
      revision: record.version_id,
      ...(record.body_digest ? { digest: record.body_digest } : {}),
    },
  };
}

export interface MeetingMinutesLearningAccessInput {
  readonly access: MinutesLineageAccess;
  readonly candidate?: MinutesLineageCandidate;
  readonly target?: LearningTargetReference;
  readonly actor?: MinutesLineageActor;
  readonly phase: 'candidate' | 'validation' | 'adoption' | 'read';
}

export interface MeetingMinutesLearningCandidateProposal {
  readonly sourceEvaluationRef: { readonly id: string; readonly digest: string };
  readonly target: LearningTargetReference;
  readonly proposedChange: unknown;
  readonly grounds: readonly string[];
  readonly counterexamples: readonly string[];
  readonly uncertainty: readonly string[];
  readonly applicability: FoundationScope;
  readonly createdAt?: string;
}

export interface MeetingMinutesLearningValidationProposal {
  readonly id?: string;
  readonly findings: readonly LearningFinding[];
  readonly conclusion: LearningValidationConclusion;
  readonly modelDisposition: LearningModelDisposition;
  readonly basis: string;
  readonly validatedAt: string;
}

/**
 * A judgment candidate must carry enough information for the existing
 * LearningCandidateInput and LearningValidationInput contracts.  The nested
 * names are intentional so a minutes proposal cannot be mistaken for an
 * already adopted judgment.
 */
export interface MeetingMinutesLearningProposal {
  readonly learningCandidate?: MeetingMinutesLearningCandidateProposal;
  readonly candidate?: MeetingMinutesLearningCandidateProposal;
  readonly learningValidation?: MeetingMinutesLearningValidationProposal;
  readonly validation?: MeetingMinutesLearningValidationProposal;
}

export interface MeetingMinutesJudgmentLineagePortOptions {
  readonly store: CompanyOsLearningAdoptionStore;
  readonly target: LearningTargetPort;
  readonly learningAccessFor: (input: MeetingMinutesLearningAccessInput) => MaybePromise<LearningAccessContext>;
  /** Resolves a lineage judgment identity to the canonical target kind. */
  readonly resolveTarget: (input: {
    readonly target: JudgmentTargetReference;
    readonly access: MinutesLineageAccess;
  }) => MaybePromise<LearningTargetReference | null>;
  /** Optional projection when a provider target carries an organization-specific identity. */
  readonly targetReferenceFor?: (input: {
    readonly target: LearningTargetReference;
    readonly candidate: MinutesLineageCandidate;
  }) => JudgmentTargetReference;
}

/**
 * Connects the lineage judgment port to the real Company OS learning
 * adoption store.  It creates a canonical learning candidate and validation,
 * then calls the store's adoption transaction; it never claims success from
 * a local placeholder.
 */
export function createMeetingMinutesJudgmentLineagePort(
  options: MeetingMinutesJudgmentLineagePortOptions,
): JudgmentLineagePort {
  if (!options?.store || typeof options.store.createCandidate !== 'function'
    || typeof options.store.createValidation !== 'function' || typeof options.store.adopt !== 'function') {
    throw new TypeError('a complete learning adoption store is required');
  }
  if (!options.target || typeof options.target.read !== 'function') throw new TypeError('learning target.read is required');
  if (typeof options.learningAccessFor !== 'function') throw new TypeError('learningAccessFor is required');
  if (typeof options.resolveTarget !== 'function') throw new TypeError('resolveTarget is required');

  return {
    async adopt({ candidate, idempotencyKey, actor, access }): Promise<{
      target: JudgmentTargetReference;
      adoption: { kind: 'judgment_adoption'; id: string; revision: string; digest: string };
    }> {
      const proposal = normalizeLearningProposal(candidate);
      const candidateAccess = await options.learningAccessFor({
        access,
        candidate,
        target: proposal.candidate.target,
        actor,
        phase: 'candidate',
      });
      const learningCandidateInput: LearningCandidateInput = {
        id: candidate.id,
        sourceEvaluationRef: proposal.candidate.sourceEvaluationRef,
        target: proposal.candidate.target,
        proposedChange: proposal.candidate.proposedChange,
        grounds: proposal.candidate.grounds,
        counterexamples: proposal.candidate.counterexamples,
        uncertainty: proposal.candidate.uncertainty,
        applicability: proposal.candidate.applicability,
        createdAt: proposal.candidate.createdAt ?? candidate.createdAt,
      };
      const storedCandidate = await options.store.createCandidate({ ...learningCandidateInput, access: candidateAccess });
      const validationAccess = await options.learningAccessFor({
        access,
        candidate,
        target: storedCandidate.target,
        actor,
        phase: 'validation',
      });
      const validationId = proposal.validation.id ?? `meeting-minutes-validation:${candidate.id}`;
      const learningValidationInput: LearningValidationInput = {
        id: validationId,
        candidateRef: { id: storedCandidate.id, digest: storedCandidate.digest },
        findings: proposal.validation.findings,
        conclusion: proposal.validation.conclusion,
        modelDisposition: proposal.validation.modelDisposition,
        basis: proposal.validation.basis,
        validatedAt: proposal.validation.validatedAt,
      };
      const storedValidation = await options.store.createValidation({ ...learningValidationInput, access: validationAccess });
      const adoptionAccess = await options.learningAccessFor({
        access,
        candidate,
        target: storedCandidate.target,
        actor,
        phase: 'adoption',
      });
      const record = await options.store.adopt({
        id: `meeting-minutes-adoption:judgment:${candidate.id}`,
        idempotencyKey,
        candidateRef: { id: storedCandidate.id, digest: storedCandidate.digest },
        validationRef: { id: storedValidation.id, digest: storedValidation.digest },
        access: adoptionAccess,
      });
      const target = (options.targetReferenceFor ?? defaultJudgmentTargetReference)({
        target: record.adoptedTarget,
        candidate,
      });
      return {
        target,
        adoption: {
          kind: 'judgment_adoption',
          id: record.id,
          revision: String(record.version),
          digest: record.digest,
        },
      };
    },

    async readExact(target, access): Promise<unknown | null> {
      const learningTarget = await options.resolveTarget({ target, access });
      if (!learningTarget) return null;
      const learningAccess = await options.learningAccessFor({ access, target: learningTarget, phase: 'read' });
      let record;
      try {
        record = await options.target.read(learningTarget, learningAccess);
      } catch (error) {
        throw mapAdapterError(error, 'Canonical judgment target is unavailable', 'target_unavailable');
      }
      if (!record || !sameJson(record.reference, learningTarget)) return null;
      return record;
    },
  };
}

function normalizeLearningProposal(candidate: MinutesLineageCandidate): {
  readonly candidate: MeetingMinutesLearningCandidateProposal;
  readonly validation: MeetingMinutesLearningValidationProposal;
} {
  if (!isRecord(candidate.proposal)) {
    throw new MeetingMinutesLineageError('invalid_input', `Judgment candidate ${candidate.id} must include learning candidate and validation inputs`);
  }
  const root = candidate.proposal;
  const candidateValue = (isRecord(root.learningCandidate) ? root.learningCandidate : root.candidate);
  const validationValue = (isRecord(root.learningValidation) ? root.learningValidation : root.validation);
  if (!isRecord(candidateValue) || !isRecord(validationValue)) {
    throw new MeetingMinutesLineageError('invalid_input', `Judgment candidate ${candidate.id} must include learningCandidate and learningValidation`);
  }
  const sourceEvaluationRef = normalizeEvaluationReference(candidateValue.sourceEvaluationRef);
  const target = normalizeLearningTargetReference(candidateValue.target);
  const grounds = stringArray(candidateValue.grounds, 'learningCandidate.grounds');
  const counterexamples = stringArray(candidateValue.counterexamples, 'learningCandidate.counterexamples');
  const uncertainty = stringArray(candidateValue.uncertainty, 'learningCandidate.uncertainty');
  const applicability = candidateValue.applicability as FoundationScope;
  if (!isRecord(applicability)) throw new MeetingMinutesLineageError('invalid_input', 'learningCandidate.applicability is required');
  const createdAt = candidateValue.createdAt === undefined ? undefined : requiredString(candidateValue.createdAt, 'learningCandidate.createdAt');
  const validation: MeetingMinutesLearningValidationProposal = {
    ...(validationValue.id === undefined ? {} : { id: requiredString(validationValue.id, 'learningValidation.id') }),
    findings: normalizeFindings(validationValue.findings),
    conclusion: enumValue(validationValue.conclusion, ['supported', 'partially_supported', 'indeterminate', 'rejected'] as const, 'learningValidation.conclusion'),
    modelDisposition: enumValue(validationValue.modelDisposition, ['unchanged', 'revise', 'refuted', 'indeterminate'] as const, 'learningValidation.modelDisposition'),
    basis: requiredString(validationValue.basis, 'learningValidation.basis'),
    validatedAt: requiredString(validationValue.validatedAt, 'learningValidation.validatedAt'),
  };
  return {
    candidate: {
      sourceEvaluationRef,
      target,
      proposedChange: candidateValue.proposedChange,
      grounds,
      counterexamples,
      uncertainty,
      applicability,
      ...(createdAt === undefined ? {} : { createdAt }),
    },
    validation,
  };
}

function defaultJudgmentTargetReference({ target }: { target: LearningTargetReference; candidate: MinutesLineageCandidate }): JudgmentTargetReference {
  return { kind: 'judgment', id: target.id, revision: target.revision, digest: target.digest };
}

export interface MeetingMinutesTaskContextInput {
  readonly access: MinutesLineageAccess;
  readonly candidate?: MinutesLineageCandidate;
  readonly target?: TaskTargetReference;
  readonly actor?: MinutesLineageActor;
  readonly phase: 'create' | 'read';
}

export interface MeetingMinutesTaskLineagePortOptions {
  readonly service: Pick<CanonicalTaskService, 'createTask' | 'getTask'>;
  readonly contextFor: (input: MeetingMinutesTaskContextInput) => MaybePromise<CanonicalTaskContext>;
}

/**
 * Connects the lineage Task port to CanonicalTaskService.  Task execution and
 * receipts stay outside this adapter.  Minutes source references are kept in
 * the lineage sidecar and are deliberately not copied into Task source_refs,
 * so revoking a minutes ACL cannot leave a source locator in the Task.
 */
export function createCanonicalTaskLineagePort(options: MeetingMinutesTaskLineagePortOptions): TaskLineagePort {
  if (!options?.service || typeof options.service.createTask !== 'function' || typeof options.service.getTask !== 'function') {
    throw new TypeError('CanonicalTaskService createTask and getTask are required');
  }
  if (typeof options.contextFor !== 'function') throw new TypeError('contextFor is required');
  return {
    async create({ candidate, idempotencyKey, actor, access }): Promise<{
      target: TaskTargetReference;
      adoption: { kind: 'task_adoption'; id: string; revision: string; digest: string };
    }> {
      const input = normalizeTaskInput(candidate);
      const context = await options.contextFor({ access, candidate, actor, phase: 'create' });
      if (!context || !context.principal) throw new MeetingMinutesLineageError('authorization_denied', 'Canonical Task context has no trusted principal');
      const record = await options.service.createTask(input, { ...context, idempotencyKey });
      assertTaskRecord(record);
      const target: TaskTargetReference = {
        kind: 'task',
        id: record.id,
        version: record.version,
        digest: taskReferenceDigest(record.id, record.version),
      };
      return {
        target,
        adoption: {
          kind: 'task_adoption',
          id: record.id,
          revision: String(record.version),
          digest: taskReferenceDigest(record.id, record.version),
        },
      };
    },

    async readExact(target, access): Promise<unknown | null> {
      const context = await options.contextFor({ access, target, phase: 'read' });
      if (!context || !context.principal) throw new MeetingMinutesLineageError('authorization_denied', 'Canonical Task context has no trusted principal');
      let record: CanonicalTaskRecord;
      try {
        record = await options.service.getTask(target.id, context);
      } catch (error) {
        const code = errorCode(error);
        if (code === 'task_not_found' || code === 'not_found') return null;
        throw mapAdapterError(error, 'Canonical Task is unavailable', 'target_unavailable');
      }
      if (!record || record.id !== target.id || record.version !== target.version) return null;
      if (target.digest !== undefined && target.digest !== taskReferenceDigest(record.id, record.version)) return null;
      return record;
    },
  };
}

function normalizeTaskInput(candidate: MinutesLineageCandidate): CanonicalTaskCreateInput {
  if (!isRecord(candidate.proposal)) throw new MeetingMinutesLineageError('invalid_input', `Task candidate ${candidate.id} must include a task input`);
  const value = isRecord(candidate.proposal.task) ? candidate.proposal.task : candidate.proposal;
  if (value.source_refs !== undefined) {
    throw new MeetingMinutesLineageError('invalid_input', 'Task source_refs belong to the minutes lineage sidecar and cannot be supplied here');
  }
  const input: CanonicalTaskCreateInput = {
    title: requiredString(value.title, 'task.title'),
    ...(value.description === undefined ? {} : { description: value.description as string | null }),
    ...(value.priority === undefined ? {} : { priority: value.priority as string | null }),
    ...(value.assignee_person_id === undefined ? {} : { assignee_person_id: value.assignee_person_id as string | null }),
    ...(value.due_at === undefined ? {} : { due_at: value.due_at as string | null }),
    ...(value.waiting_on === undefined ? {} : { waiting_on: value.waiting_on as string | null }),
    ...(value.review_at === undefined ? {} : { review_at: value.review_at as string | null }),
    ...(value.project_codes === undefined ? {} : { project_codes: value.project_codes }),
  };
  return input;
}

function assertTaskRecord(record: CanonicalTaskRecord): asserts record is CanonicalTaskRecord {
  if (!record || typeof record !== 'object' || typeof record.id !== 'string' || record.id.trim() === ''
    || !Number.isInteger(record.version) || record.version < 1) {
    throw new MeetingMinutesLineageError('integrity_mismatch', 'Canonical Task service returned an invalid record');
  }
}

function taskReferenceDigest(id: string, version: number): string {
  return `sha256:${createHash('sha256').update(`meeting-minutes-task:${id}:${version}`, 'utf8').digest('hex')}`;
}

function normalizeEvaluationReference(value: unknown): { id: string; digest: string } {
  if (!isRecord(value)) throw new MeetingMinutesLineageError('invalid_input', 'learningCandidate.sourceEvaluationRef is required');
  return { id: requiredString(value.id, 'sourceEvaluationRef.id'), digest: requiredString(value.digest, 'sourceEvaluationRef.digest') };
}

function normalizeLearningTargetReference(value: unknown): LearningTargetReference {
  if (!isRecord(value)) throw new MeetingMinutesLineageError('invalid_input', 'learningCandidate.target is required');
  const kind = enumValue(value.kind, ['world_model', 'judgment_method', 'execution_method', 'objective'] as const, 'target.kind');
  return {
    kind,
    id: requiredString(value.id, 'target.id'),
    revision: requiredString(value.revision, 'target.revision'),
    digest: requiredString(value.digest, 'target.digest'),
    ...(value.foundationType === undefined ? {} : { foundationType: value.foundationType as LearningTargetReference['foundationType'] }),
  };
}

function normalizeFindings(value: unknown): readonly LearningFinding[] {
  if (!Array.isArray(value)) throw new MeetingMinutesLineageError('invalid_input', 'learningValidation.findings is required');
  return value.map((item, index) => {
    if (!isRecord(item)) throw new MeetingMinutesLineageError('invalid_input', `learningValidation.findings[${index}] is invalid`);
    return {
      kind: enumValue(item.kind, ['measurement_error', 'execution_difference', 'external_change', 'other'] as const, `findings[${index}].kind`),
      description: requiredString(item.description, `findings[${index}].description`),
      evidenceRefs: stringArray(item.evidenceRefs, `findings[${index}].evidenceRefs`),
    };
  });
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim() !== '')) {
    throw new MeetingMinutesLineageError('invalid_input', `${label} must be an array of non-empty strings`);
  }
  return value.map((item) => (item as string).normalize('NFKC').trim());
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.normalize('NFKC').trim() === '') {
    throw new MeetingMinutesLineageError('invalid_input', `${label} is required`);
  }
  if (/^[\u0000-\u001f\u007f]/u.test(value)) throw new MeetingMinutesLineageError('invalid_input', `${label} contains control characters`);
  return value.normalize('NFKC').trim();
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new MeetingMinutesLineageError('invalid_input', `${label} is invalid`);
  return value as T[number];
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`;
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
}

function mapAdapterError(error: unknown, fallback: string, fallbackCode: 'source_unavailable' | 'target_unavailable'): MeetingMinutesLineageError {
  if (error instanceof MeetingMinutesLineageError) return error;
  const code = errorCode(error);
  if (code === 'authorization_denied' || code === 'forbidden' || code === 'permission_denied') {
    return new MeetingMinutesLineageError('authorization_denied', fallback);
  }
  if (code === 'revision_conflict' || code === 'integrity_mismatch' || code === 'readback_mismatch') {
    return new MeetingMinutesLineageError(code, fallback);
  }
  if (code === 'not_found' || code === 'task_not_found') return new MeetingMinutesLineageError(fallbackCode, fallback);
  return new MeetingMinutesLineageError(fallbackCode, fallback);
}
