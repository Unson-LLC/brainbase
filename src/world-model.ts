import {
  validateFoundationDefinition,
  type FoundationDefinition,
  type FoundationAcl,
  type FoundationAdoptionState,
  type FoundationEpistemicState,
  type FoundationPeriod,
  type FoundationProvenance,
  type FoundationRevision,
  type FoundationUse,
  type FoundationValidationResult,
  type DecisionRevision,
  type ModelDefinition,
  type VariableDefinition
} from './ontology-foundation.js';
import {
  findFoundationRecord,
  findLatestFoundationRecord,
  foundationCatalogOrEmpty
} from './foundation-catalog.js';
import { loadPersonalOs, mutatePersonalOsWithSidecar, readPersonalOsSidecar } from './ssot.js';
import type { PersonalOs } from './types.js';

/**
 * The world-model helpers are deliberately independent of storage.  Definitions
 * belong to the shared foundation catalog; observations and adoption records are
 * values that reference an exact definition revision. A caller can therefore
 * pass these records through the canonical SSOT transaction without introducing
 * a second lock or definition authority.
 */
export const WORLD_MODEL_CONTRACT_VERSION = '0.1.0' as const;
export const WORLD_MODEL_RECORD_CATALOG_VERSION = 1 as const;
/** Evidence records are sidecar data committed with the canonical aggregate. */
export const WORLD_MODEL_EVIDENCE_SIDECAR = 'evidence/world-model.json' as const;

export type WorldModelScalar = string | number | boolean;

export type WorldModelValue =
  | WorldModelScalar
  | readonly WorldModelValue[]
  | { readonly [key: string]: WorldModelValue };

export interface WorldModelObservationInput {
  id: string;
  variableRef: FoundationRevision;
  subjectId: string;
  value: WorldModelValue;
  /** When the observed event happened. */
  occurredAt: string;
  /** The interval for which the value is valid, which may differ from occurredAt. */
  period: FoundationPeriod;
  /** When Brainbase recorded the observation. */
  recordedAt: string;
  sourceRef: FoundationProvenance;
  /** A correction creates a new observation and points at the old one. */
  supersedes?: string;
}

export interface WorldModelObservation extends WorldModelObservationInput {
  readonly id: string;
  readonly variableRef: FoundationRevision;
  readonly subjectId: string;
  readonly value: WorldModelValue;
  readonly occurredAt: string;
  readonly period: FoundationPeriod;
  readonly recordedAt: string;
  readonly sourceRef: FoundationProvenance;
  readonly supersedes?: string;
}

export type WorldModelValidationIssueCode =
  | 'MISSING_FIELD'
  | 'INVALID_FIELD'
  | 'INVALID_TIMESTAMP'
  | 'INVALID_PERIOD'
  | 'INVALID_VARIABLE_REFERENCE'
  | 'VARIABLE_VALUE_KIND_MISMATCH'
  | 'OBSERVATION_SCOPE_MISMATCH'
  | 'OBSERVATION_PERIOD_MISMATCH'
  | 'RECORDED_BEFORE_OCCURRED'
  | 'INVALID_CORRECTION_REFERENCE'
  | 'MISSING_SOURCE'
  | 'MODEL_CONTRACT_INVALID';

export interface WorldModelValidationIssue {
  readonly code: WorldModelValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface WorldModelValidationResult {
  readonly valid: boolean;
  readonly status: 'valid' | 'invalid';
  readonly issues: readonly WorldModelValidationIssue[];
}

/**
 * A candidate snapshot is intentionally not a FoundationDefinition.  It
 * captures the candidate-store state at the moment a model is proposed so that
 * adopting a model never overwrites the original hypothesis or ACL.
 */
export interface CandidateModelSnapshot {
  readonly candidateId: string;
  readonly hypothesis: string;
  readonly evidenceIds: readonly string[];
  readonly acl: FoundationAcl;
  readonly epistemicState: Extract<FoundationEpistemicState, 'unverified' | 'hypothesis'>;
}

export interface ModelAdoptionInput {
  readonly adoptionId: string;
  readonly modelRef: FoundationRevision;
  readonly candidate: CandidateModelSnapshot;
  readonly adoptionState: Extract<FoundationAdoptionState, 'proposed' | 'approved'>;
  readonly authorizedUse: FoundationUse;
  readonly adoptedAt: string;
  readonly approvalRef?: DecisionRevision;
}

export interface ModelAdoptionRecord extends ModelAdoptionInput {
  readonly modelRef: FoundationRevision;
  readonly candidate: CandidateModelSnapshot;
  readonly adoptionState: Extract<FoundationAdoptionState, 'proposed' | 'approved'>;
  readonly authorizedUse: FoundationUse;
  readonly adoptedAt: string;
  readonly approvalRef?: DecisionRevision;
}

/**
 * This is an evidence-sidecar catalog, not part of the canonical Graph
 * aggregate. Variable and Model definitions continue to be resolved by the
 * foundation catalog, while this catalog holds immutable observations and
 * candidate adoption references that point back to exact definition revisions.
 */
export interface WorldModelRecordCatalog {
  readonly version: typeof WORLD_MODEL_RECORD_CATALOG_VERSION;
  readonly observations: readonly WorldModelObservation[];
  readonly adoptions: readonly ModelAdoptionRecord[];
}

export interface WorldModelStoreContext {
  /** Identity resolved by the trusted auth boundary. */
  readonly principal: string;
}

export interface WorldModelFoundationRecord {
  readonly definition: FoundationDefinition;
  readonly digest: string;
}

/**
 * Structural contract implemented by the shared FoundationRevisionStore. It
 * is local to this module so world-model can depend on the small public store
 * surface without introducing a second definition catalog. Transactional
 * foundation resolution is implemented below from the aggregate already held
 * by mutatePersonalOsWithSidecar; the normal read method must not be
 * re-entered while that lock is held.
 */
export interface WorldModelFoundationStore {
  create(
    definition: FoundationDefinition,
    context: WorldModelStoreContext
  ): Promise<FoundationRevision & { readonly digest: string }>;
  read(
    reference: FoundationRevision,
    context: WorldModelStoreContext
  ): Promise<WorldModelFoundationRecord | null>;
}

export interface WorldModelObservationQuery {
  readonly variableRef?: FoundationRevision;
  readonly subjectId?: string;
  readonly supersedes?: string;
}

export type ModelAdoptionStoreInput = Omit<ModelAdoptionInput, 'candidate' | 'modelRef'>;

export type WorldModelStoreErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'revision_conflict'
  | 'authorization_denied'
  | 'unsupported_graph'
  | 'corrupt_record'
  | 'readback_mismatch';

export class WorldModelStoreError extends Error {
  readonly code: WorldModelStoreErrorCode;

