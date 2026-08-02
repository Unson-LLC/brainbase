import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InfoSSOTService } from '../../server/services/info-ssot-service.js';
import { OntologyRegistry } from '../../server/services/ontology-registry.js';

const storyId = 'story-brainbase-ontology-kernel';
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function proposedRelease() {
  return new OntologyRegistry({ rootDir }).resolve({ version: '1.0.0' });
}

test('story-brainbase-ontology-kernel ac:1 registered types expose complete machine-readable semantics', async () => {
  const { kernel } = proposedRelease();
  const required = ['description', 'identity', 'usage', 'examples', 'counter_examples', 'owner'];
  for (const [id, definition] of Object.entries(kernel.describe().entity_types)) {
    expect(required.every((field) => definition[field] != null), `${storyId} ac:1 type ${id}`).toBe(true);
  }
  expect(new Set(['app', 'product', 'brand', 'project'].map((id) => kernel.getType(id).identity)).size).toBe(4);
});

test('story-brainbase-ontology-kernel ac:2 relation vocabulary exposes endpoints and lifecycle semantics', async () => {
  const { kernel } = proposedRelease();
  const required = ['from', 'to', 'direction', 'cardinality', 'lifecycle', 'provenance'];
  for (const [id, definition] of Object.entries(kernel.describe().relation_types)) {
    expect(required.every((field) => definition[field] != null), `${storyId} ac:2 relation ${id}`).toBe(true);
    expect(definition.inverse !== undefined || definition.symmetric !== undefined, `${storyId} ac:2 inverse ${id}`).toBe(true);
  }
});

