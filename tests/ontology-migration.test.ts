import { describe, expect, it } from 'vitest';
import { canonicalEdgeId } from '../src/canonical-graph.js';
import { planCanonicalGraphMigration } from '../src/ontology-migration.js';
import type { GraphFileV1, GraphFileV2, RelationshipsFile } from '../src/types.js';

const legacyGraph: GraphFileV1 = {
  version: 1,
  owner: { name: '佐藤' },
  entities: [
    {
      id: 'project-atlas',
      type: 'project',
      name: 'Atlas導入',
      metadata: { decisionPrinciples: ['実測と利用者成果を分けて判断する'] }
    },
    {
      id: 'person-tanaka-atlas',
      type: 'person',
      name: '田中',
      metadata: { projectId: 'project-atlas' }
    },
    { id: 'org-unson', type: 'org', name: '雲孫' }
  ]
};

const relationships: RelationshipsFile = {
  version: 1,
  relationships: [{ id: 'relationship-tanaka', person: '田中', role: '最終承認者', context: 'Atlas導入' }]
};

describe('canonical Graph storage migration', () => {
  it('plans a deterministic v1 to v2 migration from explicit canonical evidence', () => {
    const input = {
      graph: legacyGraph,
      relationships,
      decisions: [{
        id: 'decision-user-outcome',
        title: 'Atlas導入の判断基準',
        decision: '実測と利用者成果を分けて判断する',
        supersedes: []
      }]
    };
    const before = structuredClone(input);

    const first = planCanonicalGraphMigration(input);
    const second = planCanonicalGraphMigration(input);

    expect(first).toEqual(second);
    expect(input).toEqual(before);
    expect(first.status).toBe('migration_required');
    expect(first.issues).toEqual([]);
    expect(first.graph.version).toBe(2);
    expect(first.graph.entities.map((entity) => entity.id)).toEqual([
      'decision-user-outcome',
      'org-unson',
      'person-tanaka-atlas',
      'project-atlas'
    ]);
    expect(first.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromId: 'person-tanaka-atlas', relation: 'participates_in', toId: 'project-atlas' }),
      expect.objectContaining({ fromId: 'decision-user-outcome', relation: 'governs', toId: 'project-atlas' })
    ]));
    expect(first.graph.edges).not.toContainEqual(expect.objectContaining({ relation: 'accountable_for' }));
    expect(first.inputDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.outputDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed when a legacy person name has multiple canonical candidates', () => {
    const ambiguousGraph: GraphFileV1 = {
      ...structuredClone(legacyGraph),
      entities: [
        ...legacyGraph.entities,
        { id: 'person-tanaka-other', type: 'person', name: '田中' }
      ]
    };

    const plan = planCanonicalGraphMigration({ graph: ambiguousGraph, relationships, decisions: [] });

    expect(plan.status).toBe('blocked');
    expect(plan.issues).toContainEqual(expect.objectContaining({
      code: 'ambiguous_person',
      recordId: 'relationship-tanaka'
    }));
    expect(plan.graph.edges.filter((edge) => edge.provenance?.sourceId === 'relationship-tanaka')).toEqual([]);
  });

  it('does not infer a project edge from free-form relationship context', () => {
    const graphWithoutExplicitProject: GraphFileV1 = {
      ...structuredClone(legacyGraph),
      entities: legacyGraph.entities.map((entity) => entity.id === 'person-tanaka-atlas'
        ? { ...entity, metadata: undefined }
        : entity)
    };

    const plan = planCanonicalGraphMigration({ graph: graphWithoutExplicitProject, relationships, decisions: [] });

    expect(plan.status).toBe('blocked');
    expect(plan.issues).toContainEqual(expect.objectContaining({
      code: 'missing_project_evidence',
      recordId: 'relationship-tanaka'
    }));
    expect(plan.graph.edges).toEqual([]);
  });

  it('treats an already migrated v2 graph as an idempotent no-op', () => {
    const migrated = planCanonicalGraphMigration({ graph: legacyGraph, relationships, decisions: [] }).graph;
    const plan = planCanonicalGraphMigration({ graph: migrated });

    expect(plan.status).toBe('up_to_date');
    expect(plan.graph).toEqual(migrated);
    expect(plan.changes).toEqual({ entitiesAdded: 0, edgesAdded: 0 });
  });

  it('treats the migrated four-file aggregate as an idempotent no-op', () => {
    const decisions = [{
      id: 'decision-user-outcome',
      title: 'Atlas導入の判断基準',
      decision: '実測と利用者成果を分けて判断する',
      supersedes: []
    }];
    const migrated = planCanonicalGraphMigration({ graph: legacyGraph, relationships, decisions }).graph;

    const plan = planCanonicalGraphMigration({ graph: migrated, relationships, decisions });

    expect(plan.status).toBe('up_to_date');
    expect(plan.graph).toEqual(migrated);
    expect(plan.issues).toEqual([]);
    expect(plan.changes).toEqual({ entitiesAdded: 0, edgesAdded: 0 });
  });

  it('preserves valid direct decision supersession IDs and reports missing endpoints', () => {
    const plan = planCanonicalGraphMigration({
      graph: legacyGraph,
      decisions: [
        { id: 'decision-new', title: 'New', decision: 'new', supersedes: ['decision-old', 'decision-missing'] },
        { id: 'decision-old', title: 'Old', decision: 'old' }
      ]
    });

    expect(plan.graph.edges).toContainEqual(expect.objectContaining({
      fromId: 'decision-new', relation: 'supersedes', toId: 'decision-old'
    }));
    expect(plan.issues).toContainEqual(expect.objectContaining({
      code: 'missing_decision_endpoint',
      recordId: 'decision-new'
    }));
  });

  it('accepts a Graph v2 value through the public union type', () => {
    const graph: GraphFileV2 = planCanonicalGraphMigration({ graph: legacyGraph }).graph;
    expect(graph.version).toBe(2);
  });

  it('rejects duplicate legacy IDs and decision ID collisions before migration', () => {
    const duplicateGraph: GraphFileV1 = {
      ...structuredClone(legacyGraph),
      entities: [...legacyGraph.entities, { id: 'project-atlas', type: 'org', name: 'Collision' }]
    };

    expect(() => planCanonicalGraphMigration({ graph: duplicateGraph })).toThrow(/GRAPH-ENTITY-ID-UNIQUE/);
    expect(() => planCanonicalGraphMigration({
      graph: legacyGraph,
      decisions: [{ id: 'project-atlas', title: 'Collision', decision: 'Collision' }]
    })).toThrow(/MIGRATION-ENTITY-ID-COLLISION/);
  });

  it('blocks an explicit project ID whose canonical endpoint is missing', () => {
    const graph: GraphFileV1 = {
      ...structuredClone(legacyGraph),
      entities: legacyGraph.entities
        .filter((entity) => entity.id !== 'project-atlas')
        .map((entity) => entity.id === 'person-tanaka-atlas'
          ? { ...entity, metadata: { projectId: 'project-missing' } }
          : entity)
    };

    const plan = planCanonicalGraphMigration({ graph });

    expect(plan.status).toBe('blocked');
    expect(plan.issues).toContainEqual(expect.objectContaining({
      code: 'missing_project_endpoint',
      recordId: 'person-tanaka-atlas'
    }));
  });

  it('never promotes a free-form relationship role to accountable_for', () => {
    const plan = planCanonicalGraphMigration({
      graph: legacyGraph,
      relationships: {
        version: 1,
        relationships: [{ id: 'relationship-friend', person: '田中', role: '友人', context: 'Atlas導入' }]
      }
    });

    expect(plan.status).toBe('migration_required');
    expect(plan.graph.edges).toContainEqual(expect.objectContaining({
      fromId: 'person-tanaka-atlas', relation: 'participates_in', toId: 'project-atlas'
    }));
    expect(plan.graph.edges).not.toContainEqual(expect.objectContaining({ relation: 'accountable_for' }));
  });

  it('is invariant to multiple legacy relationship record order', () => {
    const records = [
      { id: 'relationship-a', person: '田中', role: '最終承認者', context: 'Atlas導入' },
      { id: 'relationship-b', person: '田中', role: '相談相手', context: 'Atlas導入' }
    ];

    const first = planCanonicalGraphMigration({ graph: legacyGraph, relationships: { version: 1, relationships: records } });
    const second = planCanonicalGraphMigration({ graph: legacyGraph, relationships: { version: 1, relationships: [...records].reverse() } });

    expect(first.graph).toEqual(second.graph);
    expect(first.outputDigest).toBe(second.outputDigest);
  });

  it('rejects duplicate legacy relationship IDs before migration', () => {
    const duplicateRelationships: RelationshipsFile = {
      version: 1,
      relationships: [
        { id: 'relationship-duplicate', person: '田中', role: '最終承認者', context: 'Atlas導入' },
        { id: 'relationship-duplicate', person: '田中', role: '相談相手', context: 'Atlas導入' }
      ]
    };

    expect(() => planCanonicalGraphMigration({ graph: legacyGraph, relationships: duplicateRelationships }))
      .toThrow(/ONT-RELATIONSHIP-ID-UNIQUE.*relationship-duplicate/);
    expect(() => planCanonicalGraphMigration({
      graph: legacyGraph,
      relationships: { ...duplicateRelationships, relationships: [...duplicateRelationships.relationships].reverse() }
    })).toThrow(/ONT-RELATIONSHIP-ID-UNIQUE.*relationship-duplicate/);
  });

  it('rejects duplicate decision projection IDs even after Graph v2 migration', () => {
    const migrated = planCanonicalGraphMigration({ graph: legacyGraph }).graph;
    const duplicateDecisions = [
      { id: 'decision-duplicate', title: 'First', decision: 'First' },
      { id: 'decision-duplicate', title: 'Second', decision: 'Second' }
    ];

    expect(() => planCanonicalGraphMigration({ graph: migrated, decisions: duplicateDecisions }))
      .toThrow(/ONT-DECISION-ID-UNIQUE.*decision-duplicate/);
  });

  it('blocks self-referential and cyclic decision supersession before promoting edges', () => {
    const self = planCanonicalGraphMigration({
      graph: legacyGraph,
      decisions: [{ id: 'decision-self', title: 'Self', decision: 'Self', supersedes: ['decision-self'] }]
    });
    const cycle = planCanonicalGraphMigration({
      graph: legacyGraph,
      decisions: [
        { id: 'decision-a', title: 'A', decision: 'A', supersedes: ['decision-b'] },
        { id: 'decision-b', title: 'B', decision: 'B', supersedes: ['decision-a'] }
      ]
    });

    expect(self.status).toBe('blocked');
    expect(self.issues).toContainEqual(expect.objectContaining({
      code: 'decision_supersedes_self',
      recordId: 'decision-self'
    }));
    expect(self.graph.edges).not.toContainEqual(expect.objectContaining({ relation: 'supersedes' }));

    expect(cycle.status).toBe('blocked');
    expect(cycle.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'decision_supersedes_cycle', recordId: 'decision-a' }),
      expect.objectContaining({ code: 'decision_supersedes_cycle', recordId: 'decision-b' })
    ]));
    expect(cycle.graph.edges).not.toContainEqual(expect.objectContaining({ relation: 'supersedes' }));
  });

  it('blocks rather than silently dropping a legacy relationship entity', () => {
    const graph: GraphFileV1 = {
      ...structuredClone(legacyGraph),
      entities: [
        ...legacyGraph.entities,
        { id: 'relationship-legacy', type: 'relationship', name: '田中とAtlas導入' }
      ]
    };

    const plan = planCanonicalGraphMigration({ graph });

    expect(plan.status).toBe('blocked');
    expect(plan.issues).toContainEqual(expect.objectContaining({
      code: 'unsupported_relationship_entity',
      recordId: 'relationship-legacy'
    }));
  });

  it('preserves decision effective time on the canonical entity and its edges', () => {
    const plan = planCanonicalGraphMigration({
      graph: legacyGraph,
      decisions: [{
        id: 'decision-future',
        title: 'Future principle',
        decision: '実測と利用者成果を分けて判断する',
        effectiveAt: '2030-01-01T00:00:00.000Z'
      }]
    });

    expect(plan.graph.entities).toContainEqual(expect.objectContaining({
      id: 'decision-future',
      validFrom: '2030-01-01T00:00:00.000Z'
    }));
    expect(plan.graph.edges).toContainEqual(expect.objectContaining({
      fromId: 'decision-future',
      relation: 'governs',
      validFrom: '2030-01-01T00:00:00.000Z'
    }));
  });

  it('blocks a supersession cycle already present in a Graph v2 no-op input', () => {
    const graph = planCanonicalGraphMigration({
      graph: legacyGraph,
      decisions: [
        { id: 'decision-a', title: 'A', decision: 'A' },
        { id: 'decision-b', title: 'B', decision: 'B' }
      ]
    }).graph;
    const first = { fromId: 'decision-a', relation: 'supersedes' as const, toId: 'decision-b' };
    const second = { fromId: 'decision-b', relation: 'supersedes' as const, toId: 'decision-a' };
    graph.edges.push(
      { ...first, id: canonicalEdgeId(first) },
      { ...second, id: canonicalEdgeId(second) }
    );

    const plan = planCanonicalGraphMigration({ graph });

    expect(plan.status).toBe('blocked');
    expect(plan.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'decision_supersedes_cycle', recordId: 'decision-a' }),
      expect.objectContaining({ code: 'decision_supersedes_cycle', recordId: 'decision-b' })
    ]));
  });
});
