import { describe, expect, it } from 'vitest';
import { retrieveGraph } from '../src/graph-retrieval.js';
import { canonicalResolutionGraph } from './canonical-resolution-fixture.js';
import type { PersonalOs } from '../src/types.js';

const asOf = '2026-08-17T00:00:00.000Z';

function os(overrides: Partial<PersonalOs> = {}): PersonalOs {
  return {
    dataDir: '/fixture',
    graph: canonicalResolutionGraph,
    personalKg: [],
    relationships: { version: 1, relationships: [] },
    decisions: [],
    sourceCount: 0,
    ...overrides
  };
}

describe('retrieveGraph', () => {
  it('keeps no-provider discovery explicitly lexical and does not infer absence', async () => {
    const response = await retrieveGraph(os(), { query: '田中さん', asOf, limit: 10 });

    expect(response.method).toBe('lexical');
    expect(response.semantic).toMatchObject({ available: false, method: 'lexical' });
    expect(response.results[0]).toMatchObject({
      source: 'graph',
      id: 'person-tanaka-atlas',
      canonicalEntityId: 'person-tanaka-atlas',
      recordClass: 'canonical',
      authority: 'local_graph',
      discovery: 'lexical',
      relationPath: []
    });
    expect(response.candidates).toBe(response.results);
    expect(response.absenceConfirmed).toBe(false);
    expect(response.partialReasons).toContain('semantic_provider_unavailable');
  });

  it('uses seed IDs and only follows actual typed active edges in a bounded plan', async () => {
    const response = await retrieveGraph(os(), {
      query: '理由',
      asOf,
      seedIds: ['person-tanaka-atlas'],
      steps: [{ relation: 'accountable_for', direction: 'outgoing', targetType: 'project' }]
    });

    expect(response.method).toBe('seed');
    expect(response.results.map((result) => result.id)).toEqual(['project-atlas']);
    expect(response.results[0]).toMatchObject({
      id: 'project-atlas',
      discovery: 'traversal',
      relationPath: [canonicalResolutionGraph.edges[0]!.id]
    });
    expect(response.observedRelations).toContainEqual(expect.objectContaining({
      relation: 'accountable_for',
      direction: 'outgoing',
      targetType: 'project',
      edgeIds: [canonicalResolutionGraph.edges[0]!.id]
    }));
  });

  it('strictly scopes project results and does not expose outside relation catalog entries', async () => {
    const response = await retrieveGraph(os(), { query: '田中', project: 'project-atlas', asOf });

    expect(response.results.map((result) => result.id)).toEqual(['person-tanaka-atlas']);
    expect(response.results.every((result) => result.id !== 'person-tanaka-other')).toBe(true);
    expect(response.observedRelations.every((relation) => relation.targetIds.every((id) => id !== 'project-other'))).toBe(true);
  });

  it('uses exact canonical decision IDs for rationale evidence', async () => {
    const response = await retrieveGraph(os({ decisions: [
      { id: 'decision-user-outcome', title: '別名', decision: '実測と利用者成果を分ける', rationale: '同じIDの根拠' },
      { id: 'legacy-title-only', title: '実測と利用者成果を分けて判断する', decision: '別の判断' }
    ] }), {
      query: '実測と利用者成果を分けて判断する',
      asOf,
      seedIds: ['decision-user-outcome']
    });

    expect(response.results[0]).toMatchObject({
      id: 'decision-user-outcome',
      decisionRationale: { decisionId: 'decision-user-outcome' },
      evidence: [expect.objectContaining({ canonicalEntityId: 'decision-user-outcome', sourceId: 'decision-user-outcome' })]
    });
    expect(response.results.some((result) => result.id === 'legacy-title-only')).toBe(false);
    expect(response.sufficiency).toBe('needs_model_verification');
  });

  it('validates provider vector count, dimensions, finiteness, and zero vectors', async () => {
    const provider = {
      id: 'fixture-provider',
      embed: async (texts: string[]) => texts.map(() => [1, 0])
    };
    const response = await retrieveGraph(os(), { query: 'Atlas', asOf, limit: 2 }, provider);
    expect(response.method).toBe('semantic');
    expect(response.semantic).toMatchObject({ available: true, providerId: 'fixture-provider' });
    expect(response.results).toHaveLength(2);

    await expect(retrieveGraph(os(), { query: 'Atlas', asOf }, {
      id: 'bad-count',
      embed: async () => [[1, 0]]
    })).rejects.toThrow('GRAPH-RETRIEVAL-EMBEDDING-COUNT');
    await expect(retrieveGraph(os(), { query: 'Atlas', asOf }, {
      id: 'bad-dimension',
      embed: async (texts: string[]) => texts.map((_, index) => index === texts.length - 1 ? [1, 0] : [1])
    })).rejects.toThrow('GRAPH-RETRIEVAL-EMBEDDING-DIMENSION');
    await expect(retrieveGraph(os(), { query: 'Atlas', asOf }, {
      id: 'bad-zero',
      embed: async (texts: string[]) => texts.map(() => [0, 0])
    })).rejects.toThrow('GRAPH-RETRIEVAL-EMBEDDING-ZERO');
  });

  it('returns only final-hop decisions at limit one with the exact traversal path', async () => {
    const response = await retrieveGraph(os(), {
      query: '担当案件の判断', asOf, project: 'project-atlas', limit: 1,
      seedIds: ['person-tanaka-atlas'],
      steps: [
        { relation: 'accountable_for', direction: 'outgoing' },
        { relation: 'governs', direction: 'incoming', targetType: 'decision' }
      ]
    });
    expect(response.results.map(result => result.id)).toEqual(['decision-user-outcome']);
    expect(response.results[0]?.relationPath).toEqual([
      canonicalResolutionGraph.edges[0]!.id, canonicalResolutionGraph.edges[2]!.id
    ]);
  });

  it('does not traverse expired edges or return a seed as the missing answer', async () => {
    const graph = structuredClone(canonicalResolutionGraph);
    graph.edges[2]!.validTo = '2026-08-01T00:00:00.000Z';
    const response = await retrieveGraph(os({ graph }), {
      query: '判断', asOf, seedIds: ['project-atlas'],
      steps: [{ relation: 'governs', direction: 'incoming' }]
    });
    expect(response.results).toEqual([]);
    expect(response.sufficiency).toBe('insufficient');
    expect(response.absenceConfirmed).toBe(false);
    expect(response.partialReasons).toContain('no_matching_edge_for_step_1');
  });

  it('marks a truncated semantic discovery as partial', async () => {
    const response = await retrieveGraph(os(), { query: '仕事', asOf, limit: 1 }, {
      id: 'fixture', embed: async texts => texts.map(() => [1, 0])
    });
    expect(response.results).toHaveLength(1);
    expect(response.coverage).toBe('partial');
    expect(response.partialReasons).toContain('result_limit_truncated');
  });

  it('returns migration_required for a valid Graph v1 without claiming no results', async () => {
    const response = await retrieveGraph(os({
      graph: { version: 1, owner: {}, entities: [] }
    }), { query: 'anything', asOf });

    expect(response).toMatchObject({
      graphVersion: 1,
      status: 'migration_required',
      migrationRequired: true,
      candidates: [],
      results: [],
      coverage: 'unknown',
      absenceConfirmed: false
    });
    expect(response.partialReasons).toContain('graph_v1_migration_required');
  });
});
