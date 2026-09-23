/**
 * Contract for composing versioned Judgment DAGs into one parent judgment.
 *
 * This module intentionally has no persistence or host adapter dependency.
 * It validates the composition, freezes the evaluation boundary, and records
 * the result of each child without changing the J0 single-DAG run artifact.
 */

import {
  JUDGMENT_DAG_SCOPE_TYPES,
  type JudgmentDAGScope,
  type JudgmentDAGScopeType
} from './judgment-dag-core.js';
import type { JudgmentDAGRunArtifactId } from './judgment-dag-artifact-store.js';
import type { JudgmentDAGJSONValue } from './judgment-dag-runner.js';

export const JUDGMENT_DAG_COMPOSITION_VERSION = 'judgment-dag-composition.v1' as const;

export const JUDGMENT_DAG_COMPOSITION_STATUSES = Object.freeze([
  'completed',
  'failed',
  'held'
] as const);

export type JudgmentDAGCompositionStatus =
  (typeof JUDGMENT_DAG_COMPOSITION_STATUSES)[number];

export const JUDGMENT_DAG_SUBDAG_STATUSES = Object.freeze([
  'completed',
  'failed',
  'held'
] as const);

export type JudgmentDAGSubDAGStatus = (typeof JUDGMENT_DAG_SUBDAG_STATUSES)[number];

export interface JudgmentDAGVersionReference {
  readonly id: string;
  readonly version: string;
}

/**
 * The immutable JudgmentProblem snapshot selected for this composition.
 *
 * The snapshot itself remains owned by Story05's store. Composition records
 * carry this exact locator so a later read cannot silently follow a newer
 * problem revision.
 */
export type JudgmentDAGProblemSnapshotId = `sha256:${string}`;

export interface JudgmentDAGProblemSnapshotReference {
  readonly snapshot_id: JudgmentDAGProblemSnapshotId;
  readonly problem_id: string;
  readonly revision: string;
}

export interface JudgmentDAGProblemSnapshotReadRequest {
  readonly mode: 'read';
  /** Composition execution must revalidate canonical references at read time. */
  readonly reference_resolution: 'current';
  readonly reference: JudgmentDAGProblemSnapshotReference;
}

/**
 * A Story05 adapter used by a new composition run must return a snapshot
 * validated with `reference_resolution: 'current'` and a canonical reference
 * provider. The coordinator checks the locator and identity fields; the
 * adapter owns the actual store lookup and current authorization/existence
 * check. `historical` resolution is for audit/replay only and cannot satisfy
 * this execution reader contract.
 */
export interface JudgmentDAGProblemSnapshotReadResult {
  readonly status: 'resolved';
  /** Historical snapshot replay is an audit path, not an execution input. */
  readonly reference_resolution: 'current';
  readonly reference: JudgmentDAGProblemSnapshotReference;
  readonly snapshot: JudgmentDAGJSONValue;
}

export interface JudgmentDAGProblemSnapshotReader {
  readonly read: (
    request: JudgmentDAGProblemSnapshotReadRequest
  ) => JudgmentDAGProblemSnapshotReadResult | Promise<JudgmentDAGProblemSnapshotReadResult>;
}

export interface JudgmentDAGVersionResolution {
  readonly dag: JudgmentDAGVersionReference;
  readonly input_contract: string;
  readonly output_contract: string;
}

export interface JudgmentDAGVersionResolverRequest {
  readonly role: 'parent' | 'child';
  readonly invocation_id?: string;
  readonly dag: JudgmentDAGVersionReference;
}

export interface JudgmentDAGVersionResolver {
  readonly resolve: (
    request: JudgmentDAGVersionResolverRequest
  ) => JudgmentDAGVersionResolution | Promise<JudgmentDAGVersionResolution>;
}

export interface JudgmentDAGInputOutputContractValidationRequest {
  readonly role: 'child';
  readonly invocation_id: string;
  readonly dag: JudgmentDAGVersionReference;
  readonly input_contract: string;
  readonly output_contract: string;
}

export interface JudgmentDAGInputOutputContractValidator {
  readonly validate: (
    request: JudgmentDAGInputOutputContractValidationRequest
  ) => void | Promise<void>;
}

export interface JudgmentDAGRunArtifactReadRequest {
  readonly artifact_id: JudgmentDAGRunArtifactId;
  readonly expected_run_id: string;
  readonly expected_dag: JudgmentDAGVersionReference;
}

/**
 * The adapter should delegate to loadJudgmentDAGRunArtifact (or an equivalent
 * integrity-checking reader). The coordinator only checks identity fields
 * after that readback; it never treats an artifact id as proof by itself.
 */
export interface JudgmentDAGRunArtifactReader {
  readonly read: (
    request: JudgmentDAGRunArtifactReadRequest
  ) => unknown | Promise<unknown>;
}

export interface JudgmentDAGSubDAGDefinition {
  readonly invocation_id: string;
  readonly dag: JudgmentDAGVersionReference;
  readonly question: string;
  readonly input_contract: string;
  readonly output_contract: string;
  readonly required_capabilities: readonly string[];
  readonly depends_on: readonly string[];
}

export interface JudgmentDAGCompositionDefinition {
  readonly composition_id: string;
  readonly composition_version: string;
  readonly scope: JudgmentDAGScope;
  readonly parent_dag: JudgmentDAGVersionReference;
  readonly children: readonly JudgmentDAGSubDAGDefinition[];
}

