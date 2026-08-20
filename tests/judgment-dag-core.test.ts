import { describe, expect, it } from 'vitest';
import {
  JudgmentDAGValidationError,
  assertValidJudgmentDAG,
  validateJudgmentDAG
} from '../src/judgment-dag-core.js';
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
});