  constructor(code: WorldModelStoreErrorCode, message: string) {
    super(message);
    this.name = 'WorldModelStoreError';
    this.code = code;
  }
}

export interface WorldModelRecordStore {
  createVariable(
    variable: VariableDefinition,
    context: WorldModelStoreContext
  ): Promise<FoundationRevision & { readonly digest: string }>;
  createModel(
    model: ModelDefinition,
    context: WorldModelStoreContext
  ): Promise<FoundationRevision & { readonly digest: string }>;
  readModel(
    reference: FoundationRevision,
    context: WorldModelStoreContext
  ): Promise<ModelDefinition | null>;
  saveObservation(
    input: WorldModelObservationInput,
    context: WorldModelStoreContext
  ): Promise<WorldModelObservation>;
  readObservation(
    id: string,
    context: WorldModelStoreContext
  ): Promise<WorldModelObservation | null>;
  listObservations(
    query: WorldModelObservationQuery | undefined,
    context: WorldModelStoreContext
  ): Promise<readonly WorldModelObservation[]>;
  saveModelAdoption(
    candidate: CandidateModelSnapshot,
    modelRef: FoundationRevision,
    adoption: ModelAdoptionStoreInput,
    context: WorldModelStoreContext
  ): Promise<ModelAdoptionRecord>;
  readModelAdoption(
    adoptionId: string,
    context: WorldModelStoreContext
  ): Promise<ModelAdoptionRecord | null>;
  listModelAdoptions(
    context: WorldModelStoreContext
  ): Promise<readonly ModelAdoptionRecord[]>;
}

export class WorldModelValidationError extends Error {
  readonly issues: readonly WorldModelValidationIssue[];

  constructor(issues: readonly WorldModelValidationIssue[]) {
    super(`World model validation failed: ${issues.map((issue) => `${issue.path} (${issue.code}): ${issue.message}`).join(', ')}`);
    this.name = 'WorldModelValidationError';
    this.issues = issues;
  }
}

/**
 * Validates and clones an observation before it crosses a storage boundary.
 * The returned value is deeply frozen, while the input remains untouched.
 */
export function normalizeWorldModelObservation(input: WorldModelObservationInput): WorldModelObservation {
  const issues = observationShapeIssues(input);
  if (issues.length > 0) throw new WorldModelValidationError(issues);

  const normalized: WorldModelObservation = {
    id: input.id.trim(),
    variableRef: freezeCloneRevision(input.variableRef),
    subjectId: input.subjectId.trim(),
    value: cloneWorldModelValue(input.value, 'value'),
    occurredAt: input.occurredAt,
    period: freezeClonePeriod(input.period),
    recordedAt: input.recordedAt,
    sourceRef: freezeCloneProvenance(input.sourceRef),
    ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes.trim() })
  };
  return deepFreeze(normalized);
}

/**
 * Checks whether an already normalized observation is compatible with the
 * exact Variable definition it references.  This does not infer a value or
 * upgrade an observation from inferred to observed.
 */
export function validateWorldModelObservation(
  observation: WorldModelObservation,
  variable: VariableDefinition
): WorldModelValidationResult {
  const issues: WorldModelValidationIssue[] = [];

  if (observation.variableRef.type !== 'variable'
    || observation.variableRef.id !== variable.id
    || observation.variableRef.revision !== variable.revision) {
    issues.push({
      code: 'INVALID_VARIABLE_REFERENCE',
      path: 'variableRef',
      message: `Observation references ${observation.variableRef.id}@${observation.variableRef.revision}, expected ${variable.id}@${variable.revision}.`
    });
  }

  if (variable.scope.subjectIds.length > 0 && !variable.scope.subjectIds.includes(observation.subjectId)) {
    issues.push({
      code: 'OBSERVATION_SCOPE_MISMATCH',
      path: 'subjectId',
      message: `Subject ${observation.subjectId} is outside Variable ${variable.id} scope.`
    });
  }

  if (!valueMatchesKind(observation.value, variable.valueKind)) {
    issues.push({
      code: 'VARIABLE_VALUE_KIND_MISMATCH',
      path: 'value',
      message: `Observation value does not match Variable valueKind ${variable.valueKind}.`
    });
  }

  const validFrom = parseIsoTimestamp(variable.scope.validFrom);
  const validUntil = variable.scope.validUntil === undefined ? undefined : parseIsoTimestamp(variable.scope.validUntil);
  const periodFrom = parseIsoTimestamp(observation.period.from);
  const periodUntil = parseIsoTimestamp(observation.period.until);
  if (validFrom !== undefined && periodFrom !== undefined && periodFrom < validFrom) {
    issues.push({
      code: 'OBSERVATION_PERIOD_MISMATCH',
      path: 'period.from',
      message: 'Observation period begins before the Variable scope becomes valid.'
    });
  }
  if (validUntil !== undefined && periodUntil !== undefined && periodUntil > validUntil) {
    issues.push({
      code: 'OBSERVATION_PERIOD_MISMATCH',
      path: 'period.until',
      message: 'Observation period ends after the Variable scope expires.'
    });
  }

  return validationResult(issues);
}

