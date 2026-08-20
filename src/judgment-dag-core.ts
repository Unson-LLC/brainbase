/**
 * Shared semantic contract for the local Judgment DAG kernel.
 *
 * This module deliberately contains only the contract and preflight checks.
 * Runners, artifact stores, replay, and public MCP/CLI adapters belong to
 * later milestones and must not be coupled to this core surface.
 */

export const JUDGMENT_DAG_NODE_TYPES = Object.freeze([
  'observation',
  'judgment',
  'decision',
  'resource',
  'execution',
  'outcome',
  'evaluation'
] as const);

export type JudgmentDAGNodeType = (typeof JUDGMENT_DAG_NODE_TYPES)[number];

export const JUDGMENT_DAG_LAYERS = Object.freeze([
  'context',
  'judgment',
  'resource',
  'execution',
  'evaluation'
] as const);

export type JudgmentDAGLayer = (typeof JUDGMENT_DAG_LAYERS)[number];

/**
 * The accepted ontology has five layers. An outcome is the result produced
 * by the Execution DAG; it is not a sixth layer of its own.
 */
export const JUDGMENT_DAG_NODE_TYPE_TO_LAYER = Object.freeze({
  observation: 'context',
  judgment: 'judgment',
  decision: 'judgment',
  resource: 'resource',
  execution: 'execution',
  outcome: 'execution',
  evaluation: 'evaluation'
} as const satisfies Record<JudgmentDAGNodeType, JudgmentDAGLayer>);

export const JUDGMENT_DAG_SCOPE_TYPES = Object.freeze([
  'personal',
  'project',
  'organization'
] as const);
export type JudgmentDAGScopeType = (typeof JUDGMENT_DAG_SCOPE_TYPES)[number];

export const JUDGMENT_DAG_RUNNER_TYPES = Object.freeze([
  'deterministic',
  'agent',
  'human',
  'committee',
  'external'
] as const);

export type JudgmentDAGRunnerType = (typeof JUDGMENT_DAG_RUNNER_TYPES)[number];

export const JUDGMENT_DAG_EDGE_RELATIONS = Object.freeze([
  'depends_on',
  'supports',
  'contradicts',
  'gates',
  'supersedes',
  'produces',
  'evaluated_by',
  'triggers'
] as const);

export type JudgmentDAGEdgeRelation = (typeof JUDGMENT_DAG_EDGE_RELATIONS)[number];

/**
 * Exact JSON object keys accepted by the runtime contract. Metadata records
 * are intentionally not listed here because their nested keys are arbitrary.
 */
export const JUDGMENT_DAG_ALLOWED_KEYS = Object.freeze({
  root: Object.freeze(['id', 'version', 'nodes', 'edges'] as const),
  node: Object.freeze([
    'id',
    'node_type',
    'layer',
    'scope',
    'version',
    'description',
    'depends_on',
    'input_contract',
    'output_contract',
    'runner_type',
    'authority',
    'confidence',
    'valid_from',
    'valid_to',
    'provenance',
    'evaluation'
  ] as const),
  scope: Object.freeze(['type', 'id'] as const),
  edge: Object.freeze(['from', 'to', 'relation'] as const)
} as const);

export type JudgmentDAGMetadata =
  | string
  | number
  | boolean
  | null
  | readonly JudgmentDAGMetadata[]
  | { readonly [key: string]: JudgmentDAGMetadata };

export interface JudgmentDAGScope {
  readonly type: JudgmentDAGScopeType;
  readonly id: string;
}

export interface JudgmentDAGNode {
  readonly id: string;
  readonly node_type: JudgmentDAGNodeType;
  readonly layer: JudgmentDAGLayer;
  readonly scope: JudgmentDAGScope;
  readonly version: string;
  readonly description: string;
  readonly depends_on: readonly string[];
  readonly input_contract: string;
  readonly output_contract: string;
  readonly runner_type: JudgmentDAGRunnerType;
  readonly authority?: JudgmentDAGMetadata;
  readonly confidence?: number;
  readonly valid_from?: string | null;
  readonly valid_to?: string | null;
  readonly provenance?: readonly JudgmentDAGMetadata[];
  readonly evaluation?: JudgmentDAGMetadata | null;
}

