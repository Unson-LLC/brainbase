import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InfoSSOTService } from '../../server/services/info-ssot-service.js';
import { OntologyRegistry } from '../../server/services/ontology-registry.js';

const storyId = 'story-brainbase-ontology-kernel';
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function proposedRelease() {
  return new OntologyRegistry({ rootDir }).resolve({ version: '1.0.0' });
}

test(`${storyId} ac:1 registered types expose complete machine-readable semantics`, async () => {
  const { kernel } = proposedRelease();
  const required = ['description', 'identity', 'usage', 'examples', 'counter_examples', 'owner'];
  for (const [id, definition] of Object.entries(kernel.describe().entity_types)) {
    expect(required.every((field) => definition[field] != null), `${storyId} ac:1 type ${id}`).toBe(true);
  }
  expect(new Set(['app', 'product', 'brand', 'project'].map((id) => kernel.getType(id).identity)).size).toBe(4);
});

test(`${storyId} ac:2 relation vocabulary exposes endpoints and lifecycle semantics`, async () => {
  const { kernel } = proposedRelease();
  const required = ['from', 'to', 'direction', 'cardinality', 'lifecycle', 'provenance'];
  for (const [id, definition] of Object.entries(kernel.describe().relation_types)) {
    expect(required.every((field) => definition[field] != null), `${storyId} ac:2 relation ${id}`).toBe(true);
    expect(definition.inverse !== undefined || definition.symmetric !== undefined, `${storyId} ac:2 inverse ${id}`).toBe(true);
  }
});

test(`${storyId} ac:3 invalid relations are rejected before persistence with a rule id`, async () => {
  const { kernel } = proposedRelease();
  expect(kernel.validateEdge({ relation: 'owns', from_type: 'person', to_type: 'app' })).toMatchObject({
    valid: false,
    violations: [{ rule_id: 'relation-endpoint-owns' }]
  });
  expect(kernel.validateEdge({ relation: 'invented_relation', from_type: 'org', to_type: 'app' })).toMatchObject({
    valid: false,
    violations: [{ rule_id: 'relation-type-registered' }]
  });
});

test(`${storyId} ac:4 shared constraints reject ownerless apps and incomplete active decisions`, async () => {
  const { kernel } = proposedRelease();
  const result = kernel.validateSnapshot({
    complete: true,
    entities: [
      { id: 'app:ownerless', type: 'app', payload: {} },
      { id: 'decision:incomplete', type: 'decision', payload: { status: 'active' } }
    ],
    edges: []
  });
  expect(result.violations).toEqual(expect.arrayContaining([
    expect.objectContaining({ rule_id: 'CON-APP-OWNER-001' }),
    expect.objectContaining({ rule_id: 'CON-DECISION-ACTIVE-001' })
  ]));
});

test(`${storyId} ac:5 dry-run and DB audit distinguish violations from incomplete collection`, async () => {
  const registry = new OntologyRegistry({ rootDir });
  registry.index.current = '1.0.0';
  const client = {
    async query(sql: string) {
      if (sql.includes('FROM graph_entities')) return { rows: [{ id: 'app:ownerless', type: 'app', payload: {} }] };
      if (sql.includes('FROM graph_edges')) return { rows: [] };
      return { rows: [] };
    },
    release() {}
  };
  const service = new InfoSSOTService({ ontologyRegistry: registry, pool: { connect: async () => client } });
  const dryRun = service.validateOntology({
    version: '1.0.0',
    snapshot: { complete: false, entities: [], edges: [] }
  });
  const audit = await service.auditOntology(
    { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] },
    { limit: 10 }
  );
  expect(dryRun).toMatchObject({ verification: 'unverified', violations: [{ rule_id: 'snapshot-incomplete' }] });
  expect(audit).toMatchObject({
    verification: 'verified',
    completeness: { status: 'complete', entity_count: 1, edge_count: 0, failure: null }
  });
  expect(audit.violations).toContainEqual(expect.objectContaining({ rule_id: 'CON-APP-OWNER-001' }));
});