export interface JudgmentDAGDelegationScope {
  readonly scope: JudgmentDAGScope;
  readonly capabilities: readonly string[];
}

export interface JudgmentDAGRunReference {
  readonly run_id: string;
  readonly dag: JudgmentDAGVersionReference;
  readonly artifact_id?: JudgmentDAGRunArtifactId;
}

export interface JudgmentDAGEvidenceReference {
  readonly kind: string;
  readonly id: string;
  readonly revision?: string;
}

export interface JudgmentDAGSubDAGResult {
  readonly status: JudgmentDAGSubDAGStatus;
  readonly input_contract: string;
  readonly output_contract: string;
  readonly run_reference: JudgmentDAGRunReference | null;
  readonly conclusion: JudgmentDAGJSONValue;
  readonly evidence: readonly JudgmentDAGEvidenceReference[];
  readonly applicability: JudgmentDAGJSONValue;
  readonly uncertainty: JudgmentDAGJSONValue;
  readonly reason?: string;
}

export interface JudgmentDAGCompositionChildRunSource {
  readonly invocation_id: string;
  readonly result: JudgmentDAGSubDAGResult;
}

export interface JudgmentDAGSubDAGRunRecord {
  readonly invocation_id: string;
  readonly dag: JudgmentDAGVersionReference;
  readonly question: string;
  readonly input_contract: string;
  readonly output_contract: string;
  readonly input: JudgmentDAGJSONValue;
  readonly problem_snapshot: JudgmentDAGProblemSnapshotReference;
  readonly fixed_conditions: JudgmentDAGJSONValue;
  readonly delegation: JudgmentDAGDelegationScope;
  readonly dependency_invocation_ids: readonly string[];
  readonly dependency_results: readonly JudgmentDAGCompositionChildRunSource[];
  readonly result: JudgmentDAGSubDAGResult;
}

export interface JudgmentDAGCompositionRunRecord {
  readonly run_id: string;
  readonly composition: JudgmentDAGVersionReference;
  readonly parent_dag: JudgmentDAGVersionReference;
  readonly question: string;
  readonly input: JudgmentDAGJSONValue;
  readonly problem_snapshot: JudgmentDAGProblemSnapshotReference;
  readonly fixed_conditions: JudgmentDAGJSONValue;
  readonly delegation: JudgmentDAGDelegationScope;
  readonly execution_order: readonly string[];
  readonly status: JudgmentDAGCompositionStatus;
  readonly children: readonly JudgmentDAGSubDAGRunRecord[];
}

export interface JudgmentDAGSubDAGExecutionRequest {
  readonly mode: 'evaluation';
  readonly parent_run_id: string;
  readonly composition: JudgmentDAGVersionReference;
  readonly invocation_id: string;
  readonly dag: JudgmentDAGVersionReference;
  readonly question: string;
  readonly input: JudgmentDAGJSONValue;
  readonly problem_snapshot: JudgmentDAGProblemSnapshotReference;
  readonly fixed_conditions: JudgmentDAGJSONValue;
  readonly delegation: JudgmentDAGDelegationScope;
  readonly dependency_results: readonly JudgmentDAGCompositionChildRunSource[];
}

export interface JudgmentDAGSubDAGEvaluationPort {
  readonly execute: (
    request: JudgmentDAGSubDAGExecutionRequest
  ) => JudgmentDAGSubDAGResult | Promise<JudgmentDAGSubDAGResult>;
}

/** Alias kept for callers that model the boundary as an execution port. */
export type JudgmentDAGSubDAGExecutionPort = JudgmentDAGSubDAGEvaluationPort;

export interface JudgmentDAGCompositionRunRequest {
  readonly run_id: string;
  readonly composition: JudgmentDAGCompositionDefinition;
  readonly question: string;
  readonly input: JudgmentDAGJSONValue;
  readonly problem_snapshot: JudgmentDAGProblemSnapshotReference;
  readonly fixed_conditions: JudgmentDAGJSONValue;
  readonly delegation: JudgmentDAGDelegationScope;
  readonly snapshot_reader: JudgmentDAGProblemSnapshotReader;
  readonly dag_resolver: JudgmentDAGVersionResolver;
  readonly contract_validator: JudgmentDAGInputOutputContractValidator;
  readonly artifact_reader?: JudgmentDAGRunArtifactReader;
  readonly port: JudgmentDAGSubDAGEvaluationPort;
}

export type JudgmentDAGCompositionErrorCode =
  | 'invalid_contract'
  | 'duplicate_invocation'
  | 'missing_dependency'
  | 'cycle'
  | 'scope_mismatch'
  | 'capability_violation'
  | 'dag_mismatch'
  | 'dag_unavailable'
  | 'contract_mismatch'
  | 'snapshot_unavailable'
  | 'artifact_readback_failed'
  | 'invalid_child_result'
  | 'executor_failed';

export interface JudgmentDAGCompositionErrorDetails {
  readonly invocation_id?: string;
  readonly dependency_id?: string;
  readonly cycle?: readonly string[];
}

export class JudgmentDAGCompositionError extends Error {
  readonly code: JudgmentDAGCompositionErrorCode;
  readonly invocation_id?: string;
  readonly dependency_id?: string;
  readonly cycle?: readonly string[];