/**
 * For a `depends_on` relation, `from` is the dependency and `to` is the
 * dependent node. This keeps the edge direction aligned with execution flow.
 */
export interface JudgmentDAGEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: JudgmentDAGEdgeRelation;
}

export interface JudgmentDAG {
  readonly id: string;
  readonly version: string;
  readonly nodes: readonly JudgmentDAGNode[];
  readonly edges: readonly JudgmentDAGEdge[];
}

export type JudgmentDAGValidationCode =
  | 'invalid_contract'
  | 'duplicate_node'
  | 'missing_dependency'
  | 'scope_boundary_violation'
  | 'reverse_layer_dependency'
  | 'cycle';

export interface JudgmentDAGValidationDetails {
  readonly node_id?: string;
  readonly dependency_id?: string;
  readonly node_layer?: JudgmentDAGLayer;
  readonly dependency_layer?: JudgmentDAGLayer;
  readonly cycle?: readonly string[];
}

export class JudgmentDAGValidationError extends Error {
  readonly code: JudgmentDAGValidationCode;
  readonly node_id?: string;
  readonly dependency_id?: string;
  readonly node_layer?: JudgmentDAGLayer;
  readonly dependency_layer?: JudgmentDAGLayer;
  readonly cycle?: readonly string[];

  constructor(
    code: JudgmentDAGValidationCode,
    message: string,
    details: JudgmentDAGValidationDetails = {}
  ) {
    super(message);
    this.name = 'JudgmentDAGValidationError';
    this.code = code;
    this.node_id = details.node_id;
    this.dependency_id = details.dependency_id;
    this.node_layer = details.node_layer;
    this.dependency_layer = details.dependency_layer;
    this.cycle = details.cycle;
  }
}

export interface JudgmentDAGValidationResult {
  readonly valid: true;
  readonly dag_id: string;
  readonly dag_version: string;
  readonly execution_order: readonly string[];
}

const LAYER_INDEX: Readonly<Record<JudgmentDAGLayer, number>> = {
  context: 0,
  judgment: 1,
  resource: 2,
  execution: 3,
  evaluation: 4
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isSafeIdentifier(value: unknown): value is string {
  return isNonEmptyString(value) && !/[\u0000-\u001F\u007F]/u.test(value);
}

function isOneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return isString(value) && (values as readonly string[]).includes(value);
}

function invalidContract(message: string): never {
  throw new JudgmentDAGValidationError('invalid_contract', message);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    invalidContract(`${path} must be an object`);
  }
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      invalidContract(`${path}.${key} is not an allowed contract field`);
    }
  }
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (!isNonEmptyString(value)) {
    invalidContract(`${path} must be a non-empty string`);
  }
  return value;
}

function requireIdentifier(value: unknown, path: string): string {
  if (!isSafeIdentifier(value)) {
    invalidContract(`${path} must be a non-empty string without control characters`);
  }
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    invalidContract(`${path} must be an array`);
  }
  return value;
}

function validateMetadata(value: unknown, path: string, active: Set<object> = new Set()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      return;
    }
    invalidContract(`${path} must contain only finite JSON numbers`);
  }
  if (typeof value !== 'object') {
    invalidContract(`${path} must contain JSON-compatible metadata`);
  }

  const objectValue = value as object;
  if (active.has(objectValue)) {
    invalidContract(`${path} must not contain cyclic metadata`);
  }
  active.add(objectValue);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {
        invalidContract(`${path}[${index}] must be defined`);
      }
      validateMetadata(value[index], `${path}[${index}]`, active);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      invalidContract(`${path} must contain only plain metadata objects`);
    }
    for (const [key, child] of Object.entries(value)) {
      validateMetadata(child, `${path}.${key}`, active);
    }
  }

  active.delete(objectValue);
}

