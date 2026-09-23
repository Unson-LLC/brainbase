import { createHash } from 'node:crypto';
import {
  findFoundationRecord,
  findLatestFoundationRecord,
  foundationCatalogOrEmpty
} from './foundation-catalog.js';
import type { FoundationRevisionStore } from './foundation-store.js';
import type {
  FoundationAcl,
  FoundationDefinition,
  FoundationRevision,
  FoundationScope
} from './ontology-foundation.js';
import {
  loadPersonalOs,
  mutatePersonalOsWithSidecar,
  readPersonalOsSidecar
} from './ssot.js';
import type { PersonalOs } from './types.js';

/**
 * Problem candidates are evidence-sidecar records. They are deliberately not
 * Graph entities: a candidate is a reviewable input to problem selection, not
 * an approved problem or a canonical fact.
 */
export const PROBLEM_CANDIDATES_CONTRACT_VERSION = 'problem-candidates.v1' as const;
export const PROBLEM_CANDIDATE_CATALOG_VERSION = 1 as const;
export const PROBLEM_CANDIDATES_SIDECAR = 'evidence/problem-candidates.json' as const;

export type ProblemCandidateKind = 'gap' | 'opportunity' | 'threat' | 'uncertainty';
export type ProblemCandidateStatus = 'candidate' | 'merged' | 'dismissed';
export type ProblemCandidateSourceKind =
  | 'event'
  | 'observation'
  | 'document'
  | 'decision'
  | 'import'
  | 'candidate'
  | 'evidence';

export interface ProblemCandidateKnown<T> {
  readonly status: 'known';
  readonly value: T;
}

export interface ProblemCandidateUnknown {
  readonly status: 'unknown';
  readonly reason: string;
}

/** Unknown is explicit so missing data cannot become zero, empty, or success. */
export type ProblemCandidateField<T> = ProblemCandidateKnown<T> | ProblemCandidateUnknown;

export interface ProblemCandidateSourceRef {
  readonly id: string;
  readonly kind: ProblemCandidateSourceKind;
  /** Optional immutable source digest. Evidence content is never embedded. */
  readonly digest?: string;
}

export interface ProblemCandidateEventInput {
  readonly id: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly sourceRefs: readonly ProblemCandidateSourceRef[];
}

export interface ProblemCandidateEvent extends ProblemCandidateEventInput {
  readonly id: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly sourceRefs: readonly ProblemCandidateSourceRef[];
}

/** Exact Objective revision plus its canonical definition digest. */
export interface ProblemCandidateObjectiveReference extends FoundationRevision {
  readonly type: 'objective';
  readonly digest: string;
}

export interface ProblemCandidateDeadline {
  readonly dueAt: string;
  readonly evaluationAt?: string;
}

export interface ProblemCandidateResource {
  readonly id: string;
  readonly kind: string;
  readonly quantity?: number;
  readonly unit?: string;
}

export interface ProblemCandidateInput {
  readonly id: string;
  readonly kind: ProblemCandidateKind;
  readonly statement: string;
  readonly objectiveRefs: readonly ProblemCandidateObjectiveReference[];
  readonly event: ProblemCandidateEventInput;
  readonly observedGap: ProblemCandidateField<string>;
  readonly opportunity: ProblemCandidateField<string>;
  readonly threat: ProblemCandidateField<string>;
  readonly uncertainty: ProblemCandidateField<string>;
  readonly deadline: ProblemCandidateField<ProblemCandidateDeadline>;
  readonly expectedEffect: ProblemCandidateField<string>;
  readonly requiredResources: ProblemCandidateField<readonly ProblemCandidateResource[]>;
  readonly responsibleId: ProblemCandidateField<string>;
  readonly ownerScope: FoundationScope;
  readonly acl: FoundationAcl;
  /** Only mergeCandidates may set this field. */
  readonly mergedFrom?: readonly string[];
  /** Optional creation time; defaults to event.recordedAt. */
  readonly createdAt?: string;
  /** Runtime input may carry candidate only; selection states are rejected. */
  readonly status?: ProblemCandidateStatus;
}

export interface ProblemCandidateProvenance {
  readonly eventIds: readonly string[];
  readonly sourceRefs: readonly ProblemCandidateSourceRef[];
  readonly candidateIds: readonly string[];
}

export interface ProblemCandidateRecord extends Omit<ProblemCandidateInput, 'mergedFrom' | 'createdAt' | 'status'> {
  readonly contractVersion: typeof PROBLEM_CANDIDATES_CONTRACT_VERSION;
  readonly status: ProblemCandidateStatus;
  readonly mergedFrom: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provenance: ProblemCandidateProvenance;
  readonly payloadDigest: string;
}

interface ProblemCandidateEventLedger {
  readonly eventId: string;
  readonly payloadDigest: string;
  readonly candidateId: string;
}

interface ProblemCandidateCatalog {
  readonly version: typeof PROBLEM_CANDIDATE_CATALOG_VERSION;
  readonly candidates: readonly ProblemCandidateRecord[];
  readonly events: readonly ProblemCandidateEventLedger[];
}

export interface ProblemCandidateQuery {
  readonly ownerScope?: FoundationScope;
  readonly responsibleId?: string;
  readonly status?: ProblemCandidateStatus;
}

export interface ProblemCandidateMergeInput extends ProblemCandidateInput {
  readonly sourceCandidateIds: readonly string[];
}

export interface ProblemCandidateStoreContext {
  /** Identity and optional scope must come from a trusted caller boundary. */
  readonly principal: string;
  readonly scope?: FoundationScope;
}

export type ProblemCandidateEvidenceOperation = 'save' | 'read';

/**
 * Trusted current-access boundary for source evidence. Candidate ACLs are not
 * evidence ACLs: every source reference, including roots reached through a
 * merge, must be authorized by this provider before candidate text is exposed.
 * The provider must fail closed when a source is missing or its digest is no
 * longer readable for the principal.
 */
export interface ProblemCandidateEvidenceAccessProvider {
  authorize(input: {
    readonly operation: ProblemCandidateEvidenceOperation;
    readonly context: ProblemCandidateStoreContext;
    readonly source: ProblemCandidateSourceRef;
  }): void | boolean | Promise<void | boolean>;
}

export type ProblemCandidateStoreErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'revision_conflict'
  | 'event_conflict'
  | 'authorization_denied'
  | 'scope_violation'
  | 'unsupported_graph'
  | 'corrupt_record'
  | 'readback_mismatch';