  constructor(
    code: JudgmentDAGCompositionErrorCode,
    message: string,
    details: JudgmentDAGCompositionErrorDetails = {}
  ) {
    super(message);
    this.name = 'JudgmentDAGCompositionError';
    this.code = code;
    this.invocation_id = details.invocation_id;
    this.dependency_id = details.dependency_id;
    this.cycle = details.cycle;
  }
}

export interface JudgmentDAGCompositionValidationResult {
  readonly valid: true;
  readonly composition_id: string;
  readonly composition_version: string;
  readonly execution_order: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function isSafeString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001F\u007F]/u.test(value);
}

function invalidContract(message: string): never {
  throw new JudgmentDAGCompositionError('invalid_contract', message);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    invalidContract(`${path} must be a plain object`);
  }
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      invalidContract(`${path}.${key} is not an allowed contract field`);
    }
  }
}

function requireString(value: unknown, path: string): string {
  if (!isSafeString(value)) {
    invalidContract(`${path} must be a non-empty string without control characters`);
  }
  return value;
}

function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    invalidContract(`${path} must be an array`);
  }
  return value;
}

function snapshotJSON(
  value: unknown,
  path: string,
  active: Set<object> = new Set()
): JudgmentDAGJSONValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      return value;
    }
    invalidContract(`${path} must contain only finite JSON numbers`);
  }
  if (typeof value !== 'object') {
    invalidContract(`${path} must be a JSON value`);
  }

  const objectValue = value as object;
  if (active.has(objectValue)) {
    invalidContract(`${path} must not contain cyclic values`);
  }
  active.add(objectValue);

  try {
    if (Array.isArray(value)) {
      const result: JudgmentDAGJSONValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          invalidContract(`${path}[${index}] must be defined`);
        }
        result.push(snapshotJSON(value[index], `${path}[${index}]`, active));
      }
      return result;
    }
    if (!isPlainRecord(value)) {
      invalidContract(`${path} must contain only plain objects`);
    }
    const result: Record<string, JudgmentDAGJSONValue> = {};
    for (const key of Object.keys(value)) {
      result[key] = snapshotJSON(value[key], `${path}.${key}`, active);
    }
    return result;
  } catch (error) {
    if (error instanceof JudgmentDAGCompositionError) {
      throw error;
    }
    invalidContract(`${path} must be readable`);
  } finally {
    active.delete(objectValue);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function parseScope(value: unknown, path: string): JudgmentDAGScope {
  const scope = requireRecord(value, path);
  requireExactKeys(scope, ['type', 'id'], path);
  if (!JUDGMENT_DAG_SCOPE_TYPES.includes(scope.type as JudgmentDAGScopeType)) {
    invalidContract(`${path}.type must be a supported scope type`);
  }
  return {
    type: scope.type as JudgmentDAGScopeType,
    id: requireString(scope.id, `${path}.id`)
  };
}

function parseVersionReference(value: unknown, path: string): JudgmentDAGVersionReference {
  const reference = requireRecord(value, path);
  requireExactKeys(reference, ['id', 'version'], path);
  return {
    id: requireString(reference.id, `${path}.id`),
    version: requireString(reference.version, `${path}.version`)
  };
}

const SNAPSHOT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function parseProblemSnapshotReference(
  value: unknown,
  path: string
): JudgmentDAGProblemSnapshotReference {
  const reference = requireRecord(value, path);
  requireExactKeys(reference, ['snapshot_id', 'problem_id', 'revision'], path);
  const snapshotId = requireString(reference.snapshot_id, `${path}.snapshot_id`);
  if (!SNAPSHOT_ID_PATTERN.test(snapshotId)) {
    invalidContract(`${path}.snapshot_id must be sha256:<64 lowercase hex>`);
  }
  const problemId = requireString(reference.problem_id, `${path}.problem_id`);
  const revision = requireString(reference.revision, `${path}.revision`);
  if (!/^[1-9]\d*$/u.test(revision)) {
    invalidContract(`${path}.revision must be a positive decimal revision`);
  }
  return deepFreeze({
    snapshot_id: snapshotId as JudgmentDAGProblemSnapshotId,
    problem_id: problemId,
    revision
  });
}

function parseStringList(value: unknown, path: string): readonly string[] {
  const values = requireArray(value, path).map((entry, index) =>
    requireString(entry, `${path}[${index}]`)
  );
  if (new Set(values).size !== values.length) {
    invalidContract(`${path} must not contain duplicates`);
  }
  return [...values].sort();
}

function parseChild(value: unknown, index: number): JudgmentDAGSubDAGDefinition {
  const path = `children[${index}]`;
  const child = requireRecord(value, path);
  requireExactKeys(
    child,
    [
      'invocation_id',
      'dag',
      'question',
      'input_contract',
      'output_contract',
      'required_capabilities',
      'depends_on'
    ],
    path
  );
  return {
    invocation_id: requireString(child.invocation_id, `${path}.invocation_id`),
    dag: parseVersionReference(child.dag, `${path}.dag`),
    question: requireString(child.question, `${path}.question`),
    input_contract: requireString(child.input_contract, `${path}.input_contract`),
    output_contract: requireString(child.output_contract, `${path}.output_contract`),
    required_capabilities: parseStringList(
      child.required_capabilities,
      `${path}.required_capabilities`
    ),
    depends_on: parseStringList(child.depends_on, `${path}.depends_on`)
  };
}

function parseComposition(value: unknown): JudgmentDAGCompositionDefinition {
  const composition = requireRecord(value, 'composition');
  requireExactKeys(
    composition,
    ['composition_id', 'composition_version', 'scope', 'parent_dag', 'children'],
    'composition'
  );
  const children = requireArray(composition.children, 'composition.children')
    .map((child, index) => parseChild(child, index))
    .sort((left, right) => left.invocation_id.localeCompare(right.invocation_id));
  return {
    composition_id: requireString(composition.composition_id, 'composition.composition_id'),
    composition_version: requireString(
      composition.composition_version,
      'composition.composition_version'
    ),
    scope: parseScope(composition.scope, 'composition.scope'),
    parent_dag: parseVersionReference(composition.parent_dag, 'composition.parent_dag'),
    children
  };
}

function equalScope(left: JudgmentDAGScope, right: JudgmentDAGScope): boolean {
  return left.type === right.type && left.id === right.id;
}

function equalVersionReference(
  left: JudgmentDAGVersionReference,
  right: JudgmentDAGVersionReference
): boolean {
  return left.id === right.id && left.version === right.version;
}

function equalProblemSnapshotReference(
  left: JudgmentDAGProblemSnapshotReference,
  right: JudgmentDAGProblemSnapshotReference
): boolean {
  return left.snapshot_id === right.snapshot_id &&
    left.problem_id === right.problem_id &&
    left.revision === right.revision;
}

function validateTopology(
  composition: JudgmentDAGCompositionDefinition
): JudgmentDAGCompositionValidationResult {
  const childById = new Map<string, JudgmentDAGSubDAGDefinition>();
  for (const child of composition.children) {
    if (childById.has(child.invocation_id)) {
      throw new JudgmentDAGCompositionError(
        'duplicate_invocation',
        `composition contains duplicate invocation ${child.invocation_id}`,
        { invocation_id: child.invocation_id }
      );
    }
    childById.set(child.invocation_id, child);
  }

  const remaining = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const child of composition.children) {
    remaining.set(child.invocation_id, child.depends_on.length);
    dependents.set(child.invocation_id, []);
  }
  for (const child of composition.children) {
    for (const dependencyId of child.depends_on) {
      if (!childById.has(dependencyId)) {
        throw new JudgmentDAGCompositionError(
          'missing_dependency',
          `invocation ${child.invocation_id} depends on missing invocation ${dependencyId}`,
          { invocation_id: child.invocation_id, dependency_id: dependencyId }
        );
      }
      dependents.get(dependencyId)?.push(child.invocation_id);
    }
  }

  const ready = composition.children
    .filter((child) => remaining.get(child.invocation_id) === 0)
    .map((child) => child.invocation_id)
    .sort();
  const executionOrder: string[] = [];
  while (ready.length > 0) {
    const invocationId = ready.shift();
    if (invocationId === undefined) {
      break;
    }
    executionOrder.push(invocationId);
    for (const dependentId of [...(dependents.get(invocationId) ?? [])].sort()) {
      const next = (remaining.get(dependentId) ?? 0) - 1;
      remaining.set(dependentId, next);
      if (next === 0) {
        ready.push(dependentId);
        ready.sort();
      }
    }
  }

  if (executionOrder.length !== composition.children.length) {
    const cycle = composition.children
      .filter((child) => (remaining.get(child.invocation_id) ?? 0) > 0)
      .map((child) => child.invocation_id)
      .sort();
    throw new JudgmentDAGCompositionError(
      'cycle',
      `composition contains an execution dependency cycle: ${cycle.join(' -> ')}`,
      { cycle }
    );
  }

  return {
    valid: true,
    composition_id: composition.composition_id,
    composition_version: composition.composition_version,
    execution_order: executionOrder
  };
}

