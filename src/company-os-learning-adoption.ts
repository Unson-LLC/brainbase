import { createHash } from 'node:crypto';
import {
  assertFoundationCatalog,
  cloneFoundationCatalog,
  cloneFoundationDefinition,
  digestFoundationDefinition,
  findFoundationRecord,
  findLatestFoundationRecord,
  foundationCatalogOrEmpty,
  foundationKey,
  nextFoundationRevision,
} from './foundation-catalog.js';
import type {
  CompanyOsEvaluationRecord,
  EvaluationAccessContext,
  CompanyOsEvaluationStore
} from './company-os-evaluation.js';
import type {
  FoundationDefinition,
  FoundationScope,
  ModelDefinition,
  FoundationAcl
} from './ontology-foundation.js';
import { validateFoundationDefinition } from './ontology-foundation.js';
import type { FoundationStoreContext } from './foundation-store.js';
import type { PersonalOs } from './types.js';
import { loadPersonalOs, mutatePersonalOsWithSidecar, readPersonalOsSidecar } from './ssot.js';

/**
 * Learning adoption is an append-only ledger over the existing canonical
 * aggregate.  It does not promote a candidate to truth and it does not
 * mutate a running judgment.  Foundation target revisions are appended to
 * Graph v2; the ledger stores only the references and decision evidence.
 */
export const COMPANY_OS_LEARNING_ADOPTION_CONTRACT_VERSION = '0.1.0' as const;
export const COMPANY_OS_LEARNING_ADOPTION_RECORD_CATALOG_VERSION = 1 as const;
/**
 * Stable identity for a canonical adoption record when it crosses a
 * knowledge boundary. This is deliberately separate from the catalog
 * version and from the adopted foundation target revision.
 */
export const COMPANY_OS_LEARNING_ADOPTION_LOCATOR_SCHEMA = 'company-os-learning-adoption-record.v1' as const;
export const COMPANY_OS_LEARNING_ADOPTION_SIDECAR = 'evidence/company-os-learning-adoption.json' as const;

export type LearningTargetKind = 'world_model' | 'judgment_method' | 'execution_method' | 'objective';
export type LearningFindingKind = 'measurement_error' | 'execution_difference' | 'external_change' | 'other';
export type LearningValidationConclusion = 'supported' | 'partially_supported' | 'indeterminate' | 'rejected';
export type LearningModelDisposition = 'unchanged' | 'revise' | 'refuted' | 'indeterminate';

export interface LearningTargetReference {
  readonly kind: LearningTargetKind;
  readonly id: string;
  readonly revision: string;
  readonly digest: string;
  /** Foundation targets identify the canonical Graph type explicitly. */
  readonly foundationType?: FoundationDefinition['type'];
}

export interface LearningTargetVersion {
  readonly target: LearningTargetReference;
  readonly reference: LearningTargetReference;
  readonly definition: unknown;
  readonly acl: FoundationAcl;
  readonly scope: FoundationScope;
}

export interface LearningCandidateReference {
  readonly id: string;
  readonly digest: string;
}

/**
 * Stable locator for a canonical adoption record. `contentDigest` is the
 * digest of the complete adoption record; it is not a catalog version and it
 * is not the revision of the target adopted by that record.
 */
export interface LearningAdoptionLocator {
  readonly id: string;
  readonly schema: typeof COMPANY_OS_LEARNING_ADOPTION_LOCATOR_SCHEMA;
  readonly contentDigest: string;
}

export interface LearningEvaluationReference {
  readonly id: string;
  readonly digest: string;
}

export interface LearningCandidateInput {
  readonly id: string;
  readonly sourceEvaluationRef: LearningEvaluationReference;
  readonly target: LearningTargetReference;
  /** Opaque proposed change. Target providers validate and materialize it. */
  readonly proposedChange: unknown;
  readonly grounds: readonly string[];
  readonly counterexamples: readonly string[];
  readonly uncertainty: readonly string[];
  readonly applicability: FoundationScope;
  readonly createdAt: string;
}

export interface LearningCandidate extends LearningCandidateInput {
  readonly version: typeof COMPANY_OS_LEARNING_ADOPTION_RECORD_CATALOG_VERSION;
  readonly digest: string;
}

export interface LearningFinding {
  readonly kind: LearningFindingKind;
  readonly description: string;
  readonly evidenceRefs: readonly string[];
}

export interface LearningValidationInput {
  readonly id: string;
  readonly candidateRef: LearningCandidateReference;
  readonly findings: readonly LearningFinding[];
  readonly conclusion: LearningValidationConclusion;
  readonly modelDisposition: LearningModelDisposition;
  readonly basis: string;
  readonly validatedAt: string;
}

export interface LearningValidation extends LearningValidationInput {
  readonly version: typeof COMPANY_OS_LEARNING_ADOPTION_RECORD_CATALOG_VERSION;
  readonly sourceEvaluationRef: LearningEvaluationReference;
  readonly digest: string;
}

export interface LearningAuthorizationRequest {
  readonly candidate: LearningCandidate;
  readonly validation: LearningValidation;
  readonly target: LearningTargetVersion;
  readonly access: LearningAccessContext;
}

export interface LearningAuthorizationDecision {
  readonly status: 'authorized' | 'denied';
  readonly authorizationId: string;
  readonly authorizedBy: string;
  readonly reason?: string;
  readonly decidedAt: string;
}

export interface LearningAdoptionAuthorizationPort {
  authorize(request: LearningAuthorizationRequest): Promise<LearningAuthorizationDecision> | LearningAuthorizationDecision;
}

/**
 * A host adapter can expose this port to a knowledge reader. Implementations
 * must re-read the canonical adoption record before returning its locator.
 */
export interface LearningAdoptionLocatorReadPort {
  read(input: {
    readonly locator: LearningAdoptionLocator;
    readonly access: LearningAccessContext;
  }): Promise<LearningAdoptionLocator | null>;
}

export interface LearningTargetRevisionPreparationInput {
  readonly candidate: LearningCandidate;
  readonly validation: LearningValidation;
  readonly current: LearningTargetVersion;
}

export interface LearningTargetRevisionPreparation {
  readonly target: LearningTargetReference;
  readonly reference: LearningTargetReference;
  readonly definition: unknown;
  readonly acl: FoundationAcl;
  readonly scope: FoundationScope;
}

/**
 * Target providers perform external reads and authorization before the SSOT
 * lock.  `commitRevision` is deliberately synchronous and pure: it receives
 * the aggregate held by the lock and must fail closed when the expected
 * revision no longer matches.  It must not call a network or re-enter SSOT.
 */
export interface LearningTargetPort {
  readCurrent(reference: LearningTargetReference, access: LearningAccessContext): Promise<LearningTargetVersion | null>;
  read(reference: LearningTargetReference, access: LearningAccessContext): Promise<LearningTargetVersion | null>;
  prepareRevision(input: LearningTargetRevisionPreparationInput): Promise<LearningTargetRevisionPreparation> | LearningTargetRevisionPreparation;
  commitRevision(input: {
    readonly currentAggregate: PersonalOs;
    readonly expectedCurrent: LearningTargetVersion;
    readonly prepared: LearningTargetRevisionPreparation;
  }): { readonly nextAggregate: PersonalOs; readonly adopted: LearningTargetVersion };
}

export interface LearningAccessContext extends FoundationStoreContext {
  readonly principal: string;
}

export interface LearningEvaluationPort {
  read(id: string, access: EvaluationAccessContext): Promise<CompanyOsEvaluationRecord | null>;
}

/**
 * The execution host owns run receipts.  The adoption ledger stores only the
 * exact receipt reference; it never accepts a caller-supplied receipt body.
 * A host must re-read the receipt with its current authorization boundary and
 * return the exact target version that the run actually used.
 */
