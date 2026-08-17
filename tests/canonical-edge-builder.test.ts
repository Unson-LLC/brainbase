import { describe, expect, it } from 'vitest';
import { applyCanonicalWrites } from '../src/canonical-edge-builder.js';
import { canonicalEdgeId } from '../src/canonical-graph.js';
import type { CanonicalEdge, GraphFileV1, GraphFileV2 } from '../src/types.js';

const baseGraph = (): GraphFileV2 => ({
  version: 2,
  ontology: {
    id: 'brainbase-personal-os',
    version: '1.0.0',
    releaseDigest: 'sha256:test'
  },
  entities: [{ id: 'org-existing', type: 'org', name: 'Existing org' }],
  edges: []
});

describe('applyCanonicalWrites', () => {
  it('adds stable ID edges and preserves unrelated canonical data', () => {
    const participatesIn: CanonicalEdge = {
      id: canonicalEdgeId({ fromId: 'person-a', relation: 'participates_in', toId: 'project-a' }),
      fromId: 'person-a',
      relation: 'participates_in',
      toId: 'project-a',
      role: 'reviewer',
      context: 'Reviews decisions',
      provenance: { sourceKind: 'onboarding', sourceId: 'project-a' }
    };

    const result = applyCanonicalWrites(baseGraph(), {
      entities: [
        { id: 'person-a', type: 'person', name: 'Partner' },
        { id: 'project-a', type: 'project', name: 'Project A' }
      ],
      edges: [participatesIn]
    });

    expect(result.entities.map((entity) => entity.id)).toEqual(['org-existing', 'person-a', 'project-a']);
    expect(result.edges).toEqual([participatesIn]);
  });

  it('is idempotent by entity and edge ID while keeping existing order', () => {
    const writes = {
      entities: [
        { id: 'person-a', type: 'person' as const, name: 'Partner' },
        { id: 'project-a', type: 'project' as const, name: 'Project A' }
      ],
      edges: [{
        id: canonicalEdgeId({ fromId: 'person-a', relation: 'participates_in', toId: 'project-a' }),
        fromId: 'person-a',
        relation: 'participates_in' as const,
        toId: 'project-a'
      }]
    };

    const once = applyCanonicalWrites(baseGraph(), writes);
    const twice = applyCanonicalWrites(once, writes);

    expect(twice).toEqual(once);
  });

  it('fails loudly for Graph v1 instead of silently writing disconnected entities', () => {
    const graph: GraphFileV1 = { version: 1, entities: [] };

    expect(() => applyCanonicalWrites(graph, { entities: [], edges: [] }))
      .toThrow(/migration_required.*Graph v1/i);
  });
});
