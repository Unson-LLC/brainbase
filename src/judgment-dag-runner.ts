import {
  JudgmentDAGValidationError,
  validateJudgmentDAG,
  type JudgmentDAG,
  type JudgmentDAGMetadata,
  type JudgmentDAGNode,
  type JudgmentDAGRunnerType
} from './judgment-dag-core.js';

/** A JSON-compatible value accepted at every local runner boundary. */
export type JudgmentDAGJSONValue = JudgmentDAGMetadata;

export interface JudgmentDAGRunnerInput {
  readonly run_id: string;
  readonly dag: JudgmentDAG;
  readonly node: JudgmentDAGNode;
  readonly input: JudgmentDAGJSONValue;
  readonly dependency_outputs: readonly JudgmentDAGDependencyOutput[];
}

export interface JudgmentDAGDependencyOutput {
  readonly node_id: string;
  readonly output: JudgmentDAGJSONValue;
}

export interface JudgmentDAGRunnerRegistration {
  readonly version: string;
  readonly run: (
    input: JudgmentDAGRunnerInput
  ) => JudgmentDAGJSONValue | Promise<JudgmentDAGJSONValue>;
}

export interface JudgmentDAGRunRequest {
  readonly run_id: string;
  readonly dag: JudgmentDAG;
  readonly input: JudgmentDAGJSONValue;
  readonly runners: Partial<Record<JudgmentDAGRunnerType, JudgmentDAGRunnerRegistration>>;
}

export interface JudgmentDAGRunnerVersion {
  readonly runner_type: JudgmentDAGRunnerType;
  readonly version: string;
}

export interface JudgmentDAGNodeRunRecord {
  readonly node_id: string;
  readonly runner_type: JudgmentDAGRunnerType;
  readonly runner_version: string;
  readonly input_contract: string;
  readonly output_contract: string;
  readonly input: JudgmentDAGJSONValue;
  readonly dependency_outputs: readonly JudgmentDAGDependencyOutput[];
  readonly output: JudgmentDAGJSONValue;
}

export interface JudgmentDAGRunRecord {
  readonly run_id: string;
  readonly dag: JudgmentDAG;
  readonly input: JudgmentDAGJSONValue;
  readonly execution_order: readonly string[];
  readonly runner_versions: readonly JudgmentDAGRunnerVersion[];
  readonly nodes: readonly JudgmentDAGNodeRunRecord[];
}

export type JudgmentDAGExecutionCode =
  | 'invalid_request'
  | 'missing_runner'
  | 'invalid_runner'
  | 'invalid_json'
  | 'runner_failed';

export type JudgmentDAGRunnerFailureKind = 'sync_throw' | 'async_reject';

export interface JudgmentDAGExecutionErrorDetails {
  readonly node_id?: string;
  readonly node_type?: JudgmentDAGNode['node_type'];
  readonly runner_type?: JudgmentDAGRunnerType;
  readonly failure_kind?: JudgmentDAGRunnerFailureKind;
  readonly cause?: unknown;
}

export class JudgmentDAGExecutionError extends Error {
  readonly code: JudgmentDAGExecutionCode;
  readonly node_id?: string;
  readonly node_type?: JudgmentDAGNode['node_type'];
  readonly runner_type?: JudgmentDAGRunnerType;
  readonly failure_kind?: JudgmentDAGRunnerFailureKind;
  readonly cause?: unknown;

  constructor(
    code: JudgmentDAGExecutionCode,
    message: string,
    details: JudgmentDAGExecutionErrorDetails = {}
  ) {
    super(message);
    this.name = 'JudgmentDAGExecutionError';
    this.code = code;
    this.node_id = details.node_id;
    this.node_type = details.node_type;
    this.runner_type = details.runner_type;
    this.failure_kind = details.failure_kind;
    this.cause = details.cause;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidJSON(path: string, reason: string): never {
  throw new JudgmentDAGExecutionError('invalid_json', `${path} must be a JSON value: ${reason}`);
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
    invalidJSON(path, 'numbers must be finite');
  }
  if (typeof value !== 'object') {
    invalidJSON(path, 'undefined, functions, symbols, and bigint are not supported');
  }

  const objectValue = value as object;
  if (active.has(objectValue)) {
    invalidJSON(path, 'cyclic values are not supported');
  }
  active.add(objectValue);

  let snapshot: JudgmentDAGJSONValue;
  if (Array.isArray(value)) {
    const result: JudgmentDAGJSONValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {
        invalidJSON(`${path}[${index}]`, 'array holes are not supported');
      }
      result.push(snapshotJSON(value[index], `${path}[${index}]`, active));
    }
    snapshot = result;
  } else {
    if (!isPlainRecord(value)) {
      invalidJSON(path, 'only plain objects are supported');
    }
    const result: Record<string, JudgmentDAGJSONValue> = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: snapshotJSON(value[key], `${path}.${key}`, active),
        writable: true
      });
    }
    snapshot = result;
  }

  active.delete(objectValue);
  return snapshot;
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