/**
 * Delegates Model validation to the shared ontology contract.  The wrapper
 * keeps world-model callers from importing ontology internals while retaining
 * the contract's distinction between draft, judgment, evaluation, and
 * execution use.
 */
export function validateWorldModelModel(
  model: ModelDefinition,
  use: FoundationUse = 'judgment'
): FoundationValidationResult {
  return validateFoundationDefinition(model, { use });
}

/**
 * Creates a durable adoption record without mutating the candidate or Model.
 * A candidate may only produce an unverified/hypothesis Model record; adopting
 * it cannot silently turn it into a verified claim.
 */
export function retainCandidateModel(
  candidate: CandidateModelSnapshot,
  model: ModelDefinition,
  adoption: Omit<ModelAdoptionInput, 'candidate' | 'modelRef'> & { modelRef?: FoundationRevision }
): ModelAdoptionRecord {
  const issues: WorldModelValidationIssue[] = [];
  if (!candidate.candidateId.trim()) issues.push(missing('candidate.candidateId'));
  if (!candidate.hypothesis.trim()) issues.push(missing('candidate.hypothesis'));
  if (!Array.isArray(candidate.evidenceIds) || candidate.evidenceIds.length === 0) {
    issues.push({ code: 'MISSING_SOURCE', path: 'candidate.evidenceIds', message: 'Candidate adoption must retain at least one evidence reference.' });
  } else if (candidate.evidenceIds.some((evidenceId) => !isNonEmptyString(evidenceId))) {
    issues.push({ code: 'MISSING_SOURCE', path: 'candidate.evidenceIds', message: 'Candidate evidence references must be non-empty strings.' });
  }
  if (!isRecord(candidate.acl) || !isNonEmptyString(candidate.acl.ownerId)) {
    issues.push(missing('candidate.acl.ownerId'));
  }
  if (!['unverified', 'hypothesis'].includes(candidate.epistemicState)) {
    issues.push({ code: 'INVALID_FIELD', path: 'candidate.epistemicState', message: 'Candidate adoption only retains unverified or hypothesis state.' });
  }
  if (model.type !== 'model') {
    issues.push({ code: 'MODEL_CONTRACT_INVALID', path: 'model.type', message: 'Candidate adoption requires a Model definition.' });
  }
  const modelValidation = validateWorldModelModel(model, adoption.authorizedUse);
  if (!modelValidation.valid) {
    issues.push(...modelValidation.issues.map((issue) => ({
      code: 'MODEL_CONTRACT_INVALID' as const,
      path: issue.path,
      message: issue.message
    })));
  }
  if (model.epistemicState === 'verified' || model.validationState === 'verified') {
    issues.push({
      code: 'INVALID_FIELD',
      path: 'model.epistemicState',
      message: 'A candidate adoption cannot be represented as a verified Model.'
    });
  }
  if (adoption.modelRef !== undefined
    && (adoption.modelRef.type !== 'model'
      || adoption.modelRef.id !== model.id
      || adoption.modelRef.revision !== model.revision)) {
    issues.push({
      code: 'INVALID_VARIABLE_REFERENCE',
      path: 'modelRef',
      message: `Adoption modelRef must match ${model.id}@${model.revision}.`
    });
  }
  if (issues.length > 0) throw new WorldModelValidationError(issues);

  const modelRef: FoundationRevision = freezeCloneRevision(adoption.modelRef ?? {
    id: model.id,
    type: 'model',
    revision: model.revision
  });
  const retainedCandidate: CandidateModelSnapshot = {
    candidateId: candidate.candidateId.trim(),
    hypothesis: candidate.hypothesis,
    evidenceIds: [...candidate.evidenceIds],
    acl: freezeCloneAcl(candidate.acl),
    epistemicState: candidate.epistemicState
  };
  const record: ModelAdoptionRecord = {
    adoptionId: adoption.adoptionId.trim(),
    modelRef,
    candidate: retainedCandidate,
    adoptionState: adoption.adoptionState,
    authorizedUse: adoption.authorizedUse,
    adoptedAt: adoption.adoptedAt,
    ...(adoption.approvalRef === undefined ? {} : { approvalRef: freezeCloneDecisionRevision(adoption.approvalRef) })
  };
  if (!record.adoptionId) throw new WorldModelValidationError([missing('adoptionId')]);
  if (!parseIsoTimestamp(record.adoptedAt)) throw new WorldModelValidationError([invalidTimestamp('adoptedAt')]);
  return deepFreeze(record);
}

/**
 * Creates a world-model record store over the existing canonical aggregate.
 * Foundation definitions are delegated to the shared revision store. The
 * observation/adoption evidence catalog is committed as a sidecar in the same
 * SSOT transaction, so the canonical Graph remains definition-only.
 */
export function createWorldModelStore(options: {
  dataDir: string;
  foundationStore: WorldModelFoundationStore;
}): WorldModelRecordStore {
  if (!options || !isNonEmptyString(options.dataDir)) {
    throw new WorldModelStoreError('invalid_input', 'dataDir is required');
  }
  if (!options.foundationStore || typeof options.foundationStore.read !== 'function'
    || typeof options.foundationStore.create !== 'function') {
    throw new WorldModelStoreError('invalid_input', 'foundationStore with create/read is required');
  }
  return new GraphWorldModelRecordStore(options.dataDir, options.foundationStore);
}