function validateNode(value: unknown, index: number): JudgmentDAGNode {
  const path = `nodes[${index}]`;
  const node = requireRecord(value, path);
  requireExactKeys(node, JUDGMENT_DAG_ALLOWED_KEYS.node, path);
  const nodeType = node.node_type;
  const layer = node.layer;
  const runnerType = node.runner_type;
  const scope = requireRecord(node.scope, `${path}.scope`);
  requireExactKeys(scope, JUDGMENT_DAG_ALLOWED_KEYS.scope, `${path}.scope`);

  if (!isOneOf(JUDGMENT_DAG_NODE_TYPES, nodeType)) {
    invalidContract(`${path}.node_type is not a supported node type`);
  }
  if (!isOneOf(JUDGMENT_DAG_LAYERS, layer)) {
    invalidContract(`${path}.layer is not a supported layer`);
  }
  if (!isOneOf(JUDGMENT_DAG_RUNNER_TYPES, runnerType)) {
    invalidContract(`${path}.runner_type is not a supported runner type`);
  }
  if (!isOneOf(JUDGMENT_DAG_SCOPE_TYPES, scope.type)) {
    invalidContract(`${path}.scope.type is not a supported scope type`);
  }

  if (JUDGMENT_DAG_NODE_TYPE_TO_LAYER[nodeType] !== layer) {
    invalidContract(`${path}.layer does not match ${path}.node_type`);
  }

  requireIdentifier(node.id, `${path}.id`);
  requireIdentifier(scope.id, `${path}.scope.id`);
  requireNonEmptyString(node.version, `${path}.version`);
  requireNonEmptyString(node.description, `${path}.description`);
  requireNonEmptyString(node.input_contract, `${path}.input_contract`);
  requireNonEmptyString(node.output_contract, `${path}.output_contract`);

  const dependencies = requireArray(node.depends_on, `${path}.depends_on`);
  for (let index = 0; index < dependencies.length; index += 1) {
    requireIdentifier(dependencies[index], `${path}.depends_on[${index}]`);
  }
  if (new Set(dependencies).size !== dependencies.length) {
    invalidContract(`${path}.depends_on must not contain duplicate node IDs`);
  }

  if (node.confidence !== undefined &&
      (typeof node.confidence !== 'number' || !Number.isFinite(node.confidence) ||
       node.confidence < 0 || node.confidence > 1)) {
    invalidContract(`${path}.confidence must be a number between 0 and 1`);
  }
  for (const field of ['valid_from', 'valid_to'] as const) {
    if (node[field] !== undefined && node[field] !== null && !isString(node[field])) {
      invalidContract(`${path}.${field} must be a string or null`);
    }
  }
  if (node.provenance !== undefined && !Array.isArray(node.provenance)) {
    invalidContract(`${path}.provenance must be an array`);
  }
  if (node.authority !== undefined) {
    validateMetadata(node.authority, `${path}.authority`);
  }
  if (node.provenance !== undefined) {
    validateMetadata(node.provenance, `${path}.provenance`);
  }
  if (node.evaluation !== undefined) {
    validateMetadata(node.evaluation, `${path}.evaluation`);
  }

  return node as unknown as JudgmentDAGNode;
}

function validateEdge(
  value: unknown,
  index: number,
  nodeById: ReadonlyMap<string, JudgmentDAGNode>
): JudgmentDAGEdge {
  const path = `edges[${index}]`;
  const edge = requireRecord(value, path);
  requireExactKeys(edge, JUDGMENT_DAG_ALLOWED_KEYS.edge, path);
  const from = requireIdentifier(edge.from, `${path}.from`);
  const to = requireIdentifier(edge.to, `${path}.to`);
  if (!isOneOf(JUDGMENT_DAG_EDGE_RELATIONS, edge.relation)) {
    invalidContract(`${path}.relation is not a supported edge relation`);
  }
  if (!nodeById.has(from) || !nodeById.has(to)) {
    throw new JudgmentDAGValidationError(
      'missing_dependency',
      `${path} references a node that is not in the DAG`,
      { node_id: to, dependency_id: from }
    );
  }
  return edge as unknown as JudgmentDAGEdge;
}