function invalidRequest(message: string): JudgmentDAGExecutionError {
  return new JudgmentDAGExecutionError('invalid_request', message);
}

interface JudgmentDAGRunRequestSnapshot {
  readonly run_id: string;
  readonly dag: unknown;
  readonly input: unknown;
  readonly runners: unknown;
}

function snapshotRequest(value: unknown): JudgmentDAGRunRequestSnapshot {
  let requestRecord: Record<string, unknown>;
  try {
    if (!isPlainRecord(value)) {
      throw invalidRequest('request must be a plain object');
    }
    requestRecord = value;
  } catch (error) {
    if (error instanceof JudgmentDAGExecutionError) {
      throw error;
    }
    throw invalidRequest('request must be a readable plain object');
  }

  let runId: unknown;
  let dag: unknown;
  let input: unknown;
  let runners: unknown;
  try {
    // Read each public request field exactly once. The local values below are
    // the only values used for validation, execution, and recording.
    runId = requestRecord.run_id;
    dag = requestRecord.dag;
    input = requestRecord.input;
    runners = requestRecord.runners;
  } catch {
    throw invalidRequest('request fields must be readable');
  }

  if (typeof runId !== 'string' || runId.trim().length === 0) {
    throw invalidRequest('request.run_id must be a non-empty string');
  }
  try {
    if (!isPlainRecord(runners)) {
      throw invalidRequest('request.runners must be a plain object');
    }
  } catch (error) {
    if (error instanceof JudgmentDAGExecutionError) {
      throw error;
    }
    throw invalidRequest('request.runners must be a readable plain object');
  }

  return { run_id: runId, dag, input, runners };
}

function snapshotRequestJSON(value: unknown, path: string): JudgmentDAGJSONValue {
  try {
    return snapshotJSON(value, path);
  } catch (error) {
    if (error instanceof JudgmentDAGExecutionError) {
      throw error;
    }
    throw invalidRequest(`${path} must be readable`);
  }
}

function snapshotRunnerOutput(value: unknown, node: JudgmentDAGNode): JudgmentDAGJSONValue {
  try {
    return snapshotJSON(value, `node ${node.id} output`);
  } catch {
    // Runner output is an untrusted boundary. Do not expose an arbitrary
    // getter/proxy exception or preserve it as cause; retain only stable node
    // context in the public machine-readable error.
    throw new JudgmentDAGExecutionError(
      'invalid_json',
      `node ${node.id} output must be a JSON value`,
      {
        node_id: node.id,
        node_type: node.node_type,
        runner_type: node.runner_type
      }
    );
  }
}

function validateRequestDAG(value: unknown) {
  try {
    return validateJudgmentDAG(value);
  } catch (error) {
    if (error instanceof JudgmentDAGValidationError) {
      throw error;
    }
    throw invalidRequest('request.dag must be readable');
  }
}

function requiredRunnerEntries(
  dag: JudgmentDAG,
  executionOrder: readonly string[],
  runners: JudgmentDAGRunRequest['runners']
): ReadonlyMap<JudgmentDAGRunnerType, JudgmentDAGRunnerRegistration> {
  const nodeById = new Map(dag.nodes.map((node) => [node.id, node]));
  const required = new Map<JudgmentDAGRunnerType, JudgmentDAGRunnerRegistration>();

  for (const nodeId of executionOrder) {
    const node = nodeById.get(nodeId);
    if (node === undefined) {
      throw invalidRequest(`validated execution order references unknown node ${nodeId}`);
    }
    const runnerType = node.runner_type;
    if (required.has(runnerType)) {
      continue;
    }

    let hasRegistration: boolean;
    let registration: unknown;
    try {
      hasRegistration = Object.prototype.hasOwnProperty.call(runners, runnerType);
      registration = hasRegistration ? runners[runnerType] : undefined;
    } catch {
      throw new JudgmentDAGExecutionError(
        'invalid_runner',
        `Runner registration for ${runnerType} is invalid`,
        { node_id: node.id, runner_type: runnerType }
      );
    }

    if (!hasRegistration || registration === undefined) {
      throw new JudgmentDAGExecutionError(
        'missing_runner',
        `DAG node ${node.id} requires a ${runnerType} runner registration`,
        { node_id: node.id, runner_type: runnerType }
      );
    }

    let registrationRecord: Record<string, unknown> | undefined;
    let version: unknown = undefined;
    let run: unknown = undefined;
    try {
      registrationRecord = isPlainRecord(registration) ? registration : undefined;
      if (registrationRecord !== undefined) {
        version = registrationRecord.version;
        run = registrationRecord.run;
      }
    } catch {
      throw new JudgmentDAGExecutionError(
        'invalid_runner',
        `Runner registration for ${runnerType} is invalid`,
        { node_id: node.id, runner_type: runnerType }
      );
    }

    if (
      registrationRecord === undefined ||
      typeof version !== 'string' ||
      version.trim().length === 0 ||
      typeof run !== 'function'
    ) {
      throw new JudgmentDAGExecutionError(
        'invalid_runner',
        `Runner registration for ${runnerType} is invalid`,
        { node_id: node.id, runner_type: runnerType }
      );
    }
    // Capture the registration's immutable contract before the first runner
    // invocation. A runner is allowed to close over the caller's registration
    // object, so retaining that object here would let it rewrite the version
    // recorded for nodes that execute later in the same run.
    required.set(runnerType, {
      version,
      run: run as JudgmentDAGRunnerRegistration['run']
    });
  }

  return required;
}