class GraphWorldModelRecordStore implements WorldModelRecordStore {
  constructor(
    private readonly dataDir: string,
    private readonly foundationStore: WorldModelFoundationStore
  ) {}

  async createVariable(
    variable: VariableDefinition,
    context: WorldModelStoreContext
  ): Promise<FoundationRevision & { readonly digest: string }> {
    assertStoreContext(context);
    assertFoundationForJudgment(variable, 'Variable');
    return this.foundationStore.create(variable, context);
  }

  async createModel(
    model: ModelDefinition,
    context: WorldModelStoreContext
  ): Promise<FoundationRevision & { readonly digest: string }> {
    assertStoreContext(context);
    assertFoundationForJudgment(model, 'Model');
    return this.foundationStore.create(model, context);
  }

  async readModel(
    reference: FoundationRevision,
    context: WorldModelStoreContext
  ): Promise<ModelDefinition | null> {
    assertStoreContext(context);
    assertModelReference(reference, 'reference');
    const record = await this.foundationStore.read(reference, context);
    if (!record) return null;
    if (record.definition.type !== 'model') {
      throw new WorldModelStoreError('corrupt_record', `Expected Model at ${reference.id}@${reference.revision}`);
    }
    assertFoundationAclRead(record.definition, context.principal);
    return cloneModel(record.definition);
  }

  async saveObservation(
    input: WorldModelObservationInput,
    context: WorldModelStoreContext
  ): Promise<WorldModelObservation> {
    assertStoreContext(context);
    const observation = normalizeStoreInput(input, 'observation');
    const variableRecord = await this.foundationStore.read(observation.variableRef, context);
    if (!variableRecord) {
      throw new WorldModelStoreError(
        'not_found',
        `Variable ${observation.variableRef.id}@${observation.variableRef.revision} was not found`
      );
    }
    if (variableRecord.definition.type !== 'variable') {
      throw new WorldModelStoreError('corrupt_record', `Observation references non-Variable ${observation.variableRef.id}`);
    }
    assertFoundationAclWrite(variableRecord.definition, context.principal);
    assertObservationCompatible(observation, variableRecord.definition);

    await this.mutateCatalog((catalog, current) => {
      const currentVariable = resolveFoundationAtAggregate(
        current,
        observation.variableRef,
        variableRecord,
        context.principal,
        'write'
      );
      if (currentVariable.definition.type !== 'variable') {
        throw new WorldModelStoreError('corrupt_record', `Variable ${observation.variableRef.id} changed type during commit`);
      }
      assertFoundationAclWrite(currentVariable.definition, context.principal);
      assertObservationCompatible(observation, currentVariable.definition);
      if (catalog.observations.some((existing) => existing.id === observation.id)) {
        throw new WorldModelStoreError('revision_conflict', `Observation ${observation.id} already exists`);
      }
      if (observation.supersedes !== undefined) {
        const superseded = catalog.observations.find((existing) => existing.id === observation.supersedes);
        if (!superseded) {
          throw new WorldModelStoreError('not_found', `Superseded observation ${observation.supersedes} was not found`);
        }
        if (superseded.variableRef.id !== observation.variableRef.id
          || superseded.variableRef.revision !== observation.variableRef.revision
          || superseded.subjectId !== observation.subjectId) {
          throw new WorldModelStoreError(
            'invalid_input',
            `Correction ${observation.id} must retain the Variable revision and subject of ${superseded.id}`
          );
        }
      }
      return {
        ...catalog,
        observations: [...catalog.observations, observation]
      };
    });

    const readback = await this.readObservation(observation.id, context);
    if (!readback) throw new WorldModelStoreError('readback_mismatch', `Observation ${observation.id} was not readable after commit`);
    return readback;
  }

  async readObservation(
    id: string,
    context: WorldModelStoreContext
  ): Promise<WorldModelObservation | null> {
    assertStoreContext(context);
    if (!isNonEmptyString(id)) throw new WorldModelStoreError('invalid_input', 'observation id is required');
    const catalog = await this.loadCatalog();
    const observation = catalog.observations.find((item) => item.id === id);
    if (!observation) return null;
    const variableRecord = await this.foundationStore.read(observation.variableRef, context);
    if (!variableRecord) {
      throw new WorldModelStoreError('corrupt_record', `Variable for observation ${id} is missing`);
    }
    if (variableRecord.definition.type !== 'variable') {
      throw new WorldModelStoreError('corrupt_record', `Observation ${id} references a non-Variable definition`);
    }
    assertFoundationAclRead(variableRecord.definition, context.principal);
    assertObservationCompatible(observation, variableRecord.definition);
    return freezeObservation(observation);
  }

  async listObservations(
    query: WorldModelObservationQuery | undefined,
    context: WorldModelStoreContext
  ): Promise<readonly WorldModelObservation[]> {
    assertStoreContext(context);
    const catalog = await this.loadCatalog();
    const filtered = catalog.observations.filter((observation) => matchesObservationQuery(observation, query));
    const visible: WorldModelObservation[] = [];
    for (const observation of filtered) {
      const readback = await this.readObservation(observation.id, context);
      if (readback) visible.push(readback);
    }
    return Object.freeze(visible);
  }