export interface LearningRunReceiptReference {
  readonly id: string;
  readonly digest: string;
}

export interface LearningRunReceipt {
  readonly id: string;
  readonly runId: string;
  readonly runPhase: 'actual';
  readonly adoptedTarget: LearningTargetReference;
  readonly digest: string;
}

export interface LearningRunReceiptPort {
  read(reference: LearningRunReceiptReference, access: LearningAccessContext): Promise<LearningRunReceipt | null>;
}

export interface LearningAdoptionStoreOptions {
  readonly dataDir: string;
  readonly evaluation: LearningEvaluationPort;
  readonly target: LearningTargetPort;
  /** Optional for planned-only consumers; required to record/read actual use. */
  readonly runReceipt?: LearningRunReceiptPort;
  readonly authorization?: LearningAdoptionAuthorizationPort;
  readonly now?: () => string;
}

export interface CreateLearningCandidateRequest extends LearningCandidateInput {
  readonly access: LearningAccessContext;
}

export interface CreateLearningValidationRequest extends LearningValidationInput {
  readonly access: LearningAccessContext;
}

export interface AdoptLearningCandidateRequest {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly candidateRef: LearningCandidateReference;
  readonly validationRef: LearningCandidateReference;
  readonly access: LearningAccessContext;
}

export interface LearningAdoptionRecord {
  readonly version: typeof COMPANY_OS_LEARNING_ADOPTION_RECORD_CATALOG_VERSION;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly candidateRef: LearningCandidateReference;
  readonly validationRef: LearningCandidateReference;
  readonly previousTarget: LearningTargetReference;
  readonly adoptedTarget: LearningTargetReference;
  readonly authorization: LearningAuthorizationDecision;
  /** Adoption does not change the epistemic state of the target. */
  readonly targetValidationState?: ModelDefinition['validationState'];
  readonly adoptedAt: string;
  readonly digest: string;
}

/**
 * Project a canonical adoption record into the locator contract used by
 * knowledge adapters.  The full record digest is the content identity; the
 * catalog version and adopted target revision have different meanings.
 */
export function createLearningAdoptionLocator(
  record: Pick<LearningAdoptionRecord, 'id' | 'digest'>
): LearningAdoptionLocator {
  const id = requireId(record?.id, 'adoption locator id');
  if (!isDigest(record?.digest)) {
    throw new CompanyOsLearningAdoptionError('invalid_input', 'adoption locator requires a sha256 content digest');
  }
  return { id, schema: COMPANY_OS_LEARNING_ADOPTION_LOCATOR_SCHEMA, contentDigest: record.digest };
}

export interface RecordLearningRunUseRequest {
  readonly id: string;
  readonly runId: string;
  readonly adoptionId: string;
  /** planned selects a version; actual proves the running host used it. */
  readonly runPhase: 'planned' | 'actual';
  /** Required for actual; it is read from the host-owned receipt port. */
  readonly receiptRef?: LearningRunReceiptReference;
  readonly access: LearningAccessContext;
}

export interface LearningRunUseRecord {
  readonly version: typeof COMPANY_OS_LEARNING_ADOPTION_RECORD_CATALOG_VERSION;
  readonly id: string;
  readonly runId: string;
  readonly adoptionId: string;
  readonly requestDigest: string;
  readonly adoptedTarget: LearningTargetReference;
  readonly runPhase: 'planned' | 'actual';
  readonly receiptRef?: LearningRunReceiptReference;
  readonly usedAt: string;
  readonly digest: string;
}

export interface CompanyOsLearningAdoptionStore {
  createCandidate(request: CreateLearningCandidateRequest): Promise<LearningCandidate>;
  readCandidate(id: string, access: LearningAccessContext): Promise<LearningCandidate | null>;
  createValidation(request: CreateLearningValidationRequest): Promise<LearningValidation>;
  readValidation(id: string, access: LearningAccessContext): Promise<LearningValidation | null>;
  adopt(request: AdoptLearningCandidateRequest): Promise<LearningAdoptionRecord>;
  readAdoption(id: string, access: LearningAccessContext): Promise<LearningAdoptionRecord | null>;
  /** Read the stable locator after the canonical record and its target are revalidated. */
  readAdoptionLocator(id: string, access: LearningAccessContext): Promise<LearningAdoptionLocator | null>;
  /** Resolve an exact locator through the current canonical ACL/target read boundary. */
  readAdoptionByLocator(locator: LearningAdoptionLocator, access: LearningAccessContext): Promise<LearningAdoptionRecord | null>;
  recordRunUse(request: RecordLearningRunUseRequest): Promise<LearningRunUseRecord>;
  readRunUse(id: string, access: LearningAccessContext): Promise<LearningRunUseRecord | null>;
}

export type CompanyOsLearningAdoptionErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'authorization_denied'
  | 'scope_violation'
  | 'revision_conflict'
  | 'integrity_mismatch'
  | 'invalid_validation'
  | 'unsupported_target'
  | 'corrupt_record'
  | 'readback_mismatch';

export class CompanyOsLearningAdoptionError extends Error {
  readonly code: CompanyOsLearningAdoptionErrorCode;

  constructor(code: CompanyOsLearningAdoptionErrorCode, message: string) {
    super(message);
    this.name = 'CompanyOsLearningAdoptionError';
    this.code = code;
  }
}

interface LearningLedger {
  readonly version: typeof COMPANY_OS_LEARNING_ADOPTION_RECORD_CATALOG_VERSION;
  readonly candidates: readonly LearningCandidate[];
  readonly validations: readonly LearningValidation[];
  readonly adoptions: readonly LearningAdoptionRecord[];
  readonly runUses: readonly LearningRunUseRecord[];
}

export function createCompanyOsLearningEvaluationPort(store: Pick<CompanyOsEvaluationStore, 'read'>): LearningEvaluationPort {
  if (!store || typeof store.read !== 'function') {
    throw new TypeError('An evaluation store with read is required');
  }
  return {
    read: (id, access) => store.read(id, access)
  };
}

export function createLocalLearningAdoptionAuthorizationPort(): LearningAdoptionAuthorizationPort {
  return {
    authorize(request) {
      const definition = request.target.definition;
      if (!isRecord(definition) || !isFoundationAcl(definition.acl)) {
        return {
          status: 'denied',
          authorizationId: `denied-${request.candidate.id}`,
          authorizedBy: request.access.principal,
          reason: 'A local authorization decision requires a canonical Foundation ACL',
          decidedAt: new Date().toISOString()
        };
      }
      const acl = definition.acl;
      const allowed = acl.ownerId === request.access.principal || acl.writerIds.includes(request.access.principal);
      return {
        status: allowed ? 'authorized' : 'denied',
        authorizationId: `${request.candidate.id}-${request.validation.id}-${request.target.reference.revision}`,
        authorizedBy: request.access.principal,
        ...(allowed ? {} : { reason: 'Current target ACL does not permit adoption' }),
        decidedAt: new Date().toISOString()
      };
    }
  };
}

export function createCompanyOsLearningAdoptionStore(options: LearningAdoptionStoreOptions): CompanyOsLearningAdoptionStore {
  if (!options || !isNonEmptyString(options.dataDir)) {
    throw new CompanyOsLearningAdoptionError('invalid_input', 'dataDir is required');
  }
  if (!options.evaluation || typeof options.evaluation.read !== 'function') {
    throw new CompanyOsLearningAdoptionError('invalid_input', 'evaluation.read is required');
  }
  if (!options.target || typeof options.target.readCurrent !== 'function' || typeof options.target.read !== 'function'
    || typeof options.target.prepareRevision !== 'function' || typeof options.target.commitRevision !== 'function') {
    throw new CompanyOsLearningAdoptionError('invalid_input', 'a complete target port is required');
  }
  if (options.runReceipt !== undefined && typeof options.runReceipt.read !== 'function') {
    throw new CompanyOsLearningAdoptionError('invalid_input', 'runReceipt.read is required when a run receipt port is provided');
  }
  return new GraphCompanyOsLearningAdoptionStore(options);
}

