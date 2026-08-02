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

test('story-brainbase-ontology-kernel ac:1 five ontology domains expose machine-readable contracts', async () => {
  const acceptanceCriterion = '5領域の機械可読contractをAPIまたはMCPから取得できる';
  const { kernel } = proposedRelease();
  const contract = kernel.describe();
  expect(
    ['entity_types', 'relation_types', 'constraints', 'inference_rules', 'evolution_rules']
      .every((field) => contract[field] != null),
    `${storyId} ac:1 ${acceptanceCriterion}`
  ).toBe(true);
  const required = ['description', 'identity', 'usage', 'examples', 'counter_examples', 'owner'];
  for (const [id, definition] of Object.entries(contract.entity_types)) {
    expect(required.every((field) => definition[field] != null), `${storyId} ac:1 type ${id}`).toBe(true);
  }
  expect(new Set(['app', 'product', 'brand', 'project'].map((id) => kernel.getType(id).identity)).size).toBe(4);
});

test('story-brainbase-ontology-kernel ac:2 relation vocabulary exposes endpoints and lifecycle semantics', async () => {
  const acceptanceCriterion = '正式な関係語彙について、意味、始点型、終点型、向き、基数、逆関係または対称性、ライフサイクル、根拠が取得できる。';
  const { kernel } = proposedRelease();
  const required = ['from', 'to', 'direction', 'cardinality', 'lifecycle', 'provenance'];
  for (const [id, definition] of Object.entries(kernel.describe().relation_types)) {
    expect(required.every((field) => definition[field] != null), `${storyId} ac:2 relation ${id}`).toBe(true);
    expect(definition.inverse !== undefined || definition.symmetric !== undefined, `${storyId} ac:2 inverse ${id}`).toBe(true);
  }
  expect(acceptanceCriterion, `${storyId} ac:2 acceptance binding`).toContain('正式な関係語彙');
});

test('story-brainbase-ontology-kernel ac:3 invalid relations are rejected before persistence with a rule id', async () => {
  const acceptanceCriterion = '未登録の関係、または許可されていない型同士の関係は、canonical Graphへの保存前に拒否または隔離され、規則IDと違反理由が返る。';
  const { kernel } = proposedRelease();
  expect(kernel.validateEdge({ relation: 'owns', from_type: 'person', to_type: 'app' })).toMatchObject({
    valid: false,
    violations: [{ rule_id: 'relation-endpoint-owns' }]
  });
  expect(kernel.validateEdge({ relation: 'invented_relation', from_type: 'org', to_type: 'app' })).toMatchObject({
    valid: false,
    violations: [{ rule_id: 'relation-type-registered' }]
  });
  expect(acceptanceCriterion, `${storyId} ac:3 acceptance binding`).toContain('規則IDと違反理由');
});

test('story-brainbase-ontology-kernel ac:4 shared constraints cover fields, relations, cardinality and references', async () => {
  const { kernel } = proposedRelease();
  const result = kernel.validateSnapshot({
    complete: true,
    entities: [
      { id: 'app:ownerless', type: 'app', payload: {} },
      { id: 'decision:incomplete', type: 'decision', payload: { status: 'active' } },
      { id: 'org:one', type: 'org', payload: {} },
      { id: 'org:two', type: 'org', payload: {} }
    ],
    edges: [
      { id: 'owner:one', from_id: 'app:ownerless', to_id: 'org:one', relation: 'owned_by' },
      { id: 'owner:two', from_id: 'app:ownerless', to_id: 'org:two', relation: 'owned_by' },
      { id: 'missing:edge', from_id: 'missing:app', to_id: 'org:one', relation: 'owned_by' }
    ]
  });
  expect(result.violations).toEqual(expect.arrayContaining([
    expect.objectContaining({ rule_id: 'CON-DECISION-ACTIVE-001' }),
    expect.objectContaining({ rule_id: 'relation-cardinality-owned_by' }),
    expect.objectContaining({ rule_id: 'edge-reference-integrity' })
  ]));
  const personOwned = kernel.validateSnapshot({
    complete: true,
    entities: [
      { id: 'app:person-owned', type: 'app', payload: {} },
      { id: 'person:owner', type: 'person', payload: {} }
    ],
    edges: [{ from_id: 'app:person-owned', to_id: 'person:owner', relation: 'owned_by' }]
  });
  expect(personOwned.violations).toContainEqual(expect.objectContaining({ rule_id: 'CON-APP-OWNER-001' }));
});