export class ProblemCandidateStoreError extends Error {
  readonly code: ProblemCandidateStoreErrorCode;

  constructor(code: ProblemCandidateStoreErrorCode, message: string) {
    super(message);
    this.name = 'ProblemCandidateStoreError';
    this.code = code;
  }
}

export interface ProblemCandidateStore {
  saveCandidate(input: ProblemCandidateInput, context: ProblemCandidateStoreContext): Promise<ProblemCandidateRecord>;
  /** Alias kept explicit for callers that name the resource in the method. */
  saveProblemCandidate(input: ProblemCandidateInput, context: ProblemCandidateStoreContext): Promise<ProblemCandidateRecord>;
  mergeCandidates(input: ProblemCandidateMergeInput, context: ProblemCandidateStoreContext): Promise<ProblemCandidateRecord>;
  readCandidate(id: string, context: ProblemCandidateStoreContext): Promise<ProblemCandidateRecord | null>;
  listCandidates(query: ProblemCandidateQuery | undefined, context: ProblemCandidateStoreContext): Promise<readonly ProblemCandidateRecord[]>;
}

/**
 * Validates, clones, and freezes a candidate input. The function is also a
 * pure contract surface for providers that want to validate before storage.
 */
export function normalizeProblemCandidate(input: ProblemCandidateInput): ProblemCandidateInput {
  if (!isRecord(input)) throw invalid('candidate must be an object');
  assertOnlyKeys(input, [
    'acl', 'createdAt', 'deadline', 'event', 'expectedEffect', 'id', 'kind',
    'mergedFrom', 'observedGap', 'objectiveRefs', 'opportunity', 'ownerScope',
    'requiredResources', 'responsibleId', 'statement', 'status', 'threat', 'uncertainty'
  ], 'candidate');
  const id = requireIdentifier(input.id, 'id');
  const kind = requireCandidateKind(input.kind, 'kind');
  const statement = requireText(input.statement, 'statement');
  if (!Array.isArray(input.objectiveRefs) || input.objectiveRefs.length === 0) {
    throw invalid('objectiveRefs must contain at least one Objective revision');
  }
  const objectiveRefs = input.objectiveRefs.map((reference, index) => normalizeObjectiveReference(reference, `objectiveRefs[${index}]`));
  assertUnique(objectiveRefs.map((reference) => `${reference.id}@${reference.revision}`), 'objectiveRefs');
  const event = normalizeEvent(input.event);
  const ownerScope = normalizeScope(input.ownerScope, 'ownerScope', true);
  const acl = normalizeAcl(input.acl, 'acl');
  const normalized: ProblemCandidateInput = {
    id,
    kind,
    statement,
    objectiveRefs,
    event,
    observedGap: normalizeTextField(input.observedGap, 'observedGap'),
    opportunity: normalizeTextField(input.opportunity, 'opportunity'),
    threat: normalizeTextField(input.threat, 'threat'),
    uncertainty: normalizeTextField(input.uncertainty, 'uncertainty'),
    deadline: normalizeDeadlineField(input.deadline, 'deadline'),
    expectedEffect: normalizeTextField(input.expectedEffect, 'expectedEffect'),
    requiredResources: normalizeResourceField(input.requiredResources, 'requiredResources'),
    responsibleId: normalizeTextField(input.responsibleId, 'responsibleId'),
    ownerScope,
    acl,
    ...(input.mergedFrom === undefined ? {} : { mergedFrom: normalizeIdentifiers(input.mergedFrom, 'mergedFrom') }),
    ...(input.createdAt === undefined ? {} : { createdAt: requireIsoTimestamp(input.createdAt, 'createdAt') }),
    ...(input.status === undefined ? {} : { status: normalizeCandidateStatus(input.status, 'status') })
  };
  if (normalized.createdAt !== undefined && Date.parse(normalized.createdAt) < Date.parse(event.recordedAt)) {
    throw invalid('createdAt cannot precede event.recordedAt');
  }
  if (normalized.status !== undefined && normalized.status !== 'candidate') {
    throw invalid('candidate input cannot select or approve a candidate');
  }
  return deepFreeze(normalized);
}

/** Returns validation without throwing, useful for contract fixtures. */
export function validateProblemCandidate(input: ProblemCandidateInput): {
  readonly valid: boolean;
  readonly issues: readonly string[];
} {
  try {
    normalizeProblemCandidate(input);
    return { valid: true, issues: [] };
  } catch (error) {
    return { valid: false, issues: [formatError(error)] };
  }
}

export function createProblemCandidateStore(options: {
  readonly dataDir: string;
  readonly foundationStore: FoundationRevisionStore;
  readonly evidenceAccessProvider: ProblemCandidateEvidenceAccessProvider;
}): ProblemCandidateStore {
  if (!options || !isNonEmptyString(options.dataDir)) {
    throw new ProblemCandidateStoreError('invalid_input', 'dataDir is required');
  }
  if (!options.foundationStore || typeof options.foundationStore.read !== 'function') {
    throw new ProblemCandidateStoreError('invalid_input', 'foundationStore with read is required');
  }
  if (!options.evidenceAccessProvider || typeof options.evidenceAccessProvider.authorize !== 'function') {
    throw new ProblemCandidateStoreError('invalid_input', 'evidenceAccessProvider.authorize is required');
  }
  return new GraphProblemCandidateStore(options.dataDir, options.foundationStore, options.evidenceAccessProvider);
}

class GraphProblemCandidateStore implements ProblemCandidateStore {
  constructor(
    private readonly dataDir: string,
    private readonly foundationStore: FoundationRevisionStore,
    private readonly evidenceAccessProvider: ProblemCandidateEvidenceAccessProvider
  ) {}

