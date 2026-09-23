import type {
  FoundationAcl,
  FoundationDefinition,
  FoundationEvaluationDescriptor,
  FoundationScope,
  ObjectiveCriterion,
  ObjectiveDefinition,
  VariableDefinition
} from './ontology-foundation.js';
import { validateEvaluationCompatibility, validateFoundationDefinition } from './ontology-foundation.js';
import {
  findFoundationRecord,
  findLatestFoundationRecord,
  foundationRef,
  foundationCatalogOrEmpty,
  type FoundationRef
} from './foundation-catalog.js';
import type { FoundationRevisionStore, FoundationStoreContext } from './foundation-store.js';
import type { FoundationCatalogRecord, PersonalOs } from './types.js';
import {
  computeJudgmentProblemSnapshotId,
  JudgmentProblemSnapshotError,
  loadJudgmentProblemSnapshot,
  type JudgmentProblemReference,
  type JudgmentProblemReferenceProvider,
  type JudgmentProblemSnapshot,
  type JudgmentProblemSnapshotAccessContext,
  type JudgmentProblemSnapshotAccessProvider
} from './judgment-problem-snapshot.js';
import { loadPersonalOs, mutatePersonalOsWithSidecar, readPersonalOsSidecar } from './ssot.js';

/**
 * Evaluation is an evidence record over a pinned Problem.  It does not own
 * Objective or Variable definitions and it does not close an OutcomeCase.
 */
export const COMPANY_OS_EVALUATION_CONTRACT_VERSION = '0.1.0' as const;
export const COMPANY_OS_EVALUATION_RECORD_CATALOG_VERSION = 1 as const;
export const COMPANY_OS_EVALUATION_SIDECAR = 'evidence/company-os-evaluation.json' as const;

export type EvaluationMeasurementStatus = 'observed' | 'missing' | 'not_arrived';
export type EvaluationJudgmentValidity = 'valid' | 'invalid' | 'indeterminate';
export type EvaluationResultStatus = 'achieved' | 'not_achieved' | 'indeterminate';
export type PredictionComparisonStatus = 'matched' | 'missed' | 'indeterminate';
export type EvaluationScalar = string | number | boolean;

export interface EvaluationMeasurementDescriptor extends Omit<FoundationEvaluationDescriptor, 'variableRef'> {}

export interface EvaluationConversionProvenance {
  /** Stable evidence or transformation identifier, not a free-form assertion. */
  readonly id: string;
  readonly description: string;
}

export interface EvaluationMeasurementConversion {
  /** The input measurement's exact source definition. */
  readonly sourceRef: FoundationRef;
  /** The exact criterion definition used after the conversion. */
  readonly targetRef: FoundationRef;
  readonly provenance: EvaluationConversionProvenance;
}

export interface EvaluationMeasurementInput {
  readonly variableRef: FoundationRef;
  /** The descriptor describes the effective (possibly converted) definition. */
  readonly descriptor: EvaluationMeasurementDescriptor;
  readonly status: EvaluationMeasurementStatus;
  readonly value?: EvaluationScalar;
  readonly recordedAt: string;
  readonly evidenceRef?: string;
  readonly conversion?: EvaluationMeasurementConversion;
}

export interface EvaluationMeasurement extends EvaluationMeasurementInput {
  readonly effectiveVariableRef: FoundationRef;
}

export interface JudgmentValidityInput {
  readonly status: EvaluationJudgmentValidity;
  readonly basis: string;
  readonly evidenceRefs?: readonly string[];
}

export interface JudgmentValidity extends JudgmentValidityInput {}

/**
 * A port owned by OSS and implemented by an OutcomeCase provider.  The port
 * deliberately has a read operation only: closure, approval, and case
 * mutation remain outside this repository.
 */
export interface OutcomeCaseReference {
  readonly id: string;
  readonly revision?: string;
  readonly digest?: string;
}

export interface OutcomeCaseCanonicalReference {
  readonly id: string;
  readonly revision: string;
  readonly digest: string;
}

export type OutcomeCaseOwnerUnknownReason = 'not_recorded' | 'legacy_untyped' | 'source_unavailable';

export interface OutcomeCaseEntityReference {
  readonly id: string;
  readonly type: string;
  readonly revision?: string;
  readonly digest?: string;
}

export type OutcomeCaseOwnerReference =
  | { readonly status: 'typed'; readonly ref: OutcomeCaseEntityReference }
  | { readonly status: 'unknown'; readonly reason: OutcomeCaseOwnerUnknownReason };

export type OutcomeCaseConditionValue =
  | string
  | number
  | boolean
  | null
  | readonly OutcomeCaseConditionValue[]
  | { readonly [key: string]: OutcomeCaseConditionValue };

export type OutcomeCaseConditions = Readonly<Record<string, OutcomeCaseConditionValue>>;

/**
 * Trusted source-owned metadata returned with an OutcomeCase read.  The
 * adapter must use this projection when creating a receipt link; caller
 * supplied receipt state, owners, or conditions are lookup input only.
 */
export interface OutcomeCaseCanonicalSource {
  readonly state: string;
  readonly owner_refs: readonly OutcomeCaseOwnerReference[];
  readonly conditions?: OutcomeCaseConditions;
}

export interface OutcomeCaseRead {
  readonly reference: OutcomeCaseCanonicalReference;
  /** Current source-owned identity/state projection, checked at read time. */
  readonly source: OutcomeCaseCanonicalSource;
  /** Current ACL, evaluated at read time. */
  readonly acl: FoundationAcl;
  readonly scope: FoundationScope;
}

export interface EvaluationAccessContext extends JudgmentProblemSnapshotAccessContext {
  readonly scope?: FoundationScope;
}

export interface OutcomeCasePort {
  read(reference: OutcomeCaseReference, actor: EvaluationAccessContext): Promise<OutcomeCaseRead>;
}

/**
 * Exact definition read used by evaluation.  A caller cannot supply an
 * Objective or criterion body as an evaluation input; this port resolves the
 * requested revision and verifies its digest from the canonical store.
 */
export interface FoundationDefinitionLoadPort {
  readExact(
    reference: FoundationRef,
    context: FoundationStoreContext
  ): Promise<FoundationCatalogRecord | null>;
}

export function createFoundationDefinitionLoadPort(
  store: Pick<FoundationRevisionStore, 'read'>
): FoundationDefinitionLoadPort {
  if (!store || typeof store.read !== 'function') {
    throw new TypeError('A foundation store with read is required');
  }
  return {
    async readExact(reference, context) {
      const record = await store.read({
        id: reference.id,
        type: reference.type,
        revision: reference.revision
      }, context);
      if (!record) return null;
      if (record.digest !== reference.digest) {
        throw new CompanyOsEvaluationError(
          'integrity_mismatch',
          `Foundation ${reference.type}/${reference.id}@${reference.revision} has a different digest`
        );
      }
      return record;
    }
  };
}

export interface CriterionEvaluation {
  readonly criterionIndex: number;
  readonly variableRef: FoundationRef;
  readonly operator: ObjectiveCriterion['operator'];
  readonly target?: string | number | boolean;
  readonly status: EvaluationResultStatus;
  readonly reason: string;
}

export interface PredictionComparison {
  readonly criterionIndex: number;
  readonly variableRef: FoundationRef;
  readonly status: PredictionComparisonStatus;
  readonly reason: string;
  readonly predictionStatus?: EvaluationMeasurementStatus;
  readonly actualStatus?: EvaluationMeasurementStatus;
  readonly predictionValue?: EvaluationScalar;
  readonly actualValue?: EvaluationScalar;
}

export interface CompanyOsEvaluationRecord {
  readonly version: typeof COMPANY_OS_EVALUATION_RECORD_CATALOG_VERSION;
  readonly id: string;
  readonly snapshot: {
    readonly snapshotId: string;
    readonly problemId: string;
    readonly revision: string;
    readonly digest: string;
  };
  readonly objectiveRef: FoundationRef;
  readonly outcomeCaseRef: OutcomeCaseCanonicalReference;
  readonly predictions: readonly EvaluationMeasurement[];
  readonly actuals: readonly EvaluationMeasurement[];
  readonly criteria: readonly CriterionEvaluation[];
  readonly predictionComparisons: readonly PredictionComparison[];
  readonly achievement: EvaluationResultStatus;
  readonly judgmentAtTimeValidity: JudgmentValidity;
  readonly evaluatedAt: string;
}

export interface EvaluateCompanyOsProblemRequest {
  readonly id: string;
  readonly snapshot: {
    readonly root: string;
    readonly snapshotId?: string;
    readonly problemId?: string;
    readonly revision?: string;
    readonly accessProvider?: JudgmentProblemSnapshotAccessProvider;
    readonly referenceProvider: JudgmentProblemReferenceProvider;
  };
  readonly access: EvaluationAccessContext;
  readonly outcomeCase: OutcomeCaseReference;
  readonly predictions: readonly EvaluationMeasurementInput[];
  readonly actuals: readonly EvaluationMeasurementInput[];
  readonly judgmentAtTimeValidity: JudgmentValidityInput;
  readonly evaluatedAt: string;
}