function edgeKey(from: string, to: string): string {
  // A delimiter-based key aliases pairs such as ("a\0b", "c") and
  // ("a", "b\0c"). JSON preserves the pair structure even if an unsafe
  // identifier reaches this internal helper, while public identifiers are
  // rejected by the schema/runtime before this point.
  return JSON.stringify([from, to]);
}

function edgePairLabel(pair: string): string {
  const [from, to] = JSON.parse(pair) as [string, string];
  return `${from} -> ${to}`;
}

function findCycle(
  nodes: readonly JudgmentDAGNode[],
  dependenciesByNode: ReadonlyMap<string, ReadonlySet<string>>
): readonly string[] | undefined {
  const state = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];

  function visit(nodeId: string): readonly string[] | undefined {
    const currentState = state.get(nodeId) ?? 0;
    if (currentState === 1) {
      const cycleStart = path.indexOf(nodeId);
      return [...path.slice(cycleStart), nodeId];
    }
    if (currentState === 2) {
      return undefined;
    }

    state.set(nodeId, 1);
    path.push(nodeId);
    for (const dependencyId of [...(dependenciesByNode.get(nodeId) ?? [])].sort()) {
      const cycle = visit(dependencyId);
      if (cycle !== undefined) {
        return cycle;
      }
    }
    path.pop();
    state.set(nodeId, 2);
    return undefined;
  }

  for (const nodeId of nodes.map((node) => node.id).sort()) {
    const cycle = visit(nodeId);
    if (cycle !== undefined) {
      return cycle;
    }
  }
  return undefined;
}

/**
 * Validate a DAG before any runner can execute it.
 *
 * The input is never mutated. Dependencies declared on nodes and explicit
 * `depends_on` edges are both checked. They are two required representations
 * of the same dependency topology and must be exact mirrors; other edge
 * relations are not part of the execution topology.
 */