/**
 * Execute a validated local DAG sequentially using only explicit runner
 * registrations. No clock, randomness, filesystem, network, or persistence
 * is consulted by this function.
 */
export async function executeJudgmentDAG(
  request: JudgmentDAGRunRequest
): Promise<JudgmentDAGRunRecord> {
  const requestSnapshot = snapshotRequest(request);
  const runIdSnapshot = requestSnapshot.run_id;

  // Keep the validator's machine-readable error and details intact. Validate
  // the captured source before cloning, then validate the exact JSON snapshot
  // that will be executed and recorded so no later mutation can change the
  // execution order or node lookup basis.
  validateRequestDAG(requestSnapshot.dag);
  const dagSnapshot = snapshotRequestJSON(requestSnapshot.dag, 'request.dag') as unknown as JudgmentDAG;
  const validation = validateRequestDAG(dagSnapshot);
  const inputSnapshot = snapshotRequestJSON(requestSnapshot.input, 'request.input');
  const runners = requiredRunnerEntries(
    dagSnapshot,
    validation.execution_order,
    requestSnapshot.runners as JudgmentDAGRunRequest['runners']
  );
  const nodeById = new Map(dagSnapshot.nodes.map((node) => [node.id, node]));
  const outputByNode = new Map<string, JudgmentDAGJSONValue>();
  const nodeRecords: JudgmentDAGNodeRunRecord[] = [];

  for (const nodeId of validation.execution_order) {
    const node = nodeById.get(nodeId);
    if (node === undefined) {
      throw invalidRequest(`validated execution order references unknown node ${nodeId}`);
    }
    const registration = runners.get(node.runner_type);
    if (registration === undefined) {
      throw new JudgmentDAGExecutionError(
        'missing_runner',
        `DAG node ${node.id} requires a ${node.runner_type} runner registration`,
        { node_id: node.id, runner_type: node.runner_type }
      );
    }

    const dependencyOutputs = node.depends_on
      .slice()
      .sort()
      .map((dependencyId): JudgmentDAGDependencyOutput => {
        const output = outputByNode.get(dependencyId);
        if (output === undefined) {
          throw invalidRequest(`dependency ${dependencyId} has not executed before ${node.id}`);
        }
        return {
          node_id: dependencyId,
          output
        };
      });

    const runnerInput = deepFreeze({
      run_id: runIdSnapshot,
      dag: dagSnapshot,
      node,
      input: inputSnapshot,
      dependency_outputs: dependencyOutputs
    });

    let rawOutput: unknown;
    let runnerResult: JudgmentDAGJSONValue | Promise<JudgmentDAGJSONValue>;
    try {
      runnerResult = registration.run(runnerInput);
    } catch (error) {
      throw new JudgmentDAGExecutionError(
        'runner_failed',
        `Runner ${node.runner_type} failed for node ${node.id}`,
        {
          node_id: node.id,
          runner_type: node.runner_type,
          failure_kind: 'sync_throw',
          cause: error
        }
      );
    }
    try {
      rawOutput = await runnerResult;
    } catch (error) {
      throw new JudgmentDAGExecutionError(
        'runner_failed',
        `Runner ${node.runner_type} failed for node ${node.id}`,
        {
          node_id: node.id,
          runner_type: node.runner_type,
          failure_kind: 'async_reject',
          cause: error
        }
      );
    }

    const output = snapshotRunnerOutput(rawOutput, node);
    outputByNode.set(node.id, output);
    nodeRecords.push({
      node_id: node.id,
      runner_type: node.runner_type,
      runner_version: registration.version,
      input_contract: node.input_contract,
      output_contract: node.output_contract,
      input: inputSnapshot,
      dependency_outputs: dependencyOutputs,
      output
    });
  }

  const runnerVersions = [...runners.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([runner_type, registration]) => ({ runner_type, version: registration.version }));

  return deepFreeze({
    run_id: runIdSnapshot,
    dag: dagSnapshot,
    input: inputSnapshot,
    execution_order: validation.execution_order.slice(),
    runner_versions: runnerVersions,
    nodes: nodeRecords
  });
}