/**
 * Expose only the exact adoption locator after the store has performed its
 * current ACL, candidate, validation, and canonical target checks.
 */
export function createLearningAdoptionLocatorReadPort(
  store: Pick<CompanyOsLearningAdoptionStore, 'readAdoptionByLocator'>
): LearningAdoptionLocatorReadPort {
  if (!store || typeof store.readAdoptionByLocator !== 'function') {
    throw new TypeError('A learning adoption store with readAdoptionByLocator is required');
  }
  return {
    async read({ locator, access }) {
      const record = await store.readAdoptionByLocator(locator, access);
      return record ? createLearningAdoptionLocator(record) : null;
    }
  };
}

/**
 * Foundation-backed target provider.  It is the concrete OSS path for
 * Objective and world-model revisions.  Judgment/execution method registries
 * belong to a consuming provider and are intentionally unsupported here.
 */
export function createFoundationLearningTargetPort(options: {
  readonly foundationStore: {
    read(reference: { id: string; type: FoundationDefinition['type']; revision: string }, context: FoundationStoreContext): Promise<{ definition: FoundationDefinition; digest: string } | null>;
    readLatest(type: FoundationDefinition['type'], id: string, context: FoundationStoreContext): Promise<{ definition: FoundationDefinition; digest: string } | null>;
  };
}): LearningTargetPort {
  if (!options?.foundationStore) throw new TypeError('foundationStore is required');
  const store = options.foundationStore;
  return {
    async readCurrent(reference, access) {
      const type = foundationTypeForTarget(reference);
      const record = await store.readLatest(type, reference.id, access);
      if (!record || record.definition.revision !== reference.revision || record.digest !== reference.digest) return null;
      return foundationTargetVersion(reference, record.definition, record.digest);
    },
    async read(reference, access) {
      const type = foundationTypeForTarget(reference);
      const record = await store.read({ id: reference.id, type, revision: reference.revision }, access);
      if (!record || record.digest !== reference.digest) return null;
      return foundationTargetVersion(reference, record.definition, record.digest);
    },
    prepareRevision(input) {
      const current = input.current;
      const type = foundationTypeForTarget(current.target);
      if (!isRecord(input.candidate.proposedChange) || !isRecord(input.candidate.proposedChange.definition)) {
        throw new CompanyOsLearningAdoptionError('invalid_input', 'Foundation adoption requires proposedChange.definition');
      }
      const proposedDefinition = cloneJson(input.candidate.proposedChange.definition) as FoundationDefinition;
      const proposed = { ...proposedDefinition, revision: nextFoundationRevision(current.reference.revision) } as FoundationDefinition;
      if (proposed.id !== current.reference.id || proposed.type !== type) {
        throw new CompanyOsLearningAdoptionError('revision_conflict', 'Proposed foundation definition changes the logical target');
      }
      const result = validateFoundationDefinition(proposed, { use: 'draft' });
      if (!result.valid) {
        throw new CompanyOsLearningAdoptionError('invalid_input', result.issues.map((issue) => issue.message).join('; '));
      }
      if (!sameJson(proposed.acl, current.acl) || !sameJson(proposed.scope, current.scope)) {
        throw new CompanyOsLearningAdoptionError('authorization_denied', 'Adoption cannot change target ACL or scope');
      }
      if (proposed.type === 'model' && isRecord(current.definition)
        && current.definition.validationState !== undefined
        && proposed.validationState !== current.definition.validationState) {
        throw new CompanyOsLearningAdoptionError('invalid_validation', 'Adoption cannot upgrade or rewrite a Model validation state');
      }
      const digest = digestFoundationDefinition(proposed);
      return {
        target: { ...current.target },
        reference: {
          kind: current.target.kind,
          id: proposed.id,
          revision: proposed.revision,
          digest,
          foundationType: proposed.type
        },
        definition: cloneFoundationDefinition(proposed),
        acl: cloneJson(proposed.acl),
        scope: cloneJson(proposed.scope)
      };
    },
    commitRevision(input) {
      const type = foundationTypeForTarget(input.expectedCurrent.target);
      if (input.currentAggregate.graph.version !== 2) {
        throw new CompanyOsLearningAdoptionError('unsupported_target', 'Foundation adoption requires canonical Graph v2');
      }
      if (!isFoundationDefinition(input.prepared.definition) || input.prepared.reference.foundationType !== type) {
        throw new CompanyOsLearningAdoptionError('integrity_mismatch', 'Prepared foundation revision is invalid');
      }
      const catalog = foundationCatalogOrEmpty(input.currentAggregate.graph.foundation);
      const latest = findLatestFoundationRecord(catalog, type, input.expectedCurrent.reference.id);
      if (!latest || latest.definition.revision !== input.expectedCurrent.reference.revision
        || latest.digest !== input.expectedCurrent.reference.digest) {
        throw new CompanyOsLearningAdoptionError('revision_conflict', 'The foundation target changed before adoption commit');
      }
      const preparedFoundationReference = {
        id: input.prepared.reference.id,
        type,
        revision: input.prepared.reference.revision
      };
      const existing = findFoundationRecord(catalog, preparedFoundationReference);
      if (existing && existing.digest !== input.prepared.reference.digest) {
        throw new CompanyOsLearningAdoptionError('integrity_mismatch', 'Prepared foundation revision collides with another digest');
      }
      const nextCatalog = cloneFoundationCatalog(catalog);
      if (!existing) {
        nextCatalog.records.push({
          definition: cloneFoundationDefinition(input.prepared.definition),
          digest: input.prepared.reference.digest
        });
        nextCatalog.latest[foundationKey(preparedFoundationReference)] = {
          id: input.prepared.reference.id,
          type,
          revision: input.prepared.reference.revision
        };
      }
      assertFoundationCatalog(nextCatalog);
      return {
        nextAggregate: {
          ...input.currentAggregate,
          graph: { ...input.currentAggregate.graph, foundation: nextCatalog }
        },
        adopted: {
          ...input.prepared,
          definition: cloneJson(input.prepared.definition),
          acl: cloneJson(input.prepared.acl),
          scope: cloneJson(input.prepared.scope)
        }
      };
    }
  };
}

class GraphCompanyOsLearningAdoptionStore implements CompanyOsLearningAdoptionStore {
  private readonly now: () => string;
  private readonly authorization: LearningAdoptionAuthorizationPort;

  constructor(private readonly options: LearningAdoptionStoreOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.authorization = options.authorization ?? createLocalLearningAdoptionAuthorizationPort();
  }