export function validateJudgmentDAGComposition(
  value: unknown
): JudgmentDAGCompositionValidationResult {
  return validateTopology(parseComposition(value));
}

export function assertValidJudgmentDAGComposition(
  value: unknown
): asserts value is JudgmentDAGCompositionDefinition {
  validateJudgmentDAGComposition(value);
}

export function createJudgmentDAGCompositionDefinition(
  value: unknown
): JudgmentDAGCompositionDefinition {
  const composition = parseComposition(value);
  validateTopology(composition);
  return deepFreeze(composition);
}

function parseDelegation(value: unknown, expectedScope: JudgmentDAGScope): JudgmentDAGDelegationScope {
  const delegation = requireRecord(value, 'request.delegation');
  requireExactKeys(delegation, ['scope', 'capabilities'], 'request.delegation');
  const scope = parseScope(delegation.scope, 'request.delegation.scope');
  if (!equalScope(scope, expectedScope)) {
    throw new JudgmentDAGCompositionError(
      'scope_mismatch',
      'request delegation scope must match the composition scope'
    );
  }
  return {
    scope,
    capabilities: parseStringList(delegation.capabilities, 'request.delegation.capabilities')
  };
}

function hasCapabilities(
  available: readonly string[],
  required: readonly string[]
): boolean {
  const availableSet = new Set(available);
  return required.every((capability) => availableSet.has(capability));
}