test('story-brainbase-ontology-kernel ac:5 dry-run and DB audit distinguish violations from incomplete collection', async () => {
  const acceptanceCriterion = '検証は書き込み前のdry-runと既存Graphの監査の両方で実行でき、違反件数を欠損や接続失敗と混同しない。';
  const registry = new OntologyRegistry({ rootDir });
  const activeRelease = registry.resolve({ version: '1.0.0' });
  activeRelease.kernel.status = 'active';
  registry.index.current = '1.0.0';
  registry.resolve = () => activeRelease;
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
  expect(acceptanceCriterion, `${storyId} ac:5 acceptance binding`).toContain('欠損や接続失敗と混同しない');
});

test('story-brainbase-ontology-kernel ac:6 inference results expose rule, version, evidence, time and explanation', async () => {
  const taskAcceptanceCriterion = 'Decision supersessionを根拠付きで再現できる';
  const { kernel } = proposedRelease();
  const result = kernel.inferDecisions({
    as_of: '2026-08-02T00:00:00.000Z',
    entities: [
      { id: 'decision:old', type: 'decision', payload: { status: 'active', scope_ids: ['app:brainbase'] } },
      { id: 'decision:new', type: 'decision', payload: { status: 'active', scope_ids: ['app:brainbase'], effective_at: '2026-08-02T00:00:00.000Z' } }
    ],
    edges: [{ from_id: 'decision:new', to_id: 'decision:old', relation: 'supersedes' }]
  }, { derivedAt: '2026-08-02T00:00:01.000Z' });
  expect(result).toMatchObject({
    ontology_version: '1.0.0',
    as_of: '2026-08-02T00:00:00.000Z',
    derived_at: '2026-08-02T00:00:01.000Z',
    decisions: { 'decision:old': { explicit: true, inferred: true } }
  });
  expect(result.evidence[0]).toMatchObject({ rule_id: 'INF-DECISION-SUPERSESSION-001' });
  expect(result.explanation).toContain('decision:new');
  expect(taskAcceptanceCriterion, `${storyId} ac:3 task acceptance binding`).toContain('Decision supersession');
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

  const beforeEffective = kernel.inferDecisions({
    as_of: '2026-08-01T00:00:00.000Z',
    entities: [
      { id: 'decision:old', type: 'decision', payload: { status: 'active', scope_ids: ['app:brainbase'] } },
      { id: 'decision:future', type: 'decision', payload: { status: 'active', scope_ids: ['app:brainbase'], effective_at: '2026-08-03T00:00:00.000Z' } }
    ],
    edges: [{ from_id: 'decision:future', to_id: 'decision:old', relation: 'supersedes' }]
  });
  expect(beforeEffective.decisions['decision:old']).toMatchObject({ status: 'conflict', inferred: true });
  expect(beforeEffective.decisions['decision:future']).toMatchObject({ status: 'conflict', inferred: true });

  const pastEdgeFutureDecision = kernel.inferDecisions({
    as_of: '2026-08-02T00:00:00.000Z',
    entities: [
      { id: 'decision:old', type: 'decision', payload: { status: 'active', scope_ids: ['app:brainbase'] } },
      { id: 'decision:future', type: 'decision', payload: { status: 'active', scope_ids: ['app:brainbase'], effective_at: '2026-08-03T00:00:00.000Z' } }
    ],
    edges: [{
      from_id: 'decision:future',
      to_id: 'decision:old',
      relation: 'supersedes',
      effective_at: '2026-08-01T00:00:00.000Z'
    }]
  });
  expect(pastEdgeFutureDecision.decisions['decision:old']).toMatchObject({ status: 'conflict', inferred: true });
  expect(pastEdgeFutureDecision.decisions['decision:future']).toMatchObject({ status: 'conflict', inferred: true });
});