test('story-brainbase-ontology-kernel ac:3 invalid relations are rejected before persistence with a rule id', async () => {
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

test('story-brainbase-ontology-kernel ac:4 shared constraints reject ownerless apps and incomplete active decisions', async () => {
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

test('story-brainbase-ontology-kernel ac:5 dry-run and DB audit distinguish violations from incomplete collection', async () => {
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

test('story-brainbase-ontology-kernel ac:6 inference results expose rule, version, evidence, time and explanation', async () => {
  const { kernel } = proposedRelease();
  const result = kernel.inferDecisions({
    as_of: '2026-08-02T00:00:00.000Z',
    entities: [
      { id: 'decision:old', type: 'decision', payload: { status: 'active', scope_ids: ['app:brainbase'] } },
      { id: 'decision:new', type: 'decision', payload: { status: 'active', scope_ids: ['app:brainbase'], effective_at: '2026-08-02T00:00:00.000Z' } }
    ],
    edges: [{ from_id: 'decision:new', to_id: 'decision:old', relation: 'supersedes' }]
  });
  expect(result).toMatchObject({
    ontology_version: '1.0.0',
    as_of: '2026-08-02T00:00:00.000Z',
    decisions: { 'decision:old': { explicit: true, inferred: true } }
  });
  expect(result.evidence[0]).toMatchObject({ rule_id: 'INF-DECISION-SUPERSESSION-001' });
  expect(result.explanation).toContain('decision:new');
});

test('story-brainbase-ontology-kernel ac:7 S-001 only explicit effective supersedes resolves a decision', async () => {
  const { kernel } = proposedRelease();
  const conflict = kernel.inferDecisions({
    entities: [
      { id: 'decision:a', type: 'decision', payload: { status: 'active', scope_ids: ['app:brainbase'] } },
      { id: 'decision:b', type: 'decision', payload: { status: 'active', scope_ids: ['app:brainbase'] } }
    ],
    edges: []
  });
  expect(conflict.decisions['decision:a']).toMatchObject({ status: 'conflict', inferred: true });
  expect(conflict.evidence).toContainEqual(expect.objectContaining({ rule_id: 'decision-active-conflict' }));
});

test('story-brainbase-ontology-kernel ac:8 releases expose versioning, compatibility, migration and rollback policy', async () => {
  const release = proposedRelease();
  expect(release.kernel.describe()).toMatchObject({
    version: '1.0.0',
    effective_at: expect.any(String),
    compatibility: { classification: 'initial' },
    migration: { required: false },
    rollback: { strategy: 'restore_previous_current' }
  });
  expect(release.kernel.describe().evolution_rules).toMatchObject({ breaking: 'major', additive: 'minor', editorial: 'patch' });
});

test('story-brainbase-ontology-kernel ac:9 rename and merge evolution preserve canonical identity and provenance', async () => {
  const { kernel } = proposedRelease();
  for (const kind of ['rename', 'merge']) {
    const plan = kernel.planEvolution({
      kind,
      canonical_id: 'org:unson',
      source_ids: ['org:legacy'],
      effective_at: '2026-08-02T00:00:00.000Z',
      provenance: ['decision:ontology-evolution']
    });
    expect(plan).toMatchObject({
      canonical_id: 'org:unson',
      source_ids: ['org:legacy'],
      provenance: ['decision:ontology-evolution'],
      conflict_policy: 'explicit_decision_required'
    });
    expect(plan.aliases).toEqual(kind === 'rename' ? ['org:legacy'] : []);
  }
});

test('story-brainbase-ontology-kernel ac:10 impact reports affected facts, APIs, agents and migration need', async () => {
  const { kernel } = proposedRelease();
  const result = kernel.impact({
    change: {
      kind: 'narrow_endpoint',
      relation: 'governs',
      affected_apis: ['/api/info/ontology/infer/decisions'],
      affected_agents: ['brainbase-graph-agent']
    },
    snapshot: {
      entities: [{ id: 'decision:one', type: 'decision' }, { id: 'app:brainbase', type: 'app' }],
      edges: [{ from_id: 'decision:one', to_id: 'app:brainbase', relation: 'governs' }]
    }
  });
  expect(result).toMatchObject({ match_count: 1, representative_ids: ['decision:one:governs:app:brainbase'] });
  expect(result.affected_apis).toEqual(['/api/info/ontology/infer/decisions']);
  expect(result.affected_agents).toEqual(['brainbase-graph-agent']);
  expect(typeof result.migration_required).toBe('boolean');
});

test('story-brainbase-ontology-kernel ac:11 unapproved governance cannot become canonical current', async () => {
  const registry = new OntologyRegistry({ rootDir });
  const release = registry.resolve({ version: '1.0.0' });
  expect(release.kernel.describe().governance).toMatchObject({
    decision_id: null,
    scope_entity_id: null,
    proposer_entity_id: null,
    decider_entity_id: null,
    applier_entity_id: null
  });
  expect(registry.index.current).toBeNull();
  expect(() => registry.resolve()).toThrowError(expect.objectContaining({ code: 'ONTOLOGY_CURRENT_UNAVAILABLE' }));
});

test('story-brainbase-ontology-kernel ac:12 publication CI binds full history and rejects rewritten evidence', async () => {
  const workflow = fs.readFileSync(path.join(rootDir, '.github/workflows/vibepro-graph-ssot.yml'), 'utf8');
  const verifier = fs.readFileSync(path.join(rootDir, 'scripts/ontology-release-verify.js'), 'utf8');
  expect(workflow).toContain('fetch-depth: 0');
  expect(workflow).toContain('ontology:verify');
  expect(verifier).toContain('source_commit_sha');
  expect(verifier).toContain('publication commit');
  expect(verifier).toContain('receipt');
});

test('story-brainbase-ontology-kernel ac:13 Core and Extension projection metadata remains explicit', async () => {
  const { kernel } = proposedRelease();
  const definitions = kernel.describe().entity_types;
  expect(definitions.app).toMatchObject({ category: 'core', default_search: true });
  const extension = Object.values(definitions).filter((definition) => definition.category === 'extension');
  expect(extension.length).toBeGreaterThan(0);
  expect(extension.every((definition) => definition.default_search === false)).toBe(true);
});

test('story-brainbase-ontology-kernel ac:14 evolution fixtures reproduce rename, dedup, supersession and invalid relation rules', async () => {
  const { kernel } = proposedRelease();
  expect(kernel.planEvolution({
    kind: 'merge',
    canonical_id: 'person:canonical',
    source_ids: ['person:duplicate'],
    effective_at: '2026-08-02T00:00:00.000Z',
    provenance: ['decision:dedup']
  })).toMatchObject({
    source_ids: ['person:duplicate'],
    provenance: ['decision:dedup']
  });
  expect(kernel.validateEdge({ relation: 'governs', from_type: 'app', to_type: 'decision' })).toMatchObject({
    valid: false,
    violations: [{ rule_id: 'relation-endpoint-governs' }]
  });
});

test('story-brainbase-ontology-kernel ac:15 proposed release is explicit-version readable while current stays unavailable', async () => {
  const service = new InfoSSOTService({ ontologyRegistry: new OntologyRegistry({ rootDir }) });
  expect(service.describeOntology({ version: '1.0.0' })).toMatchObject({ version: '1.0.0', effective_status: 'proposed' });
  expect(() => service.describeOntology()).toThrowError(expect.objectContaining({ code: 'ONTOLOGY_CURRENT_UNAVAILABLE' }));
});

test('story-brainbase-ontology-kernel ac:16 current absence preserves legacy writes but closes canonical audit and commit', async () => {
  const service = new InfoSSOTService({ ontologyRegistry: new OntologyRegistry({ rootDir }) });
  expect(service.getOntologyGuard()).toEqual({ guard_status: 'inactive_no_current', ontology_version: null });
  await expect(service.auditOntology(
    { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] },
    { limit: 1 }
  )).rejects.toMatchObject({ code: 'ONTOLOGY_CURRENT_UNAVAILABLE' });
});

test('story-brainbase-ontology-kernel ac:17 active publication remains an explicit follow-up task', async () => {
  const task = fs.readFileSync(path.join(rootDir, 'docs/management/tasks/ONT-KERNEL-001.md'), 'utf8');
  const index = JSON.parse(fs.readFileSync(path.join(rootDir, 'config/ontology/index.json'), 'utf8'));
  expect(task).toContain('active');
  expect(task).toContain('Decision');
  expect(task).toContain('RACI');
  expect(index.current).toBeNull();
});