  async saveCandidate(
    input: ProblemCandidateInput,
    context: ProblemCandidateStoreContext
  ): Promise<ProblemCandidateRecord> {
    assertContext(context);
    const candidate = normalizeProblemCandidate(input);
    if (candidate.mergedFrom !== undefined && candidate.mergedFrom.length > 0) {
      throw new ProblemCandidateStoreError('invalid_input', 'Use mergeCandidates to retain merge provenance');
    }
    const objectiveRecords = await this.readObjectives(candidate.objectiveRefs, context);
    assertCandidateWrite(candidate, context);
    let committed: ProblemCandidateRecord | undefined;
    await this.mutateCatalog(async (catalog, current) => {
      assertObjectivesAtAggregate(current, candidate.objectiveRefs, objectiveRecords, context);
      await this.authorizeEvidence(candidate.event.sourceRefs, context, 'save');
      const payloadDigest = digestCandidateInput(candidate);
      const existingEvent = catalog.events.find((event) => event.eventId === candidate.event.id);
      if (existingEvent !== undefined) {
        if (existingEvent.payloadDigest !== payloadDigest) {
          throw new ProblemCandidateStoreError(
            'event_conflict',
            `Event ${candidate.event.id} was already ingested with a different payload`
          );
        }
        const existing = catalog.candidates.find((item) => item.id === existingEvent.candidateId);
        if (!existing) throw new ProblemCandidateStoreError('corrupt_record', `Event ${candidate.event.id} points to a missing candidate`);
        assertCandidateRead(existing, context);
        await this.authorizeCandidateEvidence(catalog, existing, context, 'read');
        committed = cloneCandidate(existing);
        return catalog;
      }
      if (catalog.candidates.some((item) => item.id === candidate.id)) {
        throw new ProblemCandidateStoreError('revision_conflict', `Candidate ${candidate.id} already exists`);
      }
      const record = makeCandidateRecord(candidate, payloadDigest, []);
      committed = record;
      return {
        version: PROBLEM_CANDIDATE_CATALOG_VERSION,
        candidates: [...catalog.candidates, record],
        events: [...catalog.events, { eventId: candidate.event.id, payloadDigest, candidateId: candidate.id }]
      };
    });
    if (!committed) throw new ProblemCandidateStoreError('readback_mismatch', 'Candidate commit did not produce a record');
    const readback = await this.readCandidate(committed.id, context);
    if (!readback) throw new ProblemCandidateStoreError('readback_mismatch', `Candidate ${committed.id} was not readable after commit`);
    return readback;
  }

  async saveProblemCandidate(
    input: ProblemCandidateInput,
    context: ProblemCandidateStoreContext
  ): Promise<ProblemCandidateRecord> {
    return this.saveCandidate(input, context);
  }

  async mergeCandidates(
    input: ProblemCandidateMergeInput,
    context: ProblemCandidateStoreContext
  ): Promise<ProblemCandidateRecord> {
    assertContext(context);
    if (!Array.isArray(input.sourceCandidateIds) || input.sourceCandidateIds.length === 0) {
      throw new ProblemCandidateStoreError('invalid_input', 'sourceCandidateIds must contain at least one candidate');
    }
    const sourceCandidateIds = normalizeIdentifiers(input.sourceCandidateIds, 'sourceCandidateIds');
    const {
      sourceCandidateIds: _sourceCandidateIds,
      ...candidateInput
    } = input;
    void _sourceCandidateIds;
    const candidate = normalizeProblemCandidate({ ...candidateInput, mergedFrom: sourceCandidateIds });
    if (candidate.id && sourceCandidateIds.includes(candidate.id)) {
      throw new ProblemCandidateStoreError('invalid_input', 'A merged candidate cannot include itself as a source');
    }
    const objectiveRecords = await this.readObjectives(candidate.objectiveRefs, context);
    assertCandidateWrite(candidate, context);
    let committed: ProblemCandidateRecord | undefined;
    await this.mutateCatalog(async (catalog, current) => {
      assertObjectivesAtAggregate(current, candidate.objectiveRefs, objectiveRecords, context);
      await this.authorizeEvidence(candidate.event.sourceRefs, context, 'save');
      const payloadDigest = digestCandidateInput(candidate);
      const existingEvent = catalog.events.find((event) => event.eventId === candidate.event.id);
      if (existingEvent !== undefined) {
        if (existingEvent.payloadDigest !== payloadDigest) {
          throw new ProblemCandidateStoreError(
            'event_conflict',
            `Event ${candidate.event.id} was already ingested with a different payload`
          );
        }
        const existing = catalog.candidates.find((item) => item.id === existingEvent.candidateId);
        if (!existing) throw new ProblemCandidateStoreError('corrupt_record', `Event ${candidate.event.id} points to a missing candidate`);
        assertCandidateRead(existing, context);
        await this.authorizeCandidateEvidence(catalog, existing, context, 'read');
        committed = cloneCandidate(existing);
        return catalog;
      }
      if (catalog.candidates.some((item) => item.id === candidate.id)) {
        throw new ProblemCandidateStoreError('revision_conflict', `Candidate ${candidate.id} already exists`);
      }
      const sources = sourceCandidateIds.map((id) => {
        const source = catalog.candidates.find((item) => item.id === id);
        if (!source) throw new ProblemCandidateStoreError('not_found', `Merge source candidate ${id} was not found`);
        assertCandidateWrite(source, context);
        assertCandidateScope(source, context);
        if (source.status !== 'candidate') {
          throw new ProblemCandidateStoreError('invalid_input', `Candidate ${id} is already ${source.status}`);
        }
        return source;
      });
      for (const source of sources) {
        await this.authorizeCandidateEvidence(catalog, source, context, 'save');
      }
      const record = makeCandidateRecord(candidate, payloadDigest, sourceCandidateIds);
      committed = record;
      const mergedAt = candidate.event.recordedAt;
      const sourceSet = new Set(sourceCandidateIds);
      const candidates = catalog.candidates.map((source) => sourceSet.has(source.id)
        ? cloneCandidate({ ...source, status: 'merged', updatedAt: mergedAt })
        : source);
      // Keep the source resolution above as a deliberate assertion inside the lock.
      void sources;
      return {
        version: PROBLEM_CANDIDATE_CATALOG_VERSION,
        candidates: [...candidates, record],
        events: [...catalog.events, { eventId: candidate.event.id, payloadDigest, candidateId: candidate.id }]
      };
    });
    if (!committed) throw new ProblemCandidateStoreError('readback_mismatch', 'Candidate merge did not produce a record');
    const readback = await this.readCandidate(committed.id, context);
    if (!readback) throw new ProblemCandidateStoreError('readback_mismatch', `Candidate ${committed.id} was not readable after merge`);
    return readback;
  }

  async readCandidate(
    id: string,
    context: ProblemCandidateStoreContext
  ): Promise<ProblemCandidateRecord | null> {
    assertContext(context);
    const candidateId = requireIdentifier(id, 'id');
    const catalog = await this.loadCatalog();
    const candidate = catalog.candidates.find((item) => item.id === candidateId);
    if (!candidate) return null;
    assertCandidateRead(candidate, context);
    await this.authorizeCandidateEvidence(catalog, candidate, context, 'read');
    await this.readObjectives(candidate.objectiveRefs, context);
    return cloneCandidate(candidate);
  }