function parseRunReference(value: unknown, child: JudgmentDAGSubDAGDefinition): JudgmentDAGRunReference | null {
  if (value === null) {
    return null;
  }
  const reference = requireRecord(value, 'child.result.run_reference');
  requireExactKeys(reference, ['run_id', 'dag', 'artifact_id'], 'child.result.run_reference');
  const dag = parseVersionReference(reference.dag, 'child.result.run_reference.dag');
  if (dag.id !== child.dag.id || dag.version !== child.dag.version) {
    throw new JudgmentDAGCompositionError(
      'dag_mismatch',
      `child ${child.invocation_id} returned a run for a different DAG`,
      { invocation_id: child.invocation_id }
    );
  }
  const runId = requireString(reference.run_id, 'child.result.run_reference.run_id');
  const artifactId = reference.artifact_id === undefined
    ? undefined
    : requireString(reference.artifact_id, 'child.result.run_reference.artifact_id');
  if (artifactId !== undefined && !/^sha256:[0-9a-f]{64}$/u.test(artifactId)) {
    invalidContract('child.result.run_reference.artifact_id must be sha256:<64 lowercase hex>');
  }
  return {
    run_id: runId,
    dag,
    ...(artifactId === undefined
      ? {}
      : { artifact_id: artifactId as JudgmentDAGRunArtifactId })
  };
}

function parseEvidence(value: unknown): readonly JudgmentDAGEvidenceReference[] {
  return requireArray(value, 'child.result.evidence').map((entry, index) => {
    const path = `child.result.evidence[${index}]`;
    const evidence = requireRecord(entry, path);
    requireExactKeys(evidence, ['kind', 'id', 'revision'], path);
    const baseResult: JudgmentDAGEvidenceReference = {
      kind: requireString(evidence.kind, `${path}.kind`),
      id: requireString(evidence.id, `${path}.id`)
    };
    const revision = evidence.revision === undefined
      ? undefined
      : requireString(evidence.revision, `${path}.revision`);
    return revision === undefined ? baseResult : { ...baseResult, revision };
  });
}

function normalizeChildResult(
  value: unknown,
  child: JudgmentDAGSubDAGDefinition
): JudgmentDAGSubDAGResult {
  const result = requireRecord(value, `child ${child.invocation_id} result`);
  requireExactKeys(
    result,
    [
      'status',
      'input_contract',
      'output_contract',
      'run_reference',
      'conclusion',
      'evidence',
      'applicability',
      'uncertainty',
      'reason'
    ],
    `child ${child.invocation_id} result`
  );
  if (!JUDGMENT_DAG_SUBDAG_STATUSES.includes(result.status as JudgmentDAGSubDAGStatus)) {
    throw new JudgmentDAGCompositionError(
      'invalid_child_result',
      `child ${child.invocation_id} returned an unsupported status`,
      { invocation_id: child.invocation_id }
    );
  }
  if (result.input_contract !== child.input_contract || result.output_contract !== child.output_contract) {
    throw new JudgmentDAGCompositionError(
      'contract_mismatch',
      `child ${child.invocation_id} returned a different input or output contract`,
      { invocation_id: child.invocation_id }
    );
  }
  const runReference = parseRunReference(result.run_reference, child);
  if (result.status === 'completed' && runReference === null) {
    throw new JudgmentDAGCompositionError(
      'invalid_child_result',
      `completed child ${child.invocation_id} must include a run reference`,
      { invocation_id: child.invocation_id }
    );
  }
  const normalized: JudgmentDAGSubDAGResult = {
    status: result.status as JudgmentDAGSubDAGStatus,
    input_contract: child.input_contract,
    output_contract: child.output_contract,
    run_reference: runReference,
    conclusion: snapshotJSON(result.conclusion, `child ${child.invocation_id} result.conclusion`),
    evidence: parseEvidence(result.evidence),
    applicability: snapshotJSON(
      result.applicability,
      `child ${child.invocation_id} result.applicability`
    ),
    uncertainty: snapshotJSON(result.uncertainty, `child ${child.invocation_id} result.uncertainty`)
  };
  if (result.reason === undefined) {
    return deepFreeze(normalized);
  }
  return deepFreeze({
    ...normalized,
    reason: requireString(result.reason, `child ${child.invocation_id} result.reason`)
  });
}

function incompleteResult(
  status: Exclude<JudgmentDAGSubDAGStatus, 'completed'>,
  child: JudgmentDAGSubDAGDefinition,
  reason: string
): JudgmentDAGSubDAGResult {
  return deepFreeze({
    status,
    input_contract: child.input_contract,
    output_contract: child.output_contract,
    run_reference: null,
    conclusion: null,
    evidence: [],
    applicability: { status: 'not_run' },
    uncertainty: { status: 'blocked' },
    reason
  });
}

function parsePort(value: unknown): JudgmentDAGSubDAGEvaluationPort {
  const port = requireRecord(value, 'request.port');
  requireExactKeys(port, ['execute'], 'request.port');
  if (typeof port.execute !== 'function') {
    invalidContract('request.port.execute must be a function');
  }
  return port as unknown as JudgmentDAGSubDAGEvaluationPort;
}

function parseSnapshotReader(value: unknown): JudgmentDAGProblemSnapshotReader {
  const reader = requireRecord(value, 'request.snapshot_reader');
  requireExactKeys(reader, ['read'], 'request.snapshot_reader');
  if (typeof reader.read !== 'function') {
    invalidContract('request.snapshot_reader.read must be a function');
  }
  return reader as unknown as JudgmentDAGProblemSnapshotReader;
}

