import type {
  CompanyOsEvaluationRecord,
  EvaluationJudgmentValidity,
  EvaluationResultStatus,
  PredictionComparison,
} from './company-os-evaluation.js';
import type { FoundationRef } from './foundation-catalog.js';
import type {
  FoundationDefinition,
  FoundationOperator,
  FoundationRevision,
  FoundationType,
  ObjectiveCriterion,
  ObjectiveDefinition,
  VariableDefinition,
} from './ontology-foundation.js';
import type {
  JudgmentDAGCompositionRunRecord,
  JudgmentDAGEvidenceReference,
  JudgmentDAGProblemSnapshotReference,
  JudgmentDAGSubDAGRunRecord,
  JudgmentDAGVersionReference,
} from './judgment-dag-composition.js';
import type { JudgmentDAGJSONValue, JudgmentDAGRunRecord } from './judgment-dag-runner.js';
import type { JudgmentProblemSnapshot } from './judgment-problem-snapshot.js';
import type { FoundationCatalogRecord } from './types.js';

/**
 * Read-only projection contract for following one judgment from its
 * conclusion back to the exact Problem, Objective, evidence, child runs, and
 * evaluation that were used at the time.
 *
 * This module deliberately owns neither a store nor an authorization policy.
 * A host supplies a port after authenticating the request and binding its
 * tenant/scope.  Every reference read is explicitly historical so the view
 * cannot silently replace a past definition with its latest revision.
 */
export const JUDGMENT_VIEW_CONTRACT_VERSION = 'judgment-view.v1' as const;

export const JUDGMENT_VIEW_STATUSES = Object.freeze([
  'resolved',
  'unknown',
  'permission_denied',
  'unavailable',
  'undecidable',
  'invalid',
] as const);

export type JudgmentViewStatus = (typeof JUDGMENT_VIEW_STATUSES)[number];
export type JudgmentViewFailureStatus = Exclude<JudgmentViewStatus, 'resolved'>;

export interface JudgmentViewAccessContext {
  /** Identity and scope are resolved by the trusted host boundary. */
  readonly tenantId: string;
  readonly principal: string;
  readonly scopeId: string;
}

export interface JudgmentViewReadResult<T> {
  readonly status: 'resolved';
  readonly value: T;
}

export interface JudgmentViewReadFailure {
  readonly status: JudgmentViewFailureStatus;
  readonly reason: string;
}

export type JudgmentViewPortResult<T> = JudgmentViewReadResult<T> | JudgmentViewReadFailure;

export interface JudgmentViewSection<T> {
  readonly status: JudgmentViewStatus;
  readonly value?: T;
  readonly reason?: string;
}

/**
 * A collection carries an explicit absence marker.  `items: []` means the
 * source confirmed that there are no records; an unknown or unauthorized
 * source must use `items: null` and `absence_confirmed: false`.
 */
export interface JudgmentViewCollection<T> {
  readonly status: JudgmentViewStatus;
  readonly items: readonly T[] | null;
  readonly absence_confirmed: boolean;
  readonly reason?: string;
}

export interface JudgmentViewReadCompositionRunRequest {
  readonly runId: string;
  readonly access: JudgmentViewAccessContext;
}

export interface JudgmentViewReadProblemSnapshotRequest {
  readonly reference: JudgmentDAGProblemSnapshotReference;
  readonly access: JudgmentViewAccessContext;
  readonly resolution: 'historical';
}

export interface JudgmentViewReadFoundationReferenceRequest {
  readonly reference: FoundationRef;
  readonly access: JudgmentViewAccessContext;
  readonly resolution: 'historical';
}

export interface JudgmentViewReadRunArtifactRequest {
  readonly runId: string;
  readonly dag: JudgmentDAGVersionReference;
  readonly artifactId?: string;
  readonly access: JudgmentViewAccessContext;
  readonly resolution: 'historical';
}

export interface JudgmentViewReadEvaluationRequest {
  readonly runId: string;
  readonly snapshot: JudgmentDAGProblemSnapshotReference;
  readonly objective: FoundationRef;
  readonly evaluationId?: string;
  readonly access: JudgmentViewAccessContext;
  readonly resolution: 'historical';
}

/**
 * Adapters can be backed by the canonical Foundation store, Problem snapshot
 * store, DAG artifact store, and Evaluation store.  They return an explicit
 * failure instead of turning a missing or unauthorized record into null.
 */