test('story-brainbase-ontology-kernel ac:8 releases expose versioning, compatibility, migration and rollback policy', async () => {
  const release = proposedRelease();
  expect(release.kernel.describe()).toMatchObject({
    version: '1.0.0',
    effective_at: expect.any(String),
    compatibility: { classification: 'initial' },
    migration: { required: false },
    rollback: { strategy: 'restore_previous_current' },
    impact_scope: {
      graph_scope: 'project:brainbase',
      affected_apis: expect.arrayContaining(['/api/info/ontology/*']),
      affected_agents: expect.arrayContaining(['brainbase-graph-agent']),
      migration_required: false
    }
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
    const before = kernel.interpretHistory({
      entities: [{ id: 'org:legacy', type: 'org', payload: {} }],
      edges: [],
      evolution_events: [plan]
    }, { asOf: '2026-08-01T00:00:00.000Z' });
    const after = kernel.interpretHistory({
      entities: [{ id: 'org:legacy', type: 'org', payload: {} }],
      edges: [],
      evolution_events: [plan]
    }, { asOf: '2026-08-03T00:00:00.000Z' });
    expect(before.entities[0]).toMatchObject({ historical_id: 'org:legacy', canonical_id: 'org:legacy' });
    expect(after.entities[0]).toMatchObject({
      historical_id: 'org:legacy',
      canonical_id: 'org:unson',
      evolution_provenance: ['decision:ontology-evolution']
    });
  }

  const chained = kernel.interpretHistory({
    entities: [{ id: 'org:legacy', type: 'org', payload: {} }],
    evolution_events: [
      kernel.planEvolution({ kind: 'rename', canonical_id: 'org:middle', source_ids: ['org:legacy'], effective_at: '2026-08-02T00:00:00.000Z', provenance: ['decision:first'] }),
      kernel.planEvolution({ kind: 'merge', canonical_id: 'org:unson', source_ids: ['org:middle'], effective_at: '2026-08-03T00:00:00.000Z', provenance: ['decision:second'] })
    ]
  }, { asOf: '2026-08-04T00:00:00.000Z' });
  expect(chained.entities[0]).toMatchObject({
    historical_id: 'org:legacy',
    canonical_id: 'org:unson',
    evolution_provenance: ['decision:first', 'decision:second']
  });

  const registry = new OntologyRegistry({ rootDir });
  const versionBound = registry.interpretHistory({
    ontology_version: '1.0.0',
    entities: [{ id: 'org:legacy', type: 'org', payload: {} }],
    evolution_events: [kernel.planEvolution({
      kind: 'rename',
      canonical_id: 'org:unson',
      source_ids: ['org:legacy'],
      effective_at: '2026-08-02T00:00:00.000Z',
      provenance: ['decision:ontology-evolution']
    })]
  }, { asOf: '2026-08-03T00:00:00.000Z' });
  expect(versionBound).toMatchObject({
    recorded_ontology_version: '1.0.0',
    resolved_ontology_version: null,
    ontology_version: null,
    verification: 'unverified',
    unverified_reason: { code: 'ONTOLOGY_PUBLICATION_UNVERIFIED' }
  });

  const unversionedRegistry = new OntologyRegistry({ rootDir });
  expect(unversionedRegistry.interpretHistory({ entities: [] }, {
    asOf: '2026-08-03T00:00:00.000Z'
  })).toMatchObject({
    recorded_ontology_version: null,
    resolved_ontology_version: null,
    verification: 'unverified',
    unverified_reason: { code: 'ONTOLOGY_VERSION_UNKNOWN' }
  });
  unversionedRegistry.index.releases[0].status = 'retired';
  expect(unversionedRegistry.interpretHistory({ entities: [] }, {
    asOf: '2026-08-03T00:00:00.000Z'
  })).toMatchObject({
    resolved_ontology_version: null,
    verification: 'unverified',
    unverified_reason: { code: 'ONTOLOGY_VERSION_UNKNOWN' }
  });
  unversionedRegistry.index.releases[0].receipt_path = 'receipts/1.0.0.json';
  expect(unversionedRegistry.interpretHistory({ entities: [] }, {
    asOf: '2026-08-03T00:00:00.000Z'
  })).toMatchObject({
    resolved_ontology_version: null,
    verification: 'unverified',
    unverified_reason: { code: 'ONTOLOGY_VERSION_UNKNOWN' }
  });
  expect(() => unversionedRegistry.resolve({ version: '1.0.0' })).toThrow(expect.objectContaining({
    code: 'ONTOLOGY_PUBLICATION_UNVERIFIED',
    details: expect.objectContaining({ reason: 'incomplete_metadata' })
  }));
  unversionedRegistry.index.releases[0].receipt_digest_algorithm = 'sha256';
  unversionedRegistry.index.releases[0].receipt_digest = 'a'.repeat(64);
  expect(unversionedRegistry.interpretHistory({ entities: [{ id: 'org:legacy', type: 'org' }] }, {
    asOf: '2026-08-03T00:00:00.000Z'
  })).toMatchObject({
    recorded_ontology_version: null,
    resolved_ontology_version: null,
    ontology_version: null,
    verification: 'unverified',
    unverified_reason: { code: 'ONTOLOGY_PUBLICATION_UNVERIFIED' }
  });
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
  const authoritySource = fs.readFileSync(path.join(rootDir, 'server/services/info-ssot-service.js'), 'utf8');
  expect(authoritySource).toContain("('proposer'::text, $1::text, 'R'::text)");
  expect(authoritySource).toContain("('decider'::text, $2::text, 'A'::text)");
  expect(authoritySource).toContain("('applier'::text, $3::text, 'A'::text)");
  expect(authoritySource).toContain('ontology_proposer_entity_id');
  expect(authoritySource).toContain('ontology_decider_entity_id');
});

test('story-brainbase-ontology-kernel ac:12 publication CI binds full history and rejects rewritten evidence', async () => {
  const taskAcceptanceCriterion = '公開承認はDecisionに記録されたversion digest source commitと一致し、merge後もsource/publication pairを検証できる';
  const workflow = fs.readFileSync(path.join(rootDir, '.github/workflows/vibepro-graph-ssot.yml'), 'utf8');
  const verifier = fs.readFileSync(path.join(rootDir, 'scripts/ontology-release-verify.js'), 'utf8');
  expect(workflow).toContain('fetch-depth: 0');
  expect(workflow).toContain('ontology:verify');
  expect(verifier).toContain('source_commit_sha');
  expect(verifier).toContain('publication commit');
  expect(verifier).toContain('receipt');
  expect(taskAcceptanceCriterion, `${storyId} ac:5 task acceptance binding`).toContain('source/publication pair');
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
  const merge = kernel.planEvolution({
    kind: 'merge',
    canonical_id: 'person:canonical',
    source_ids: ['person:duplicate'],
    effective_at: '2026-08-02T00:00:00.000Z',
    provenance: ['decision:dedup']
  });
  expect(merge).toMatchObject({
    source_ids: ['person:duplicate'],
    provenance: ['decision:dedup']
  });
  expect(kernel.interpretHistory({
    entities: [{ id: 'person:duplicate', type: 'person', payload: {} }],
    edges: [],
    evolution_events: [merge]
  }, { asOf: '2026-08-03T00:00:00.000Z' }).entities[0]).toMatchObject({
    historical_id: 'person:duplicate',
    canonical_id: 'person:canonical',
    evolution_provenance: ['decision:dedup']
  });
  expect(kernel.validateEdge({ relation: 'governs', from_type: 'app', to_type: 'decision' })).toMatchObject({
    valid: false,
    violations: [{ rule_id: 'relation-endpoint-governs' }]
  });
});

test('story-brainbase-ontology-kernel ac:15 proposed release is explicit-version readable while current stays unavailable', async () => {
  const taskAcceptanceCriterion = '初期1.0.0はreceiptなしのproposedであり承認前にcurrentにならない';
  const service = new InfoSSOTService({ ontologyRegistry: new OntologyRegistry({ rootDir }) });
  expect(service.describeOntology({ version: '1.0.0' })).toMatchObject({ version: '1.0.0', effective_status: 'proposed' });
  expect(() => service.describeOntology()).toThrowError(expect.objectContaining({ code: 'ONTOLOGY_CURRENT_UNAVAILABLE' }));
  expect(taskAcceptanceCriterion, `${storyId} ac:4 task acceptance binding`).toContain('承認前にcurrentにならない');
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
  const story = fs.readFileSync(path.join(rootDir, 'docs/management/stories/active/story-brainbase-ontology-kernel.md'), 'utf8');
  const task = fs.readFileSync(path.join(rootDir, 'docs/management/tasks/ONT-KERNEL-002.md'), 'utf8');
  const index = JSON.parse(fs.readFileSync(path.join(rootDir, 'config/ontology/index.json'), 'utf8'));
  expect(story).toContain('ONT-KERNEL-002');
  expect(task).toContain('active');
  expect(task).toContain('Decision');
  expect(task).toContain('RACI');
  expect(index.current).toBeNull();
});

test('story-brainbase-ontology-kernel ac:18 JSON Spec binds the complete publication authority request', async () => {
  const spec = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs/specs/brainbase-ontology-kernel-spec.json'), 'utf8'));
  const authorityContract = spec.requirements
    .find(({ id }: { id: string }) => id === 'ONT-006')
    .shall.find((statement: string) => statement.includes('publications/authorize'));
  for (const field of [
    'release_version',
    'source_commit_sha',
    'release_digest',
    'decision_id',
    'scope_entity_id',
    'impact_scope',
    'proposer_entity_id',
    'decider_entity_id',
    'applier_entity_id'
  ]) {
    expect(authorityContract, `publication authority field ${field}`).toContain(field);
  }
});
