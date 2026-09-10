import { describe, expect, it } from 'vitest';
import { canonicalEdgeId } from '../src/canonical-graph.js';
import {
  canonicalPortableJson,
  createPortableGraph,
  hydratePortableGraph,
  portableGraphDigest,
  retrievePortableGraph,
  validatePortableGraph,
  type PortableGraphBundle
} from '../src/portable-graph.js';
import type { DecisionRecord, PersonalOs } from '../src/types.js';
import { canonicalResolutionGraph } from './canonical-resolution-fixture.js';

const asOf = '2026-08-17T00:00:00.000Z';

function sourceOs(): PersonalOs {
  const graph = structuredClone(canonicalResolutionGraph);
  graph.entities = graph.entities.map((entity) => entity.id === 'decision-user-outcome'
    ? { ...entity, metadata: { authority: 'approved', labels: ['searchable'] } }
    : entity);
  graph.edges = graph.edges.map((edge) => ({
    ...edge,
    provenance: { sourceKind: 'user_approved', sourceId: `approval:${edge.id}`, evidenceHash: 'evidence-hash' }
  }));
  const decision: DecisionRecord = {
    id: 'decision-user-outcome',
    title: '判断基準',
    decision: '実測と利用者成果を分ける',
    rationale: '根拠を分けて判断する',
    topic: 'evidence',
    tags: ['approved'],
    effectiveAt: asOf
  };
  return {
    dataDir: '/private/local/brainbase',
    graph,
    personalKg: [{ id: 'private', type: 'self', text: 'private local fact' }],
    relationships: { version: 1, relationships: [{ id: 'legacy', person: '田中', context: 'private legacy fact' }] },
    decisions: [decision, { id: 'unrelated-local', title: 'Local only', decision: 'Do not export' }],
    sourceCount: 3
  };
}

describe('portable Graph v2 bundle', () => {
  it('exports only canonical Graph data and the decision records needed by search', () => {
    const bundle = createPortableGraph(sourceOs());

    expect(Object.keys(bundle).sort()).toEqual(['decisions', 'graph', 'schemaVersion']);
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.graph.entities.find((entity) => entity.id === 'decision-user-outcome')?.metadata).toEqual({
      authority: 'approved', labels: ['searchable']
    });
    expect(bundle.graph.edges[0]?.provenance).toEqual(expect.objectContaining({ sourceKind: 'user_approved' }));
    expect(bundle.decisions).toEqual([expect.objectContaining({
      id: 'decision-user-outcome',
      rationale: '根拠を分けて判断する',
      effectiveAt: asOf
    })]);
    expect(JSON.stringify(bundle)).not.toContain('/private/local/brainbase');
    expect(JSON.stringify(bundle)).not.toContain('private local fact');
    expect(JSON.stringify(bundle)).not.toContain('unrelated-local');
  });

  it('round-trips byte and semantic content without changing relation evidence', async () => {
    const original = createPortableGraph(sourceOs());
    const decoded = JSON.parse(JSON.stringify(original)) as PortableGraphBundle;
    validatePortableGraph(decoded);
    const reExported = createPortableGraph(hydratePortableGraph(decoded));

    expect(JSON.stringify(reExported)).toBe(JSON.stringify(original));
    expect(portableGraphDigest(reExported)).toBe(portableGraphDigest(original));
    expect(canonicalPortableJson({ b: 2, a: { d: 4, c: 3 } })).toBe(canonicalPortableJson({ a: { c: 3, d: 4 }, b: 2 }));

    const response = await retrievePortableGraph(original, {
      query: '担当案件の判断',
      asOf,
      limit: 1,
      seedIds: ['person-tanaka-atlas'],
      steps: [
        { relation: 'accountable_for', direction: 'outgoing' },
        { relation: 'governs', direction: 'incoming', targetType: 'decision' }
      ]
    });
    expect(response.results[0]).toMatchObject({
      id: 'decision-user-outcome',
      relationPath: [canonicalResolutionGraph.edges[0]!.id, canonicalResolutionGraph.edges[2]!.id],
      decisionRationale: { decisionId: 'decision-user-outcome', rationale: '根拠を分けて判断する' },
      evidence: [expect.objectContaining({ canonicalEntityId: 'decision-user-outcome' })]
    });
  });

  it('rejects Graph v1, unknown bundle fields, duplicates, and dangling decision references', () => {
    const valid = createPortableGraph(sourceOs());

    expect(() => validatePortableGraph({ schemaVersion: 1, graph: { version: 1, entities: [] }, decisions: [] }))
      .toThrow('PORTABLE-GRAPH-V1-REJECTED');
    expect(() => validatePortableGraph({ ...valid, privateField: true }))
      .toThrow('unknown top-level field');
    expect(() => validatePortableGraph({ ...valid, decisions: [...valid.decisions, structuredClone(valid.decisions[0])] }))
      .toThrow('duplicate decision ID');
    expect(() => validatePortableGraph({ ...valid, decisions: [] }))
      .toThrow('missing decision record');
    expect(() => validatePortableGraph({ ...valid, decisions: [{ ...valid.decisions[0], supersedes: ['missing-decision'] }] }))
      .toThrow('supersedes missing decision');
    expect(() => validatePortableGraph({ ...valid, decisions: [...valid.decisions, { id: 'unknown', title: 'Unknown', decision: 'Unknown' }] }))
      .toThrow('has no Graph decision entity');
  });

  it('does not accept a stale or invented edge as a portable decision path', async () => {
    const bundle = createPortableGraph(sourceOs());
    const edge = {
      fromId: 'person-tanaka-atlas', relation: 'accountable_for' as const, toId: 'decision-user-outcome'
    };
    const invalid = structuredClone(bundle);
    invalid.graph.edges.push({ id: canonicalEdgeId(edge), ...edge });
    expect(() => validatePortableGraph(invalid)).toThrow('requires person -> project');
    await expect(retrievePortableGraph(bundle, {
      query: 'missing path', asOf, seedIds: ['person-tanaka-atlas'],
      steps: [{ relation: 'governs', direction: 'outgoing', targetType: 'decision' }]
    })).resolves.toMatchObject({ results: [], absenceConfirmed: false });
  });
});