  async createCandidate(request: CreateLearningCandidateRequest): Promise<LearningCandidate> {
    const access = assertAccess(request.access);
    const input = normalizeCandidateInput(request);
    const evaluation = await this.options.evaluation.read(input.sourceEvaluationRef.id, access);
    if (!evaluation) throw new CompanyOsLearningAdoptionError('not_found', `Evaluation ${input.sourceEvaluationRef.id} was not found`);
    const evaluationDigest = digestEvaluationRecord(evaluation);
    if (evaluationDigest !== input.sourceEvaluationRef.digest) {
      throw new CompanyOsLearningAdoptionError('integrity_mismatch', 'Candidate source evaluation digest does not match the canonical record');
    }
    const candidate: LearningCandidate = {
      version: COMPANY_OS_LEARNING_ADOPTION_RECORD_CATALOG_VERSION,
      ...input,
      proposedChange: cloneJson(input.proposedChange),
      grounds: [...input.grounds],
      counterexamples: [...input.counterexamples],
      uncertainty: [...input.uncertainty],
      applicability: cloneJson(input.applicability),
    digest: ''
  };
    const completeCandidate = { ...candidate, digest: digestLearningRecord({ ...candidate, digest: '' }) };
    let committed: LearningCandidate | undefined;
    await this.mutateLedger(async (ledger) => {
      const existing = ledger.candidates.find((item) => item.id === completeCandidate.id);
      if (existing) {
        if (existing.digest !== completeCandidate.digest) throw new CompanyOsLearningAdoptionError('revision_conflict', `Candidate ${completeCandidate.id} already exists with different content`);
        committed = cloneJson(existing);
        return ledger;
      }
      committed = cloneJson(completeCandidate);
      return { ...ledger, candidates: [...ledger.candidates, completeCandidate] };
    });
    if (!committed) throw new CompanyOsLearningAdoptionError('readback_mismatch', 'Candidate commit did not produce a record');
    const readback = await this.readCandidate(committed.id, access);
    if (!readback || readback.digest !== committed.digest) throw new CompanyOsLearningAdoptionError('readback_mismatch', `Candidate ${committed.id} was not readable after commit`);
    return readback;
  }

  async readCandidate(id: string, access: LearningAccessContext): Promise<LearningCandidate | null> {
    const context = assertAccess(access);
    const candidateId = requireId(id, 'candidate id');
    const ledger = await this.loadLedger();
    const candidate = ledger.candidates.find((item) => item.id === candidateId);
    if (!candidate) return null;
    await this.assertCandidateAccess(candidate, context);
    return cloneJson(candidate);
  }

  async createValidation(request: CreateLearningValidationRequest): Promise<LearningValidation> {
    const access = assertAccess(request.access);
    const input = normalizeValidationInput(request);
    const candidate = await this.readCandidateByReference(input.candidateRef, access);
    if (!candidate) throw new CompanyOsLearningAdoptionError('not_found', `Candidate ${input.candidateRef.id} was not found`);
    assertValidationLogic(input);
    const validation: LearningValidation = {
      version: COMPANY_OS_LEARNING_ADOPTION_RECORD_CATALOG_VERSION,
      ...input,
      sourceEvaluationRef: cloneJson(candidate.sourceEvaluationRef),
      findings: cloneJson(input.findings),
      digest: ''
    };
    const completeValidation = {
      ...validation,
      digest: digestLearningRecord({ ...validation, digest: '' })
    };
    let committed: LearningValidation | undefined;
    await this.mutateLedger(async (ledger) => {
      const existing = ledger.validations.find((item) => item.id === completeValidation.id);
      if (existing) {
        if (existing.digest !== completeValidation.digest) throw new CompanyOsLearningAdoptionError('revision_conflict', `Validation ${completeValidation.id} already exists with different content`);
        committed = cloneJson(existing);
        return ledger;
      }
      committed = cloneJson(completeValidation);
      return { ...ledger, validations: [...ledger.validations, completeValidation] };
    });
    if (!committed) throw new CompanyOsLearningAdoptionError('readback_mismatch', 'Validation commit did not produce a record');
    const readback = await this.readValidation(committed.id, access);
    if (!readback || readback.digest !== committed.digest) throw new CompanyOsLearningAdoptionError('readback_mismatch', `Validation ${committed.id} was not readable after commit`);
    return readback;
  }

  async readValidation(id: string, access: LearningAccessContext): Promise<LearningValidation | null> {
    const context = assertAccess(access);
    const validationId = requireId(id, 'validation id');
    const ledger = await this.loadLedger();
    const validation = ledger.validations.find((item) => item.id === validationId);
    if (!validation) return null;
    const candidate = await this.readCandidateByReference(validation.candidateRef, context);
    if (!candidate) throw new CompanyOsLearningAdoptionError('integrity_mismatch', `Validation ${validation.id} points to an unreadable candidate`);
    if (!sameRefDigest(candidate.sourceEvaluationRef, validation.sourceEvaluationRef)) {
      throw new CompanyOsLearningAdoptionError('integrity_mismatch', `Validation ${validation.id} source evaluation changed`);
    }
    assertValidationLogic(validation);
    return cloneJson(validation);
  }

  async adopt(request: AdoptLearningCandidateRequest): Promise<LearningAdoptionRecord> {
    const access = assertAccess(request.access);
    const id = requireId(request.id, 'adoption id');
    const idempotencyKey = requireId(request.idempotencyKey, 'idempotencyKey');
    const candidateRef = normalizeRecordReference(request.candidateRef, 'candidateRef');
    const validationRef = normalizeRecordReference(request.validationRef, 'validationRef');
    const requestDigest = digestJson({ id, idempotencyKey, candidateRef, validationRef, principal: access.principal });

    const existing = await this.findAdoptionByIdempotencyKey(idempotencyKey, access);
    if (existing) {
      if (existing.requestDigest !== requestDigest) throw new CompanyOsLearningAdoptionError('revision_conflict', `Adoption key ${idempotencyKey} was used with different content`);
      return existing;
    }

    const candidate = await this.readCandidateByReference(candidateRef, access);
    if (!candidate) throw new CompanyOsLearningAdoptionError('not_found', `Candidate ${candidateRef.id} was not found`);
    const validation = await this.readValidationByReference(validationRef, access);
    if (!validation) throw new CompanyOsLearningAdoptionError('not_found', `Validation ${validationRef.id} was not found`);
    if (!sameRefDigest(validation.candidateRef, candidateRef)) {
      throw new CompanyOsLearningAdoptionError('integrity_mismatch', 'Validation does not belong to the selected candidate');
    }
    if (!sameRefDigest(candidate.sourceEvaluationRef, validation.sourceEvaluationRef)) {
      throw new CompanyOsLearningAdoptionError('integrity_mismatch', 'Candidate and validation do not refer to the same evaluation');
    }
    const target = await this.options.target.readCurrent(candidate.target, access);
    if (!target) throw new CompanyOsLearningAdoptionError('revision_conflict', 'The target is not the current exact revision');
    assertScopeAccess(target.scope, access);
    const decision = await this.authorization.authorize({ candidate, validation, target, access });
    assertAuthorizationDecision(decision);
    if (decision.status !== 'authorized') throw new CompanyOsLearningAdoptionError('authorization_denied', decision.reason ?? 'Adoption was denied');
    const prepared = await this.options.target.prepareRevision({ candidate, validation, current: target });
    assertPreparedRevision(prepared, target);

    let committed: LearningAdoptionRecord | undefined;
    await this.mutateLedger(async (ledger, currentAggregate) => {
      const sameKey = ledger.adoptions.find((item) => item.idempotencyKey === idempotencyKey);
      if (sameKey) {
        if (sameKey.requestDigest !== requestDigest) throw new CompanyOsLearningAdoptionError('revision_conflict', `Adoption key ${idempotencyKey} was used with different content`);
        committed = cloneJson(sameKey);
        return { ledger, nextAggregate: currentAggregate };
      }
      const storedCandidate = ledger.candidates.find((item) => item.id === candidate.id);
      const storedValidation = ledger.validations.find((item) => item.id === validation.id);
      if (!storedCandidate || storedCandidate.digest !== candidate.digest || !storedValidation || storedValidation.digest !== validation.digest) {
        throw new CompanyOsLearningAdoptionError('integrity_mismatch', 'Candidate or validation changed before adoption commit');
      }
      const result = this.options.target.commitRevision({ currentAggregate, expectedCurrent: target, prepared });
      if (!sameRefIdentity(result.adopted.reference, candidate.target)) {
        throw new CompanyOsLearningAdoptionError('integrity_mismatch', 'Adopted target changed the candidate logical identity');
      }
      const adoption: LearningAdoptionRecord = {
        version: COMPANY_OS_LEARNING_ADOPTION_RECORD_CATALOG_VERSION,
        id,
        idempotencyKey,
        requestDigest,
        candidateRef: { ...candidateRef },
        validationRef: { ...validationRef },
        previousTarget: cloneJson(target.reference),
        adoptedTarget: cloneJson(result.adopted.reference),
        authorization: cloneJson(decision),
        ...(isModelDefinition(result.adopted.definition) ? { targetValidationState: result.adopted.definition.validationState } : {}),
        adoptedAt: this.now(),
        digest: ''
      };
      const complete = { ...adoption, digest: digestLearningRecord(adoption) };
      committed = complete;
      return {
        ledger: { ...ledger, adoptions: [...ledger.adoptions, complete] },
        nextAggregate: result.nextAggregate
      };
    });
    if (!committed) throw new CompanyOsLearningAdoptionError('readback_mismatch', 'Adoption commit did not produce a record');
    const readback = await this.readAdoption(committed.id, access);
    if (!readback || readback.digest !== committed.digest) throw new CompanyOsLearningAdoptionError('readback_mismatch', `Adoption ${committed.id} was not readable after commit`);
    return readback;
  }