  async listCandidates(
    query: ProblemCandidateQuery | undefined,
    context: ProblemCandidateStoreContext
  ): Promise<readonly ProblemCandidateRecord[]> {
    assertContext(context);
    const normalizedQuery = normalizeQuery(query);
    const catalog = await this.loadCatalog();
    const visible: ProblemCandidateRecord[] = [];
    for (const candidate of catalog.candidates) {
      if (!matchesQuery(candidate, normalizedQuery)) continue;
      try {
        const readback = await this.readCandidate(candidate.id, context);
        if (readback) visible.push(readback);
      } catch (error) {
        const code = errorCode(error);
        if (code === 'authorization_denied' || code === 'scope_violation') continue;
        throw error;
      }
    }
    return Object.freeze(visible);
  }

  private async readObjectives(
    references: readonly ProblemCandidateObjectiveReference[],
    context: ProblemCandidateStoreContext
  ): Promise<readonly FoundationRecordExpectation[]> {
    const records: FoundationRecordExpectation[] = [];
    for (const reference of references) {
      let record;
      try {
        record = await this.foundationStore.read(reference, context);
      } catch (error) {
        throw mapFoundationError(error, reference);
      }
      if (!record) {
        throw new ProblemCandidateStoreError('not_found', `Objective ${reference.id}@${reference.revision} was not found`);
      }
      if (record.definition.type !== 'objective') {
        throw new ProblemCandidateStoreError('corrupt_record', `Candidate references non-Objective ${reference.id}`);
      }
      if (record.digest !== reference.digest) {
        throw new ProblemCandidateStoreError('revision_conflict', `Objective ${reference.id}@${reference.revision} digest does not match the candidate reference`);
      }
      records.push({ reference, digest: record.digest });
    }
    return records;
  }

  private async authorizeCandidateEvidence(
    catalog: ProblemCandidateCatalog,
    candidate: ProblemCandidateRecord,
    context: ProblemCandidateStoreContext,
    operation: ProblemCandidateEvidenceOperation
  ): Promise<void> {
    const sources = collectCandidateSourceRefs(catalog, candidate);
    await this.authorizeEvidence(sources, context, operation);
  }

  private async authorizeEvidence(
    sources: readonly ProblemCandidateSourceRef[],
    context: ProblemCandidateStoreContext,
    operation: ProblemCandidateEvidenceOperation
  ): Promise<void> {
    for (const source of sources) {
      try {
        const allowed = await this.evidenceAccessProvider.authorize({ operation, context, source });
        if (allowed === false) {
          throw new ProblemCandidateStoreError(
            'authorization_denied',
            `Current evidence access was denied for ${source.kind}/${source.id}`
          );
        }
      } catch (error) {
        if (error instanceof ProblemCandidateStoreError) throw error;
        throw new ProblemCandidateStoreError(
          'authorization_denied',
          `Current evidence access could not be verified for ${source.kind}/${source.id}`
        );
      }
    }
  }

  private async loadCatalog(): Promise<ProblemCandidateCatalog> {
    try {
      const os = await loadPersonalOs(this.dataDir);
      if (os.graph.version !== 2) {
        throw new ProblemCandidateStoreError('unsupported_graph', 'Problem candidates require canonical Graph v2');
      }
      return parseCatalog(await readPersonalOsSidecar(this.dataDir, PROBLEM_CANDIDATES_SIDECAR));
    } catch (error) {
      if (error instanceof ProblemCandidateStoreError) throw error;
      throw new ProblemCandidateStoreError('corrupt_record', formatError(error));
    }
  }

  private async mutateCatalog(
    mutator: (catalog: ProblemCandidateCatalog, current: PersonalOs) => ProblemCandidateCatalog | Promise<ProblemCandidateCatalog>
  ): Promise<void> {
    await mutatePersonalOsWithSidecar(this.dataDir, PROBLEM_CANDIDATES_SIDECAR, async (current, existingContent) => {
      if (current.graph.version !== 2) {
        throw new ProblemCandidateStoreError('unsupported_graph', 'Problem candidates require canonical Graph v2');
      }
      // The callback already owns the SSOT lock. Parse the supplied sidecar
      // content instead of calling readPersonalOsSidecar or FoundationStore.
      const catalog = parseCatalog(existingContent);
      const next = await mutator(catalog, current);
      assertCatalog(next);
      return {
        next: current,
        sidecarContent: `${JSON.stringify(next, null, 2)}\n`,
        result: undefined
      };
    });
  }
}

interface FoundationRecordExpectation {
  readonly reference: ProblemCandidateObjectiveReference;
  readonly digest: string;
}

function assertObjectivesAtAggregate(
  current: PersonalOs,
  references: readonly ProblemCandidateObjectiveReference[],
  expected: readonly FoundationRecordExpectation[],
  context: ProblemCandidateStoreContext
): void {
  if (current.graph.version !== 2) {
    throw new ProblemCandidateStoreError('unsupported_graph', 'Problem candidates require canonical Graph v2');
  }
  const catalog = foundationCatalogOrEmpty(current.graph.foundation);
  for (const item of expected) {
    const actual = findFoundationRecord(catalog, item.reference);
    const latest = findLatestFoundationRecord(catalog, 'objective', item.reference.id);
    if (!actual) throw new ProblemCandidateStoreError('not_found', `Objective ${item.reference.id}@${item.reference.revision} disappeared before commit`);
    if (!latest || latest.definition.type !== 'objective') {
      throw new ProblemCandidateStoreError('corrupt_record', `Objective ${item.reference.id} has no valid latest revision`);
    }
    if (actual.definition.type !== 'objective') {
      throw new ProblemCandidateStoreError('corrupt_record', `Candidate references non-Objective ${item.reference.id}`);
    }
    if (actual.digest !== item.digest || actual.digest !== item.reference.digest) {
      throw new ProblemCandidateStoreError('revision_conflict', `Objective ${item.reference.id}@${item.reference.revision} changed before candidate commit`);
    }
    assertAclRead(latest.definition, context.principal);
    assertScopeAccess(latest.definition, context);
  }
  // Keep this check explicit so callers cannot accidentally pass an expectation
  // for a different Objective set when adding a future resolver.
  if (references.length !== expected.length) {
    throw new ProblemCandidateStoreError('corrupt_record', 'Objective resolution set is incomplete');
  }
}