export interface CompanyOsEvaluationStore {
  evaluate(request: EvaluateCompanyOsProblemRequest): Promise<CompanyOsEvaluationRecord>;
  read(id: string, access: EvaluationAccessContext): Promise<CompanyOsEvaluationRecord | null>;
  list(access: EvaluationAccessContext): Promise<readonly CompanyOsEvaluationRecord[]>;
}

export interface CompanyOsEvaluationStoreOptions {
  readonly dataDir: string;
  readonly foundation: FoundationDefinitionLoadPort;
  readonly outcomeCase: OutcomeCasePort;
  /**
   * Resolver used when a stored evaluation is read back.  The evaluation
   * record only stores a snapshot reference, so reads must resolve that exact
   * snapshot again under the provider's current ACL/digest checks.
   */
  readonly snapshotReferenceProvider: JudgmentProblemReferenceProvider;
}

export type CompanyOsEvaluationErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'authorization_denied'
  | 'scope_violation'
  | 'integrity_mismatch'
  | 'incompatible_measurement'
  | 'revision_conflict'
  | 'unsupported_graph'
  | 'corrupt_record'
  | 'readback_mismatch';

export class CompanyOsEvaluationError extends Error {
  readonly code: CompanyOsEvaluationErrorCode;

  constructor(code: CompanyOsEvaluationErrorCode, message: string) {
    super(message);
    this.name = 'CompanyOsEvaluationError';
    this.code = code;
  }
}

interface EvaluationRecordCatalog {
  readonly version: typeof COMPANY_OS_EVALUATION_RECORD_CATALOG_VERSION;
  readonly records: readonly CompanyOsEvaluationRecord[];
}

interface ResolvedEvaluationDefinitions {
  readonly snapshot: JudgmentProblemSnapshot;
  readonly snapshotId: string;
  readonly objectiveRef: FoundationRef;
  readonly objective: ObjectiveDefinition;
  readonly objectiveRecord: FoundationCatalogRecord;
  readonly variables: readonly ResolvedVariable[];
}

interface ResolvedVariable {
  readonly criterionIndex: number;
  readonly criterion: ObjectiveCriterion;
  readonly reference: FoundationRef;
  readonly definition: VariableDefinition;
  readonly record: FoundationCatalogRecord;
}

interface MeasurementResolution {
  readonly measurements: readonly EvaluationMeasurement[];
  readonly byVariable: ReadonlyMap<string, EvaluationMeasurement>;
}

export function createCompanyOsEvaluationStore(
  options: CompanyOsEvaluationStoreOptions
): CompanyOsEvaluationStore {
  if (!options || !isNonEmptyString(options.dataDir)) {
    throw new CompanyOsEvaluationError('invalid_input', 'dataDir is required');
  }
  if (!options.foundation || typeof options.foundation.readExact !== 'function') {
    throw new CompanyOsEvaluationError('invalid_input', 'foundation.readExact is required');
  }
  if (!options.outcomeCase || typeof options.outcomeCase.read !== 'function') {
    throw new CompanyOsEvaluationError('invalid_input', 'outcomeCase.read is required');
  }
  if (!options.snapshotReferenceProvider || typeof options.snapshotReferenceProvider.resolve !== 'function') {
    throw new CompanyOsEvaluationError('invalid_input', 'snapshotReferenceProvider.resolve is required');
  }
  return new GraphCompanyOsEvaluationStore(options);
}

class GraphCompanyOsEvaluationStore implements CompanyOsEvaluationStore {
  constructor(private readonly options: CompanyOsEvaluationStoreOptions) {}

  async evaluate(request: EvaluateCompanyOsProblemRequest): Promise<CompanyOsEvaluationRecord> {
    const access = assertAccessContext(request?.access);
    assertEvaluationRequest(request);
    const resolved = await resolveDefinitions(this.options.foundation, request.snapshot, access);
    const outcomeCase = await readCanonicalOutcomeCase(this.options.outcomeCase, request.outcomeCase, access);
    const predictions = await resolveMeasurements(
      request.predictions,
      resolved.variables,
      this.options.foundation,
      access,
      'prediction',
      resolved.objective.evaluationPeriod
    );
    const actuals = await resolveMeasurements(
      request.actuals,
      resolved.variables,
      this.options.foundation,
      access,
      'actual',
      resolved.objective.evaluationPeriod
    );
    const validity = normalizeJudgmentValidity(request.judgmentAtTimeValidity);
    const record = buildEvaluationRecord({
      id: request.id,
      resolved,
      outcomeCase,
      predictions,
      actuals,
      validity,
      evaluatedAt: request.evaluatedAt
    });

    await this.mutateCatalog((catalog, current) => {
      if (catalog.records.some((existing) => existing.id === record.id)) {
        throw new CompanyOsEvaluationError('revision_conflict', `Evaluation ${record.id} already exists`);
      }
      // The Foundation read above is repeated against the aggregate held by
      // the canonical lock. This prevents a concurrent revision/ACL update
      // from silently changing what the immutable evaluation points at.
      assertCurrentFoundation(current, record.objectiveRef, resolved.objectiveRecord, access);
      for (const variable of resolved.variables) {
        assertCurrentFoundation(current, variable.reference, variable.record, access);
      }
      return {
        ...catalog,
        records: [...catalog.records, record]
      };
    });

    const readback = await this.read(record.id, access);
    if (!readback) {
      throw new CompanyOsEvaluationError('readback_mismatch', `Evaluation ${record.id} was not readable after commit`);
    }
    return readback;
  }

  async read(id: string, access: EvaluationAccessContext): Promise<CompanyOsEvaluationRecord | null> {
    const context = assertAccessContext(access);
    if (!isNonEmptyString(id)) throw new CompanyOsEvaluationError('invalid_input', 'evaluation id is required');
    const catalog = await this.loadCatalog();
    const record = catalog.records.find((item) => item.id === id);
    if (!record) return null;
    const snapshot = await loadEvaluationSnapshot(this.options, record, context);
    assertSnapshotMatchesEvaluation(record, snapshot);
    const resolved = await this.options.foundation.readExact(record.objectiveRef, context);
    if (!resolved || resolved.definition.type !== 'objective') {
      throw new CompanyOsEvaluationError('corrupt_record', `Objective for evaluation ${id} is missing or has the wrong type`);
    }
    await assertEvaluationRecordConsistency(record, resolved, this.options.foundation, context);
    const outcomeCase = await readCanonicalOutcomeCase(this.options.outcomeCase, record.outcomeCaseRef, context);
    if (!sameCaseReference(outcomeCase.reference, record.outcomeCaseRef)) {
      throw new CompanyOsEvaluationError('integrity_mismatch', `OutcomeCase reference for evaluation ${id} changed`);
    }
    return cloneEvaluationRecord(record);
  }

  async list(access: EvaluationAccessContext): Promise<readonly CompanyOsEvaluationRecord[]> {
    const context = assertAccessContext(access);
    const catalog = await this.loadCatalog();
    const records: CompanyOsEvaluationRecord[] = [];
    for (const record of catalog.records) {
      const visible = await this.read(record.id, context);
      if (visible) records.push(visible);
    }
    return Object.freeze(records);
  }

  private async loadCatalog(): Promise<EvaluationRecordCatalog> {
    try {
      const os = await loadPersonalOs(this.options.dataDir);
      if (os.graph.version !== 2) {
        throw new CompanyOsEvaluationError('unsupported_graph', 'Evaluation records require canonical Graph v2');
      }
      return parseEvaluationCatalog(await readPersonalOsSidecar(this.options.dataDir, COMPANY_OS_EVALUATION_SIDECAR));
    } catch (error) {
      if (error instanceof CompanyOsEvaluationError) throw error;
      throw new CompanyOsEvaluationError('corrupt_record', formatError(error));
    }
  }

  private async mutateCatalog(
    mutator: (catalog: EvaluationRecordCatalog, current: PersonalOs) => EvaluationRecordCatalog | Promise<EvaluationRecordCatalog>
  ): Promise<void> {
    try {
      await mutatePersonalOsWithSidecar(this.options.dataDir, COMPANY_OS_EVALUATION_SIDECAR, async (current, existingContent) => {
        if (current.graph.version !== 2) {
          throw new CompanyOsEvaluationError('unsupported_graph', 'Evaluation records require canonical Graph v2');
        }
        const catalog = parseEvaluationCatalog(existingContent);
        const next = await mutator(catalog, current);
        assertEvaluationCatalog(next);
        return {
          next: current,
          sidecarContent: serializeEvaluationCatalog(next),
          result: undefined
        };
      });
    } catch (error) {
      if (error instanceof CompanyOsEvaluationError) throw error;
      throw new CompanyOsEvaluationError('corrupt_record', formatError(error));
    }
  }
}