  async readAdoption(id: string, access: LearningAccessContext): Promise<LearningAdoptionRecord | null> {
    const context = assertAccess(access);
    const adoptionId = requireId(id, 'adoption id');
    const ledger = await this.loadLedger();
    const adoption = ledger.adoptions.find((item) => item.id === adoptionId);
    if (!adoption) return null;
    if (digestLearningRecord({ ...adoption, digest: '' }) !== adoption.digest) {
      throw new CompanyOsLearningAdoptionError('integrity_mismatch', `Adoption ${id} digest does not match`);
    }
    const candidate = await this.readCandidateByReference(adoption.candidateRef, context);
    if (!candidate) throw new CompanyOsLearningAdoptionError('integrity_mismatch', `Adoption ${id} points to an unreadable candidate`);
    const validation = await this.readValidationByReference(adoption.validationRef, context);
    if (!validation) throw new CompanyOsLearningAdoptionError('integrity_mismatch', `Adoption ${id} points to an unreadable validation`);
    if (!sameRefDigest(validation.candidateRef, adoption.candidateRef)) {
      throw new CompanyOsLearningAdoptionError('integrity_mismatch', `Adoption ${id} links a validation for a different candidate`);
    }
    if (!sameRefExact(adoption.previousTarget, candidate.target)
      || !sameRefIdentity(adoption.previousTarget, candidate.target)
      || !sameRefIdentity(adoption.adoptedTarget, candidate.target)) {
      throw new CompanyOsLearningAdoptionError('integrity_mismatch', `Adoption ${id} changed the candidate target identity`);
    }
    const target = await this.options.target.read(adoption.adoptedTarget, context);
    if (!target || !isTargetReferenceShape(target.reference) || !sameRefExact(target.reference, adoption.adoptedTarget)
      || !sameRefIdentity(target.reference, candidate.target)) {
      throw new CompanyOsLearningAdoptionError('integrity_mismatch', `Adopted target for ${id} is not readable at its exact revision`);
    }
    void candidate;
    void validation;
    return cloneJson(adoption);
  }

  async readAdoptionLocator(id: string, access: LearningAccessContext): Promise<LearningAdoptionLocator | null> {
    const adoption = await this.readAdoption(id, access);
    return adoption ? createLearningAdoptionLocator(adoption) : null;
  }

  async readAdoptionByLocator(locator: LearningAdoptionLocator, access: LearningAccessContext): Promise<LearningAdoptionRecord | null> {
    const normalized = normalizeLearningAdoptionLocator(locator);
    const adoption = await this.readAdoption(normalized.id, access);
    if (!adoption) return null;
    const current = createLearningAdoptionLocator(adoption);
    if (!sameJson(current, normalized)) {
      throw new CompanyOsLearningAdoptionError(
        'integrity_mismatch',
        `Adoption ${normalized.id} does not match the requested canonical locator`
      );
    }
    return adoption;
  }

  async recordRunUse(request: RecordLearningRunUseRequest): Promise<LearningRunUseRecord> {
    const access = assertAccess(request.access);
    if (request.runPhase !== 'planned' && request.runPhase !== 'actual') {
      throw new CompanyOsLearningAdoptionError('invalid_input', 'runPhase must be planned or actual');
    }
    const id = requireId(request.id, 'run-use id');
    const runId = requireId(request.runId, 'run id');
    const adoptionId = requireId(request.adoptionId, 'adoption id');
    const adoption = await this.readAdoption(adoptionId, access);
    if (!adoption) throw new CompanyOsLearningAdoptionError('not_found', `Adoption ${adoptionId} was not found`);
    const receiptRef = request.runPhase === 'actual'
      ? normalizeRunReceiptReference(request.receiptRef)
      : request.receiptRef === undefined
        ? undefined
        : (() => { throw new CompanyOsLearningAdoptionError('invalid_input', 'planned run-use cannot carry a receipt reference'); })();
    if (request.runPhase === 'actual') {
      await this.readAndAssertRunReceipt(receiptRef!, runId, adoption, access);
    }
    const requestDigest = digestJson({ id, runId, adoptionId, runPhase: request.runPhase, receiptRef, principal: access.principal });
    let committed: LearningRunUseRecord | undefined;
    await this.mutateLedger(async (ledger) => {
      const existing = ledger.runUses.find((item) => item.id === id);
      if (existing) {
        if (existing.digest !== digestLearningRecord({ ...existing, digest: '' })) throw new CompanyOsLearningAdoptionError('corrupt_record', `Run use ${id} is corrupt`);
        if (existing.runId !== runId || existing.adoptionId !== adoptionId || existing.requestDigest !== requestDigest) {
          throw new CompanyOsLearningAdoptionError('revision_conflict', `Run-use ${id} already exists with different content`);
        }
        committed = cloneJson(existing);
        return ledger;
      }
      const record: LearningRunUseRecord = {
        version: COMPANY_OS_LEARNING_ADOPTION_RECORD_CATALOG_VERSION,
        id,
        runId,
        adoptionId,
        requestDigest,
        adoptedTarget: cloneJson(adoption.adoptedTarget),
        runPhase: request.runPhase,
        ...(receiptRef ? { receiptRef: cloneJson(receiptRef) } : {}),
        usedAt: this.now(),
        digest: ''
      };
      const complete = { ...record, digest: digestLearningRecord(record) };
      committed = complete;
      return { ...ledger, runUses: [...ledger.runUses, complete] };
    });
    if (!committed) throw new CompanyOsLearningAdoptionError('readback_mismatch', 'Run-use commit did not produce a record');
    const readback = await this.readRunUse(committed.id, access);
    if (!readback || readback.digest !== committed.digest) throw new CompanyOsLearningAdoptionError('readback_mismatch', `Run use ${id} was not readable after commit`);
    return readback;
  }

