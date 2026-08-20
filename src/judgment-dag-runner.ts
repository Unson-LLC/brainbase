import {
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

export interface JudgmentDAGExecutionErrorDetails {
  readonly node_id?: string;
  readonly runner_type?: JudgmentDAGRunnerType;
  readonly cause?: unknown;
}

export class JudgmentDAGExecutionError extends Error {
  readonly code: JudgmentDAGExecutionCode;
  readonly node_id?: string;
  readonly runner_type?: JudgmentDAGRunnerType;
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
    this.runner_type = details.runner_type;
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

function assertValidRequest(value: unknown): asserts value is JudgmentDAGRunRequest {
  if (!isPlainRecord(value)) {
    throw invalidRequest('request must be a plain object');
  }
  if (typeof value.run_id !== 'string' || value.run_id.trim().length === 0) {
    throw invalidRequest('request.run_id must be a non-empty string');
  }
  if (!isPlainRecord(value.runners)) {
    throw invalidRequest('request.runners must be a plain object');
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
    if (!Object.prototype.hasOwnProperty.call(runners, runnerType) || runners[runnerType] === undefined) {
      throw new JudgmentDAGExecutionError(
        'missing_runner',
        `DAG node ${node.id} requires a ${runnerType} runner registration`,
        { node_id: node.id, runner_type: runnerType }
      );
    }
    if (required.has(runnerType)) {
      continue;
    }
    const registration = runners[runnerType];
    if (
      !isPlainRecord(registration) ||
      typeof registration.version !== 'string' ||
      registration.version.trim().length === 0 ||
      typeof registration.run !== 'function'
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
      version: registration.version,
      run: registration.run
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
  assertValidRequest(request);

  const dagSnapshot = snapshotJSON(request.dag, 'request.dag') as unknown as JudgmentDAG;
  const inputSnapshot = snapshotJSON(request.input, 'request.input');
  const validation = validateJudgmentDAG(dagSnapshot);
  const runners = requiredRunnerEntries(dagSnapshot, validation.execution_order, request.runners);
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
      run_id: request.run_id,
      dag: dagSnapshot,
      node,
      input: inputSnapshot,
      dependency_outputs: dependencyOutputs
    });

    let rawOutput: unknown;
    try {
      rawOutput = await registration.run(runnerInput);
    } catch (error) {
      throw new JudgmentDAGExecutionError(
        'runner_failed',
        `Runner ${node.runner_type} failed for node ${node.id}`,
        { node_id: node.id, runner_type: node.runner_type, cause: error }
      );
    }

    const output = snapshotJSON(rawOutput, `node ${node.id} output`);
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
    run_id: request.run_id,
    dag: dagSnapshot,
    input: inputSnapshot,
    execution_order: validation.execution_order.slice(),
    runner_versions: runnerVersions,
    nodes: nodeRecords
  });
}