async function resolveDefinitions(
  foundation: FoundationDefinitionLoadPort,
  snapshotInput: EvaluateCompanyOsProblemRequest['snapshot'],
  access: EvaluationAccessContext
): Promise<ResolvedEvaluationDefinitions> {
  const snapshot = await loadJudgmentProblemSnapshot({
    root: snapshotInput.root,
    ...(snapshotInput.snapshotId === undefined ? {} : { snapshot_id: snapshotInput.snapshotId }),
    ...(snapshotInput.problemId === undefined ? {} : { problem_id: snapshotInput.problemId }),
    ...(snapshotInput.revision === undefined ? {} : { revision: snapshotInput.revision }),
    access,
    ...(snapshotInput.accessProvider === undefined ? {} : { accessProvider: snapshotInput.accessProvider }),
    reference_resolution: 'historical',
    referenceProvider: snapshotInput.referenceProvider
  });
  const snapshotId = computeJudgmentProblemSnapshotId(snapshot);
  const objectiveReferences = snapshot.references.filter((reference) => reference.kind === 'objective');
  if (objectiveReferences.length !== 1) {
    throw new CompanyOsEvaluationError('invalid_input', 'A Problem must pin exactly one Objective reference');
  }
  const objectiveRef = foundationReference(objectiveReferences[0]);
  const objectiveRecord = await foundation.readExact(objectiveRef, access);
  if (!objectiveRecord) {
    throw new CompanyOsEvaluationError('not_found', `Objective ${objectiveRef.id}@${objectiveRef.revision} was not found`);
  }
  if (objectiveRecord.definition.type !== 'objective') {
    throw new CompanyOsEvaluationError('integrity_mismatch', `Problem Objective reference resolved to ${objectiveRecord.definition.type}`);
  }
  const objective = objectiveRecord.definition;
  const validation = validateFoundationDefinition(objective, { use: 'evaluation' });
  if (!validation.valid) {
    throw new CompanyOsEvaluationError('incompatible_measurement', `Objective cannot be evaluated: ${validation.issues.map((issue) => issue.message).join('; ')}`);
  }
  const criteriaReferences = snapshot.references.filter((reference) => reference.kind === 'criterion');
  if (criteriaReferences.length !== objective.criteria.length || criteriaReferences.length === 0) {
    throw new CompanyOsEvaluationError('integrity_mismatch', 'Problem criterion references do not match the pinned Objective criteria');
  }
  assertUniqueReferences(criteriaReferences, 'criterion');
  const variableReferences = snapshot.references.filter((reference) => reference.kind === 'variable');
  const variables: ResolvedVariable[] = [];
  for (const [criterionIndex, criterion] of objective.criteria.entries()) {
    const candidates = variableReferences.filter((reference) => (
      reference.id === criterion.variableRef.id
      && reference.revision === criterion.variableRef.revision
    ));
    if (candidates.length !== 1) {
      throw new CompanyOsEvaluationError(
        'integrity_mismatch',
        `Problem must pin exactly one Variable reference for criterion ${criterionIndex}`
      );
    }
    const reference = foundationReference(candidates[0]);
    const record = await foundation.readExact(reference, access);
    if (!record) throw new CompanyOsEvaluationError('not_found', `Variable ${reference.id}@${reference.revision} was not found`);
    if (record.definition.type !== 'variable') {
      throw new CompanyOsEvaluationError('integrity_mismatch', `Criterion ${criterionIndex} resolved to ${record.definition.type}`);
    }
    const variableValidation = validateFoundationDefinition(record.definition, { use: 'evaluation' });
    if (!variableValidation.valid) {
      throw new CompanyOsEvaluationError('incompatible_measurement', `Variable ${reference.id} cannot be evaluated: ${variableValidation.issues.map((issue) => issue.message).join('; ')}`);
    }
    assertCriterionCompatibility(criterion, record.definition, criterionIndex);
    variables.push({ criterionIndex, criterion, reference, definition: record.definition, record });
  }
  return { snapshot, snapshotId, objectiveRef, objective, objectiveRecord, variables };
}

/**
 * A stored evaluation is only meaningful with the exact Problem snapshot that
 * produced it. Re-resolve the canonical locator on every read instead of
 * trusting the four fields copied into the evaluation sidecar. The resolver
 * also rechecks current ACLs and exact reference digests for historical reads.
 */
async function loadEvaluationSnapshot(
  options: CompanyOsEvaluationStoreOptions,
  record: CompanyOsEvaluationRecord,
  access: EvaluationAccessContext
): Promise<JudgmentProblemSnapshot> {
  let snapshot: JudgmentProblemSnapshot;
  try {
    snapshot = await loadJudgmentProblemSnapshot({
      root: options.dataDir,
      snapshot_id: record.snapshot.snapshotId,
      problem_id: record.snapshot.problemId,
      revision: record.snapshot.revision,
      access,
      reference_resolution: 'historical',
      referenceProvider: options.snapshotReferenceProvider
    });
  } catch (error) {
    throw mapEvaluationSnapshotLoadError(error);
  }

  const canonicalDigest = computeJudgmentProblemSnapshotId(snapshot);
  if (snapshot.problem_id !== record.snapshot.problemId
    || snapshot.revision !== record.snapshot.revision
    || canonicalDigest !== record.snapshot.snapshotId
    || canonicalDigest !== record.snapshot.digest) {
    throw new CompanyOsEvaluationError(
      'integrity_mismatch',
      'Evaluation snapshot locator or digest does not match the canonical Problem snapshot'
    );
  }
  return snapshot;
}

function mapEvaluationSnapshotLoadError(error: unknown): CompanyOsEvaluationError {
  if (error instanceof CompanyOsEvaluationError) return error;
  if (error instanceof JudgmentProblemSnapshotError) {
    if (error.code === 'unauthorized') {
      return new CompanyOsEvaluationError('authorization_denied', error.message);
    }
    if (error.code === 'not_found' || error.code === 'integrity_mismatch' || error.code === 'conflict') {
      return new CompanyOsEvaluationError('integrity_mismatch', error.message);
    }
    return new CompanyOsEvaluationError('corrupt_record', error.message);
  }
  return new CompanyOsEvaluationError('corrupt_record', formatError(error));
}

function assertSnapshotMatchesEvaluation(
  record: CompanyOsEvaluationRecord,
  snapshot: JudgmentProblemSnapshot
): void {
  const objectiveReferences = snapshot.references.filter((reference) => reference.kind === 'objective');
  if (objectiveReferences.length !== 1) {
    throw new CompanyOsEvaluationError('integrity_mismatch', 'Evaluation snapshot must contain exactly one Objective reference');
  }
  if (!sameFoundationRef(record.objectiveRef, foundationReference(objectiveReferences[0]))) {
    throw new CompanyOsEvaluationError('integrity_mismatch', 'Evaluation Objective reference does not match its Problem snapshot');
  }

  const variableKeys = new Set(
    snapshot.references
      .filter((reference) => reference.kind === 'variable')
      .map((reference) => foundationReferenceKey(foundationReference(reference)))
  );
  for (const criterion of record.criteria) {
    if (!variableKeys.has(foundationReferenceKey(criterion.variableRef))) {
      throw new CompanyOsEvaluationError(
        'integrity_mismatch',
        `Evaluation criterion ${criterion.criterionIndex} is not pinned by its Problem snapshot`
      );
    }
  }
}

async function resolveMeasurements(
  inputs: readonly EvaluationMeasurementInput[],
  variables: readonly ResolvedVariable[],
  foundation: FoundationDefinitionLoadPort,
  access: EvaluationAccessContext,
  phase: 'prediction' | 'actual',
  expectedPeriod: ObjectiveDefinition['evaluationPeriod']
): Promise<MeasurementResolution> {
  if (!Array.isArray(inputs)) throw new CompanyOsEvaluationError('invalid_input', `${phase} measurements must be an array`);
  const byVariable = new Map<string, EvaluationMeasurement>();
  const normalized: EvaluationMeasurement[] = [];
  for (const input of inputs) {
    const variable = await resolveMeasurementVariable(input, variables, foundation, access);
    const measurement = normalizeMeasurement(input, variable, expectedPeriod);
    const key = foundationReferenceKey(measurement.effectiveVariableRef);
    if (byVariable.has(key)) {
      throw new CompanyOsEvaluationError('invalid_input', `${phase} contains duplicate measurements for ${key}`);
    }
    byVariable.set(key, measurement);
    normalized.push(measurement);
  }
  return { measurements: Object.freeze(normalized.map(cloneEvaluationMeasurement)), byVariable };
}