export interface JudgmentViewReadPort {
  readonly readCompositionRun: (
    request: JudgmentViewReadCompositionRunRequest,
  ) => JudgmentViewPortResult<JudgmentDAGCompositionRunRecord> | Promise<JudgmentViewPortResult<JudgmentDAGCompositionRunRecord>>;
  readonly readProblemSnapshot: (
    request: JudgmentViewReadProblemSnapshotRequest,
  ) => JudgmentViewPortResult<JudgmentProblemSnapshot> | Promise<JudgmentViewPortResult<JudgmentProblemSnapshot>>;
  readonly readFoundationReference: (
    request: JudgmentViewReadFoundationReferenceRequest,
  ) => JudgmentViewPortResult<FoundationCatalogRecord> | Promise<JudgmentViewPortResult<FoundationCatalogRecord>>;
  readonly readRunArtifact: (
    request: JudgmentViewReadRunArtifactRequest,
  ) => JudgmentViewPortResult<JudgmentDAGRunRecord> | Promise<JudgmentViewPortResult<JudgmentDAGRunRecord>>;
  /** Optional until a host has an exact run-to-evaluation index. */
  readonly readEvaluation?: (
    request: JudgmentViewReadEvaluationRequest,
  ) => JudgmentViewPortResult<CompanyOsEvaluationRecord> | Promise<JudgmentViewPortResult<CompanyOsEvaluationRecord>>;
}

export interface JudgmentViewReadRequest {
  readonly runId: string;
  readonly evaluationId?: string;
  readonly access: JudgmentViewAccessContext;
}

export interface JudgmentViewRun {
  readonly runId: string;
  readonly status: JudgmentDAGCompositionRunRecord['status'];
  readonly question: string;
  readonly composition: JudgmentDAGVersionReference;
  readonly parentDag: JudgmentDAGVersionReference;
  readonly problemSnapshot: JudgmentDAGProblemSnapshotReference;
}

export interface JudgmentViewConclusion {
  readonly source: 'parent-run-artifact';
  readonly runId: string;
  readonly dag: JudgmentDAGVersionReference;
  /** The final node output; node internals are intentionally not exposed. */
  readonly value: JudgmentDAGJSONValue;
}

export interface JudgmentViewProblem {
  readonly snapshotId: string;
  readonly problemId: string;
  readonly revision: string;
  readonly question: string;
  readonly references: readonly JudgmentViewProblemReference[];
}

export interface JudgmentViewProblemReference {
  readonly kind: string;
  readonly id: string;
  readonly revision: string;
  readonly digest: string;
}

export interface JudgmentViewCriterion {
  readonly variableRef: FoundationRef;
  readonly operator: FoundationOperator;
  readonly target?: string | number | boolean;
  readonly variable: {
    readonly meaning: string;
    readonly subject: string;
    readonly valueKind: VariableDefinition['valueKind'];
    readonly unit?: string;
    readonly aggregation: VariableDefinition['aggregation'];
    readonly granularity: string;
  };
}

export interface JudgmentViewObjective {
  readonly ref: FoundationRef;
  readonly meaning: string;
  readonly desiredState: string;
  readonly adoptionState: ObjectiveDefinition['adoptionState'];
  readonly epistemicState?: ObjectiveDefinition['epistemicState'];
  readonly beneficiaryIds: readonly string[];
  readonly criteria: JudgmentViewCollection<JudgmentViewCriterion>;
}

export interface JudgmentViewEvidence {
  readonly source: 'subdag';
  readonly invocationId: string;
  readonly runId?: string;
  readonly kind: string;
  readonly id: string;
  readonly revision?: string;
}

export interface JudgmentViewChildRun {
  readonly invocationId: string;
  readonly dag: JudgmentDAGVersionReference;
  readonly status: JudgmentDAGSubDAGRunRecord['result']['status'];
  readonly question: string;
  readonly runId?: string;
  readonly conclusion: JudgmentDAGSubDAGRunRecord['result']['conclusion'];
  readonly uncertainty: JudgmentDAGSubDAGRunRecord['result']['uncertainty'];
  readonly applicability: JudgmentDAGSubDAGRunRecord['result']['applicability'];
  readonly reason?: string;
}

export interface JudgmentViewResultEvaluation {
  readonly evaluationId: string;
  readonly achievement: EvaluationResultStatus;
  readonly criteria: CompanyOsEvaluationRecord['criteria'];
  readonly predictionComparisons: readonly PredictionComparison[];
  readonly evaluatedAt: string;
  readonly outcomeCaseRef: CompanyOsEvaluationRecord['outcomeCaseRef'];
}