function makeCandidateRecord(
  input: ProblemCandidateInput,
  payloadDigest: string,
  mergedFrom: readonly string[]
): ProblemCandidateRecord {
  const recordedAt = input.event.recordedAt;
  return deepFreeze({
    contractVersion: PROBLEM_CANDIDATES_CONTRACT_VERSION,
    id: input.id,
    kind: input.kind,
    statement: input.statement,
    objectiveRefs: input.objectiveRefs,
    event: input.event,
    observedGap: input.observedGap,
    opportunity: input.opportunity,
    threat: input.threat,
    uncertainty: input.uncertainty,
    deadline: input.deadline,
    expectedEffect: input.expectedEffect,
    requiredResources: input.requiredResources,
    responsibleId: input.responsibleId,
    ownerScope: input.ownerScope,
    acl: input.acl,
    status: 'candidate',
    mergedFrom: [...mergedFrom],
    createdAt: input.createdAt ?? recordedAt,
    updatedAt: recordedAt,
    provenance: {
      eventIds: [input.event.id],
      sourceRefs: input.event.sourceRefs,
      candidateIds: [...mergedFrom]
    },
    payloadDigest
  });
}

function digestCandidateInput(input: ProblemCandidateInput): string {
  return `sha256:${createHash('sha256').update(canonicalJson({
    id: input.id,
    kind: input.kind,
    statement: input.statement,
    objectiveRefs: input.objectiveRefs,
    event: input.event,
    observedGap: input.observedGap,
    opportunity: input.opportunity,
    threat: input.threat,
    uncertainty: input.uncertainty,
    deadline: input.deadline,
    expectedEffect: input.expectedEffect,
    requiredResources: input.requiredResources,
    responsibleId: input.responsibleId,
    ownerScope: input.ownerScope,
    acl: input.acl,
    mergedFrom: input.mergedFrom ?? []
  }), 'utf8').digest('hex')}`;
}

function parseCatalog(rawText: string | undefined): ProblemCandidateCatalog {
  if (rawText === undefined) return emptyCatalog();
  try {
    const raw: unknown = JSON.parse(rawText);
    assertCatalog(raw);
    return cloneCatalog(raw);
  } catch (error) {
    if (error instanceof ProblemCandidateStoreError) throw error;
    throw new ProblemCandidateStoreError('corrupt_record', formatError(error));
  }
}

function assertCatalog(value: unknown): asserts value is ProblemCandidateCatalog {
  if (!isRecord(value) || value.version !== PROBLEM_CANDIDATE_CATALOG_VERSION
    || !Array.isArray(value.candidates) || !Array.isArray(value.events)) {
    throw new ProblemCandidateStoreError('corrupt_record', 'Problem candidate sidecar requires version 1 candidates and events arrays');
  }
  const candidateIds = new Set<string>();
  const eventIds = new Set<string>();
  for (const raw of value.candidates) {
    const candidate = normalizeStoredCandidate(raw);
    if (candidateIds.has(candidate.id)) throw new ProblemCandidateStoreError('corrupt_record', `Duplicate candidate ${candidate.id}`);
    candidateIds.add(candidate.id);
    if (eventIds.has(candidate.event.id)) throw new ProblemCandidateStoreError('corrupt_record', `Duplicate event ${candidate.event.id}`);
    eventIds.add(candidate.event.id);
  }
  const ledgerEventIds = new Set<string>();
  const ledgerCandidateIds = new Set<string>();
  for (const raw of value.events) {
    if (!isRecord(raw) || !isNonEmptyString(raw.eventId) || !isNonEmptyString(raw.candidateId) || !isDigest(raw.payloadDigest)) {
      throw new ProblemCandidateStoreError('corrupt_record', 'Problem candidate event ledger entry is malformed');
    }
    if (ledgerEventIds.has(raw.eventId) || ledgerCandidateIds.has(raw.candidateId)) {
      throw new ProblemCandidateStoreError('corrupt_record', `Duplicate event ledger entry for ${raw.eventId}`);
    }
    ledgerEventIds.add(raw.eventId);
    ledgerCandidateIds.add(raw.candidateId);
    if (eventIds.has(raw.eventId)) {
      const candidateRaw = value.candidates.find((item) => isRecord(item) && isRecord(item.event) && item.event.id === raw.eventId);
      if (!isRecord(candidateRaw) || candidateRaw.id !== raw.candidateId || candidateRaw.payloadDigest !== raw.payloadDigest) {
        throw new ProblemCandidateStoreError('corrupt_record', `Event ledger mismatch for ${raw.eventId}`);
      }
    } else {
      throw new ProblemCandidateStoreError('corrupt_record', `Event ledger ${raw.eventId} has no candidate`);
    }
  }
  if (value.events.length !== value.candidates.length) {
    throw new ProblemCandidateStoreError('corrupt_record', 'Every candidate event must have exactly one idempotency ledger entry');
  }
  if (ledgerEventIds.size !== eventIds.size || ledgerCandidateIds.size !== candidateIds.size) {
    throw new ProblemCandidateStoreError('corrupt_record', 'Problem candidate event ledger is incomplete');
  }
}