  async readRunUse(id: string, access: LearningAccessContext): Promise<LearningRunUseRecord | null> {
    const context = assertAccess(access);
    const runUseId = requireId(id, 'run-use id');
    const ledger = await this.loadLedger();
    const record = ledger.runUses.find((item) => item.id === runUseId);
    if (!record) return null;
    if (digestLearningRecord({ ...record, digest: '' }) !== record.digest) throw new CompanyOsLearningAdoptionError('integrity_mismatch', `Run use ${id} digest does not match`);
    const adoption = await this.readAdoption(record.adoptionId, context);
    if (!adoption || !sameRefExact(adoption.adoptedTarget, record.adoptedTarget)) throw new CompanyOsLearningAdoptionError('integrity_mismatch', `Run use ${id} points to a different adoption`);
    if (record.runPhase === 'actual') {
      if (!record.receiptRef) throw new CompanyOsLearningAdoptionError('corrupt_record', `Actual run use ${id} has no receipt reference`);
      await this.readAndAssertRunReceipt(record.receiptRef, record.runId, adoption, context);
    } else if (record.receiptRef !== undefined) {
      throw new CompanyOsLearningAdoptionError('corrupt_record', `Planned run use ${id} has an unexpected receipt reference`);
    }
    return cloneJson(record);
  }

  private async readCandidateByReference(reference: LearningCandidateReference, access: LearningAccessContext): Promise<LearningCandidate | null> {
    const ledger = await this.loadLedger();
    const candidate = ledger.candidates.find((item) => item.id === reference.id);
    if (!candidate) return null;
    if (candidate.digest !== reference.digest) throw new CompanyOsLearningAdoptionError('integrity_mismatch', `Candidate ${reference.id} digest does not match`);
    await this.assertCandidateAccess(candidate, access);
    return cloneJson(candidate);
  }

  private async readValidationByReference(reference: LearningCandidateReference, access: LearningAccessContext): Promise<LearningValidation | null> {
    const ledger = await this.loadLedger();
    const validation = ledger.validations.find((item) => item.id === reference.id);
    if (!validation) return null;
    if (validation.digest !== reference.digest) throw new CompanyOsLearningAdoptionError('integrity_mismatch', `Validation ${reference.id} digest does not match`);
    const candidate = await this.readCandidateByReference(validation.candidateRef, access);
    if (!candidate) return null;
    if (!sameRefDigest(validation.sourceEvaluationRef, candidate.sourceEvaluationRef)) {
      throw new CompanyOsLearningAdoptionError('integrity_mismatch', `Validation ${validation.id} source evaluation changed`);
    }
    assertValidationLogic(validation);
    return cloneJson(validation);
  }

  private async assertCandidateAccess(candidate: LearningCandidate, access: LearningAccessContext): Promise<void> {
    const evaluation = await this.options.evaluation.read(candidate.sourceEvaluationRef.id, access);
    if (!evaluation) throw new CompanyOsLearningAdoptionError('not_found', `Evaluation ${candidate.sourceEvaluationRef.id} was not found`);
    if (digestEvaluationRecord(evaluation) !== candidate.sourceEvaluationRef.digest) {
      throw new CompanyOsLearningAdoptionError('integrity_mismatch', `Candidate ${candidate.id} source evaluation changed`);
    }
    const target = await this.options.target.read(candidate.target, access);
    if (!target || !isTargetReferenceShape(target.reference) || !sameRefExact(target.reference, candidate.target)
      || !sameRefIdentity(target.reference, candidate.target)) {
      throw new CompanyOsLearningAdoptionError('integrity_mismatch', `Candidate ${candidate.id} target is not readable at its exact revision`);
    }
    assertScopeAccess(target.scope, access);
    assertScopeAccess(candidate.applicability, access);
  }

  private async readAndAssertRunReceipt(
    reference: LearningRunReceiptReference,
    runId: string,
    adoption: LearningAdoptionRecord,
    access: LearningAccessContext
  ): Promise<LearningRunReceipt> {
    if (!this.options.runReceipt) {
      throw new CompanyOsLearningAdoptionError('unsupported_target', 'Actual run-use requires a host-owned run receipt port');
    }
    const receipt = await this.options.runReceipt.read(reference, access);
    if (!receipt) throw new CompanyOsLearningAdoptionError('not_found', `Run receipt ${reference.id} was not found`);
    if (!isRecord(receipt) || !isTargetReferenceShape(receipt.adoptedTarget)
      || receipt.id !== reference.id || receipt.digest !== reference.digest
      || digestLearningRecord({ ...receipt, digest: '' }) !== receipt.digest
      || receipt.runId !== runId || receipt.runPhase !== 'actual'
      || !sameRefExact(receipt.adoptedTarget, adoption.adoptedTarget)) {
      throw new CompanyOsLearningAdoptionError('readback_mismatch', `Run receipt ${reference.id} does not prove exact adopted target use`);
    }
    return receipt;
  }

  private async findAdoptionByIdempotencyKey(key: string, access: LearningAccessContext): Promise<LearningAdoptionRecord | null> {
    const ledger = await this.loadLedger();
    const adoption = ledger.adoptions.find((item) => item.idempotencyKey === key);
    if (!adoption) return null;
    return this.readAdoption(adoption.id, access);
  }

  private async loadLedger(): Promise<LearningLedger> {
    try {
      await loadPersonalOs(this.options.dataDir);
      return parseLedger(await readPersonalOsSidecar(this.options.dataDir, COMPANY_OS_LEARNING_ADOPTION_SIDECAR));
    } catch (error) {
      if (error instanceof CompanyOsLearningAdoptionError) throw error;
      throw new CompanyOsLearningAdoptionError('corrupt_record', formatError(error));
    }
  }

  private async mutateLedger(
    mutator: (ledger: LearningLedger, current: PersonalOs) => Promise<{ ledger: LearningLedger; nextAggregate?: PersonalOs } | LearningLedger>
  ): Promise<void> {
    try {
      await mutatePersonalOsWithSidecar(this.options.dataDir, COMPANY_OS_LEARNING_ADOPTION_SIDECAR, async (current, sidecarContent) => {
        if (current.graph.version !== 2) throw new CompanyOsLearningAdoptionError('unsupported_target', 'Learning adoption requires canonical Graph v2');
        const ledger = parseLedger(sidecarContent);
        const result = await mutator(ledger, current);
        const nextLedger = isLedgerMutation(result) ? result.ledger : result;
        assertLedger(nextLedger);
        return {
          next: isLedgerMutation(result) ? (result.nextAggregate ?? current) : current,
          sidecarContent: `${JSON.stringify(nextLedger, null, 2)}\n`,
          result: undefined
        };
      });
    } catch (error) {
      if (error instanceof CompanyOsLearningAdoptionError) throw error;
      throw new CompanyOsLearningAdoptionError('corrupt_record', formatError(error));
    }
  }
}

export function digestEvaluationRecord(record: CompanyOsEvaluationRecord): string {
  return digestJson(record);
}

function normalizeCandidateInput(request: CreateLearningCandidateRequest): LearningCandidateInput {
  requireId(request.id, 'candidate id');
  const sourceEvaluationRef = normalizeEvaluationReference(request.sourceEvaluationRef);
  const target = normalizeTargetReference(request.target);
  const grounds = normalizeTextArray(request.grounds, 'grounds', true);
  const counterexamples = normalizeTextArray(request.counterexamples, 'counterexamples', false);
  const uncertainty = normalizeTextArray(request.uncertainty, 'uncertainty', true);
  const applicability = normalizeScope(request.applicability);
  requireTimestamp(request.createdAt, 'createdAt');
  return {
    id: request.id,
    sourceEvaluationRef,
    target,
    proposedChange: cloneJson(request.proposedChange),
    grounds,
    counterexamples,
    uncertainty,
    applicability,
    createdAt: request.createdAt
  };
}