export interface JudgmentViewJudgmentValidity {
  readonly status: EvaluationJudgmentValidity;
  readonly basis: string;
  readonly evidenceRefs: readonly string[];
}

export interface JudgmentViewDocument {
  readonly contract_version: typeof JUDGMENT_VIEW_CONTRACT_VERSION;
  readonly mode: 'historical';
  readonly status: JudgmentViewStatus;
  readonly reason?: string;
  readonly run: JudgmentViewSection<JudgmentViewRun>;
  readonly conclusion: JudgmentViewSection<JudgmentViewConclusion>;
  readonly problem: JudgmentViewSection<JudgmentViewProblem>;
  readonly objective: JudgmentViewSection<JudgmentViewObjective>;
  readonly evidence: JudgmentViewCollection<JudgmentViewEvidence>;
  readonly childRuns: JudgmentViewCollection<JudgmentViewChildRun>;
  readonly resultEvaluation: JudgmentViewSection<JudgmentViewResultEvaluation>;
  readonly judgmentValidity: JudgmentViewSection<JudgmentViewJudgmentValidity>;
}

type MutableJudgmentViewDocument = {
  -readonly [K in keyof JudgmentViewDocument]: JudgmentViewDocument[K];
};

interface RecordLike {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is RecordLike {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isStatus(value: unknown): value is JudgmentViewStatus {
  return typeof value === 'string' && (JUDGMENT_VIEW_STATUSES as readonly string[]).includes(value);
}

function failure(status: JudgmentViewFailureStatus, reason: string): JudgmentViewReadFailure {
  return { status, reason };
}

function sectionFailure(result: JudgmentViewReadFailure): JudgmentViewSection<never> {
  return { status: result.status, reason: result.reason };
}

function collectionFailure(result: JudgmentViewReadFailure): JudgmentViewCollection<never> {
  return { status: result.status, items: null, absence_confirmed: false, reason: result.reason };
}

function resolvedSection<T>(value: T): JudgmentViewSection<T> {
  return { status: 'resolved', value };
}

function resolvedCollection<T>(items: readonly T[]): JudgmentViewCollection<T> {
  return { status: 'resolved', items, absence_confirmed: items.length === 0 };
}

function unknownCollection(reason: string): JudgmentViewCollection<never> {
  return { status: 'unknown', items: null, absence_confirmed: false, reason };
}

function statusFromResult<T>(result: JudgmentViewPortResult<T>): JudgmentViewStatus {
  return result.status;
}

function safeReason(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : 'read failed';
}

async function safeRead<T>(reader: () => JudgmentViewPortResult<T> | Promise<JudgmentViewPortResult<T>>): Promise<JudgmentViewPortResult<T>> {
  try {
    const result = await reader();
    if (!isRecord(result) || result.status === 'resolved' && !hasOwn(result, 'value')) {
      return failure('unknown', 'read port returned an invalid result');
    }
    if (result.status !== 'resolved') {
      if (!isStatus(result.status) || !nonEmptyString(result.reason)) {
        return failure('unknown', 'read port returned an invalid failure');
      }
      return { status: result.status, reason: result.reason };
    }
    return { status: 'resolved', value: result.value as T };
  } catch (error) {
    return failure('unavailable', safeReason(error));
  }
}

function validDAGReference(value: unknown): value is JudgmentDAGVersionReference {
  return isRecord(value) && nonEmptyString(value.id) && nonEmptyString(value.version);
}

function validProblemReference(value: unknown): value is JudgmentDAGProblemSnapshotReference {
  return isRecord(value)
    && nonEmptyString(value.snapshot_id)
    && nonEmptyString(value.problem_id)
    && nonEmptyString(value.revision);
}

function sameProblemReference(left: JudgmentDAGProblemSnapshotReference, right: JudgmentDAGProblemSnapshotReference): boolean {
  return left.snapshot_id === right.snapshot_id
    && left.problem_id === right.problem_id
    && left.revision === right.revision;
}

function validEvidenceReference(value: unknown): value is JudgmentDAGEvidenceReference {
  return isRecord(value)
    && nonEmptyString(value.kind)
    && nonEmptyString(value.id)
    && (value.revision === undefined || nonEmptyString(value.revision));
}

function validSubdagResult(value: unknown): value is JudgmentDAGSubDAGRunRecord['result'] {
  if (!isRecord(value)
    || !['completed', 'failed', 'held'].includes(String(value.status))
    || !nonEmptyString(value.input_contract)
    || !nonEmptyString(value.output_contract)
    || !Array.isArray(value.evidence)) {
    return false;
  }
  if (value.run_reference !== null && value.run_reference !== undefined) {
    if (!isRecord(value.run_reference) || !nonEmptyString(value.run_reference.run_id) || !validDAGReference(value.run_reference.dag)) return false;
  }
  if (!Array.isArray(value.evidence) || value.evidence.some((item) => !validEvidenceReference(item))) return false;
  if (value.reason !== undefined && typeof value.reason !== 'string') return false;
  return true;
}

function validateCompositionRun(value: unknown, expectedRunId: string): value is JudgmentDAGCompositionRunRecord {
  if (!isRecord(value)
    || value.run_id !== expectedRunId
    || !validDAGReference(value.composition)
    || !validDAGReference(value.parent_dag)
    || !nonEmptyString(value.question)
    || !validProblemReference(value.problem_snapshot)
    || !['completed', 'failed', 'held'].includes(String(value.status))
    || !Array.isArray(value.execution_order)
    || value.execution_order.some((item) => !nonEmptyString(item))
    || !Array.isArray(value.children)) {
    return false;
  }
  return value.children.every((child) => {
    if (!isRecord(child)
      || !nonEmptyString(child.invocation_id)
      || !validDAGReference(child.dag)
      || !nonEmptyString(child.question)
      || !nonEmptyString(child.input_contract)
      || !nonEmptyString(child.output_contract)
      || !validProblemReference(child.problem_snapshot)
      || !Array.isArray(child.dependency_invocation_ids)
      || child.dependency_invocation_ids.some((item) => !nonEmptyString(item))
      || !Array.isArray(child.dependency_results)
      || !validSubdagResult(child.result)) {
      return false;
    }
    if (!sameProblemReference(child.problem_snapshot, value.problem_snapshot as JudgmentDAGProblemSnapshotReference)) return false;
    return true;
  });
}

function validateSnapshot(value: unknown, expected: JudgmentDAGProblemSnapshotReference): value is JudgmentProblemSnapshot {
  if (!isRecord(value)
    || value.snapshot_version !== 'judgment-problem-snapshot.v1'
    || value.problem_id !== expected.problem_id
    || value.revision !== expected.revision
    || !nonEmptyString(value.question)
    || !Array.isArray(value.references)) {
    return false;
  }
  return value.references.every((reference) => (
    isRecord(reference)
      && nonEmptyString(reference.kind)
      && nonEmptyString(reference.id)
      && nonEmptyString(reference.revision)
      && nonEmptyString(reference.digest)
  ));
}

function validFoundationRef(value: unknown, type?: FoundationType): value is FoundationRef {
  return isRecord(value)
    && nonEmptyString(value.id)
    && nonEmptyString(value.revision)
    && nonEmptyString(value.digest)
    && (type === undefined || value.type === type);
}

function validFoundationRecord(value: unknown, reference: FoundationRef): value is FoundationCatalogRecord {
  if (!isRecord(value) || !nonEmptyString(value.digest) || value.digest !== reference.digest || !isRecord(value.definition)) return false;
  const definition = value.definition;
  return definition.id === reference.id && definition.type === reference.type && definition.revision === reference.revision;
}

function sameFoundationRef(left: FoundationRef, right: FoundationRef): boolean {
  return left.id === right.id && left.type === right.type && left.revision === right.revision && left.digest === right.digest;
}

function asFoundationRef(reference: RecordLike): FoundationRef {
  return {
    id: reference.id as string,
    type: reference.type as FoundationType,
    revision: reference.revision as string,
    digest: reference.digest as string,
  };
}

function isObjectiveDefinition(value: FoundationDefinition): value is ObjectiveDefinition {
  return value.type === 'objective';
}

function isVariableDefinition(value: FoundationDefinition): value is VariableDefinition {
  return value.type === 'variable';
}

function validObjectiveCriterion(value: unknown): value is ObjectiveCriterion {
  return isRecord(value)
    && isRecord(value.variableRef)
    && value.variableRef.type === 'variable'
    && nonEmptyString(value.variableRef.id)
    && nonEmptyString(value.variableRef.revision)
    && ['at_least', 'at_most', 'equals'].includes(String(value.operator))
    && (value.target === undefined || typeof value.target === 'string' || typeof value.target === 'number' || typeof value.target === 'boolean');
}

function extractConclusion(
  artifact: JudgmentDAGRunRecord,
  runId: string,
  dag: JudgmentDAGVersionReference,
): JudgmentViewConclusion | null {
  if (!isRecord(artifact)
    || artifact.run_id !== runId
    || !validDAGReference(artifact.dag)
    || artifact.dag.id !== dag.id
    || artifact.dag.version !== dag.version
    || !Array.isArray(artifact.execution_order)
    || !Array.isArray(artifact.nodes)
    || artifact.execution_order.length === 0) {
    return null;
  }
  const finalNodeId = artifact.execution_order[artifact.execution_order.length - 1];
  if (!nonEmptyString(finalNodeId)) return null;
  const finalNode = artifact.nodes.find((node) => isRecord(node) && node.node_id === finalNodeId);
  if (!finalNode || !hasOwn(finalNode, 'output')) return null;
  return {
    source: 'parent-run-artifact',
    runId,
    dag,
    value: finalNode.output,
  };
}

function sectionStatus<T>(section: JudgmentViewSection<T>): JudgmentViewStatus {
  return section.status;
}

function collectionStatus<T>(collection: JudgmentViewCollection<T>): JudgmentViewStatus {
  return collection.status;
}

function aggregateStatus(sections: readonly (JudgmentViewSection<unknown> | JudgmentViewCollection<unknown>)[]): JudgmentViewStatus {
  const statuses = sections.map((section) => sectionStatus(section as JudgmentViewSection<unknown>) ?? collectionStatus(section as JudgmentViewCollection<unknown>));
  if (statuses.includes('invalid')) return 'invalid';
  if (statuses.includes('permission_denied')) return 'permission_denied';
  if (statuses.includes('unavailable')) return 'unavailable';
  if (statuses.includes('unknown')) return 'unknown';
  if (statuses.includes('undecidable')) return 'undecidable';
  return 'resolved';
}

function baseDocument(status: JudgmentViewStatus, reason?: string): JudgmentViewDocument {
  return {
    contract_version: JUDGMENT_VIEW_CONTRACT_VERSION,
    mode: 'historical',
    status,
    ...(reason ? { reason } : {}),
    run: { status, reason },
    conclusion: { status, reason },
    problem: { status, reason },
    objective: { status, reason },
    evidence: { status, items: null, absence_confirmed: false, reason },
    childRuns: { status, items: null, absence_confirmed: false, reason },
    resultEvaluation: { status, reason },
    judgmentValidity: { status, reason },
  };
}

function buildRunView(run: JudgmentDAGCompositionRunRecord): JudgmentViewRun {
  return {
    runId: run.run_id,
    status: run.status,
    question: run.question,
    composition: run.composition,
    parentDag: run.parent_dag,
    problemSnapshot: run.problem_snapshot,
  };
}

function buildProblemView(snapshot: JudgmentProblemSnapshot, reference: JudgmentDAGProblemSnapshotReference): JudgmentViewProblem {
  return {
    snapshotId: reference.snapshot_id,
    problemId: snapshot.problem_id,
    revision: snapshot.revision,
    question: snapshot.question,
    references: snapshot.references.map((item) => ({
      kind: item.kind,
      id: item.id,
      revision: item.revision,
      digest: item.digest,
    })),
  };
}

function buildChildView(child: JudgmentDAGSubDAGRunRecord): JudgmentViewChildRun {
  return {
    invocationId: child.invocation_id,
    dag: child.dag,
    status: child.result.status,
    question: child.question,
    ...(child.result.run_reference?.run_id ? { runId: child.result.run_reference.run_id } : {}),
    conclusion: child.result.conclusion,
    uncertainty: child.result.uncertainty,
    applicability: child.result.applicability,
    ...(child.result.reason ? { reason: child.result.reason } : {}),
  };
}

async function buildObjectiveView(
  snapshot: JudgmentProblemSnapshot,
  access: JudgmentViewAccessContext,
  port: JudgmentViewReadPort,
): Promise<JudgmentViewSection<JudgmentViewObjective>> {
  const objectiveReferences = snapshot.references.filter((reference) => reference.kind === 'objective');
  if (objectiveReferences.length === 0) return { status: 'unknown', reason: 'objective reference is absent from the historical snapshot' };
  if (objectiveReferences.length !== 1) return { status: 'invalid', reason: 'historical snapshot must contain exactly one objective reference' };
  const objectiveReference = objectiveReferences[0];
  const foundationReference: FoundationRef = {
    id: objectiveReference.id,
    type: 'objective',
    revision: objectiveReference.revision,
    digest: objectiveReference.digest,
  };
  const objectiveResult = await safeRead(() => port.readFoundationReference({
    reference: foundationReference,
    access,
    resolution: 'historical',
  }));
  if (objectiveResult.status !== 'resolved') return sectionFailure(objectiveResult);
  if (!validFoundationRecord(objectiveResult.value, foundationReference) || !isObjectiveDefinition(objectiveResult.value.definition)) {
    return { status: 'invalid', reason: 'historical objective reference readback does not match the requested objective' };
  }
  const objective = objectiveResult.value.definition;
  if (!Array.isArray(objective.criteria) || objective.criteria.some((criterion) => !validObjectiveCriterion(criterion))) {
    return { status: 'invalid', reason: 'objective criteria are malformed' };
  }
  const variableReferences = snapshot.references.filter((reference) => reference.kind === 'variable');
  const criteria: JudgmentViewCriterion[] = [];
  for (const criterion of objective.criteria) {
    const variableReference = criterion.variableRef;
    const matches = variableReferences.filter((reference) => (
      reference.id === variableReference.id && reference.revision === variableReference.revision
    ));
    if (matches.length !== 1) return { status: 'unknown', reason: 'a criterion variable is not pinned in the historical snapshot' };
    const requestedVariable: FoundationRef = {
      id: matches[0].id,
      type: 'variable',
      revision: matches[0].revision,
      digest: matches[0].digest,
    };
    const variableResult = await safeRead(() => port.readFoundationReference({
      reference: requestedVariable,
      access,
      resolution: 'historical',
    }));
    if (variableResult.status !== 'resolved') return sectionFailure(variableResult);
    if (!validFoundationRecord(variableResult.value, requestedVariable) || !isVariableDefinition(variableResult.value.definition)) {
      return { status: 'invalid', reason: 'historical criterion variable readback does not match the requested variable' };
    }
    const variable = variableResult.value.definition;
    criteria.push({
      variableRef: requestedVariable,
      operator: criterion.operator,
      ...(criterion.target === undefined ? {} : { target: criterion.target }),
      variable: {
        meaning: variable.meaning,
        subject: variable.subject,
        valueKind: variable.valueKind,
        ...(variable.unit === undefined ? {} : { unit: variable.unit }),
        aggregation: variable.aggregation,
        granularity: variable.granularity,
      },
    });
  }
  return resolvedSection({
    ref: foundationReference,
    meaning: objective.meaning,
    desiredState: objective.desiredState,
    adoptionState: objective.adoptionState,
    ...(objective.epistemicState === undefined ? {} : { epistemicState: objective.epistemicState }),
    beneficiaryIds: objective.beneficiaryIds,
    criteria: resolvedCollection(criteria),
  });
}

function buildEvidenceCollection(run: JudgmentDAGCompositionRunRecord): JudgmentViewCollection<JudgmentViewEvidence> {
  const evidence: JudgmentViewEvidence[] = [];
  for (const child of run.children) {
    for (const reference of child.result.evidence) {
      evidence.push({
        source: 'subdag',
        invocationId: child.invocation_id,
        ...(child.result.run_reference?.run_id ? { runId: child.result.run_reference.run_id } : {}),
        kind: reference.kind,
        id: reference.id,
        ...(reference.revision === undefined ? {} : { revision: reference.revision }),
      });
    }
  }
  return resolvedCollection(evidence);
}

function validEvaluationRecord(value: unknown): value is CompanyOsEvaluationRecord {
  if (!isRecord(value)
    || value.version !== 1
    || !nonEmptyString(value.id)
    || !isRecord(value.snapshot)
    || !isRecord(value.objectiveRef)
    || !isRecord(value.outcomeCaseRef)
    || !Array.isArray(value.predictions)
    || !Array.isArray(value.actuals)
    || !Array.isArray(value.criteria)
    || !Array.isArray(value.predictionComparisons)
    || !['achieved', 'not_achieved', 'indeterminate'].includes(String(value.achievement))
    || !isRecord(value.judgmentAtTimeValidity)
    || !['valid', 'invalid', 'indeterminate'].includes(String(value.judgmentAtTimeValidity.status))
    || !nonEmptyString(value.judgmentAtTimeValidity.basis)
    || !nonEmptyString(value.evaluatedAt)) return false;
  if (!nonEmptyString(value.snapshot.snapshotId) || !nonEmptyString(value.snapshot.problemId) || !nonEmptyString(value.snapshot.revision)) return false;
  if (!validFoundationRef(value.objectiveRef, 'objective')) return false;
  if (!nonEmptyString(value.outcomeCaseRef.id) || !nonEmptyString(value.outcomeCaseRef.revision) || !nonEmptyString(value.outcomeCaseRef.digest)) return false;
  if (value.judgmentAtTimeValidity.evidenceRefs !== undefined
    && (!Array.isArray(value.judgmentAtTimeValidity.evidenceRefs)
      || value.judgmentAtTimeValidity.evidenceRefs.some((item) => !nonEmptyString(item)))) return false;
  return true;
}

function sameEvaluationSnapshot(
  evaluation: CompanyOsEvaluationRecord,
  snapshot: JudgmentDAGProblemSnapshotReference,
): boolean {
  return evaluation.snapshot.snapshotId === snapshot.snapshot_id
    && evaluation.snapshot.problemId === snapshot.problem_id
    && evaluation.snapshot.revision === snapshot.revision;
}

function buildEvaluationSections(
  evaluation: CompanyOsEvaluationRecord,
  objective: FoundationRef,
): {
  resultEvaluation: JudgmentViewSection<JudgmentViewResultEvaluation>;
  judgmentValidity: JudgmentViewSection<JudgmentViewJudgmentValidity>;
} {
  if (!sameFoundationRef(evaluation.objectiveRef, objective)) {
    return {
      resultEvaluation: { status: 'invalid', reason: 'evaluation objective reference differs from the historical objective' },
      judgmentValidity: { status: 'invalid', reason: 'evaluation objective reference differs from the historical objective' },
    };
  }
  if (!Array.isArray(evaluation.criteria)
    || !Array.isArray(evaluation.predictionComparisons)
    || evaluation.criteria.some((item) => !isRecord(item))
    || evaluation.predictionComparisons.some((item) => !isRecord(item))) {
    return {
      resultEvaluation: { status: 'invalid', reason: 'evaluation arrays are malformed' },
      judgmentValidity: { status: 'invalid', reason: 'evaluation arrays are malformed' },
    };
  }
  return {
    resultEvaluation: resolvedSection({
      evaluationId: evaluation.id,
      achievement: evaluation.achievement,
      criteria: evaluation.criteria,
      predictionComparisons: evaluation.predictionComparisons,
      evaluatedAt: evaluation.evaluatedAt,
      outcomeCaseRef: evaluation.outcomeCaseRef,
    }),
    judgmentValidity: resolvedSection({
      status: evaluation.judgmentAtTimeValidity.status,
      basis: evaluation.judgmentAtTimeValidity.basis,
      evidenceRefs: evaluation.judgmentAtTimeValidity.evidenceRefs ?? [],
    }),
  };
}

function requestIsValid(request: JudgmentViewReadRequest): boolean {
  return isRecord(request)
    && nonEmptyString(request.runId)
    && isRecord(request.access)
    && nonEmptyString(request.access.tenantId)
    && nonEmptyString(request.access.principal)
    && nonEmptyString(request.access.scopeId)
    && (request.evaluationId === undefined || nonEmptyString(request.evaluationId));
}

export interface JudgmentViewService {
  readonly read: (request: JudgmentViewReadRequest) => Promise<JudgmentViewDocument>;
}

export function createJudgmentViewService(port: JudgmentViewReadPort): JudgmentViewService {
  if (!port || typeof port !== 'object') throw new TypeError('A judgment view read port is required');
  for (const method of ['readCompositionRun', 'readProblemSnapshot', 'readFoundationReference', 'readRunArtifact']) {
    if (typeof port[method as keyof JudgmentViewReadPort] !== 'function') {
      throw new TypeError(`${method} is required`);
    }
  }

  return {
    async read(request): Promise<JudgmentViewDocument> {
      if (!requestIsValid(request)) return baseDocument('invalid', 'runId and trusted access context are required');
      const runResult = await safeRead(() => port.readCompositionRun({ runId: request.runId, access: request.access }));
      if (runResult.status !== 'resolved') return baseDocument(runResult.status, runResult.reason);
      if (!validateCompositionRun(runResult.value, request.runId)) return baseDocument('invalid', 'composition run record is malformed');
      const run = runResult.value;
      const runSection = resolvedSection(buildRunView(run));
      const childRuns = resolvedCollection(run.children.map(buildChildView));
      const evidence = buildEvidenceCollection(run);
      const problemResult = await safeRead(() => port.readProblemSnapshot({
        reference: run.problem_snapshot,
        access: request.access,
        resolution: 'historical',
      }));
      const document: MutableJudgmentViewDocument = {
        contract_version: JUDGMENT_VIEW_CONTRACT_VERSION,
        mode: 'historical',
        status: 'unknown',
        run: runSection,
        conclusion: { status: 'unknown', reason: 'parent run artifact is not available' },
        problem: problemResult.status === 'resolved'
          && validateSnapshot(problemResult.value, run.problem_snapshot)
          ? resolvedSection(buildProblemView(problemResult.value, run.problem_snapshot))
          : problemResult.status === 'resolved'
            ? { status: 'invalid', reason: 'problem snapshot readback does not match the composition run' }
            : sectionFailure(problemResult),
        objective: { status: 'unknown', reason: 'historical Problem snapshot is unavailable' },
        evidence,
        childRuns,
        resultEvaluation: { status: 'unknown', reason: 'evaluation is not available' },
        judgmentValidity: { status: 'unknown', reason: 'evaluation is not available' },
      };

      const artifactResult = await safeRead(() => port.readRunArtifact({
        runId: run.run_id,
        dag: run.parent_dag,
        access: request.access,
        resolution: 'historical',
      }));
      if (artifactResult.status === 'resolved') {
        const conclusion = extractConclusion(artifactResult.value, run.run_id, run.parent_dag);
        document.conclusion = conclusion ? resolvedSection(conclusion) : { status: 'invalid', reason: 'parent run artifact does not match the historical run' };
      } else {
        document.conclusion = sectionFailure(artifactResult);
      }

      if (document.problem.status === 'resolved' && problemResult.status === 'resolved' && validateSnapshot(problemResult.value, run.problem_snapshot)) {
        document.objective = await buildObjectiveView(problemResult.value, request.access, port);
      }

      if (port.readEvaluation && document.problem.status === 'resolved' && document.objective.status === 'resolved') {
        const objective = document.objective.value?.ref;
        if (objective) {
          const evaluationResult = await safeRead(() => port.readEvaluation!({
            runId: run.run_id,
            snapshot: run.problem_snapshot,
            objective,
            ...(request.evaluationId ? { evaluationId: request.evaluationId } : {}),
            access: request.access,
            resolution: 'historical',
          }));
          if (evaluationResult.status === 'resolved') {
            if (!validEvaluationRecord(evaluationResult.value) || !sameEvaluationSnapshot(evaluationResult.value, run.problem_snapshot)) {
              document.resultEvaluation = { status: 'invalid', reason: 'evaluation readback does not match the historical Problem snapshot' };
              document.judgmentValidity = { status: 'invalid', reason: 'evaluation readback does not match the historical Problem snapshot' };
            } else {
              const sections = buildEvaluationSections(evaluationResult.value, objective);
              document.resultEvaluation = sections.resultEvaluation;
              document.judgmentValidity = sections.judgmentValidity;
            }
          } else {
            document.resultEvaluation = sectionFailure(evaluationResult);
            document.judgmentValidity = sectionFailure(evaluationResult);
          }
        }
      }

      const status = aggregateStatus([
        document.run,
        document.conclusion,
        document.problem,
        document.objective,
        document.evidence,
        document.childRuns,
        document.resultEvaluation,
        document.judgmentValidity,
      ]);
      const reasons = [
        document.conclusion.reason,
        document.problem.reason,
        document.objective.reason,
        document.resultEvaluation.reason,
        document.judgmentValidity.reason,
      ].filter((reason): reason is string => nonEmptyString(reason));
      document.status = status;
      if (reasons.length > 0) document.reason = reasons[0];
      return document;
    },
  };
}

export async function readJudgmentView(
  port: JudgmentViewReadPort,
  request: JudgmentViewReadRequest,
): Promise<JudgmentViewDocument> {
  return createJudgmentViewService(port).read(request);
}