async function resolveMeasurementVariable(
  input: EvaluationMeasurementInput,
  variables: readonly ResolvedVariable[],
  foundation: FoundationDefinitionLoadPort,
  access: EvaluationAccessContext
): Promise<ResolvedVariable> {
  if (!input || typeof input !== 'object') {
    throw new CompanyOsEvaluationError('invalid_input', 'Measurement must be an object');
  }
  assertFoundationRef(input?.variableRef, 'measurement.variableRef');
  const conversion = input.conversion;
  const source = conversion?.sourceRef ?? input.variableRef;
  if (!sameFoundationRef(source, input.variableRef)) {
    throw new CompanyOsEvaluationError('integrity_mismatch', 'Conversion sourceRef must equal measurement.variableRef');
  }
  if (conversion !== undefined) {
    assertFoundationRef(conversion.targetRef, 'measurement.conversion.targetRef');
    if (!isNonEmptyString(conversion.provenance.id) || !isNonEmptyString(conversion.provenance.description)) {
      throw new CompanyOsEvaluationError('invalid_input', 'A conversion requires explicit provenance id and description');
    }
    const sourceRecord = await foundation.readExact(source, access);
    if (!sourceRecord) throw new CompanyOsEvaluationError('not_found', `Conversion source ${source.id}@${source.revision} was not found`);
    if (sourceRecord.definition.type !== 'variable') {
      throw new CompanyOsEvaluationError('integrity_mismatch', `Conversion source ${source.id}@${source.revision} is not a Variable`);
    }
  }
  const target = conversion?.targetRef ?? input.variableRef;
  const matches = variables.filter((candidate) => sameFoundationRef(candidate.reference, target));
  if (matches.length !== 1) {
    throw new CompanyOsEvaluationError(
      'incompatible_measurement',
      `Measurement ${input.variableRef.id}@${input.variableRef.revision} does not match a pinned criterion definition; an explicit conversion is required`
    );
  }
  if (conversion !== undefined && !sameFoundationRef(conversion.targetRef, matches[0].reference)) {
    throw new CompanyOsEvaluationError('integrity_mismatch', 'Conversion target does not match the pinned criterion definition');
  }
  return matches[0];
}

function normalizeMeasurement(
  input: EvaluationMeasurementInput,
  variable: ResolvedVariable,
  expectedPeriod: ObjectiveDefinition['evaluationPeriod']
): EvaluationMeasurement {
  if (!input || typeof input !== 'object') throw new CompanyOsEvaluationError('invalid_input', 'Measurement must be an object');
  if (!input.descriptor || typeof input.descriptor !== 'object' || Array.isArray(input.descriptor)
    || Object.prototype.hasOwnProperty.call(input.descriptor, 'variableRef')) {
    throw new CompanyOsEvaluationError('invalid_input', 'Measurement descriptor must not carry a variableRef');
  }
  if (!['observed', 'missing', 'not_arrived'].includes(input.status)) {
    throw new CompanyOsEvaluationError('invalid_input', `Unknown measurement status ${String(input.status)}`);
  }
  if (!parseIsoTimestamp(input.recordedAt)) {
    throw new CompanyOsEvaluationError('invalid_input', 'Measurement recordedAt must be an RFC3339 timestamp');
  }
  if (input.status === 'observed' && input.value === undefined) {
    throw new CompanyOsEvaluationError('invalid_input', 'Observed measurements require a value');
  }
  if (input.status !== 'observed' && input.value !== undefined) {
    throw new CompanyOsEvaluationError('invalid_input', 'Missing or not-arrived measurements cannot carry a value');
  }
  const descriptor: FoundationEvaluationDescriptor = {
    variableRef: {
      id: variable.reference.id,
      type: 'variable',
      revision: variable.reference.revision
    },
    ...input.descriptor
  };
  const compatibility = validateEvaluationCompatibility(
    variable.definition,
    descriptor,
    { period: expectedPeriod }
  );
  // A measurement may not silently use a different period or definition. The
  // caller can only use a different definition through an explicit conversion
  // whose effective descriptor still matches the pinned criterion.
  if (compatibility.issues.length > 0) {
    throw new CompanyOsEvaluationError(
      'incompatible_measurement',
      compatibility.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
    );
  }
  assertValueKind(input.value, variable.definition.valueKind, input.status);
  return deepFreeze({
    variableRef: cloneFoundationRef(input.variableRef),
    effectiveVariableRef: cloneFoundationRef(variable.reference),
    descriptor: cloneJson(input.descriptor),
    status: input.status,
    ...(input.value === undefined ? {} : { value: input.value }),
    recordedAt: input.recordedAt,
    ...(input.evidenceRef === undefined ? {} : { evidenceRef: input.evidenceRef }),
    ...(input.conversion === undefined ? {} : { conversion: cloneJson(input.conversion) })
  });
}

function buildEvaluationRecord(input: {
  readonly id: string;
  readonly resolved: ResolvedEvaluationDefinitions;
  readonly outcomeCase: OutcomeCaseRead;
  readonly predictions: MeasurementResolution;
  readonly actuals: MeasurementResolution;
  readonly validity: JudgmentValidity;
  readonly evaluatedAt: string;
}): CompanyOsEvaluationRecord {
  if (!isNonEmptyString(input.id)) throw new CompanyOsEvaluationError('invalid_input', 'evaluation id is required');
  if (!parseIsoTimestamp(input.evaluatedAt)) throw new CompanyOsEvaluationError('invalid_input', 'evaluatedAt must be an RFC3339 timestamp');
  const criteria: CriterionEvaluation[] = [];
  const predictionComparisons: PredictionComparison[] = [];
  for (const variable of input.resolved.variables) {
    const actual = input.actuals.byVariable.get(foundationReferenceKey(variable.reference));
    const prediction = input.predictions.byVariable.get(foundationReferenceKey(variable.reference));
    criteria.push(evaluateCriterion(variable, actual, input.evaluatedAt));
    predictionComparisons.push(comparePrediction(variable, prediction, actual, input.evaluatedAt));
  }
  const achievement = aggregateAchievement(criteria);
  return deepFreeze({
    version: COMPANY_OS_EVALUATION_RECORD_CATALOG_VERSION,
    id: input.id,
    snapshot: {
      snapshotId: input.resolved.snapshotId,
      problemId: input.resolved.snapshot.problem_id,
      revision: input.resolved.snapshot.revision,
      digest: input.resolved.snapshotId
    },
    objectiveRef: cloneFoundationRef(input.resolved.objectiveRef),
    outcomeCaseRef: cloneCaseReference(input.outcomeCase.reference),
    predictions: input.predictions.measurements,
    actuals: input.actuals.measurements,
    criteria,
    predictionComparisons,
    achievement,
    judgmentAtTimeValidity: input.validity,
    evaluatedAt: input.evaluatedAt
  });
}

function evaluateCriterion(
  variable: ResolvedVariable,
  actual: EvaluationMeasurement | undefined,
  evaluatedAt: string
): CriterionEvaluation {
  const base = {
    criterionIndex: variable.criterionIndex,
    variableRef: cloneFoundationRef(variable.reference),
    operator: variable.criterion.operator,
    ...(variable.criterion.target === undefined ? {} : { target: variable.criterion.target })
  };
  if (!actual) return { ...base, status: 'indeterminate', reason: 'actual_measurement_missing' };
  if (actual.status !== 'observed') return { ...base, status: 'indeterminate', reason: `actual_${actual.status}` };
  if (Date.parse(actual.descriptor.period.until) > Date.parse(evaluatedAt)) {
    return { ...base, status: 'indeterminate', reason: 'evaluation_period_not_complete' };
  }
  const target = variable.criterion.target;
  if (target === undefined || actual.value === undefined) {
    return { ...base, status: 'indeterminate', reason: 'criterion_value_unavailable' };
  }
  const achieved = variable.criterion.operator === 'at_least'
    ? typeof actual.value === 'number' && typeof target === 'number' && actual.value >= target
    : variable.criterion.operator === 'at_most'
      ? typeof actual.value === 'number' && typeof target === 'number' && actual.value <= target
      : Object.is(actual.value, target);
  return {
    ...base,
    status: achieved ? 'achieved' : 'not_achieved',
    reason: achieved ? 'criterion_satisfied' : 'criterion_not_satisfied'
  };
}

function comparePrediction(
  variable: ResolvedVariable,
  prediction: EvaluationMeasurement | undefined,
  actual: EvaluationMeasurement | undefined,
  evaluatedAt: string
): PredictionComparison {
  const base = { criterionIndex: variable.criterionIndex, variableRef: cloneFoundationRef(variable.reference) };
  if (!prediction || !actual) return { ...base, status: 'indeterminate', reason: 'prediction_or_actual_missing' };
  if (prediction.status !== 'observed' || actual.status !== 'observed') {
    return {
      ...base,
      status: 'indeterminate',
      reason: 'prediction_or_actual_not_observed',
      predictionStatus: prediction.status,
      actualStatus: actual.status
    };
  }
  if (Date.parse(actual.descriptor.period.until) > Date.parse(evaluatedAt)) {
    return {
      ...base,
      status: 'indeterminate',
      reason: 'evaluation_period_not_complete',
      predictionStatus: prediction.status,
      actualStatus: actual.status,
      predictionValue: prediction.value,
      actualValue: actual.value
    };
  }
  const matched = Object.is(prediction.value, actual.value);
  return {
    ...base,
    status: matched ? 'matched' : 'missed',
    reason: matched ? 'prediction_matches_actual' : 'prediction_differs_from_actual',
    predictionStatus: prediction.status,
    actualStatus: actual.status,
    predictionValue: prediction.value,
    actualValue: actual.value
  };
}