function normalizeValidationInput(request: CreateLearningValidationRequest): LearningValidationInput {
  requireId(request.id, 'validation id');
  const candidateRef = normalizeRecordReference(request.candidateRef, 'candidateRef');
  if (!Array.isArray(request.findings)) throw new CompanyOsLearningAdoptionError('invalid_input', 'findings must be an array');
  const findings = request.findings.map((finding, index) => normalizeFinding(finding, index));
  if (!['supported', 'partially_supported', 'indeterminate', 'rejected'].includes(request.conclusion)) {
    throw new CompanyOsLearningAdoptionError('invalid_input', 'Unknown validation conclusion');
  }
  if (!['unchanged', 'revise', 'refuted', 'indeterminate'].includes(request.modelDisposition)) {
    throw new CompanyOsLearningAdoptionError('invalid_input', 'Unknown model disposition');
  }
  if (!isNonEmptyString(request.basis)) throw new CompanyOsLearningAdoptionError('invalid_input', 'basis is required');
  requireTimestamp(request.validatedAt, 'validatedAt');
  return { id: request.id, candidateRef, findings, conclusion: request.conclusion, modelDisposition: request.modelDisposition, basis: request.basis, validatedAt: request.validatedAt };
}

function normalizeFinding(finding: LearningFinding, index: number): LearningFinding {
  if (!isRecord(finding) || !['measurement_error', 'execution_difference', 'external_change', 'other'].includes(finding.kind)) {
    throw new CompanyOsLearningAdoptionError('invalid_input', `findings[${index}] has an unknown kind`);
  }
  if (!isNonEmptyString(finding.description)) throw new CompanyOsLearningAdoptionError('invalid_input', `findings[${index}].description is required`);
  return { kind: finding.kind, description: finding.description, evidenceRefs: normalizeTextArray(finding.evidenceRefs, `findings[${index}].evidenceRefs`, false) };
}

function assertValidationLogic(validation: LearningValidationInput): void {
  if (validation.modelDisposition === 'refuted' && !validation.findings.some((finding) => finding.kind !== 'other')) {
    throw new CompanyOsLearningAdoptionError('invalid_validation', 'A prediction gap alone cannot refute a model; causal findings are required');
  }
}

function normalizeEvaluationReference(reference: LearningEvaluationReference): LearningEvaluationReference {
  if (!isRecord(reference) || !isNonEmptyString(reference.id) || !isDigest(reference.digest)) {
    throw new CompanyOsLearningAdoptionError('invalid_input', 'sourceEvaluationRef requires id and sha256 digest');
  }
  return { id: reference.id, digest: reference.digest };
}

function normalizeTargetReference(reference: LearningTargetReference): LearningTargetReference {
  if (!isRecord(reference) || !['world_model', 'judgment_method', 'execution_method', 'objective'].includes(reference.kind)
    || !isNonEmptyString(reference.id) || !isRevision(reference.revision) || !isDigest(reference.digest)) {
    throw new CompanyOsLearningAdoptionError('invalid_input', 'target requires kind, id, positive revision, and sha256 digest');
  }
  if (reference.foundationType !== undefined && !['objective', 'variable', 'model', 'constraint'].includes(reference.foundationType)) {
    throw new CompanyOsLearningAdoptionError('invalid_input', 'target foundationType is invalid');
  }
  if ((reference.kind === 'objective' || reference.kind === 'world_model') && reference.foundationType === undefined) {
    throw new CompanyOsLearningAdoptionError('invalid_input', 'Objective/world_model targets require foundationType');
  }
  if ((reference.kind === 'judgment_method' || reference.kind === 'execution_method') && reference.foundationType !== undefined) {
    throw new CompanyOsLearningAdoptionError('invalid_input', 'Method targets cannot carry foundationType');
  }
  return cloneJson(reference);
}

function normalizeRecordReference(reference: LearningCandidateReference, label: string): LearningCandidateReference {
  if (!isRecord(reference) || !isNonEmptyString(reference.id) || !isDigest(reference.digest)) {
    throw new CompanyOsLearningAdoptionError('invalid_input', `${label} requires id and sha256 digest`);
  }
  return { id: reference.id, digest: reference.digest };
}

function normalizeLearningAdoptionLocator(value: unknown): LearningAdoptionLocator {
  if (!isRecord(value)
    || value.schema !== COMPANY_OS_LEARNING_ADOPTION_LOCATOR_SCHEMA
    || !isNonEmptyString(value.id)
    || !isDigest(value.contentDigest)) {
    throw new CompanyOsLearningAdoptionError(
      'invalid_input',
      'adoption locator requires id, the registered schema, and a sha256 contentDigest'
    );
  }
  return {
    id: value.id,
    schema: COMPANY_OS_LEARNING_ADOPTION_LOCATOR_SCHEMA,
    contentDigest: value.contentDigest
  };
}

function normalizeRunReceiptReference(reference: LearningRunReceiptReference | undefined): LearningRunReceiptReference {
  if (!isRecord(reference) || !isNonEmptyString(reference.id) || !isDigest(reference.digest)) {
    throw new CompanyOsLearningAdoptionError('invalid_input', 'actual run-use requires a receiptRef with id and sha256 digest');
  }
  return { id: reference.id, digest: reference.digest };
}

function assertPreparedRevision(prepared: LearningTargetRevisionPreparation, current: LearningTargetVersion): void {
  if (!prepared || !sameRefIdentity(prepared.target, current.target) || !isRevision(prepared.reference.revision)
    || !isDigest(prepared.reference.digest) || prepared.reference.revision === current.reference.revision) {
    throw new CompanyOsLearningAdoptionError('integrity_mismatch', 'Target provider returned an invalid prepared revision');
  }
  if (!sameJson(prepared.reference.kind, current.reference.kind) || prepared.reference.id !== current.reference.id) {
    throw new CompanyOsLearningAdoptionError('revision_conflict', 'Prepared revision changes target identity');
  }
}

function assertAuthorizationDecision(decision: LearningAuthorizationDecision): void {
  if (!decision || !['authorized', 'denied'].includes(decision.status)
    || !isNonEmptyString(decision.authorizationId) || !isNonEmptyString(decision.authorizedBy) || !isNonEmptyString(decision.decidedAt)) {
    throw new CompanyOsLearningAdoptionError('authorization_denied', 'Authorization provider returned an invalid decision');
  }
}

function foundationTypeForTarget(reference: LearningTargetReference): FoundationDefinition['type'] {
  if (reference.kind === 'judgment_method' || reference.kind === 'execution_method' || reference.foundationType === undefined) {
    throw new CompanyOsLearningAdoptionError('unsupported_target', `No OSS Foundation target adapter exists for ${reference.kind}`);
  }
  if (reference.kind === 'objective' && reference.foundationType !== 'objective') {
    throw new CompanyOsLearningAdoptionError('invalid_input', 'Objective target must use Foundation type objective');
  }
  if (reference.kind === 'world_model' && !['model', 'variable'].includes(reference.foundationType)) {
    throw new CompanyOsLearningAdoptionError('invalid_input', 'World-model target must use Foundation type model or variable');
  }
  return reference.foundationType;
}

function foundationTargetVersion(target: LearningTargetReference, definition: FoundationDefinition, digest: string): LearningTargetVersion {
  return {
    target: cloneJson(target),
    reference: { ...target, id: definition.id, revision: definition.revision, digest, foundationType: definition.type },
    definition: cloneFoundationDefinition(definition),
    acl: cloneJson(definition.acl),
    scope: cloneJson(definition.scope)
  };
}

function isFoundationDefinition(value: unknown): value is FoundationDefinition {
  return isRecord(value) && ['objective', 'variable', 'model', 'constraint'].includes(value.type)
    && isNonEmptyString(value.id) && isRevision(value.revision);
}

function isModelDefinition(value: unknown): value is ModelDefinition {
  return isFoundationDefinition(value) && value.type === 'model' && typeof value.validationState === 'string';
}