export function validateJudgmentDAG(value: unknown): JudgmentDAGValidationResult {
  const dag = requireRecord(value, 'dag');
  requireExactKeys(dag, JUDGMENT_DAG_ALLOWED_KEYS.root, 'dag');
  const dagId = requireIdentifier(dag.id, 'dag.id');
  const dagVersion = requireNonEmptyString(dag.version, 'dag.version');
  const nodeValues = requireArray(dag.nodes, 'dag.nodes');
  const edgeValues = requireArray(dag.edges, 'dag.edges');
  const nodes = nodeValues.map(validateNode);
  const nodeById = new Map<string, JudgmentDAGNode>();

  for (const node of nodes) {
    if (nodeById.has(node.id)) {
      throw new JudgmentDAGValidationError(
        'duplicate_node',
        `DAG contains duplicate node ID: ${node.id}`,
        { node_id: node.id }
      );
    }
    nodeById.set(node.id, node);
  }

  const dependenciesByNode = new Map<string, Set<string>>(
    nodes.map((node) => [node.id, new Set<string>()])
  );
  const dependentsByNode = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  const dependencyPairs = new Set<string>();
  const nodeDependencyPairs = new Set<string>();

  function addDependency(dependencyId: string, dependentId: string): void {
    const dependent = nodeById.get(dependentId);
    const dependency = nodeById.get(dependencyId);
    if (dependent === undefined || dependency === undefined) {
      throw new JudgmentDAGValidationError(
        'missing_dependency',
        `Node ${dependentId} depends on missing node ${dependencyId}`,
        { node_id: dependentId, dependency_id: dependencyId }
      );
    }

    if (dependency.scope.type !== dependent.scope.type || dependency.scope.id !== dependent.scope.id) {
      throw new JudgmentDAGValidationError(
        'scope_boundary_violation',
        `Dependency ${dependencyId} -> ${dependentId} crosses an exact scope boundary`,
        { node_id: dependentId, dependency_id: dependencyId }
      );
    }

    const pair = edgeKey(dependencyId, dependentId);
    if (dependencyPairs.has(pair)) {
      return;
    }
    dependencyPairs.add(pair);
    dependenciesByNode.get(dependentId)?.add(dependencyId);
    dependentsByNode.get(dependencyId)?.push(dependentId);

    const dependencyLayerIndex = LAYER_INDEX[dependency.layer];
    const dependentLayerIndex = LAYER_INDEX[dependent.layer];
    if (dependencyLayerIndex > dependentLayerIndex) {
      throw new JudgmentDAGValidationError(
        'reverse_layer_dependency',
        `Node ${dependentId} in layer ${dependent.layer} depends on later layer ` +
          `${dependency.layer} node ${dependencyId}`,
        {
          node_id: dependentId,
          dependency_id: dependencyId,
          node_layer: dependent.layer,
          dependency_layer: dependency.layer
        }
      );
    }
  }

  for (const node of nodes) {
    for (const dependencyId of node.depends_on) {
      nodeDependencyPairs.add(edgeKey(dependencyId, node.id));
      addDependency(dependencyId, node.id);
    }
  }

  const seenEdges = new Set<string>();
  const edgeDependencyPairs = new Set<string>();
  const edges = edgeValues.map((value, index) => validateEdge(value, index, nodeById));
  for (const edge of edges) {
    const key = `${edge.relation}:${edgeKey(edge.from, edge.to)}`;
    if (seenEdges.has(key)) {
      invalidContract(`edges contains duplicate relation ${key}`);
    }
    seenEdges.add(key);
    if (edge.relation === 'depends_on') {
      edgeDependencyPairs.add(edgeKey(edge.from, edge.to));
      addDependency(edge.from, edge.to);
    }
  }

  for (const pair of nodeDependencyPairs) {
    if (!edgeDependencyPairs.has(pair)) {
      invalidContract(`depends_on edge is missing for node dependency ${edgePairLabel(pair)}`);
    }
  }
  for (const pair of edgeDependencyPairs) {
    if (!nodeDependencyPairs.has(pair)) {
      invalidContract(`node dependency is missing for depends_on edge ${edgePairLabel(pair)}`);
    }
  }

  const cycle = findCycle(nodes, dependenciesByNode);
  if (cycle !== undefined) {
    throw new JudgmentDAGValidationError(
      'cycle',
      `DAG contains a dependency cycle: ${cycle.join(' -> ')}`,
      { cycle }
    );
  }

  const remainingDependencies = new Map(
    [...dependenciesByNode.entries()].map(([id, dependencies]) => [id, dependencies.size])
  );
  const ready: string[] = nodes
    .filter((node) => remainingDependencies.get(node.id) === 0)
    .map((node) => node.id)
    .sort();
  const executionOrder: string[] = [];
  while (ready.length > 0) {
    const completedNodeId = ready.shift();
    if (completedNodeId === undefined) {
      break;
    }
    executionOrder.push(completedNodeId);
    for (const dependentId of [...(dependentsByNode.get(completedNodeId) ?? [])].sort()) {
      const remaining = (remainingDependencies.get(dependentId) ?? 0) - 1;
      remainingDependencies.set(dependentId, remaining);
      if (remaining === 0) {
        ready.push(dependentId);
        ready.sort();
      }
    }
  }

  // This is defensive after findCycle, but keeps the preflight invariant
  // explicit if the topology implementation changes later.
  if (executionOrder.length !== nodes.length) {
    throw new JudgmentDAGValidationError('cycle', 'DAG does not have a complete topological order');
  }

  return {
    valid: true,
    dag_id: dagId,
    dag_version: dagVersion,
    execution_order: executionOrder
  };
}

export function assertValidJudgmentDAG(value: unknown): asserts value is JudgmentDAG {
  validateJudgmentDAG(value);
}