  async saveModelAdoption(
    candidate: CandidateModelSnapshot,
    modelRef: FoundationRevision,
    adoption: ModelAdoptionStoreInput,
    context: WorldModelStoreContext
  ): Promise<ModelAdoptionRecord> {
    assertStoreContext(context);
    assertModelReference(modelRef, 'modelRef');
    const modelRecord = await this.foundationStore.read(modelRef, context);
    if (!modelRecord) {
      throw new WorldModelStoreError('not_found', `Model ${modelRef.id}@${modelRef.revision} was not found`);
    }
    if (modelRecord.definition.type !== 'model') {
      throw new WorldModelStoreError('corrupt_record', `Adoption references non-Model ${modelRef.id}`);
    }
    assertFoundationAclWrite(modelRecord.definition, context.principal);
    assertCandidateAclWrite(candidate, context.principal);
    let record: ModelAdoptionRecord | undefined;
    await this.mutateCatalog((catalog, current) => {
      const currentModel = resolveFoundationAtAggregate(
        current,
        modelRef,
        modelRecord,
        context.principal,
        'write'
      );
      if (currentModel.definition.type !== 'model') {
        throw new WorldModelStoreError('corrupt_record', `Model ${modelRef.id} changed type during commit`);
      }
      assertFoundationAclWrite(currentModel.definition, context.principal);
      assertCandidateAclWrite(candidate, context.principal);
      const retained = retainCandidateModel(candidate, currentModel.definition, { ...adoption, modelRef });
      record = retained;
      if (catalog.adoptions.some((existing) => existing.adoptionId === retained.adoptionId)) {
        throw new WorldModelStoreError('revision_conflict', `Model adoption ${retained.adoptionId} already exists`);
      }
      return {
        ...catalog,
        adoptions: [...catalog.adoptions, retained]
      };
    });

    if (!record) throw new WorldModelStoreError('readback_mismatch', 'Model adoption commit did not produce a record');
    const readback = await this.readModelAdoption(record.adoptionId, context);
    if (!readback) throw new WorldModelStoreError('readback_mismatch', `Model adoption ${record.adoptionId} was not readable after commit`);
    return readback;
  }

  async readModelAdoption(
    adoptionId: string,
    context: WorldModelStoreContext
  ): Promise<ModelAdoptionRecord | null> {
    assertStoreContext(context);
    if (!isNonEmptyString(adoptionId)) throw new WorldModelStoreError('invalid_input', 'adoptionId is required');
    const catalog = await this.loadCatalog();
    const record = catalog.adoptions.find((item) => item.adoptionId === adoptionId);
    if (!record) return null;
    assertCandidateAclRead(record.candidate, context.principal);
    const modelRecord = await this.foundationStore.read(record.modelRef, context);
    if (!modelRecord || modelRecord.definition.type !== 'model') {
      throw new WorldModelStoreError('corrupt_record', `Model for adoption ${adoptionId} is missing`);
    }
    assertFoundationAclRead(modelRecord.definition, context.principal);
    const verified = retainCandidateModel(record.candidate, modelRecord.definition, {
      adoptionId: record.adoptionId,
      adoptionState: record.adoptionState,
      authorizedUse: record.authorizedUse,
      adoptedAt: record.adoptedAt,
      modelRef: record.modelRef,
      ...(record.approvalRef === undefined ? {} : { approvalRef: record.approvalRef })
    });
    return verified;
  }

  async listModelAdoptions(context: WorldModelStoreContext): Promise<readonly ModelAdoptionRecord[]> {
    assertStoreContext(context);
    const catalog = await this.loadCatalog();
    const visible: ModelAdoptionRecord[] = [];
    for (const record of catalog.adoptions) {
      const readback = await this.readModelAdoption(record.adoptionId, context);
      if (readback) visible.push(readback);
    }
    return Object.freeze(visible);
  }

  private async loadCatalog(): Promise<WorldModelRecordCatalog> {
    try {
      // Loading the aggregate first performs the canonical recovery/read
      // under the SSOT lock. The sidecar is then read from the committed
      // evidence path; writes use the same lock and transaction below.
      const os = await loadPersonalOs(this.dataDir);
      if (os.graph.version !== 2) {
        throw new WorldModelStoreError('unsupported_graph', 'World-model records require canonical Graph v2');
      }
      return await readWorldModelCatalog(this.dataDir);
    } catch (error) {
      if (error instanceof WorldModelStoreError) throw error;
      throw new WorldModelStoreError('corrupt_record', formatError(error));
    }
  }

  private async mutateCatalog(
    mutator: (catalog: WorldModelRecordCatalog, current: PersonalOs) => WorldModelRecordCatalog | Promise<WorldModelRecordCatalog>
  ): Promise<void> {
    await mutatePersonalOsWithSidecar(this.dataDir, WORLD_MODEL_EVIDENCE_SIDECAR, async (current, existingContent) => {
      if (current.graph.version !== 2) {
        throw new WorldModelStoreError('unsupported_graph', 'World-model records require canonical Graph v2');
      }
      // This callback already owns the canonical SSOT lock. Reading the
      // existing evidence sidecar here avoids a lock re-entry and makes the
      // read-modify-write sequence atomic with the Graph aggregate.
      const catalog = parseWorldModelCatalog(existingContent);
      const next = await mutator(catalog, current);
      assertWorldModelCatalog(next);
      return {
        next: current,
        sidecarContent: serializeWorldModelCatalog(next),
        result: undefined
      };
    });
  }
}