function parseDAGResolver(value: unknown): JudgmentDAGVersionResolver {
  const resolver = requireRecord(value, 'request.dag_resolver');
  requireExactKeys(resolver, ['resolve'], 'request.dag_resolver');
  if (typeof resolver.resolve !== 'function') {
    invalidContract('request.dag_resolver.resolve must be a function');
  }
  return resolver as unknown as JudgmentDAGVersionResolver;
}

function parseContractValidator(value: unknown): JudgmentDAGInputOutputContractValidator {
  const validator = requireRecord(value, 'request.contract_validator');
  requireExactKeys(validator, ['validate'], 'request.contract_validator');
  if (typeof validator.validate !== 'function') {
    invalidContract('request.contract_validator.validate must be a function');
  }
  return validator as unknown as JudgmentDAGInputOutputContractValidator;
}

function parseArtifactReader(value: unknown): JudgmentDAGRunArtifactReader {
  const reader = requireRecord(value, 'request.artifact_reader');
  requireExactKeys(reader, ['read'], 'request.artifact_reader');
  if (typeof reader.read !== 'function') {
    invalidContract('request.artifact_reader.read must be a function');
  }
  return reader as unknown as JudgmentDAGRunArtifactReader;
}

function parseRequest(value: unknown): {
  readonly run_id: string;
  readonly composition: JudgmentDAGCompositionDefinition;
  readonly question: string;
  readonly input: JudgmentDAGJSONValue;
  readonly problem_snapshot: JudgmentDAGProblemSnapshotReference;
  readonly fixed_conditions: JudgmentDAGJSONValue;
  readonly delegation: JudgmentDAGDelegationScope;
  readonly snapshot_reader: JudgmentDAGProblemSnapshotReader;
  readonly dag_resolver: JudgmentDAGVersionResolver;
  readonly contract_validator: JudgmentDAGInputOutputContractValidator;
  readonly artifact_reader?: JudgmentDAGRunArtifactReader;
  readonly port: JudgmentDAGSubDAGEvaluationPort;
  readonly validation: JudgmentDAGCompositionValidationResult;
} {
  const request = requireRecord(value, 'request');
  requireExactKeys(
    request,
    [
      'run_id',
      'composition',
      'question',
      'input',
      'problem_snapshot',
      'fixed_conditions',
      'delegation',
      'snapshot_reader',
      'dag_resolver',
      'contract_validator',
      'artifact_reader',
      'port'
    ],
    'request'
  );
  const composition = createJudgmentDAGCompositionDefinition(request.composition);
  const validation = validateTopology(composition);
  const artifactReader = request.artifact_reader === undefined
    ? undefined
    : parseArtifactReader(request.artifact_reader);
  return {
    run_id: requireString(request.run_id, 'request.run_id'),
    composition,
    question: requireString(request.question, 'request.question'),
    input: snapshotJSON(request.input, 'request.input'),
    problem_snapshot: parseProblemSnapshotReference(
      request.problem_snapshot,
      'request.problem_snapshot'
    ),
    fixed_conditions: snapshotJSON(request.fixed_conditions, 'request.fixed_conditions'),
    delegation: parseDelegation(request.delegation, composition.scope),
    snapshot_reader: parseSnapshotReader(request.snapshot_reader),
    dag_resolver: parseDAGResolver(request.dag_resolver),
    contract_validator: parseContractValidator(request.contract_validator),
    ...(artifactReader === undefined ? {} : { artifact_reader: artifactReader }),
    port: parsePort(request.port),
    validation
  };
}

function parseVersionResolution(value: unknown, path: string): JudgmentDAGVersionResolution {
  const resolution = requireRecord(value, path);
  requireExactKeys(resolution, ['dag', 'input_contract', 'output_contract'], path);
  return deepFreeze({
    dag: parseVersionReference(resolution.dag, `${path}.dag`),
    input_contract: requireString(resolution.input_contract, `${path}.input_contract`),
    output_contract: requireString(resolution.output_contract, `${path}.output_contract`)
  });
}

type ParsedJudgmentDAGCompositionRunRequest = ReturnType<typeof parseRequest>;

async function resolveDAGReferences(
  parsed: ParsedJudgmentDAGCompositionRunRequest
): Promise<void> {
  const resolve = async (
    role: 'parent' | 'child',
    dag: JudgmentDAGVersionReference,
    invocationId?: string
  ): Promise<JudgmentDAGVersionResolution> => {
    let rawResolution: unknown;
    try {
      rawResolution = await parsed.dag_resolver.resolve({
        role,
        ...(invocationId === undefined ? {} : { invocation_id: invocationId }),
        dag
      });
    } catch {
      throw new JudgmentDAGCompositionError(
        'dag_unavailable',
        `${role} DAG ${dag.id}@${dag.version} could not be resolved`,
        invocationId === undefined ? {} : { invocation_id: invocationId }
      );
    }
    try {
      return parseVersionResolution(rawResolution, `${role} DAG resolution`);
    } catch {
      throw new JudgmentDAGCompositionError(
        'dag_unavailable',
        `${role} DAG ${dag.id}@${dag.version} returned an invalid resolution`,
        invocationId === undefined ? {} : { invocation_id: invocationId }
      );
    }
  };

  const parentResolution = await resolve('parent', parsed.composition.parent_dag);
  if (!equalVersionReference(parentResolution.dag, parsed.composition.parent_dag)) {
    throw new JudgmentDAGCompositionError(
      'dag_mismatch',
      'parent DAG resolver returned a different version'
    );
  }

  for (const child of parsed.composition.children) {
    const resolution = await resolve('child', child.dag, child.invocation_id);
    if (!equalVersionReference(resolution.dag, child.dag)) {
      throw new JudgmentDAGCompositionError(
        'dag_mismatch',
        `child ${child.invocation_id} DAG resolver returned a different version`,
        { invocation_id: child.invocation_id }
      );
    }
    if (
      resolution.input_contract !== child.input_contract ||
      resolution.output_contract !== child.output_contract
    ) {
      throw new JudgmentDAGCompositionError(
        'contract_mismatch',
        `child ${child.invocation_id} DAG version has a different input or output contract`,
        { invocation_id: child.invocation_id }
      );
    }
    try {
      await parsed.contract_validator.validate({
        role: 'child',
        invocation_id: child.invocation_id,
        dag: child.dag,
        input_contract: resolution.input_contract,
        output_contract: resolution.output_contract
      });
    } catch {
      throw new JudgmentDAGCompositionError(
        'contract_mismatch',
        `child ${child.invocation_id} input/output contract was rejected`,
        { invocation_id: child.invocation_id }
      );
    }
  }
}