function aggregateAchievement(criteria: readonly CriterionEvaluation[]): EvaluationResultStatus {
  if (criteria.some((criterion) => criterion.status === 'indeterminate')) return 'indeterminate';
  return criteria.every((criterion) => criterion.status === 'achieved') ? 'achieved' : 'not_achieved';
}

/**
 * Rebuild all derived fields before returning an immutable record.  The
 * sidecar is deliberately treated as untrusted evidence: a syntactically
 * valid JSON edit must not be able to turn a failed criterion into success or
 * make a measurement refer to a different Foundation revision.
 */
async function assertEvaluationRecordConsistency(
  record: CompanyOsEvaluationRecord,
  objectiveRecord: FoundationCatalogRecord,
  foundation: FoundationDefinitionLoadPort,
  access: EvaluationAccessContext
): Promise<void> {
  if (objectiveRecord.definition.type !== 'objective') {
    throw new CompanyOsEvaluationError('corrupt_record', 'Evaluation objective has the wrong type');
  }
  const objectiveReference = foundationRef(objectiveRecord);
  if (!sameFoundationRef(record.objectiveRef, objectiveReference)) {
    throw new CompanyOsEvaluationError('integrity_mismatch', 'Evaluation objective reference does not match the canonical definition');
  }
  const objective = objectiveRecord.definition;
  const objectiveValidation = validateFoundationDefinition(objective, { use: 'evaluation' });
  if (!objectiveValidation.valid) {
    throw new CompanyOsEvaluationError('corrupt_record', `Evaluation objective is no longer evaluable: ${objectiveValidation.issues.map((issue) => issue.message).join('; ')}`);
  }
  if (record.criteria.length !== objective.criteria.length || record.criteria.length === 0
    || record.predictionComparisons.length !== objective.criteria.length) {
    throw new CompanyOsEvaluationError('corrupt_record', 'Evaluation derived criteria do not match the Objective');
  }

  const variables: ResolvedVariable[] = [];
  for (const [criterionIndex, criterion] of objective.criteria.entries()) {
    const storedCriterion = record.criteria[criterionIndex];
    if (!storedCriterion || storedCriterion.criterionIndex !== criterionIndex
      || storedCriterion.variableRef.type !== 'variable'
      || storedCriterion.variableRef.id !== criterion.variableRef.id
      || storedCriterion.variableRef.revision !== criterion.variableRef.revision
      || storedCriterion.operator !== criterion.operator
      || !sameOptionalScalar(storedCriterion.target, criterion.target)) {
      throw new CompanyOsEvaluationError('integrity_mismatch', `Evaluation criterion ${criterionIndex} does not match the Objective`);
    }
    const variableRecord = await foundation.readExact(storedCriterion.variableRef, access);
    if (!variableRecord) {
      throw new CompanyOsEvaluationError('corrupt_record', `Variable for evaluation criterion ${criterionIndex} is missing`);
    }
    if (variableRecord.definition.type !== 'variable') {
      throw new CompanyOsEvaluationError('corrupt_record', `Evaluation criterion ${criterionIndex} resolved to ${variableRecord.definition.type}`);
    }
    const variableValidation = validateFoundationDefinition(variableRecord.definition, { use: 'evaluation' });
    if (!variableValidation.valid) {
      throw new CompanyOsEvaluationError('corrupt_record', `Variable for evaluation criterion ${criterionIndex} is not evaluable: ${variableValidation.issues.map((issue) => issue.message).join('; ')}`);
    }
    try {
      assertCriterionCompatibility(criterion, variableRecord.definition, criterionIndex);
    } catch (error) {
      throw new CompanyOsEvaluationError('corrupt_record', formatError(error));
    }
    variables.push({
      criterionIndex,
      criterion,
      reference: foundationRef(variableRecord),
      definition: variableRecord.definition,
      record: variableRecord
    });
  }

  const predictions = await validateStoredMeasurementSet(
    record.predictions,
    variables,
    foundation,
    access,
    objective.evaluationPeriod,
    'prediction'
  );
  const actuals = await validateStoredMeasurementSet(
    record.actuals,
    variables,
    foundation,
    access,
    objective.evaluationPeriod,
    'actual'
  );
  const expectedCriteria = variables.map((variable) => evaluateCriterion(
    variable,
    actuals.byVariable.get(foundationReferenceKey(variable.reference)),
    record.evaluatedAt
  ));
  const expectedComparisons = variables.map((variable) => comparePrediction(
    variable,
    predictions.byVariable.get(foundationReferenceKey(variable.reference)),
    actuals.byVariable.get(foundationReferenceKey(variable.reference)),
    record.evaluatedAt
  ));
  if (!sameJson(record.criteria, expectedCriteria)
    || !sameJson(record.predictionComparisons, expectedComparisons)
    || record.achievement !== aggregateAchievement(expectedCriteria)) {
    throw new CompanyOsEvaluationError('integrity_mismatch', 'Evaluation derived results do not match its measurements and Objective');
  }
}

async function validateStoredMeasurementSet(
  measurements: readonly EvaluationMeasurement[],
  variables: readonly ResolvedVariable[],
  foundation: FoundationDefinitionLoadPort,
  access: EvaluationAccessContext,
  expectedPeriod: ObjectiveDefinition['evaluationPeriod'],
  phase: 'prediction' | 'actual'
): Promise<MeasurementResolution> {
  const byVariable = new Map<string, EvaluationMeasurement>();
  for (const [index, measurement] of measurements.entries()) {
    const variable = variables.find((candidate) => sameFoundationRef(candidate.reference, measurement.effectiveVariableRef));
    if (!variable) {
      throw new CompanyOsEvaluationError('integrity_mismatch', `${phase} measurement ${index} is not pinned to an Objective criterion`);
    }
    if (measurement.conversion !== undefined) {
      const sourceRecord = await foundation.readExact(measurement.conversion.sourceRef, access);
      if (!sourceRecord || sourceRecord.definition.type !== 'variable') {
        throw new CompanyOsEvaluationError('corrupt_record', `${phase} measurement ${index} conversion source is missing or is not a Variable`);
      }
    } else if (!sameFoundationRef(measurement.variableRef, variable.reference)) {
      throw new CompanyOsEvaluationError('integrity_mismatch', `${phase} measurement ${index} changed definition without conversion provenance`);
    }
    const descriptor: FoundationEvaluationDescriptor = {
      variableRef: {
        id: variable.reference.id,
        type: 'variable',
        revision: variable.reference.revision
      },
      ...measurement.descriptor
    };
    const compatibility = validateEvaluationCompatibility(variable.definition, descriptor, { period: expectedPeriod });
    if (compatibility.issues.length > 0) {
      throw new CompanyOsEvaluationError(
        'integrity_mismatch',
        `${phase} measurement ${index} is incompatible: ${compatibility.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`
      );
    }
    try {
      assertValueKind(measurement.value, variable.definition.valueKind, measurement.status);
    } catch (error) {
      throw new CompanyOsEvaluationError('integrity_mismatch', formatError(error));
    }
    const key = foundationReferenceKey(variable.reference);
    if (byVariable.has(key)) {
      throw new CompanyOsEvaluationError('corrupt_record', `${phase} contains duplicate measurements for ${key}`);
    }
    byVariable.set(key, measurement);
  }
  return { measurements, byVariable };
}