function normalizeStoredCandidate(value: unknown): ProblemCandidateRecord {
  if (!isRecord(value)) throw new ProblemCandidateStoreError('corrupt_record', 'Problem candidate record is not an object');
  assertOnlyKeys(value, [
    'acl', 'contractVersion', 'createdAt', 'deadline', 'event', 'expectedEffect', 'id', 'kind',
    'mergedFrom', 'observedGap', 'objectiveRefs', 'opportunity', 'ownerScope', 'provenance',
    'payloadDigest', 'requiredResources', 'responsibleId', 'statement', 'status', 'threat',
    'uncertainty', 'updatedAt'
  ], 'stored candidate');
  if (value.contractVersion !== PROBLEM_CANDIDATES_CONTRACT_VERSION
    || !isDigest(value.payloadDigest)
    || !isIsoTimestamp(value.createdAt)
    || !isIsoTimestamp(value.updatedAt)
    || !Array.isArray(value.mergedFrom)
    || !isRecord(value.provenance)
    || !Array.isArray(value.provenance.eventIds)
    || !Array.isArray(value.provenance.sourceRefs)
    || !Array.isArray(value.provenance.candidateIds)) {
    throw new ProblemCandidateStoreError('corrupt_record', 'Stored problem candidate metadata is malformed');
  }
  const input = normalizeProblemCandidate({
    id: value.id as string,
    kind: value.kind as ProblemCandidateKind,
    statement: value.statement as string,
    objectiveRefs: value.objectiveRefs as ProblemCandidateObjectiveReference[],
    event: value.event as ProblemCandidateEventInput,
    observedGap: value.observedGap as ProblemCandidateField<string>,
    opportunity: value.opportunity as ProblemCandidateField<string>,
    threat: value.threat as ProblemCandidateField<string>,
    uncertainty: value.uncertainty as ProblemCandidateField<string>,
    deadline: value.deadline as ProblemCandidateField<ProblemCandidateDeadline>,
    expectedEffect: value.expectedEffect as ProblemCandidateField<string>,
    requiredResources: value.requiredResources as ProblemCandidateField<readonly ProblemCandidateResource[]>,
    responsibleId: value.responsibleId as ProblemCandidateField<string>,
    ownerScope: value.ownerScope as FoundationScope,
    acl: value.acl as FoundationAcl,
    mergedFrom: value.mergedFrom as string[],
    createdAt: value.createdAt as string,
    // Stored records may be merged/dismissed. The input normalizer validates
    // the candidate payload; the lifecycle status is checked separately below.
  });
  const status = normalizeCandidateStatus(value.status, 'status');
  if (!isIsoTimestamp(value.updatedAt)) throw new ProblemCandidateStoreError('corrupt_record', 'updatedAt is invalid');
  const sourceRefs = value.provenance.sourceRefs.map((source, index) => normalizeSourceRef(source, `provenance.sourceRefs[${index}]`));
  const eventIds = normalizeIdentifiers(value.provenance.eventIds, 'provenance.eventIds');
  const candidateIds = normalizeIdentifiers(value.provenance.candidateIds, 'provenance.candidateIds');
  if (eventIds.length !== 1 || eventIds[0] !== input.event.id) throw new ProblemCandidateStoreError('corrupt_record', 'Candidate provenance must retain its event id');
  if (candidateIds.join('\u0000') !== (input.mergedFrom ?? []).join('\u0000')) throw new ProblemCandidateStoreError('corrupt_record', `Candidate ${input.id} merge provenance mismatch`);
  if (canonicalJson(sourceRefs) !== canonicalJson(input.event.sourceRefs)) throw new ProblemCandidateStoreError('corrupt_record', `Candidate ${input.id} source provenance mismatch`);
  const payloadDigest = digestCandidateInput(input);
  if (payloadDigest !== value.payloadDigest) throw new ProblemCandidateStoreError('corrupt_record', `Candidate ${input.id} payload digest mismatch`);
  return deepFreeze({
    contractVersion: PROBLEM_CANDIDATES_CONTRACT_VERSION,
    ...input,
    status,
    mergedFrom: input.mergedFrom ?? [],
    createdAt: String(value.createdAt),
    updatedAt: String(value.updatedAt),
    provenance: { eventIds, sourceRefs, candidateIds },
    payloadDigest
  });
}

function cloneCatalog(catalog: ProblemCandidateCatalog): ProblemCandidateCatalog {
  return {
    version: PROBLEM_CANDIDATE_CATALOG_VERSION,
    candidates: catalog.candidates.map((candidate) => cloneCandidate(candidate)),
    events: catalog.events.map((event) => ({ ...event }))
  };
}

function cloneCandidate(candidate: ProblemCandidateRecord): ProblemCandidateRecord {
  return deepFreeze(JSON.parse(JSON.stringify(candidate)) as ProblemCandidateRecord);
}

function emptyCatalog(): ProblemCandidateCatalog {
  return { version: PROBLEM_CANDIDATE_CATALOG_VERSION, candidates: [], events: [] };
}

function collectCandidateSourceRefs(
  catalog: ProblemCandidateCatalog,
  candidate: ProblemCandidateRecord
): readonly ProblemCandidateSourceRef[] {
  const refs: ProblemCandidateSourceRef[] = [];
  const seenSources = new Set<string>();
  const visitedCandidates = new Set<string>();
  const visit = (current: ProblemCandidateRecord): void => {
    if (visitedCandidates.has(current.id)) return;
    visitedCandidates.add(current.id);
    for (const source of current.event.sourceRefs) {
      const key = `${source.kind}:${source.id}:${source.digest ?? ''}`;
      if (seenSources.has(key)) continue;
      seenSources.add(key);
      refs.push(source);
    }
    for (const sourceId of current.mergedFrom) {
      const source = catalog.candidates.find((item) => item.id === sourceId);
      if (!source) {
        throw new ProblemCandidateStoreError('corrupt_record', `Candidate ${current.id} points to missing merge source ${sourceId}`);
      }
      visit(source);
    }
  };
  visit(candidate);
  return refs;
}

function normalizeEvent(value: unknown): ProblemCandidateEvent {
  if (!isRecord(value)) throw invalid('event must be an object');
  assertOnlyKeys(value, ['id', 'occurredAt', 'recordedAt', 'sourceRefs'], 'event');
  const id = requireIdentifier(value.id, 'event.id');
  const occurredAt = requireIsoTimestamp(value.occurredAt, 'event.occurredAt');
  const recordedAt = requireIsoTimestamp(value.recordedAt, 'event.recordedAt');
  if (Date.parse(recordedAt) < Date.parse(occurredAt)) throw invalid('event.recordedAt cannot precede event.occurredAt');
  if (!Array.isArray(value.sourceRefs) || value.sourceRefs.length === 0) throw invalid('event.sourceRefs must contain at least one source reference');
  const sourceRefs = value.sourceRefs.map((source, index) => normalizeSourceRef(source, `event.sourceRefs[${index}]`));
  assertUnique(sourceRefs.map((source) => `${source.kind}:${source.id}`), 'event.sourceRefs');
  return deepFreeze({ id, occurredAt, recordedAt, sourceRefs });
}

function normalizeObjectiveReference(value: unknown, label: string): ProblemCandidateObjectiveReference {
  if (!isRecord(value)
    || value.type !== 'objective'
    || !isNonEmptyString(value.id)
    || !isPositiveRevision(value.revision)
    || !isDigest(value.digest)) {
    throw invalid(`${label} must contain objective id, positive revision, and sha256 digest`);
  }
  return deepFreeze({ id: String(value.id).trim(), type: 'objective', revision: String(value.revision), digest: value.digest });
}

