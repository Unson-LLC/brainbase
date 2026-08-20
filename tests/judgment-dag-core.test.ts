import { describe, expect, it } from 'vitest';
import {
  JudgmentDAGValidationError,
  assertValidJudgmentDAG,
  validateJudgmentDAG
} from '../src/judgment-dag-core.js';
import {
  JUDGMENT_DAG_ALLOWED_KEYS,
  JUDGMENT_DAG_EDGE_RELATIONS,
  JUDGMENT_DAG_LAYERS,
  JUDGMENT_DAG_NODE_TYPE_TO_LAYER,
  JUDGMENT_DAG_NODE_TYPES,
  JUDGMENT_DAG_RUNNER_TYPES,
  JUDGMENT_DAG_SCOPE_TYPES
} from '../src/judgment-dag.js';
import {
  cycleJudgmentDAG,
  invalidAuthorityMetadataJudgmentDAG,
  invalidEvaluationMetadataJudgmentDAG,
  invalidProvenanceMetadataJudgmentDAG,
  missingDependencyJudgmentDAG,
  nodeTypeLayerMismatchJudgmentDAG,
  reverseLayerJudgmentDAG,
  validJudgmentDAG
} from './fixtures/judgment-dag-core.js';

describe('Judgment DAG core contract', () => {
  it('validates an immutable five-layer fixture and returns deterministic order', () => {
    const result = validateJudgmentDAG(validJudgmentDAG);

    expect(result).toEqual({
      valid: true,
      dag_id: 'j0-valid',
      dag_version: '2026-08-20.1',
      execution_order: [
        'context.account',
        'context.customer',
        'judgment.fit',
        'resource.scope',
        'execution.proposal',
        'execution.outcome',
        'evaluation.result'
      ]
    });
    expect(Object.isFrozen(validJudgmentDAG)).toBe(true);
    expect(Object.isFrozen(validJudgmentDAG.nodes)).toBe(true);
    expect(Object.isFrozen(validJudgmentDAG.nodes[0])).toBe(true);
    expect(Object.isFrozen(validJudgmentDAG.nodes[0].depends_on)).toBe(true);
  });

  it('rejects a dependency that does not name a node before execution', () => {
    expect(() => validateJudgmentDAG(missingDependencyJudgmentDAG)).toThrowError(
      expect.objectContaining<Partial<JudgmentDAGValidationError>>({
        code: 'missing_dependency',
        node_id: 'judgment.fit',
        dependency_id: 'context.missing'
      })
    );
  });

  it('rejects a dependency from a later layer', () => {
    expect(() => validateJudgmentDAG(reverseLayerJudgmentDAG)).toThrowError(
      expect.objectContaining<Partial<JudgmentDAGValidationError>>({
        code: 'reverse_layer_dependency',
        node_id: 'context.customer',
        dependency_id: 'execution.proposal'
      })
    );
  });

  it('rejects a node type masquerading as a different layer', () => {
    expect(() => validateJudgmentDAG(nodeTypeLayerMismatchJudgmentDAG)).toThrowError(
      expect.objectContaining<Partial<JudgmentDAGValidationError>>({
        code: 'invalid_contract'
      })
    );
  });

  it.each([
    ['duplicate node IDs', {
      ...validJudgmentDAG,
      nodes: [...validJudgmentDAG.nodes, validJudgmentDAG.nodes[0]]
    }, 'duplicate_node'],
    ['duplicate dependency declarations', {
      ...validJudgmentDAG,
      nodes: validJudgmentDAG.nodes.map((node) => node.id === 'judgment.fit'
        ? { ...node, depends_on: [...node.depends_on, 'context.customer'] }
        : node)
    }, 'invalid_contract'],
    ['duplicate edge declarations', {
      ...validJudgmentDAG,
      edges: [...validJudgmentDAG.edges, validJudgmentDAG.edges[0]]
    }, 'invalid_contract']
  ] as const)('rejects %s before execution', (_label, dag, code) => {
    expect(() => validateJudgmentDAG(dag)).toThrowError(
      expect.objectContaining<Partial<JudgmentDAGValidationError>>({ code })
    );
  });

  it.each([
    ['a node dependency without its matching depends_on edge', {
      ...validJudgmentDAG,
      edges: validJudgmentDAG.edges.filter((edge) => !(
        edge.from === 'context.account' && edge.to === 'judgment.fit' && edge.relation === 'depends_on'
      ))
    }],
    ['a depends_on edge without its matching node dependency', {
      ...validJudgmentDAG,
      edges: [
        ...validJudgmentDAG.edges,
        { from: 'context.customer', to: 'resource.scope', relation: 'depends_on' as const }
      ]
    }]
  ] as const)('requires the node dependency and depends_on edge representations to be exact mirrors: rejects %s', (_label, dag) => {
    expect(() => validateJudgmentDAG(dag)).toThrowError(
      expect.objectContaining<Partial<JudgmentDAGValidationError>>({ code: 'invalid_contract' })
    );
  });

  it('rejects control characters in public IDs before edge-key mirror collisions', () => {
    const contextAccount = validJudgmentDAG.nodes.find((node) => node.id === 'context.account');
    const contextCustomer = validJudgmentDAG.nodes.find((node) => node.id === 'context.customer');
    const judgmentFit = validJudgmentDAG.nodes.find((node) => node.id === 'judgment.fit');
    const resourceScope = validJudgmentDAG.nodes.find((node) => node.id === 'resource.scope');
    if (!contextAccount || !contextCustomer || !judgmentFit || !resourceScope) {
      throw new Error('fixture nodes missing');
    }

    const collisionDag = {
      ...validJudgmentDAG,
      id: 'j0-control-id',
      nodes: [
        { ...contextAccount, id: 'a\u0000b' },
        { ...judgmentFit, id: 'c', depends_on: ['a\u0000b'] },
        { ...contextCustomer, id: 'a', depends_on: [] },
        { ...resourceScope, id: 'b\u0000c', depends_on: [] }
      ],
      edges: [{ from: 'a', to: 'b\u0000c', relation: 'depends_on' as const }]
    };

    expect(() => validateJudgmentDAG(collisionDag)).toThrowError(
      expect.objectContaining<Partial<JudgmentDAGValidationError>>({ code: 'invalid_contract' })
    );
  });

  it.each([
    ['scope type', { type: 'organization', id: 'project-j0-fixture' }],
    ['scope ID', { type: 'project', id: 'project-j0-other' }]
  ] as const)('rejects a dependency crossing the exact scope boundary (%s)', (_label, scope) => {
    const dag = {
      ...validJudgmentDAG,
      nodes: validJudgmentDAG.nodes.map((node) => node.id === 'context.customer'
        ? { ...node, scope }
        : node)
    };

    expect(() => validateJudgmentDAG(dag)).toThrowError(
      expect.objectContaining({ code: 'scope_boundary_violation' })
    );
  });

  it.each([
    ['root', { ...validJudgmentDAG, unexpected: true }],
    ['node', {
      ...validJudgmentDAG,
      nodes: validJudgmentDAG.nodes.map((node, index) => index === 0
        ? { ...node, unexpected: true }
        : node)
    }],
    ['scope', {
      ...validJudgmentDAG,
      nodes: validJudgmentDAG.nodes.map((node, index) => index === 0
        ? { ...node, scope: { ...node.scope, unexpected: true } }
        : node)
    }],
    ['edge', {
      ...validJudgmentDAG,
      edges: validJudgmentDAG.edges.map((edge, index) => index === 0
        ? { ...edge, unexpected: true }
        : edge)
    }]
  ] as const)('rejects an unknown %s contract field', (_label, dag) => {
    expect(() => validateJudgmentDAG(dag)).toThrowError(
      expect.objectContaining<Partial<JudgmentDAGValidationError>>({ code: 'invalid_contract' })
    );
  });

  it.each([
    ['authority', invalidAuthorityMetadataJudgmentDAG],
    ['provenance', invalidProvenanceMetadataJudgmentDAG],
    ['evaluation', invalidEvaluationMetadataJudgmentDAG]
  ])('rejects recursively invalid %s metadata before execution', (_field, dag) => {
    expect(() => validateJudgmentDAG(dag)).toThrowError(
      expect.objectContaining<Partial<JudgmentDAGValidationError>>({
        code: 'invalid_contract'
      })
    );
  });

  it('rejects a cycle before producing an execution order', () => {
    expect(() => validateJudgmentDAG(cycleJudgmentDAG)).toThrowError(
      expect.objectContaining<Partial<JudgmentDAGValidationError>>({
        code: 'cycle',
        cycle: expect.arrayContaining(['context.customer', 'context.peer'])
      })
    );
  });

  it('asserts the contract without changing the immutable fixture', () => {
    const before = JSON.stringify(validJudgmentDAG);
    expect(() => assertValidJudgmentDAG(validJudgmentDAG)).not.toThrow();
    expect(JSON.stringify(validJudgmentDAG)).toBe(before);
    expect(() => assertValidJudgmentDAG(cycleJudgmentDAG)).toThrowError(
      expect.objectContaining({ code: 'cycle' })
    );
  });

  it('uses node ID ascending as a stable topological tie-break', () => {
    const reordered = {
      ...validJudgmentDAG,
      nodes: [...validJudgmentDAG.nodes].reverse(),
      edges: [...validJudgmentDAG.edges].reverse()
    };

    const expected = validateJudgmentDAG(validJudgmentDAG).execution_order;
    expect(validateJudgmentDAG(reordered).execution_order).toEqual(expected);
    expect(expected.slice(0, 2)).toEqual(['context.account', 'context.customer']);
  });

  it('deep-freezes public semantic constants so consumers cannot alter validation rules', () => {
    const semanticArrays = [
      JUDGMENT_DAG_NODE_TYPES,
      JUDGMENT_DAG_LAYERS,
      JUDGMENT_DAG_SCOPE_TYPES,
      JUDGMENT_DAG_RUNNER_TYPES,
      JUDGMENT_DAG_EDGE_RELATIONS
    ];
    for (const values of semanticArrays) {
      expect(Object.isFrozen(values)).toBe(true);
      expect(() => (values as unknown as string[]).push('tampered')).toThrow(TypeError);
      expect(() => { (values as unknown as string[])[0] = 'tampered'; }).toThrow(TypeError);
      expect(Reflect.deleteProperty(values, '0')).toBe(false);
    }

    expect(Object.isFrozen(JUDGMENT_DAG_NODE_TYPE_TO_LAYER)).toBe(true);
    const map = JUDGMENT_DAG_NODE_TYPE_TO_LAYER as Record<string, string>;
    expect(() => { map.outcome = 'evaluation'; }).toThrow(TypeError);
    expect(Reflect.deleteProperty(map, 'outcome')).toBe(false);
    expect(map.outcome).toBe('execution');
    expect(Object.isFrozen(JUDGMENT_DAG_ALLOWED_KEYS)).toBe(true);
    for (const keys of Object.values(JUDGMENT_DAG_ALLOWED_KEYS)) {
      expect(Object.isFrozen(keys)).toBe(true);
    }
    expect(validateJudgmentDAG(validJudgmentDAG).execution_order).toEqual([
      'context.account', 'context.customer', 'judgment.fit', 'resource.scope',
      'execution.proposal', 'execution.outcome', 'evaluation.result'
    ]);
  });
});
