/**
 * Shared semantic contract for the local Judgment DAG kernel.
 *
 * This module deliberately contains only the contract and preflight checks.
 * Runners, artifact stores, replay, and public MCP/CLI adapters belong to
 * later milestones and must not be coupled to this core surface.
 */

export const JUDGMENT_DAG_NODE_TYPES = [
  'observation',
  'judgment',
  'decision',
  'resource',
  'execution',
  'outcome',
  'evaluation'
] as const;

export type JudgmentDAGNodeType = (typeof JUDGMENT_DAG_NODE_TYPES)[number];

export const JUDGMENT_DAG_LAYERS = [
  'context',
  'judgment',
  'resource',
  'execution',
  'evaluation'
] as const;

export type JudgmentDAGLayer = (typeof JUDGMENT_DAG_LAYERS)[number];

export const JUDGMENT_DAG_SCOPE_TYPES = ['personal', 'project', 'organization'] as const;
export type JudgmentDAGScopeType = (typeof JUDGMENT_DAG_SCOPE_TYPES)[number];

export const JUDGMENT_DAG_RUNNER_TYPES = [
  'deterministic',
  'agent',
  'human',
  'committee',
  'external'
] as const;

export type JudgmentDAGRunnerType = (typeof JUDGMENT_DAG_RUNNER_TYPES)[number];

export const JUDGMENT_DAG_EDGE_RELATIONS = [
  'depends_on',
  'supports',
  'contradicts',
  'gates',
  'supersedes',
  'produces',
  'evaluated_by',
  'triggers'
] as const;

export type JudgmentDAGEdgeRelation = (typeof JUDGMENT_DAG_EDGE_RELATIONS)[number];

export type JudgmentDAGMetadata = string | readonly string[] | Readonly<Record<string, unknown>>;

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

function requireNonEmptyString(value: unknown, path: string): string {
  if (!isNonEmptyString(value)) {
    invalidContract(`${path} must be a non-empty string`);
  }
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    invalidContract(`${path} must be an array`);
  }
  return value;
}

function validateNode(value: unknown, index: number): JudgmentDAGNode {
  const path = `nodes[${index}]`;
  const node = requireRecord(value, path);
  const nodeType = node.node_type;
  const layer = node.layer;
  const runnerType = node.runner_type;
  const scope = requireRecord(node.scope, `${path}.scope`);

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

  requireNonEmptyString(node.id, `${path}.id`);
  requireNonEmptyString(scope.id, `${path}.scope.id`);
  requireNonEmptyString(node.version, `${path}.version`);
  requireNonEmptyString(node.description, `${path}.description`);
  requireNonEmptyString(node.input_contract, `${path}.input_contract`);
  requireNonEmptyString(node.output_contract, `${path}.output_contract`);

  const dependencies = requireArray(node.depends_on, `${path}.depends_on`);
  if (!dependencies.every(isString)) {
    invalidContract(`${path}.depends_on must contain only node IDs`);
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

  return node as unknown as JudgmentDAGNode;
}

function validateEdge(
  value: unknown,
  index: number,
  nodeById: ReadonlyMap<string, JudgmentDAGNode>
): JudgmentDAGEdge {
  const path = `edges[${index}]`;
  const edge = requireRecord(value, path);
  const from = requireNonEmptyString(edge.from, `${path}.from`);
  const to = requireNonEmptyString(edge.to, `${path}.to`);
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
  return `${from}\u0000${to}`;
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
    for (const dependencyId of dependenciesByNode.get(nodeId) ?? []) {
      const cycle = visit(dependencyId);
      if (cycle !== undefined) {
        return cycle;
      }
    }
    path.pop();
    state.set(nodeId, 2);
    return undefined;
  }

  for (const node of nodes) {
    const cycle = visit(node.id);
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
 * `depends_on` edges are both checked; duplicate declarations are harmless.
 */
export function validateJudgmentDAG(value: unknown): JudgmentDAGValidationResult {
  const dag = requireRecord(value, 'dag');
  const dagId = requireNonEmptyString(dag.id, 'dag.id');
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
      if (!nodeById.has(dependencyId)) {
        throw new JudgmentDAGValidationError(
          'missing_dependency',
          `Node ${node.id} depends on missing node ${dependencyId}`,
          { node_id: node.id, dependency_id: dependencyId }
        );
      }
      addDependency(dependencyId, node.id);
    }
  }

  const seenEdges = new Set<string>();
  const edges = edgeValues.map((value, index) => validateEdge(value, index, nodeById));
  for (const edge of edges) {
    const key = `${edge.relation}:${edgeKey(edge.from, edge.to)}`;
    if (seenEdges.has(key)) {
      invalidContract(`edges contains duplicate relation ${key}`);
    }
    seenEdges.add(key);
    if (edge.relation === 'depends_on') {
      addDependency(edge.from, edge.to);
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
  const executionOrder: string[] = nodes
    .filter((node) => remainingDependencies.get(node.id) === 0)
    .map((node) => node.id);
  for (let index = 0; index < executionOrder.length; index += 1) {
    const completedNodeId = executionOrder[index];
    for (const dependentId of dependentsByNode.get(completedNodeId) ?? []) {
      const remaining = (remainingDependencies.get(dependentId) ?? 0) - 1;
      remainingDependencies.set(dependentId, remaining);
      if (remaining === 0) {
        executionOrder.push(dependentId);
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
