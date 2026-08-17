import { describe, expect, it } from 'vitest';
import { canonicalEdgeId } from '../src/canonical-graph.js';
import { resolveText } from '../src/entity-resolution.js';
import { canonicalRelationRegistry, getCanonicalRelation } from '../src/relation-registry.js';
import type { CanonicalEdge, CoreRelation, GraphFileV2 } from '../src/types.js';

describe('canonical relation registry', () => {
  it('defines every public CoreRelation exactly once with typed endpoints', () => {
    const expected: CoreRelation[] = [
      'accountable_for',
      'governs',
      'member_of',
      'owned_by',
      'participates_in',
      'supersedes'
    ];

    expect(Object.keys(canonicalRelationRegistry).sort()).toEqual(expected);
    expect(getCanonicalRelation('accountable_for')).toMatchObject({ from: 'person', to: 'project' });
    expect(getCanonicalRelation('governs')).toMatchObject({ from: 'decision', to: 'project' });
    expect(getCanonicalRelation('owned_by')).toMatchObject({ from: 'project', to: 'org' });
  });

  it('publishes stable meanings and project-scope traversal semantics', () => {
    for (const definition of Object.values(canonicalRelationRegistry)) {
      expect(definition.meaning.trim().length).toBeGreaterThan(0);
      expect(definition.scopeTraversal).toMatch(/^(none|project_direct|project_transitive)$/);
    }
    expect(getCanonicalRelation('participates_in').scopeTraversal).toBe('project_direct');
    expect(getCanonicalRelation('accountable_for').scopeTraversal).toBe('project_direct');
    expect(getCanonicalRelation('governs').scopeTraversal).toBe('project_direct');
    expect(getCanonicalRelation('supersedes').scopeTraversal).toBe('project_transitive');
    expect(getCanonicalRelation('supersedes').traversalDirection).toBe('forward');
  });

  it('is deeply immutable and rejects unknown runtime relation IDs', () => {
    expect(Object.isFrozen(canonicalRelationRegistry)).toBe(true);
    expect(Object.values(canonicalRelationRegistry).every(Object.isFrozen)).toBe(true);
    expect(() => getCanonicalRelation('relates_to')).toThrow(/ONTOLOGY-RELATION-UNKNOWN/);
  });

  it('drives strict project traversal through active supersedes edges', () => {
    const rawEdges: Array<Omit<CanonicalEdge, 'id'>> = [
      { fromId: 'decision-new', relation: 'supersedes', toId: 'decision-old' },
      { fromId: 'decision-old', relation: 'governs', toId: 'project-atlas' }
    ];
    const graph: GraphFileV2 = {
      version: 2,
      ontology: { id: 'brainbase-personal-os', version: '2.0.0', releaseDigest: 'registry-test' },
      entities: [
        { id: 'project-atlas', type: 'project', name: 'Atlas導入' },
        { id: 'decision-new', type: 'decision', name: '新しい判断' },
        { id: 'decision-old', type: 'decision', name: '以前の判断' }
      ],
      edges: rawEdges.map((edge) => ({ ...edge, id: canonicalEdgeId(edge) }))
    };

    const result = resolveText({
      text: '新しい判断',
      projectScope: { projectIds: ['project-atlas'], policy: 'strict' },
      asOf: '2026-08-17T00:00:00.000Z',
      source: { authority: 'local_graph', status: 'complete', revision: 'registry-test', graph }
    });

    expect(result.mentions[0]).toMatchObject({ status: 'resolved', selectedEntityId: 'decision-new' });
    expect(result.mentions[0]?.candidates[0]?.evidence).toContainEqual(expect.objectContaining({
      kind: 'relation_path',
      edgeIds: rawEdges.map((edge) => canonicalEdgeId(edge))
    }));
  });
});
