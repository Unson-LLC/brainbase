import type { JudgmentDAG, JudgmentDAGEdge, JudgmentDAGNode } from '../../src/judgment-dag-core.js';

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value as Readonly<T>;
}

const scope = { type: 'project', id: 'project-j0-fixture' } as const;

function node(
  id: string,
  nodeType: JudgmentDAGNode['node_type'],
  layer: JudgmentDAGNode['layer'],
  dependsOn: readonly string[]
): JudgmentDAGNode {
  return {
    id,
    node_type: nodeType,
    layer,
    scope,
    version: '1.0.0',
    description: `${id} fixture node`,
    depends_on: dependsOn,
    input_contract: 'fixture.input.v1',
    output_contract: 'fixture.output.v1',
    runner_type: 'deterministic',
    authority: ['fixture-owner'],
    confidence: 1,
    valid_from: '2026-08-20T00:00:00.000Z',
    valid_to: null,
    provenance: [{ source: 'j0-fixture', reference: id }],
    evaluation: { criteria: [`${id} is evaluated`] }
  };
}

function nodes(): JudgmentDAGNode[] {
  return [
    node('context.customer', 'observation', 'context', []),
    node('judgment.fit', 'judgment', 'judgment', ['context.customer']),
    node('resource.scope', 'resource', 'resource', ['judgment.fit']),
    node('execution.proposal', 'execution', 'execution', ['resource.scope']),
    node('evaluation.outcome', 'evaluation', 'evaluation', ['execution.proposal'])
  ];
}

function edges(): JudgmentDAGEdge[] {
  return [
    { from: 'context.customer', to: 'judgment.fit', relation: 'depends_on' },
    { from: 'judgment.fit', to: 'resource.scope', relation: 'depends_on' },
    { from: 'resource.scope', to: 'execution.proposal', relation: 'depends_on' },
    { from: 'execution.proposal', to: 'evaluation.outcome', relation: 'depends_on' }
  ];
}

function dag(id: string, dagNodes: JudgmentDAGNode[], dagEdges: JudgmentDAGEdge[]): JudgmentDAG {
  return {
    id,
    version: '2026-08-20.1',
    nodes: dagNodes,
    edges: dagEdges
  };
}

export const validJudgmentDAG = deepFreeze(dag('j0-valid', nodes(), edges()));

const missingNodes = nodes();
missingNodes[1] = {
  ...missingNodes[1],
  depends_on: ['context.missing']
};
export const missingDependencyJudgmentDAG = deepFreeze(
  dag('j0-missing-dependency', missingNodes, edges())
);

const reverseLayerNodes = nodes();
reverseLayerNodes[0] = {
  ...reverseLayerNodes[0],
  depends_on: ['execution.proposal']
};
export const reverseLayerJudgmentDAG = deepFreeze(
  dag('j0-reverse-layer', reverseLayerNodes, edges())
);

const cycleNodes = [...nodes(), node('context.peer', 'observation', 'context', ['context.customer'])];
cycleNodes[0] = {
  ...cycleNodes[0],
  depends_on: ['context.peer']
};
export const cycleJudgmentDAG = deepFreeze(
  dag('j0-cycle', cycleNodes, edges())
);