function resolveFoundationAtAggregate(
  current: PersonalOs,
  reference: FoundationRevision,
  expected: WorldModelFoundationRecord,
  principal: string,
  action: 'read' | 'write'
): WorldModelFoundationRecord {
  if (current.graph.version !== 2) {
    throw new WorldModelStoreError('unsupported_graph', 'World-model records require canonical Graph v2');
  }
  let actual: ReturnType<typeof findFoundationRecord>;
  let latest: ReturnType<typeof findLatestFoundationRecord>;
  try {
    const catalog = foundationCatalogOrEmpty(current.graph.foundation);
    actual = findFoundationRecord(catalog, reference);
    latest = findLatestFoundationRecord(catalog, reference.type, reference.id);
  } catch (error) {
    if (error instanceof WorldModelStoreError) throw error;
    throw new WorldModelStoreError('corrupt_record', formatError(error));
  }
  if (!actual) {
    throw new WorldModelStoreError('not_found', `Foundation ${reference.type}/${reference.id}@${reference.revision} was not found in the commit aggregate`);
  }
  if (!latest) {
    throw new WorldModelStoreError('corrupt_record', `Latest pointer is missing for ${reference.type}/${reference.id}`);
  }
  const readable = aclAllowsRead(latest.definition.acl, principal);
  const authorized = action === 'read' ? readable : aclAllowsWrite(latest.definition.acl, principal);
  if (!authorized) {
    throw new WorldModelStoreError('authorization_denied', `Principal ${principal} cannot ${action} ${reference.type}/${reference.id}`);
  }
  if (actual.digest !== expected.digest) {
    throw new WorldModelStoreError(
      'revision_conflict',
      `Foundation ${reference.type}/${reference.id}@${reference.revision} changed before commit`
    );
  }
  return { definition: actual.definition, digest: actual.digest };
}

function assertFoundationForJudgment(definition: FoundationDefinition, label: string): void {
  const result = validateFoundationDefinition(definition, { use: 'judgment' });
  if (!result.valid) {
    throw new WorldModelStoreError(
      'invalid_input',
      `${label} is not valid for judgment: ${result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`
    );
  }
}

function normalizeStoreInput(input: WorldModelObservationInput, label: string): WorldModelObservation {
  try {
    return normalizeWorldModelObservation(input);
  } catch (error) {
    if (error instanceof WorldModelValidationError) {
      throw new WorldModelStoreError('invalid_input', `${label} is invalid: ${error.message}`);
    }
    throw error;
  }
}

function assertObservationCompatible(observation: WorldModelObservation, variable: VariableDefinition): void {
  const result = validateWorldModelObservation(observation, variable);
  if (!result.valid) {
    throw new WorldModelStoreError(
      'invalid_input',
      result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
    );
  }
}

function assertStoreContext(context: WorldModelStoreContext): void {
  if (!context || !isNonEmptyString(context.principal)) {
    throw new WorldModelStoreError('authorization_denied', 'A trusted principal is required');
  }
}

function assertModelReference(reference: FoundationRevision, label: string): void {
  if (!isVariableOrModelRevision(reference, 'model')) {
    throw new WorldModelStoreError('invalid_input', `${label} must contain a model id and positive revision`);
  }
}

function isVariableOrModelRevision(value: unknown, type: 'variable' | 'model'): value is FoundationRevision {
  return isRecord(value)
    && value.type === type
    && isNonEmptyString(value.id)
    && /^[1-9]\d*$/.test(String(value.revision));
}

function assertFoundationAclWrite(definition: FoundationDefinition, principal: string): void {
  if (!aclAllowsWrite(definition.acl, principal)) {
    throw new WorldModelStoreError('authorization_denied', `Principal ${principal} cannot write ${definition.type}/${definition.id}`);
  }
}

function assertFoundationAclRead(definition: FoundationDefinition, principal: string): void {
  if (!aclAllowsRead(definition.acl, principal)) {
    throw new WorldModelStoreError('authorization_denied', `Principal ${principal} cannot read ${definition.type}/${definition.id}`);
  }
}

function assertCandidateAclWrite(candidate: CandidateModelSnapshot, principal: string): void {
  if (!aclAllowsWrite(candidate.acl, principal)) {
    throw new WorldModelStoreError('authorization_denied', `Principal ${principal} cannot write candidate ${candidate.candidateId}`);
  }
}