function assertAccess(value: LearningAccessContext): LearningAccessContext {
  if (!value || !isNonEmptyString(value.principal)) throw new CompanyOsLearningAdoptionError('authorization_denied', 'A trusted principal is required');
  if (value.scope !== undefined) normalizeScope(value.scope);
  return value;
}

function assertScopeAccess(scope: FoundationScope, access: LearningAccessContext): void {
  if (access.scope === undefined) return;
  if (!scope.subjectIds.some((id) => access.scope?.subjectIds.includes(id))) {
    throw new CompanyOsLearningAdoptionError('scope_violation', `Principal ${access.principal} cannot access the target scope`);
  }
}

function normalizeScope(scope: FoundationScope): FoundationScope {
  if (!isRecord(scope) || !Array.isArray(scope.subjectIds) || scope.subjectIds.length === 0 || !scope.subjectIds.every(isNonEmptyString)
    || !isNonEmptyString(scope.validFrom) || (scope.validUntil !== undefined && !isNonEmptyString(scope.validUntil))) {
    throw new CompanyOsLearningAdoptionError('invalid_input', 'applicability must contain subjectIds and validFrom');
  }
  return cloneJson(scope);
}

function normalizeTextArray(value: readonly string[], label: string, requireOne: boolean): string[] {
  if (!Array.isArray(value) || (requireOne && value.length === 0) || !value.every(isNonEmptyString)) {
    throw new CompanyOsLearningAdoptionError('invalid_input', `${label} must contain ${requireOne ? 'at least one ' : ''}non-empty string`);
  }
  return [...value];
}

function requireTimestamp(value: string, label: string): void {
  if (!isNonEmptyString(value) || Number.isNaN(Date.parse(value))) throw new CompanyOsLearningAdoptionError('invalid_input', `${label} must be an RFC3339 timestamp`);
}

function requireId(value: string, label: string): string {
  if (!isNonEmptyString(value)) throw new CompanyOsLearningAdoptionError('invalid_input', `${label} is required`);
  return value;
}

function isRevision(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isFoundationAcl(value: unknown): value is FoundationAcl {
  return isRecord(value) && isNonEmptyString(value.ownerId) && ['private', 'project', 'organization', 'public'].includes(value.visibility)
    && Array.isArray(value.readerIds) && value.readerIds.every(isNonEmptyString)
    && Array.isArray(value.writerIds) && value.writerIds.every(isNonEmptyString);
}

function sameRefIdentity(left: LearningTargetReference, right: LearningTargetReference): boolean {
  return left.kind === right.kind && left.id === right.id && left.foundationType === right.foundationType;
}

function sameRefExact(left: LearningTargetReference, right: LearningTargetReference): boolean {
  return sameRefIdentity(left, right) && left.revision === right.revision && left.digest === right.digest;
}

function isTargetReferenceShape(value: unknown): value is LearningTargetReference {
  return isRecord(value)
    && ['world_model', 'judgment_method', 'execution_method', 'objective'].includes(value.kind)
    && isNonEmptyString(value.id)
    && isRevision(value.revision)
    && isDigest(value.digest)
    && (value.foundationType === undefined || ['objective', 'variable', 'model', 'constraint'].includes(value.foundationType));
}

function sameRefDigest(left: { id: string; digest: string }, right: { id: string; digest: string }): boolean {
  return left.id === right.id && left.digest === right.digest;
}

function digestLearningRecord(value: unknown): string {
  return digestJson(value);
}

function digestJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) throw new CompanyOsLearningAdoptionError('invalid_input', 'Value is not JSON serializable');
  return `sha256:${createHash('sha256').update(serialized, 'utf8').digest('hex')}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right, 'en')).map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isLedgerMutation(value: LearningLedger | { ledger: LearningLedger; nextAggregate?: PersonalOs }): value is { ledger: LearningLedger; nextAggregate?: PersonalOs } {
  return isRecord(value) && 'ledger' in value;
}

function parseLedger(content: string | undefined): LearningLedger {
  if (content === undefined || content.trim() === '') return emptyLedger();
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new CompanyOsLearningAdoptionError('corrupt_record', `Learning adoption sidecar is not valid JSON: ${formatError(error)}`);
  }
  try {
    assertLedger(parsed);
    return cloneJson(parsed as LearningLedger);
  } catch (error) {
    if (error instanceof CompanyOsLearningAdoptionError) throw error;
    throw new CompanyOsLearningAdoptionError('corrupt_record', formatError(error));
  }
}

function emptyLedger(): LearningLedger {
  return { version: COMPANY_OS_LEARNING_ADOPTION_RECORD_CATALOG_VERSION, candidates: [], validations: [], adoptions: [], runUses: [] };
}

function assertLedger(value: unknown): asserts value is LearningLedger {
  if (!isRecord(value) || value.version !== COMPANY_OS_LEARNING_ADOPTION_RECORD_CATALOG_VERSION
    || !Array.isArray(value.candidates) || !Array.isArray(value.validations) || !Array.isArray(value.adoptions) || !Array.isArray(value.runUses)) {
    throw new CompanyOsLearningAdoptionError('corrupt_record', 'Learning adoption sidecar has an invalid catalog shape');
  }
  uniqueIds(value.candidates, 'candidate');
  uniqueIds(value.validations, 'validation');
  uniqueIds(value.adoptions, 'adoption');
  uniqueIds(value.runUses, 'run-use');
  for (const candidate of value.candidates) {
    if (!isRecord(candidate) || candidate.version !== 1 || !isNonEmptyString(candidate.id) || !isDigest(candidate.digest)
      || digestLearningRecord({ ...candidate, digest: '' }) !== candidate.digest) throw new CompanyOsLearningAdoptionError('corrupt_record', 'Learning candidate digest or shape is invalid');
  }
  for (const validation of value.validations) {
    if (!isRecord(validation) || validation.version !== 1 || !isNonEmptyString(validation.id) || !isDigest(validation.digest)
      || digestLearningRecord({ ...validation, digest: '' }) !== validation.digest) throw new CompanyOsLearningAdoptionError('corrupt_record', 'Learning validation digest or shape is invalid');
    assertValidationLogic(validation as LearningValidation);
  }
  for (const adoption of value.adoptions) {
    if (!isRecord(adoption) || adoption.version !== 1 || !isNonEmptyString(adoption.id) || !isDigest(adoption.digest)
      || digestLearningRecord({ ...adoption, digest: '' }) !== adoption.digest) throw new CompanyOsLearningAdoptionError('corrupt_record', 'Learning adoption digest or shape is invalid');
  }
  for (const runUse of value.runUses) {
    if (!isRecord(runUse) || runUse.version !== 1 || !isNonEmptyString(runUse.id) || !isDigest(runUse.digest)
      || !['planned', 'actual'].includes(runUse.runPhase)
      || !isTargetReferenceShape(runUse.adoptedTarget)
      || (runUse.runPhase === 'actual' && !isRunReceiptReferenceShape(runUse.receiptRef))
      || (runUse.runPhase === 'planned' && runUse.receiptRef !== undefined)
      || digestLearningRecord({ ...runUse, digest: '' }) !== runUse.digest) throw new CompanyOsLearningAdoptionError('corrupt_record', 'Learning run-use digest or shape is invalid');
  }
}

function isRunReceiptReferenceShape(value: unknown): value is LearningRunReceiptReference {
  return isRecord(value) && isNonEmptyString(value.id) && isDigest(value.digest);
}

function uniqueIds(values: readonly unknown[], label: string): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (!isRecord(value) || !isNonEmptyString(value.id) || ids.has(value.id)) throw new CompanyOsLearningAdoptionError('corrupt_record', `Duplicate or invalid ${label} id`);
    ids.add(value.id);
  }
}