function normalizeSourceRef(value: unknown, label: string): ProblemCandidateSourceRef {
  if (!isRecord(value)) throw invalid(`${label} must be an object`);
  assertOnlyKeys(value, ['digest', 'id', 'kind'], label);
  if (!isNonEmptyString(value.id) || !isSourceKind(value.kind) || (value.digest !== undefined && !isDigest(value.digest))) {
    throw invalid(`${label} must contain a source id, supported kind, and optional sha256 digest`);
  }
  return deepFreeze({
    id: String(value.id).trim(),
    kind: value.kind,
    ...(value.digest === undefined ? {} : { digest: value.digest })
  });
}

function normalizeTextField(value: unknown, label: string): ProblemCandidateField<string> {
  if (!isRecord(value) || !['known', 'unknown'].includes(String(value.status))) throw invalid(`${label} must be known or unknown`);
  assertOnlyKeys(value, ['status', 'value', 'reason'], label);
  if (value.status === 'unknown') return deepFreeze({ status: 'unknown', reason: requireText(value.reason, `${label}.reason`) });
  if (!isNonEmptyString(value.value)) throw invalid(`${label}.value must be non-empty when known`);
  return deepFreeze({ status: 'known', value: String(value.value) });
}

function normalizeDeadlineField(value: unknown, label: string): ProblemCandidateField<ProblemCandidateDeadline> {
  if (!isRecord(value) || !['known', 'unknown'].includes(String(value.status))) throw invalid(`${label} must be known or unknown`);
  assertOnlyKeys(value, ['status', 'value', 'reason'], label);
  if (value.status === 'unknown') return deepFreeze({ status: 'unknown', reason: requireText(value.reason, `${label}.reason`) });
  if (!isRecord(value.value)) throw invalid(`${label}.value must be an object when known`);
  assertOnlyKeys(value.value, ['dueAt', 'evaluationAt'], `${label}.value`);
  const dueAt = requireIsoTimestamp(value.value.dueAt, `${label}.value.dueAt`);
  const evaluationAt = value.value.evaluationAt === undefined
    ? undefined
    : requireIsoTimestamp(value.value.evaluationAt, `${label}.value.evaluationAt`);
  return deepFreeze({ status: 'known', value: { dueAt, ...(evaluationAt === undefined ? {} : { evaluationAt }) } });
}

function normalizeResourceField(value: unknown, label: string): ProblemCandidateField<readonly ProblemCandidateResource[]> {
  if (!isRecord(value) || !['known', 'unknown'].includes(String(value.status))) throw invalid(`${label} must be known or unknown`);
  assertOnlyKeys(value, ['status', 'value', 'reason'], label);
  if (value.status === 'unknown') return deepFreeze({ status: 'unknown', reason: requireText(value.reason, `${label}.reason`) });
  if (!Array.isArray(value.value)) throw invalid(`${label}.value must be an array when known`);
  const resources = value.value.map((resource, index) => {
    if (!isRecord(resource)) throw invalid(`${label}.value[${index}] must be an object`);
    assertOnlyKeys(resource, ['id', 'kind', 'quantity', 'unit'], `${label}.value[${index}]`);
    if (!isNonEmptyString(resource.id) || !isNonEmptyString(resource.kind)) throw invalid(`${label}.value[${index}] id and kind are required`);
    if (resource.quantity !== undefined && (typeof resource.quantity !== 'number' || !Number.isFinite(resource.quantity) || resource.quantity < 0)) {
      throw invalid(`${label}.value[${index}].quantity must be a finite non-negative number`);
    }
    if (resource.unit !== undefined && !isNonEmptyString(resource.unit)) throw invalid(`${label}.value[${index}].unit must be non-empty`);
    return {
      id: String(resource.id).trim(),
      kind: String(resource.kind).trim(),
      ...(resource.quantity === undefined ? {} : { quantity: resource.quantity }),
      ...(resource.unit === undefined ? {} : { unit: String(resource.unit).trim() })
    };
  });
  assertUnique(resources.map((resource) => `${resource.kind}:${resource.id}`), `${label}.value`);
  return deepFreeze({ status: 'known', value: resources });
}

function normalizeScope(value: unknown, label: string, requireSubjects: boolean): FoundationScope {
  if (!isRecord(value) || !Array.isArray(value.subjectIds) || !isIsoTimestamp(value.validFrom)
    || (value.validUntil !== undefined && !isIsoTimestamp(value.validUntil))) {
    throw invalid(`${label} is invalid`);
  }
  const subjectIds = normalizeIdentifiers(value.subjectIds, `${label}.subjectIds`);
  if (requireSubjects && subjectIds.length === 0) throw invalid(`${label}.subjectIds must contain at least one subject`);
  if (value.validUntil !== undefined && Date.parse(value.validUntil) < Date.parse(value.validFrom)) throw invalid(`${label}.validUntil precedes validFrom`);
  return deepFreeze({ subjectIds, validFrom: value.validFrom, ...(value.validUntil === undefined ? {} : { validUntil: value.validUntil }) });
}

function normalizeAcl(value: unknown, label: string): FoundationAcl {
  if (!isRecord(value) || !isNonEmptyString(value.ownerId)
    || !['private', 'project', 'organization', 'public'].includes(String(value.visibility))
    || !Array.isArray(value.readerIds) || !Array.isArray(value.writerIds)) {
    throw invalid(`${label} is invalid`);
  }
  const readerIds = normalizeIdentifiers(value.readerIds, `${label}.readerIds`);
  const writerIds = normalizeIdentifiers(value.writerIds, `${label}.writerIds`);
  const visibility = value.visibility as FoundationAcl['visibility'];
  return deepFreeze({ ownerId: String(value.ownerId).trim(), visibility, readerIds, writerIds });
}

function normalizeQuery(query: ProblemCandidateQuery | undefined): ProblemCandidateQuery {
  if (query === undefined) return {};
  if (!isRecord(query)) throw invalid('query must be an object');
  assertOnlyKeys(query, ['ownerScope', 'responsibleId', 'status'], 'query');
  return {
    ...(query.ownerScope === undefined ? {} : { ownerScope: normalizeScope(query.ownerScope, 'query.ownerScope', true) }),
    ...(query.responsibleId === undefined ? {} : { responsibleId: requireIdentifier(query.responsibleId, 'query.responsibleId') }),
    ...(query.status === undefined ? {} : { status: normalizeCandidateStatus(query.status, 'query.status') })
  };
}

function matchesQuery(candidate: ProblemCandidateRecord, query: ProblemCandidateQuery): boolean {
  if (query.status !== undefined && candidate.status !== query.status) return false;
  if (query.responsibleId !== undefined && (candidate.responsibleId.status !== 'known' || candidate.responsibleId.value !== query.responsibleId)) return false;
  if (query.ownerScope !== undefined && !scopeContains(query.ownerScope, candidate.ownerScope)) return false;
  return true;
}