async function readProblemSnapshot(
  parsed: ParsedJudgmentDAGCompositionRunRequest
): Promise<JudgmentDAGJSONValue> {
  let rawResult: unknown;
  try {
    rawResult = await parsed.snapshot_reader.read({
      mode: 'read',
      reference_resolution: 'current',
      reference: parsed.problem_snapshot
    });
  } catch {
    throw new JudgmentDAGCompositionError(
      'snapshot_unavailable',
      'the selected JudgmentProblem snapshot could not be read'
    );
  }

  try {
    const result = requireRecord(rawResult, 'snapshot_reader result');
    requireExactKeys(
      result,
      ['reference_resolution', 'status', 'reference', 'snapshot'],
      'snapshot_reader result'
    );
    if (result.status !== 'resolved' || result.reference_resolution !== 'current') {
      throw new Error('snapshot is not resolved');
    }
    const reference = parseProblemSnapshotReference(
      result.reference,
      'snapshot_reader result.reference'
    );
    if (!equalProblemSnapshotReference(reference, parsed.problem_snapshot)) {
      throw new Error('snapshot reference does not match the requested snapshot');
    }
    const snapshot = snapshotJSON(result.snapshot, 'snapshot_reader result.snapshot');
    const snapshotRecord = requireRecord(snapshot, 'snapshot_reader result.snapshot');
    if (
      snapshotRecord.snapshot_version !== 'judgment-problem-snapshot.v1' ||
      snapshotRecord.problem_id !== parsed.problem_snapshot.problem_id ||
      snapshotRecord.revision !== parsed.problem_snapshot.revision
    ) {
      throw new Error('snapshot identity does not match the requested snapshot');
    }
    return deepFreeze(snapshot);
  } catch {
    throw new JudgmentDAGCompositionError(
      'snapshot_unavailable',
      'the snapshot reader returned an invalid or mismatched JudgmentProblem snapshot'
    );
  }
}

async function verifyArtifactReadback(
  result: JudgmentDAGSubDAGResult,
  child: JudgmentDAGSubDAGDefinition,
  reader: JudgmentDAGRunArtifactReader | undefined
): Promise<void> {
  const runReference = result.run_reference;
  if (runReference?.artifact_id === undefined) return;
  if (reader === undefined) {
    throw new JudgmentDAGCompositionError(
      'artifact_readback_failed',
      `child ${child.invocation_id} returned an artifact without a readback adapter`,
      { invocation_id: child.invocation_id }
    );
  }

  let rawArtifact: unknown;
  try {
    rawArtifact = await reader.read({
      artifact_id: runReference.artifact_id,
      expected_run_id: runReference.run_id,
      expected_dag: child.dag
    });
  } catch {
    throw new JudgmentDAGCompositionError(
      'artifact_readback_failed',
      `child ${child.invocation_id} artifact could not be read back`,
      { invocation_id: child.invocation_id }
    );
  }

  try {
    const artifact = requireRecord(rawArtifact, `child ${child.invocation_id} artifact`);
    if (requireString(artifact.run_id, `child ${child.invocation_id} artifact.run_id`) !== runReference.run_id) {
      throw new Error('artifact run identity does not match the child result');
    }
    const artifactDAG = requireRecord(artifact.dag, `child ${child.invocation_id} artifact.dag`);
    const artifactDAGReference: JudgmentDAGVersionReference = {
      id: requireString(artifactDAG.id, `child ${child.invocation_id} artifact.dag.id`),
      version: requireString(artifactDAG.version, `child ${child.invocation_id} artifact.dag.version`)
    };
    if (!equalVersionReference(artifactDAGReference, child.dag)) {
      throw new Error('artifact DAG identity does not match the child result');
    }
  } catch {
    throw new JudgmentDAGCompositionError(
      'artifact_readback_failed',
      `child ${child.invocation_id} artifact readback did not match the child run`,
      { invocation_id: child.invocation_id }
    );
  }
}

function childByInvocation(
  composition: JudgmentDAGCompositionDefinition
): ReadonlyMap<string, JudgmentDAGSubDAGDefinition> {
  return new Map(composition.children.map((child) => [child.invocation_id, child]));
}

