import { canonicalEdgeId } from '../src/canonical-graph.js';
import { digestFoundationDefinition, foundationKey } from '../src/foundation-catalog.js';
import type { FoundationDefinition } from '../src/ontology-foundation.js';
import type { PortableGraphBundle } from '../src/portable-graph.js';
import { canonicalGraphOntologyRelease } from '../src/templates.js';
import type { CanonicalEdge, FoundationCatalog } from '../src/types.js';
import { EDGES, ENTITIES } from './graph-web-fixture.js';

/**
 * A synthetic bundle as an owner sends it with `graph:upgrade`: the local
 * Graph fixture, the owner `self` accountable for a project, a judgment
 * record for the decision, and one objective with its variable.  No real
 * people or organizations.
 */
export const OWNER_PERSON_ID = 'per_owner_fixture';
export const OWNER_NAME = '組織 花子';

const validFrom = '2026-08-01T00:00:00.000Z';

function definitionBase(id: string, type: FoundationDefinition['type']) {
  return {
    id,
    type,
    revision: '1',
    adoptionState: 'draft' as const,
    authorizedUses: ['draft', 'judgment'] as const,
    acl: { ownerId: 'self', visibility: 'private' as const, readerIds: ['self'], writerIds: ['self'] },
    storage: 'ontology' as const,
    provenance: [{ sourceId: 'synthetic-owner-private-fixture', sourceKind: 'document' as const, evidenceIds: [] }],
    scope: { subjectIds: ['self', 'project-atlas'], validFrom }
  };
}

export const VARIABLE = {
  ...definitionBase('variable-focus-hours', 'variable'),
  meaning: '週ごとの集中時間',
  subject: 'self/focus',
  valueKind: 'number',
  unit: 'hours',
  aggregation: 'sum',
  granularity: 'week',
  measurementMethod: 'calendar blocks marked focus'
} as unknown as FoundationDefinition;

export function objectiveDefinition(revision = '1', desiredState = '毎週10時間以上の集中時間を守る'): FoundationDefinition {
  return {
    ...definitionBase('objective-protect-focus', 'objective'),
    revision,
    meaning: '集中時間を守る',
    beneficiaryIds: ['self', 'person-tanaka'],
    desiredState,
    criteria: [{ variableRef: { id: 'variable-focus-hours', type: 'variable', revision: '1' }, operator: 'at_least', target: 10 }],
    evaluationPeriod: { from: validFrom, until: '2026-09-30T23:59:59.000Z' },
    accountableId: 'self'
  } as unknown as FoundationDefinition;
}

export function foundationCatalog(definitions: FoundationDefinition[] = [VARIABLE, objectiveDefinition()]): FoundationCatalog {
  const latest: FoundationCatalog['latest'] = {};
  for (const definition of definitions) {
    const key = foundationKey(definition);
    const current = latest[key];
    if (!current || Number(current.revision) < Number(definition.revision)) {
      latest[key] = { id: definition.id, type: definition.type, revision: definition.revision };
    }
  }
  return {
    version: 1,
    records: definitions.map((definition) => ({ definition, digest: digestFoundationDefinition(definition) })),
    latest,
    relations: []
  };
}

function edge(fromId: string, relation: CanonicalEdge['relation'], toId: string, extra: Partial<CanonicalEdge> = {}): CanonicalEdge {
  return { id: canonicalEdgeId({ fromId, relation, toId }), fromId, relation, toId, ...extra };
}

export const SELF_ATLAS = edge('self', 'accountable_for', 'project-atlas', { role: '発起人' });

export function ownerPrivateBundle({ foundation = foundationCatalog() }: { foundation?: FoundationCatalog | null } = {}): PortableGraphBundle {
  return {
    schemaVersion: 1,
    graph: {
      version: 2,
      ontology: canonicalGraphOntologyRelease.binding,
      owner: { id: 'self', name: 'Owner' },
      entities: Object.values(ENTITIES).map((entity) => structuredClone(entity)),
      edges: [...Object.values(EDGES), SELF_ATLAS].map((item) => structuredClone(item)),
      ...(foundation ? { foundation } : {})
    },
    decisions: [{
      id: 'decision-scope',
      title: 'スコープ',
      decision: '小さく始める',
      rationale: '最初の利用者の手戻りを小さくするため',
      topic: 'scope',
      effectiveAt: '2026-08-01T00:00:00.000Z'
    }]
  } as PortableGraphBundle;
}
