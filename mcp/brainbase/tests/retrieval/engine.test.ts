import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  retrieveGraph,
  type Embedder,
  type GraphEdge,
  type GraphNode,
} from '../../src/retrieval/engine.js';

function node(id: string, payload: Record<string, unknown>, extra: Partial<GraphNode> = {}): GraphNode {
  return { id, entity_type: 'decision', payload, ...extra };
}

function edge(from_id: string, to_id: string, rel_type: string, extra: Partial<GraphEdge> = {}): GraphEdge {
  return { from_id, to_id, rel_type, ...extra };
}

const unitEmbedder: Embedder = async (texts, kind) => {
  if (kind === 'query') return texts.map(() => [1, 0]);
  return texts.map(text => text.includes('graph') || text.includes('関係') ? [1, 0] : [0, 1]);
};

describe('retrieveGraph', () => {
  it('ranks a semantic paraphrase and does not include retired entities', async () => {
    const result = await retrieveGraph({
      query: 'グラフの関係を検索する',
      nodes: [
        node('decision_graph', { title: 'Graph retrieval', body: '検索の関係探索を有効にする。' }),
        node('decision_other', { title: 'Unrelated', body: '別の内容。' }),
        node('decision_retired', { title: 'Graph retrieval old', body: '旧版', lifecycle_status: 'retired' }),
        node('decision_superseded', { title: 'Graph retrieval superseded', body: '旧版', semantic_state: 'superseded' }),
      ],
      edges: [],
      embed: unitEmbedder,
      top_k: 1,
      coverage: 'complete',
    });

    assert.deepEqual(result.candidates.map(candidate => candidate.id), ['decision_graph']);
    assert.equal(result.candidates[0].evidence.body, '検索の関係探索を有効にする。');
    assert.equal(result.coverage, 'partial');
    assert.equal(result.sufficiency, 'needs_model_verification');
  });

  it('follows only actual typed edges and returns final plan nodes with concrete paths', async () => {
    const result = await retrieveGraph({
      query: '関係',
      nodes: [
        node('project_brainbase', { name: 'Brainbase' }, { entity_type: 'project' }),
        node('decision_target', { title: 'Graph decision', body: 'actual body' }),
        node('decision_unrelated', { title: 'Unrelated', body: 'must not be filled by semantic search' }),
      ],
      edges: [
        edge('project_brainbase', 'decision_target', 'belongs_to_project', { id: 'edge_target' }),
        edge('project_brainbase', 'decision_unrelated', 'other_relation', { id: 'edge_other' }),
      ],
      embed: async () => {
        throw new Error('plan retrieval must not call semantic embedding');
      },
      plan: {
        seed_ids: ['project_brainbase'],
        steps: [{ relation: 'belongs_to_project', direction: 'outgoing', target_type: 'decision' }],
      },
      coverage: 'complete',
    });

    assert.deepEqual(result.candidates.map(candidate => candidate.id), ['decision_target']);
    assert.equal(result.candidates[0].score, null);
    assert.deepEqual(result.candidates[0].paths[0].node_ids, ['project_brainbase', 'decision_target']);
    assert.equal(result.candidates[0].paths[0].edges[0].id, 'edge_target');
    assert.equal(result.candidates[0].entity_type, 'decision');
  });

  it('returns only the final frontier after a bounded multi-step plan', async () => {
    const result = await retrieveGraph({
      query: '関係',
      nodes: [
        node('project', { name: 'Project' }, { entity_type: 'project' }),
        node('org', { name: 'Org' }, { entity_type: 'org' }),
        node('decision', { title: 'Decision', body: 'final body' }),
      ],
      edges: [
        edge('project', 'org', 'belongs_to_org', { id: 'edge_1' }),
        edge('decision', 'org', 'belongs_to_org', { id: 'edge_2' }),
      ],
      embed: async () => {
        throw new Error('plan retrieval must not call semantic embedding');
      },
      plan: {
        seed_ids: ['project'],
        steps: [
          { relation: 'belongs_to_org', direction: 'outgoing', target_type: 'org' },
          { relation: 'belongs_to_org', direction: 'incoming', target_type: 'decision' },
        ],
      },
      coverage: 'complete',
    });

    assert.deepEqual(result.candidates.map(candidate => candidate.id), ['decision']);
    assert.deepEqual(result.candidates[0].paths[0].node_ids, ['project', 'org', 'decision']);
    assert.deepEqual(result.candidates[0].paths[0].edges.map(pathEdge => pathEdge.id), ['edge_1', 'edge_2']);
  });

  it('keeps missing links as an empty graph result instead of semantic fallback', async () => {
    let embedCalls = 0;
    const result = await retrieveGraph({
      query: 'anything',
      nodes: [node('seed', { title: 'Seed' }), node('unrelated', { title: 'Unrelated' })],
      edges: [edge('seed', 'missing_node', 'belongs_to_project')],
      embed: async () => {
        embedCalls += 1;
        return [[1, 0]];
      },
      plan: { seed_ids: ['seed'], steps: [{ relation: 'belongs_to_project', direction: 'outgoing' }] },
      coverage: 'complete',
    });

    assert.deepEqual(result.candidates, []);
    assert.equal(result.sufficiency, 'insufficient');
    assert.equal(embedCalls, 0);
  });

  it('filters inactive edges and nodes, including lifecycle fields in payload', async () => {
    const result = await retrieveGraph({
      query: 'relation',
      nodes: [
        node('seed', { title: 'Seed' }, { entity_type: 'project' }),
        node('active_target', { title: 'Active target', body: 'body' }),
        node('inactive_target', { title: 'Inactive target', body: 'body', status: 'inactive' }),
        node('superseded_target', { title: 'Superseded target', body: 'body', semantic_state: 'superseded' }),
      ],
      edges: [
        edge('seed', 'active_target', 'rel'),
        edge('seed', 'inactive_target', 'rel', { payload: { lifecycle_status: 'inactive' } }),
        edge('seed', 'superseded_target', 'rel'),
      ],
      embed: async () => {
        throw new Error('plan retrieval must not call semantic embedding');
      },
      plan: { seed_ids: ['seed'], steps: [{ relation: 'rel', direction: 'outgoing' }] },
      coverage: 'complete',
    });

    assert.deepEqual(result.candidates.map(candidate => candidate.id), ['active_target']);
  });

  it('reports evidence status per candidate and leaves external pointers unresolved', async () => {
    const result = await retrieveGraph({
      query: 'evidence',
      nodes: [
        node('seed', { name: 'Seed' }, { entity_type: 'project' }),
        node('with_body', {
          title: 'Grounded decision',
          body: '本文はあるがモデル確認が必要。',
          source_pointer: 'repo/docs/decision.md',
          provenance: { commit: 'abc' },
        }),
        node('without_body', { title: 'Pointer only', source_pointer: 'https://example.invalid/source' }),
      ],
      edges: [
        edge('seed', 'with_body', 'rel'),
        edge('seed', 'without_body', 'rel'),
      ],
      embed: async () => {
        throw new Error('plan retrieval must not call semantic embedding');
      },
      plan: { seed_ids: ['seed'], steps: [{ relation: 'rel', direction: 'outgoing' }] },
      coverage: 'unknown',
    });

    const withBody = result.candidates.find(candidate => candidate.id === 'with_body');
    const withoutBody = result.candidates.find(candidate => candidate.id === 'without_body');
    assert.ok(withBody);
    assert.ok(withoutBody);
    assert.equal(withBody.evidence_status, 'present');
    assert.deepEqual(withBody.missing_evidence, ['content', 'statement', 'decision', 'rationale']);
    assert.equal(withBody.source_pointer_resolved, false);
    assert.equal(withoutBody.evidence_status, 'missing');
    assert.deepEqual(withoutBody.missing_evidence, ['content', 'statement', 'decision', 'rationale', 'body']);
    assert.equal(result.sufficiency, 'needs_model_verification');
    assert.equal(result.coverage, 'unknown');
  });

  it('validates vectors and plan bounds deterministically', async () => {
    const base = {
      query: 'query',
      nodes: [node('one', { title: 'one' })],
      edges: [],
      coverage: 'complete' as const,
    };

    await assert.rejects(
      retrieveGraph({ ...base, embed: async (texts, kind) => kind === 'query' ? [[0, 0]] : texts.map(() => [1, 0]) }),
      /non-zero norm/,
    );
    await assert.rejects(
      retrieveGraph({ ...base, embed: async (texts, kind) => kind === 'query' ? [[1, Number.NaN]] : texts.map(() => [1, 0]) }),
      /finite numbers/,
    );
    await assert.rejects(
      retrieveGraph({ ...base, embed: async (texts, kind) => kind === 'query' ? [[1, 0]] : texts.map(() => [1]) }),
      /dimension/,
    );
    await assert.rejects(
      retrieveGraph({ ...base, embed: unitEmbedder, top_k: 101 }),
      /top_k/,
    );
    await assert.rejects(
      retrieveGraph({
        ...base,
        embed: unitEmbedder,
        plan: {
          seed_ids: ['one'],
          steps: [
            { relation: 'a', direction: 'outgoing' },
            { relation: 'b', direction: 'outgoing' },
            { relation: 'c', direction: 'outgoing' },
            { relation: 'd', direction: 'outgoing' },
          ],
        },
      }),
      /at most 3/,
    );
    await assert.rejects(
      retrieveGraph({ ...base, query: '   ', embed: unitEmbedder }),
      /must not be empty/,
    );
  });
});