/**
 * Execute only the explicitly declared evaluation port for each child.
 * Resource reservation, deploys, external sends, and arbitrary host-code
 * isolation remain outside this OSS boundary.
 */
export async function executeJudgmentDAGComposition(
  request: JudgmentDAGCompositionRunRequest
): Promise<JudgmentDAGCompositionRunRecord> {
  const parsed = parseRequest(request);
  const childrenById = childByInvocation(parsed.composition);

  // Preflight every child before the first port call. A later capability
  // violation therefore cannot leave an earlier child partially evaluated.
  for (const child of parsed.composition.children) {
    if (!hasCapabilities(parsed.delegation.capabilities, child.required_capabilities)) {
      const missing = child.required_capabilities.filter(
        (capability) => !parsed.delegation.capabilities.includes(capability)
      );
      throw new JudgmentDAGCompositionError(
        'capability_violation',
        `child ${child.invocation_id} requires undelegated capabilities: ${missing.join(', ')}`,
        { invocation_id: child.invocation_id }
      );
    }
  }

  // Resolve the selected problem snapshot and every declared DAG version before
  // the first evaluation port call. The snapshot adapter owns current lookup
  // and authorization; the coordinator only accepts the exact locator and
  // identity it was given.
  await readProblemSnapshot(parsed);
  await resolveDAGReferences(parsed);

  const childRecords = new Map<string, JudgmentDAGSubDAGRunRecord>();
  for (const invocationId of parsed.validation.execution_order) {
    const child = childrenById.get(invocationId);
    if (child === undefined) {
      throw new JudgmentDAGCompositionError(
        'invalid_contract',
        `execution order references unknown invocation ${invocationId}`,
        { invocation_id: invocationId }
      );
    }

    const dependencyResults = child.depends_on.map((dependencyId) => {
      const dependency = childRecords.get(dependencyId);
      if (dependency === undefined) {
        throw new JudgmentDAGCompositionError(
          'invalid_contract',
          `dependency ${dependencyId} has not been recorded before ${invocationId}`,
          { invocation_id: invocationId, dependency_id: dependencyId }
        );
      }
      return {
        invocation_id: dependency.invocation_id,
        result: dependency.result
      };
    });
    const delegation: JudgmentDAGDelegationScope = {
      scope: parsed.delegation.scope,
      capabilities: child.required_capabilities
    };
    const blockedDependency = dependencyResults.find(
      (dependency) => dependency.result.status !== 'completed'
    );

    let result: JudgmentDAGSubDAGResult;
    if (blockedDependency !== undefined) {
      result = incompleteResult(
        'held',
        child,
        `dependency ${blockedDependency.invocation_id} is ${blockedDependency.result.status}`
      );
    } else {
      const childRequest = deepFreeze({
        mode: 'evaluation' as const,
        parent_run_id: parsed.run_id,
        composition: {
          id: parsed.composition.composition_id,
          version: parsed.composition.composition_version
        },
        invocation_id: child.invocation_id,
        dag: child.dag,
        question: child.question,
        input: parsed.input,
        problem_snapshot: parsed.problem_snapshot,
        fixed_conditions: parsed.fixed_conditions,
        delegation,
        dependency_results: dependencyResults
      });

      let rawResult: unknown;
      let executorFailed = false;
      try {
        rawResult = await parsed.port.execute(childRequest);
      } catch {
        executorFailed = true;
      }
      if (executorFailed) {
        result = incompleteResult('failed', child, 'evaluation port failed');
      } else {
        // Keep result validation outside the executor catch. A malformed or
        // mismatched result is a contract error, not a successful child.
        result = normalizeChildResult(rawResult, child);
        await verifyArtifactReadback(result, child, parsed.artifact_reader);
      }
    }

    const childRecord: JudgmentDAGSubDAGRunRecord = {
      invocation_id: child.invocation_id,
      dag: child.dag,
      question: child.question,
      input_contract: child.input_contract,
      output_contract: child.output_contract,
      input: parsed.input,
      problem_snapshot: parsed.problem_snapshot,
      fixed_conditions: parsed.fixed_conditions,
      delegation,
      dependency_invocation_ids: child.depends_on,
      dependency_results: dependencyResults,
      result
    };
    childRecords.set(invocationId, deepFreeze(childRecord));
  }

  const children = parsed.validation.execution_order.map((invocationId) => {
    const child = childRecords.get(invocationId);
    if (child === undefined) {
      throw new JudgmentDAGCompositionError(
        'invalid_contract',
        `child ${invocationId} was not recorded`,
        { invocation_id: invocationId }
      );
    }
    return child;
  });
  const status: JudgmentDAGCompositionStatus = children.some(
    (child) => child.result.status === 'failed'
  )
    ? 'failed'
    : children.some((child) => child.result.status === 'held')
      ? 'held'
      : 'completed';

  return deepFreeze({
    run_id: parsed.run_id,
    composition: {
      id: parsed.composition.composition_id,
      version: parsed.composition.composition_version
    },
    parent_dag: parsed.composition.parent_dag,
    question: parsed.question,
    input: parsed.input,
    problem_snapshot: parsed.problem_snapshot,
    fixed_conditions: parsed.fixed_conditions,
    delegation: parsed.delegation,
    execution_order: parsed.validation.execution_order,
    status,
    children
  });
}