function assertCandidateAclRead(candidate: CandidateModelSnapshot, principal: string): void {
  if (!aclAllowsRead(candidate.acl, principal)) {
    throw new WorldModelStoreError('authorization_denied', `Principal ${principal} cannot read candidate ${candidate.candidateId}`);
  }
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

function matchesObservationQuery(observation: WorldModelObservation, query: WorldModelObservationQuery | undefined): boolean {
  if (!query) return true;
  if (query.subjectId !== undefined && observation.subjectId !== query.subjectId) return false;
  if (query.supersedes !== undefined && observation.supersedes !== query.supersedes) return false;
  if (query.variableRef !== undefined && (
    observation.variableRef.id !== query.variableRef.id
    || observation.variableRef.type !== query.variableRef.type
    || observation.variableRef.revision !== query.variableRef.revision
  )) return false;
  return true;
}

async function readWorldModelCatalog(dataDir: string): Promise<WorldModelRecordCatalog> {
  try {
    return parseWorldModelCatalog(await readPersonalOsSidecar(dataDir, WORLD_MODEL_EVIDENCE_SIDECAR));
  } catch (error) {
    if (error instanceof WorldModelStoreError) throw error;
    throw new WorldModelStoreError('corrupt_record', formatError(error));
  }
}

function parseWorldModelCatalog(rawText: string | undefined): WorldModelRecordCatalog {
  if (rawText === undefined) return emptyWorldModelCatalog();
  try {
    const raw: unknown = JSON.parse(rawText);
    assertWorldModelCatalog(raw);
    return cloneWorldModelCatalog(raw);
  } catch (error) {
    if (error instanceof WorldModelStoreError) throw error;
    throw new WorldModelStoreError('corrupt_record', formatError(error));
  }
}

function serializeWorldModelCatalog(catalog: WorldModelRecordCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function emptyWorldModelCatalog(): WorldModelRecordCatalog {
  return { version: WORLD_MODEL_RECORD_CATALOG_VERSION, observations: [], adoptions: [] };
}

function cloneWorldModelCatalog(catalog: WorldModelRecordCatalog): WorldModelRecordCatalog {
  return {
    version: WORLD_MODEL_RECORD_CATALOG_VERSION,
    observations: catalog.observations.map((observation) => freezeObservation(observation)),
    adoptions: catalog.adoptions.map((adoption) => freezeAdoption(adoption))
  };
}

function assertWorldModelCatalog(value: unknown): asserts value is WorldModelRecordCatalog {
  if (!isRecord(value) || value.version !== WORLD_MODEL_RECORD_CATALOG_VERSION
    || !Array.isArray(value.observations) || !Array.isArray(value.adoptions)) {
    throw new WorldModelStoreError('corrupt_record', 'world-model evidence must contain version 1 observations and adoptions arrays');
  }
  const observationIds = new Set<string>();
  for (const item of value.observations) {
    const normalized = normalizeWorldModelObservation(item as WorldModelObservationInput);
    if (observationIds.has(normalized.id)) {
      throw new WorldModelStoreError('corrupt_record', `Duplicate observation ${normalized.id}`);
    }
    observationIds.add(normalized.id);
  }
  const adoptionIds = new Set<string>();
  for (const item of value.adoptions) {
    const normalized = normalizeStoredAdoption(item);
    if (adoptionIds.has(normalized.adoptionId)) {
      throw new WorldModelStoreError('corrupt_record', `Duplicate model adoption ${normalized.adoptionId}`);
    }
    adoptionIds.add(normalized.adoptionId);
  }
}

function normalizeStoredAdoption(value: unknown): ModelAdoptionRecord {
  if (!isRecord(value)
    || !isNonEmptyString(value.adoptionId)
    || !isVariableOrModelRevision(value.modelRef, 'model')
    || !isRecord(value.candidate)
    || !isNonEmptyString(value.candidate.candidateId)
    || !isNonEmptyString(value.candidate.hypothesis)
    || !Array.isArray(value.candidate.evidenceIds)
    || value.candidate.evidenceIds.length === 0
    || value.candidate.evidenceIds.some((item) => !isNonEmptyString(item))
    || !isCandidateAcl(value.candidate.acl)
    || !['unverified', 'hypothesis'].includes(String(value.candidate.epistemicState))
    || !['proposed', 'approved'].includes(String(value.adoptionState))
    || !isFoundationUse(String(value.authorizedUse))
    || !isIsoTimestamp(value.adoptedAt)
    || (value.approvalRef !== undefined && !isDecisionRevision(value.approvalRef))) {
    throw new WorldModelStoreError('corrupt_record', 'world-model adoption record is malformed');
  }
  const candidate: CandidateModelSnapshot = {
    candidateId: String(value.candidate.candidateId).trim(),
    hypothesis: String(value.candidate.hypothesis),
    evidenceIds: [...value.candidate.evidenceIds].map(String),
    acl: freezeCloneAcl(value.candidate.acl),
    epistemicState: value.candidate.epistemicState as CandidateModelSnapshot['epistemicState']
  };
  return freezeAdoption({
    adoptionId: String(value.adoptionId).trim(),
    modelRef: freezeCloneRevision(value.modelRef),
    candidate,
    adoptionState: value.adoptionState as ModelAdoptionRecord['adoptionState'],
    authorizedUse: value.authorizedUse as FoundationUse,
    adoptedAt: String(value.adoptedAt),
    ...(value.approvalRef === undefined ? {} : { approvalRef: freezeCloneDecisionRevision(value.approvalRef) })
  });
}

function isFoundationUse(value: unknown): value is FoundationUse {
  return value === 'draft' || value === 'judgment' || value === 'evaluation' || value === 'execution';
}

function isDecisionRevision(value: unknown): value is DecisionRevision {
  return isRecord(value)
    && value.type === 'decision'
    && isNonEmptyString(value.id)
    && /^[1-9]\d*$/.test(String(value.revision));
}

function isCandidateAcl(value: unknown): value is FoundationAcl {
  return isRecord(value)
    && isNonEmptyString(value.ownerId)
    && ['private', 'project', 'organization', 'public'].includes(String(value.visibility))
    && Array.isArray(value.readerIds)
    && Array.isArray(value.writerIds)
    && value.readerIds.every((item) => isNonEmptyString(item))
    && value.writerIds.every((item) => isNonEmptyString(item));
}

function freezeObservation(observation: WorldModelObservation): WorldModelObservation {
  return deepFreeze({
    id: observation.id,
    variableRef: freezeCloneRevision(observation.variableRef),
    subjectId: observation.subjectId,
    value: cloneWorldModelValue(observation.value, 'value'),
    occurredAt: observation.occurredAt,
    period: freezeClonePeriod(observation.period),
    recordedAt: observation.recordedAt,
    sourceRef: freezeCloneProvenance(observation.sourceRef),
    ...(observation.supersedes === undefined ? {} : { supersedes: observation.supersedes })
  });
}

function freezeAdoption(adoption: ModelAdoptionRecord): ModelAdoptionRecord {
  return deepFreeze({
    adoptionId: adoption.adoptionId,
    modelRef: freezeCloneRevision(adoption.modelRef),
    candidate: {
      candidateId: adoption.candidate.candidateId,
      hypothesis: adoption.candidate.hypothesis,
      evidenceIds: [...adoption.candidate.evidenceIds],
      acl: freezeCloneAcl(adoption.candidate.acl),
      epistemicState: adoption.candidate.epistemicState
    },
    adoptionState: adoption.adoptionState,
    authorizedUse: adoption.authorizedUse,
    adoptedAt: adoption.adoptedAt,
    ...(adoption.approvalRef === undefined ? {} : { approvalRef: freezeCloneDecisionRevision(adoption.approvalRef) })
  });
}

function cloneModel(model: ModelDefinition): ModelDefinition {
  return JSON.parse(JSON.stringify(model)) as ModelDefinition;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function observationShapeIssues(input: WorldModelObservationInput): WorldModelValidationIssue[] {
  const issues: WorldModelValidationIssue[] = [];
  if (!isRecord(input)) return [invalid('observation', 'Observation must be a plain object.')];
  if (!isNonEmptyString(input.id)) issues.push(missing('id'));
  if (!isNonEmptyString(input.subjectId)) issues.push(missing('subjectId'));
  if (!isVariableRevision(input.variableRef)) issues.push({
    code: 'INVALID_VARIABLE_REFERENCE',
    path: 'variableRef',
    message: 'Observation variableRef requires a variable id and revision.'
  });
  if (input.value === null || input.value === undefined || !isWorldModelValue(input.value)) {
    issues.push(invalid('value', 'Observation value must be a finite JSON scalar, array, or object; null is reserved for missing data.'));
  }
  if (!isIsoTimestamp(input.occurredAt)) issues.push(invalidTimestamp('occurredAt'));
  if (!isValidPeriod(input.period)) issues.push({
    code: 'INVALID_PERIOD',
    path: 'period',
    message: 'Observation period requires valid ISO from/until timestamps with until at or after from.'
  });
  if (!isIsoTimestamp(input.recordedAt)) issues.push(invalidTimestamp('recordedAt'));
  if (!isProvenance(input.sourceRef)) issues.push({
    code: 'MISSING_SOURCE',
    path: 'sourceRef',
    message: 'Observation requires a source id, source kind, and evidence reference list.'
  });
  if (isIsoTimestamp(input.occurredAt) && isIsoTimestamp(input.recordedAt)
    && Date.parse(input.recordedAt) < Date.parse(input.occurredAt)) {
    issues.push({
      code: 'RECORDED_BEFORE_OCCURRED',
      path: 'recordedAt',
      message: 'recordedAt cannot precede occurredAt for an observation.'
    });
  }
  if (input.supersedes !== undefined
    && (!isNonEmptyString(input.supersedes) || input.supersedes.trim() === input.id?.trim())) {
    issues.push({
      code: 'INVALID_CORRECTION_REFERENCE',
      path: 'supersedes',
      message: 'A correction must reference a different non-empty observation id.'
    });
  }
  return issues;
}

function valueMatchesKind(value: WorldModelValue, kind: VariableDefinition['valueKind']): boolean {
  switch (kind) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
    case 'state':
      return typeof value === 'string' && value.length > 0;
    default:
      return false;
  }
}

function isWorldModelValue(value: unknown, seen = new Set<object>()): value is WorldModelValue {
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = value.every((item) => isWorldModelValue(item, seen));
    seen.delete(value);
    return valid;
  }
  if (!isRecord(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Object.values(value).every((item) => isWorldModelValue(item, seen));
  seen.delete(value);
  return valid;
}

function cloneWorldModelValue(value: WorldModelValue, path: string): WorldModelValue {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new WorldModelValidationError([invalid(path, 'Numbers must be finite.')]);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => cloneWorldModelValue(item, `${path}[${index}]`));
  const result: Record<string, WorldModelValue> = {};
  for (const [key, item] of Object.entries(value)) result[key] = cloneWorldModelValue(item, `${path}.${key}`);
  return result;
}

function isVariableRevision(value: unknown): value is FoundationRevision {
  return isRecord(value)
    && value.type === 'variable'
    && isNonEmptyString(value.id)
    && /^[1-9]\d*$/.test(String(value.revision));
}

function isProvenance(value: unknown): value is FoundationProvenance {
  return isRecord(value)
    && isNonEmptyString(value.sourceId)
    && ['candidate', 'document', 'observation', 'decision', 'import'].includes(String(value.sourceKind))
    && Array.isArray(value.evidenceIds)
    && value.evidenceIds.length > 0
    && value.evidenceIds.every((item) => isNonEmptyString(item));
}

function isValidPeriod(value: unknown): value is FoundationPeriod {
  return isRecord(value)
    && isIsoTimestamp(value.from)
    && isIsoTimestamp(value.until)
    && Date.parse(value.until) >= Date.parse(value.from);
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

function parseIsoTimestamp(value: unknown): number | undefined {
  return isIsoTimestamp(value) ? Date.parse(value) : undefined;
}

function freezeCloneRevision(value: FoundationRevision): FoundationRevision {
  return deepFreeze({ id: value.id, type: value.type, revision: value.revision });
}

function freezeCloneDecisionRevision(value: DecisionRevision): DecisionRevision {
  return deepFreeze({ id: value.id, type: 'decision', revision: value.revision });
}

function freezeClonePeriod(value: FoundationPeriod): FoundationPeriod {
  return deepFreeze({ from: value.from, until: value.until });
}

function freezeCloneProvenance(value: FoundationProvenance): FoundationProvenance {
  return deepFreeze({ sourceId: value.sourceId, sourceKind: value.sourceKind, evidenceIds: [...value.evidenceIds] });
}

function freezeCloneAcl(value: FoundationAcl): FoundationAcl {
  return deepFreeze({
    ownerId: value.ownerId,
    visibility: value.visibility,
    readerIds: [...value.readerIds],
    writerIds: [...value.writerIds]
  });
}

function validationResult(issues: readonly WorldModelValidationIssue[]): WorldModelValidationResult {
  return { valid: issues.length === 0, status: issues.length === 0 ? 'valid' : 'invalid', issues: deepFreeze([...issues]) };
}

function missing(path: string): WorldModelValidationIssue {
  return { code: 'MISSING_FIELD', path, message: `${path} is required.` };
}

function invalid(path: string, message: string): WorldModelValidationIssue {
  return { code: 'INVALID_FIELD', path, message };
}

function invalidTimestamp(path: string): WorldModelValidationIssue {
  return { code: 'INVALID_TIMESTAMP', path, message: `${path} must be an ISO 8601 timestamp with timezone.` };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