function sameOptionalScalar(left: EvaluationScalar | undefined, right: EvaluationScalar | undefined): boolean {
  return left === undefined || right === undefined ? left === right : Object.is(left, right);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function assertCurrentFoundation(
  current: PersonalOs,
  reference: FoundationRef,
  expected: FoundationCatalogRecord,
  access: EvaluationAccessContext
): void {
  if (current.graph.version !== 2) throw new CompanyOsEvaluationError('unsupported_graph', 'Foundation data requires Graph v2');
  let actual: FoundationCatalogRecord | undefined;
  let latest: FoundationCatalogRecord | undefined;
  try {
    const catalog = foundationCatalogOrEmpty(current.graph.foundation);
    actual = findFoundationRecord(catalog, reference);
    latest = findLatestFoundationRecord(catalog, reference.type, reference.id);
  } catch (error) {
    throw new CompanyOsEvaluationError('corrupt_record', formatError(error));
  }
  if (!actual || !latest) throw new CompanyOsEvaluationError('revision_conflict', `Foundation ${reference.type}/${reference.id}@${reference.revision} changed before evaluation commit`);
  if (!aclAllowsRead(latest.definition.acl, access.principal)) {
    throw new CompanyOsEvaluationError('authorization_denied', `Principal ${access.principal} cannot read ${reference.type}/${reference.id}`);
  }
  if (access.scope !== undefined && !scopeHasSubjectOverlap(latest.definition.scope, access.scope)) {
    throw new CompanyOsEvaluationError('scope_violation', `Principal ${access.principal} cannot access ${reference.type}/${reference.id} outside the trusted scope`);
  }
  if (actual.digest !== expected.digest) {
    throw new CompanyOsEvaluationError('revision_conflict', `Foundation ${reference.type}/${reference.id}@${reference.revision} changed before evaluation commit`);
  }
}

async function readCanonicalOutcomeCase(
  port: OutcomeCasePort,
  input: OutcomeCaseReference,
  access: EvaluationAccessContext
): Promise<OutcomeCaseRead> {
  assertOutcomeCaseReference(input);
  let resolved: OutcomeCaseRead;
  try {
    resolved = await port.read(input, access);
  } catch (error) {
    throw error;
  }
  assertOutcomeCaseRead(resolved);
  if (input.revision !== undefined && input.revision !== resolved.reference.revision) {
    throw new CompanyOsEvaluationError('integrity_mismatch', 'OutcomeCase resolver returned a different requested revision');
  }
  if (input.digest !== undefined && input.digest !== resolved.reference.digest) {
    throw new CompanyOsEvaluationError('integrity_mismatch', 'OutcomeCase resolver returned a different requested digest');
  }
  if (!aclAllowsRead(resolved.acl, access.principal)) {
    throw new CompanyOsEvaluationError('authorization_denied', `Principal ${access.principal} cannot read OutcomeCase ${resolved.reference.id}`);
  }
  if (access.scope !== undefined && !scopeHasSubjectOverlap(resolved.scope, access.scope)) {
    throw new CompanyOsEvaluationError('scope_violation', `Principal ${access.principal} cannot access OutcomeCase ${resolved.reference.id} outside the trusted scope`);
  }
  return {
    reference: cloneCaseReference(resolved.reference),
    source: cloneOutcomeCaseSource(resolved.source),
    acl: cloneAcl(resolved.acl),
    scope: cloneScope(resolved.scope)
  };
}

function normalizeJudgmentValidity(input: JudgmentValidityInput): JudgmentValidity {
  if (!input || !['valid', 'invalid', 'indeterminate'].includes(input.status) || !isNonEmptyString(input.basis)) {
    throw new CompanyOsEvaluationError('invalid_input', 'judgmentAtTimeValidity requires status and a non-empty basis');
  }
  if (input.evidenceRefs !== undefined && (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.some((ref) => !isNonEmptyString(ref)))) {
    throw new CompanyOsEvaluationError('invalid_input', 'judgmentAtTimeValidity.evidenceRefs must contain non-empty strings');
  }
  return deepFreeze({
    status: input.status,
    basis: input.basis,
    ...(input.evidenceRefs === undefined ? {} : { evidenceRefs: [...input.evidenceRefs] })
  });
}

function assertEvaluationRequest(request: EvaluateCompanyOsProblemRequest): void {
  if (!request || typeof request !== 'object') throw new CompanyOsEvaluationError('invalid_input', 'Evaluation request is required');
  if (!isNonEmptyString(request.id)) throw new CompanyOsEvaluationError('invalid_input', 'Evaluation id is required');
  if (!request.snapshot || !isNonEmptyString(request.snapshot.root) || !request.snapshot.referenceProvider) {
    throw new CompanyOsEvaluationError('invalid_input', 'A snapshot root and referenceProvider are required');
  }
  if (!Array.isArray(request.predictions) || !Array.isArray(request.actuals)) {
    throw new CompanyOsEvaluationError('invalid_input', 'predictions and actuals must be arrays');
  }
}

function assertOutcomeCaseReference(input: OutcomeCaseReference): void {
  if (!input || !isNonEmptyString(input.id)) throw new CompanyOsEvaluationError('invalid_input', 'OutcomeCase id is required');
  if (input.revision !== undefined && !/^[1-9]\d*$/.test(input.revision)) throw new CompanyOsEvaluationError('invalid_input', 'OutcomeCase revision must be positive');
  if (input.digest !== undefined && !isDigest(input.digest)) throw new CompanyOsEvaluationError('invalid_input', 'OutcomeCase digest must be sha256:<64 lowercase hex>');
}

function assertOutcomeCaseRead(value: OutcomeCaseRead): void {
  if (!value || typeof value !== 'object' || !value.reference || !isNonEmptyString(value.reference.id)
    || !/^[1-9]\d*$/.test(value.reference.revision) || !isDigest(value.reference.digest)
    || !isValidAcl(value.acl) || !isValidScope(value.scope)) {
    throw new CompanyOsEvaluationError('integrity_mismatch', 'OutcomeCase resolver returned invalid canonical metadata');
  }
  assertOutcomeCaseSource(value.source);
}

function assertOutcomeCaseSource(value: unknown): asserts value is OutcomeCaseCanonicalSource {
  if (!isRecord(value) || !isNonEmptyString(value.state) || !Array.isArray(value.owner_refs)) {
    throw new CompanyOsEvaluationError(
      'integrity_mismatch',
      'OutcomeCase resolver returned invalid canonical source metadata'
    );
  }
  value.owner_refs.forEach((owner, index) => assertOutcomeCaseOwnerReference(owner, `source.owner_refs[${index}]`));
  if (value.conditions !== undefined) assertOutcomeCaseConditions(value.conditions, 'source.conditions');
}

function assertOutcomeCaseOwnerReference(value: unknown, label: string): asserts value is OutcomeCaseOwnerReference {
  if (!isRecord(value) || (value.status !== 'typed' && value.status !== 'unknown')) {
    throw new CompanyOsEvaluationError('integrity_mismatch', `${label} has an invalid status`);
  }
  if (value.status === 'unknown') {
    if (!['not_recorded', 'legacy_untyped', 'source_unavailable'].includes(String(value.reason))) {
      throw new CompanyOsEvaluationError('integrity_mismatch', `${label} has an invalid unknown reason`);
    }
    return;
  }
  if (!isRecord(value.ref)
    || !isNonEmptyString(value.ref.id)
    || !isNonEmptyString(value.ref.type)
    || (value.ref.revision !== undefined && !isNonEmptyString(value.ref.revision))
    || (value.ref.digest !== undefined && !isNonEmptyString(value.ref.digest))) {
    throw new CompanyOsEvaluationError('integrity_mismatch', `${label}.ref has an invalid shape`);
  }
}

function assertOutcomeCaseConditions(value: unknown, label: string): asserts value is OutcomeCaseConditions {
  if (!isRecord(value)) {
    throw new CompanyOsEvaluationError('integrity_mismatch', `${label} must be an object`);
  }
  assertOutcomeCaseConditionValue(value, label);
}

function assertOutcomeCaseConditionValue(value: unknown, label: string): asserts value is OutcomeCaseConditionValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new CompanyOsEvaluationError('integrity_mismatch', `${label} contains a non-finite number`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertOutcomeCaseConditionValue(item, `${label}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (!isNonEmptyString(key)) {
        throw new CompanyOsEvaluationError('integrity_mismatch', `${label} contains an empty key`);
      }
      assertOutcomeCaseConditionValue(item, `${label}.${key}`);
    }
    return;
  }
  throw new CompanyOsEvaluationError('integrity_mismatch', `${label} contains a non-JSON value`);
}

function assertCriterionCompatibility(criterion: ObjectiveCriterion, variable: VariableDefinition, index: number): void {
  if (criterion.target === undefined) throw new CompanyOsEvaluationError('incompatible_measurement', `Criterion ${index} has no target`);
  if ((criterion.operator === 'at_least' || criterion.operator === 'at_most')
    && (variable.valueKind !== 'number' || typeof criterion.target !== 'number' || !Number.isFinite(criterion.target))) {
    throw new CompanyOsEvaluationError('incompatible_measurement', `Criterion ${index} requires a numeric Variable and finite number target`);
  }
  if (criterion.operator === 'equals' && !valueMatchesKind(criterion.target, variable.valueKind)) {
    throw new CompanyOsEvaluationError('incompatible_measurement', `Criterion ${index} target does not match Variable valueKind`);
  }
}

function assertValueKind(value: EvaluationScalar | undefined, kind: VariableDefinition['valueKind'], status: EvaluationMeasurementStatus): void {
  if (value === undefined || status !== 'observed') return;
  if (!valueMatchesKind(value, kind)) throw new CompanyOsEvaluationError('incompatible_measurement', `Measurement value does not match Variable valueKind ${kind}`);
}

function valueMatchesKind(value: unknown, kind: VariableDefinition['valueKind']): boolean {
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (kind === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string';
}

function foundationReference(reference: JudgmentProblemReference): FoundationRef {
  if (!['objective', 'variable', 'model', 'constraint'].includes(reference.kind)) {
    throw new CompanyOsEvaluationError('invalid_input', `Reference ${reference.kind} is not a Foundation definition`);
  }
  return {
    id: reference.id,
    type: reference.kind,
    revision: reference.revision,
    digest: reference.digest
  } as FoundationRef;
}

function assertFoundationRef(value: unknown, label: string): asserts value is FoundationRef {
  if (!value || typeof value !== 'object' || !isNonEmptyString((value as FoundationRef).id)
    || !['objective', 'variable', 'model', 'constraint'].includes((value as FoundationRef).type)
    || !/^[1-9]\d*$/.test(String((value as FoundationRef).revision))
    || !isDigest((value as FoundationRef).digest)) {
    throw new CompanyOsEvaluationError('invalid_input', `${label} must contain id, type, revision, and digest`);
  }
}

function assertUniqueReferences(references: readonly JudgmentProblemReference[], label: string): void {
  const keys = new Set<string>();
  for (const reference of references) {
    const key = `${reference.id}@${reference.revision}:${reference.digest}`;
    if (keys.has(key)) throw new CompanyOsEvaluationError('integrity_mismatch', `Duplicate ${label} reference ${key}`);
    keys.add(key);
  }
}

function assertAccessContext(value: EvaluationAccessContext): EvaluationAccessContext {
  if (!value || !isNonEmptyString(value.principal)) throw new CompanyOsEvaluationError('authorization_denied', 'A trusted principal is required');
  return { principal: value.principal, ...(value.scope === undefined ? {} : { scope: cloneScope(value.scope) }) };
}

function foundationReferenceKey(reference: FoundationRef): string {
  return JSON.stringify([reference.type, reference.id, reference.revision, reference.digest]);
}

function sameFoundationRef(left: FoundationRef, right: FoundationRef): boolean {
  return left.type === right.type && left.id === right.id && left.revision === right.revision && left.digest === right.digest;
}

function sameCaseReference(left: OutcomeCaseCanonicalReference, right: OutcomeCaseCanonicalReference): boolean {
  return left.id === right.id && left.revision === right.revision && left.digest === right.digest;
}

function cloneFoundationRef(reference: FoundationRef): FoundationRef {
  return { id: reference.id, type: reference.type, revision: reference.revision, digest: reference.digest };
}

function cloneCaseReference(reference: OutcomeCaseCanonicalReference): OutcomeCaseCanonicalReference {
  return { id: reference.id, revision: reference.revision, digest: reference.digest };
}

function cloneOutcomeCaseSource(source: OutcomeCaseCanonicalSource): OutcomeCaseCanonicalSource {
  return {
    state: source.state,
    owner_refs: source.owner_refs.map((owner) => owner.status === 'typed'
      ? {
          status: 'typed',
          ref: {
            id: owner.ref.id,
            type: owner.ref.type,
            ...(owner.ref.revision === undefined ? {} : { revision: owner.ref.revision }),
            ...(owner.ref.digest === undefined ? {} : { digest: owner.ref.digest })
          }
        }
      : { status: 'unknown', reason: owner.reason }),
    ...(source.conditions === undefined ? {} : { conditions: cloneOutcomeCaseConditions(source.conditions) })
  };
}

function cloneOutcomeCaseConditions(conditions: OutcomeCaseConditions): OutcomeCaseConditions {
  return cloneOutcomeCaseConditionValue(conditions) as OutcomeCaseConditions;
}

function cloneOutcomeCaseConditionValue(value: OutcomeCaseConditionValue): OutcomeCaseConditionValue {
  if (Array.isArray(value)) return value.map(cloneOutcomeCaseConditionValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneOutcomeCaseConditionValue(child as OutcomeCaseConditionValue)])
    );
  }
  return value;
}

function cloneEvaluationMeasurement(measurement: EvaluationMeasurement): EvaluationMeasurement {
  return deepFreeze(cloneJson(measurement));
}

function cloneEvaluationRecord(record: CompanyOsEvaluationRecord): CompanyOsEvaluationRecord {
  return deepFreeze(cloneJson(record));
}

function cloneAcl(acl: FoundationAcl): FoundationAcl {
  return { ownerId: acl.ownerId, visibility: acl.visibility, readerIds: [...acl.readerIds], writerIds: [...acl.writerIds] };
}

function cloneScope(scope: FoundationScope): FoundationScope {
  return { subjectIds: [...scope.subjectIds], validFrom: scope.validFrom, ...(scope.validUntil === undefined ? {} : { validUntil: scope.validUntil }) };
}

function aclAllowsRead(acl: FoundationAcl, principal: string): boolean {
  return acl.visibility === 'public' || acl.ownerId === principal || acl.readerIds.includes(principal) || acl.writerIds.includes(principal);
}

function scopeHasSubjectOverlap(resource: FoundationScope, trusted: FoundationScope): boolean {
  const trustedSubjects = new Set(trusted.subjectIds);
  return resource.subjectIds.some((subjectId) => trustedSubjects.has(subjectId));
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isValidAcl(value: unknown): value is FoundationAcl {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as FoundationAcl;
  return isNonEmptyString(candidate.ownerId)
    && ['private', 'project', 'organization', 'public'].includes(candidate.visibility)
    && Array.isArray(candidate.readerIds) && candidate.readerIds.every(isNonEmptyString)
    && Array.isArray(candidate.writerIds) && candidate.writerIds.every(isNonEmptyString);
}

function isValidScope(value: unknown): value is FoundationScope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as FoundationScope;
  const from = parseStrictRfc3339(candidate.validFrom);
  const until = candidate.validUntil === undefined ? undefined : parseStrictRfc3339(candidate.validUntil);
  return Array.isArray(candidate.subjectIds) && candidate.subjectIds.length > 0
    && candidate.subjectIds.every(isNonEmptyString)
    && from !== undefined
    && (candidate.validUntil === undefined || (
      until !== undefined
      && until > from
    ));
}

function parseIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && parseStrictRfc3339(value) !== undefined;
}

function parseStrictRfc3339(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? '';
  const zone = match[8];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return undefined;
    offsetMinutes = sign * (offsetHour * 60 + offsetMinute);
  }
  const milliseconds = Number((fraction + '000').slice(0, 3));
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds)
    - offsetMinutes * 60_000;
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEvaluationScalar(value: unknown): value is EvaluationScalar {
  return typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function assertStoredMeasurement(value: unknown, label: string): asserts value is EvaluationMeasurement {
  if (!isRecord(value) || !value.variableRef || !value.effectiveVariableRef
    || !value.descriptor || !isNonEmptyString(value.status)
    || !parseIsoTimestamp(value.recordedAt)) {
    throw new CompanyOsEvaluationError('corrupt_record', `${label} is invalid`);
  }
  assertFoundationRef(value.variableRef, `${label}.variableRef`);
  assertFoundationRef(value.effectiveVariableRef, `${label}.effectiveVariableRef`);
  if (value.variableRef.type !== 'variable' || value.effectiveVariableRef.type !== 'variable') {
    throw new CompanyOsEvaluationError('corrupt_record', `${label} must reference Variables`);
  }
  if (!['observed', 'missing', 'not_arrived'].includes(value.status)) {
    throw new CompanyOsEvaluationError('corrupt_record', `${label}.status is invalid`);
  }
  const descriptor = value.descriptor;
  if (!isRecord(descriptor) || Object.prototype.hasOwnProperty.call(descriptor, 'variableRef')
    || (descriptor.unit !== undefined && typeof descriptor.unit !== 'string')
    || !isFoundationAggregation(descriptor.aggregation)
    || !isNonEmptyString(descriptor.granularity)
    || !isValidScope(descriptor.scope)
    || !isValidPeriod(descriptor.period)) {
    throw new CompanyOsEvaluationError('corrupt_record', `${label}.descriptor is invalid`);
  }
  if (value.status === 'observed' && !isEvaluationScalar(value.value)) {
    throw new CompanyOsEvaluationError('corrupt_record', `${label} observed value is invalid`);
  }
  if (value.status !== 'observed' && value.value !== undefined) {
    throw new CompanyOsEvaluationError('corrupt_record', `${label} non-observed value must be absent`);
  }
  if (value.evidenceRef !== undefined && !isNonEmptyString(value.evidenceRef)) {
    throw new CompanyOsEvaluationError('corrupt_record', `${label}.evidenceRef is invalid`);
  }
  if (value.conversion !== undefined) {
    if (!isRecord(value.conversion) || !value.conversion.sourceRef || !value.conversion.targetRef
      || !isRecord(value.conversion.provenance)) {
      throw new CompanyOsEvaluationError('corrupt_record', `${label}.conversion is invalid`);
    }
    assertFoundationRef(value.conversion.sourceRef, `${label}.conversion.sourceRef`);
    assertFoundationRef(value.conversion.targetRef, `${label}.conversion.targetRef`);
    if (value.conversion.sourceRef.type !== 'variable' || value.conversion.targetRef.type !== 'variable'
      || !sameFoundationRef(value.conversion.sourceRef, value.variableRef)
      || !sameFoundationRef(value.conversion.targetRef, value.effectiveVariableRef)
      || !isNonEmptyString(value.conversion.provenance.id)
      || !isNonEmptyString(value.conversion.provenance.description)) {
      throw new CompanyOsEvaluationError('corrupt_record', `${label}.conversion provenance or references are invalid`);
    }
  } else if (!sameFoundationRef(value.variableRef, value.effectiveVariableRef)) {
    throw new CompanyOsEvaluationError('corrupt_record', `${label} changed definition without conversion provenance`);
  }
}

function assertStoredCriterion(value: unknown, label: string): asserts value is CriterionEvaluation {
  if (!isRecord(value) || typeof value.criterionIndex !== 'number' || !Number.isInteger(value.criterionIndex) || value.criterionIndex < 0
    || !value.variableRef || !isNonEmptyString(value.operator)
    || !isNonEmptyString(value.status) || !isNonEmptyString(value.reason)) {
    throw new CompanyOsEvaluationError('corrupt_record', `${label} is invalid`);
  }
  assertFoundationRef(value.variableRef, `${label}.variableRef`);
  if (value.variableRef.type !== 'variable' || !['at_least', 'at_most', 'equals'].includes(value.operator)
    || !['achieved', 'not_achieved', 'indeterminate'].includes(value.status)) {
    throw new CompanyOsEvaluationError('corrupt_record', `${label} contains an invalid criterion contract`);
  }
  if (value.target !== undefined && !isEvaluationScalar(value.target)) {
    throw new CompanyOsEvaluationError('corrupt_record', `${label}.target is invalid`);
  }
}

function assertStoredPredictionComparison(value: unknown, label: string): asserts value is PredictionComparison {
  if (!isRecord(value) || typeof value.criterionIndex !== 'number' || !Number.isInteger(value.criterionIndex) || value.criterionIndex < 0
    || !value.variableRef || !isNonEmptyString(value.status) || !isNonEmptyString(value.reason)) {
    throw new CompanyOsEvaluationError('corrupt_record', `${label} is invalid`);
  }
  assertFoundationRef(value.variableRef, `${label}.variableRef`);
  if (value.variableRef.type !== 'variable' || !['matched', 'missed', 'indeterminate'].includes(value.status)) {
    throw new CompanyOsEvaluationError('corrupt_record', `${label} contains an invalid comparison contract`);
  }
  for (const status of ['predictionStatus', 'actualStatus'] as const) {
    const statusValue = value[status];
    if (statusValue !== undefined && (typeof statusValue !== 'string' || !['observed', 'missing', 'not_arrived'].includes(statusValue))) {
      throw new CompanyOsEvaluationError('corrupt_record', `${label}.${status} is invalid`);
    }
  }
  for (const field of ['predictionValue', 'actualValue'] as const) {
    if (value[field] !== undefined && !isEvaluationScalar(value[field])) {
      throw new CompanyOsEvaluationError('corrupt_record', `${label}.${field} is invalid`);
    }
  }
}

function assertStoredJudgmentValidity(value: unknown, label: string): asserts value is JudgmentValidity {
  if (!isRecord(value) || typeof value.status !== 'string' || !['valid', 'invalid', 'indeterminate'].includes(value.status)
    || !isNonEmptyString(value.basis)
    || (value.evidenceRefs !== undefined
      && (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.some((ref) => !isNonEmptyString(ref))))) {
    throw new CompanyOsEvaluationError('corrupt_record', `${label} is invalid`);
  }
}

function assertOutcomeCaseCanonicalReference(value: unknown, label: string): asserts value is OutcomeCaseCanonicalReference {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !/^[1-9]\d*$/.test(String(value.revision)) || !isDigest(value.digest)) {
    throw new CompanyOsEvaluationError('corrupt_record', `${label} must contain a canonical id, revision, and digest`);
  }
}

function isFoundationAggregation(value: unknown): value is FoundationEvaluationDescriptor['aggregation'] {
  return ['none', 'sum', 'average', 'count', 'min', 'max', 'last', 'custom'].includes(String(value));
}

function isValidPeriod(value: unknown): value is { from: string; until: string } {
  if (!isRecord(value)) return false;
  const from = typeof value.from === 'string' ? parseStrictRfc3339(value.from) : undefined;
  const until = typeof value.until === 'string' ? parseStrictRfc3339(value.until) : undefined;
  return isRecord(value)
    && from !== undefined
    && until !== undefined
    && until > from;
}

function parseEvaluationCatalog(rawText: string | undefined): EvaluationRecordCatalog {
  if (rawText === undefined) return { version: COMPANY_OS_EVALUATION_RECORD_CATALOG_VERSION, records: [] };
  try {
    const raw: unknown = JSON.parse(rawText);
    assertEvaluationCatalog(raw);
    return deepFreeze(cloneJson(raw));
  } catch (error) {
    if (error instanceof CompanyOsEvaluationError) {
      // Persisted JSON is untrusted input.  A shape helper may share the
      // request-side invalid_input code, but callers must see a corrupt record
      // when the sidecar itself is malformed.
      if (error.code === 'invalid_input') {
        throw new CompanyOsEvaluationError('corrupt_record', error.message);
      }
      throw error;
    }
    throw new CompanyOsEvaluationError('corrupt_record', formatError(error));
  }
}

function assertEvaluationCatalog(value: unknown): asserts value is EvaluationRecordCatalog {
  if (!value || typeof value !== 'object' || (value as EvaluationRecordCatalog).version !== COMPANY_OS_EVALUATION_RECORD_CATALOG_VERSION
    || !Array.isArray((value as EvaluationRecordCatalog).records)) {
    throw new CompanyOsEvaluationError('corrupt_record', 'Evaluation evidence must contain version 1 records');
  }
  const ids = new Set<string>();
  for (const record of (value as EvaluationRecordCatalog).records) {
    if (!record || typeof record !== 'object' || !isNonEmptyString(record.id) || ids.has(record.id)
      || record.version !== COMPANY_OS_EVALUATION_RECORD_CATALOG_VERSION
      || !record.snapshot || !isNonEmptyString(record.snapshot.snapshotId)
      || !isNonEmptyString(record.snapshot.problemId) || !/^[1-9]\d*$/.test(record.snapshot.revision)
      || !isNonEmptyString(record.snapshot.digest) || !record.objectiveRef
      || !record.outcomeCaseRef || !Array.isArray(record.predictions) || !Array.isArray(record.actuals)
      || !Array.isArray(record.criteria) || !Array.isArray(record.predictionComparisons)
      || !['achieved', 'not_achieved', 'indeterminate'].includes(record.achievement)
      || !record.judgmentAtTimeValidity || !parseIsoTimestamp(record.evaluatedAt)) {
      throw new CompanyOsEvaluationError('corrupt_record', 'Evaluation evidence contains an invalid immutable record');
    }
    assertFoundationRef(record.objectiveRef, 'record.objectiveRef');
    assertOutcomeCaseCanonicalReference(record.outcomeCaseRef, 'record.outcomeCaseRef');
    if (!isDigest(record.snapshot.snapshotId) || !isDigest(record.snapshot.digest)) {
      throw new CompanyOsEvaluationError('corrupt_record', 'Evaluation snapshot ids must be sha256 digests');
    }
    if (record.snapshot.digest !== record.snapshot.snapshotId) {
      throw new CompanyOsEvaluationError('integrity_mismatch', 'Evaluation snapshot digest must equal its snapshot id');
    }
    if (record.criteria.length === 0 || record.criteria.length !== record.predictionComparisons.length) {
      throw new CompanyOsEvaluationError('corrupt_record', 'Evaluation criteria and prediction comparisons are inconsistent');
    }
    record.predictions.forEach((measurement, index) => assertStoredMeasurement(measurement, `record.predictions[${index}]`));
    record.actuals.forEach((measurement, index) => assertStoredMeasurement(measurement, `record.actuals[${index}]`));
    record.criteria.forEach((criterion, index) => assertStoredCriterion(criterion, `record.criteria[${index}]`));
    record.predictionComparisons.forEach((comparison, index) => assertStoredPredictionComparison(comparison, `record.predictionComparisons[${index}]`));
    assertStoredJudgmentValidity(record.judgmentAtTimeValidity, 'record.judgmentAtTimeValidity');
    ids.add(record.id);
  }
}

function serializeEvaluationCatalog(catalog: EvaluationRecordCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