function assertCandidateWrite(candidate: ProblemCandidateInput | ProblemCandidateRecord, context: ProblemCandidateStoreContext): void {
  if (!aclAllowsWrite(candidate.acl, context.principal)) throw new ProblemCandidateStoreError('authorization_denied', `Principal ${context.principal} cannot write candidate ${candidate.id}`);
  assertCandidateScope(candidate, context);
}

function assertCandidateRead(candidate: ProblemCandidateRecord, context: ProblemCandidateStoreContext): void {
  if (!aclAllowsRead(candidate.acl, context.principal)) throw new ProblemCandidateStoreError('authorization_denied', `Principal ${context.principal} cannot read candidate ${candidate.id}`);
  assertCandidateScope(candidate, context);
}

function assertCandidateScope(candidate: { readonly ownerScope: FoundationScope }, context: ProblemCandidateStoreContext): void {
  if (context.scope !== undefined && !scopeContains(context.scope, candidate.ownerScope)) {
    throw new ProblemCandidateStoreError('scope_violation', `Candidate is outside the trusted scope for ${context.principal}`);
  }
}

function assertAclRead(definition: FoundationDefinition, principal: string): void {
  if (!aclAllowsRead(definition.acl, principal)) throw new ProblemCandidateStoreError('authorization_denied', `Principal ${principal} cannot read Objective ${definition.id}`);
}

function assertScopeAccess(definition: FoundationDefinition, context: ProblemCandidateStoreContext): void {
  if (context.scope !== undefined && !scopeContains(context.scope, definition.scope)) {
    throw new ProblemCandidateStoreError('scope_violation', `Objective ${definition.id} is outside the trusted scope`);
  }
}

function scopeContains(container: FoundationScope, target: FoundationScope): boolean {
  const allowed = new Set(container.subjectIds);
  if (target.subjectIds.length === 0 || target.subjectIds.some((subjectId) => !allowed.has(subjectId))) return false;
  if (Date.parse(target.validFrom) < Date.parse(container.validFrom)) return false;
  if (container.validUntil !== undefined) {
    if (target.validUntil === undefined || Date.parse(target.validUntil) > Date.parse(container.validUntil)) return false;
  }
  return true;
}

function aclAllowsWrite(acl: FoundationAcl, principal: string): boolean {
  return acl.ownerId === principal || acl.writerIds.includes(principal);
}

function aclAllowsRead(acl: FoundationAcl, principal: string): boolean {
  return acl.visibility === 'public'
    || acl.ownerId === principal
    || acl.readerIds.includes(principal)
    || acl.writerIds.includes(principal);
}

function mapFoundationError(error: unknown, reference: ProblemCandidateObjectiveReference): ProblemCandidateStoreError {
  const code = errorCode(error);
  if (code === 'authorization_denied') return new ProblemCandidateStoreError('authorization_denied', `Objective ${reference.id}@${reference.revision} is not readable`);
  if (code === 'scope_violation') return new ProblemCandidateStoreError('scope_violation', `Objective ${reference.id}@${reference.revision} is outside the trusted scope`);
  if (code === 'not_found') return new ProblemCandidateStoreError('not_found', `Objective ${reference.id}@${reference.revision} was not found`);
  return new ProblemCandidateStoreError('corrupt_record', `Objective resolver failed for ${reference.id}@${reference.revision}: ${formatError(error)}`);
}

function assertContext(context: ProblemCandidateStoreContext): void {
  if (!context || !isNonEmptyString(context.principal)) throw new ProblemCandidateStoreError('authorization_denied', 'A trusted principal is required');
  if (context.scope !== undefined) normalizeScope(context.scope, 'context.scope', false);
}

function normalizeCandidateStatus(value: unknown, label: string): ProblemCandidateStatus {
  if (value !== 'candidate' && value !== 'merged' && value !== 'dismissed') throw invalid(`${label} must be candidate, merged, or dismissed`);
  return value;
}

function requireCandidateKind(value: unknown, label: string): ProblemCandidateKind {
  if (value !== 'gap' && value !== 'opportunity' && value !== 'threat' && value !== 'uncertainty') {
    throw invalid(`${label} must be gap, opportunity, threat, or uncertainty`);
  }
  return value;
}

function isSourceKind(value: unknown): value is ProblemCandidateSourceKind {
  return value === 'event' || value === 'observation' || value === 'document' || value === 'decision'
    || value === 'import' || value === 'candidate' || value === 'evidence';
}

function normalizeIdentifiers(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw invalid(`${label} must be an array`);
  const identifiers = value.map((item, index) => requireIdentifier(item, `${label}[${index}]`));
  assertUnique(identifiers, label);
  return identifiers;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw invalid(`${label} must not contain duplicates`);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unexpected.length > 0) throw invalid(`${label} contains unsupported field(s): ${unexpected.join(', ')}`);
}

function requireIdentifier(value: unknown, label: string): string {
  if (!isNonEmptyString(value) || value.includes('\0')) throw invalid(`${label} must be a non-empty identifier`);
  return value.trim();
}

function requireText(value: unknown, label: string): string {
  if (!isNonEmptyString(value)) throw invalid(`${label} must be non-empty text`);
  return value.trim();
}

function requireIsoTimestamp(value: unknown, label: string): string {
  if (!isIsoTimestamp(value)) throw invalid(`${label} must be an ISO timestamp`);
  return value;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = zone === 'Z' ? 0 : Number(offsetHourText);
  const offsetMinute = zone === 'Z' ? 0 : Number(offsetMinuteText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth
    && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59
    && offsetHour >= 0 && offsetHour <= 23 && offsetMinute >= 0 && offsetMinute <= 59
    && Number.isFinite(Date.parse(value));
}

function isPositiveRevision(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(message: string): ProblemCandidateStoreError {
  return new ProblemCandidateStoreError('invalid_input', message);
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalValue(value));
  if (serialized === undefined) throw invalid('candidate values must be JSON-compatible');
  return serialized;
}

function canonicalValue(value: unknown, active = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid('candidate values must contain finite numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') throw invalid('candidate values must be JSON-compatible');
  if (active.has(value)) throw invalid('candidate values must not be cyclic');
  active.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalValue(item, active));
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalValue((value as Record<string, unknown>)[key], active);
    return result;
  } finally {
    active.delete(value);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
