import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OntologyRegistry } from '../../server/services/ontology-registry.js';
import { InfoSSOTService } from '../../server/services/info-ssot-service.js';
import { GraphMaintenanceService } from '../../server/services/graph-maintenance-service.js';
import { hashGraphSnapshot } from '../../server/services/graph-maintenance-engine.js';
import { createProposedOntologyFixture } from '../helpers/ontology-test-fixtures.js';

const storyId = 'story-brainbase-ontology-production-compatibility';
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const proposedFixture = createProposedOntologyFixture(sourceRoot);
const rootDir = proposedFixture.rootDir;

test.afterAll(() => proposedFixture.cleanup());

function proposedRelease() {
  return new OntologyRegistry({ rootDir }).resolve({ version: '1.0.0' });
}

test(`${storyId} ac:1 classifies only verified production vocabulary`, async () => {
  const { kernel } = proposedRelease();
  const { manifest } = kernel;
  for (const type of ['capital', 'contract', 'database', 'database_cluster', 'diagnosis', 'finance', 'finance_account', 'org_alias', 'organization', 'person_alias', 'push_case']) {
    expect(manifest.entity_types[type]?.classification, `${storyId} ac:1 type ${type}`).toBe('compatibility');
  }
  expect(manifest.relation_types.appeared_in?.classification, `${storyId} ac:1 verified relation`).toBe('compatibility');
});

test(`${storyId} ac:2 accepts verified many-to-many project membership`, async () => {
  const { kernel } = proposedRelease();
  const { manifest } = kernel;
  expect(manifest.relation_types.belongs_to_project.cardinality, `${storyId} ac:2 cardinality`).toBe('many_to_many');
  const result = kernel.validateSnapshot({
    complete: true,
    entities: [
      { id: 'contact:one', type: 'contact', payload: {} },
      { id: 'project:one', type: 'project', payload: {} },
      { id: 'project:two', type: 'project', payload: {} }
    ],
    edges: [
      { from_id: 'contact:one', to_id: 'project:one', relation: 'belongs_to_project' },
      { from_id: 'contact:one', to_id: 'project:two', relation: 'belongs_to_project' }
    ]
  });
  expect(result.violations, `${storyId} ac:2 verified memberships`).toEqual([]);
});

test('story-brainbase-ontology-production-compatibility ac:3 validates and infers decided Decisions from Graph edges', async () => {
  const { kernel } = proposedRelease();
  const entities = [
    { id: 'decision:a', type: 'decision', payload: { status: 'decided' } },
    { id: 'decision:b', type: 'decision', payload: { status: 'decided' } },
    { id: 'person:one', type: 'person', payload: {} },
    { id: 'project:one', type: 'project', payload: {} }
  ];
  const edges = [
    { from_id: 'decision:a', to_id: 'person:one', relation: 'owned_by' },
    { from_id: 'decision:b', to_id: 'person:one', relation: 'owned_by' },
    { from_id: 'decision:a', to_id: 'project:one', relation: 'belongs_to_project' },
    { from_id: 'decision:b', to_id: 'project:one', relation: 'belongs_to_project' }
  ];
  expect(kernel.validateSnapshot({ complete: true, entities, edges }).violations, `${storyId} ac:3 valid`).toEqual([]);
  expect(kernel.inferDecisions({ entities, edges }).evidence, `${storyId} ac:3 conflict`).toContainEqual(
    expect.objectContaining({ rule_id: 'decision-active-conflict' })
  );

  const missingDecider = kernel.validateSnapshot({ complete: true, entities, edges: edges.filter((edge) => edge.relation !== 'owned_by') });
  expect(missingDecider.violations, `${storyId} ac:3 missing decider`).toContainEqual(
    expect.objectContaining({ rule_id: 'CON-DECISION-DECIDER-001' })
  );
  const missingScope = kernel.validateSnapshot({ complete: true, entities, edges: edges.filter((edge) => edge.relation !== 'belongs_to_project') });
  expect(missingScope.violations, `${storyId} ac:3 missing scope`).toContainEqual(
    expect.objectContaining({ rule_id: 'CON-DECISION-SCOPE-001' })
  );

  const invalidScopeEdges = [
    { from_id: 'decision:a', to_id: 'person:one', relation: 'belongs_to_project' },
    { from_id: 'decision:b', to_id: 'person:one', relation: 'belongs_to_project' },
    { from_id: 'decision:a', to_id: 'project:missing', relation: 'belongs_to_project' },
    { from_id: 'decision:b', to_id: 'project:missing', relation: 'belongs_to_project' }
  ];
  const invalidScopeInference = kernel.inferDecisions({ entities, edges: invalidScopeEdges });
  expect(invalidScopeInference.evidence, `${storyId} ac:3 invalid scope ignored`).not.toContainEqual(
    expect.objectContaining({ rule_id: 'decision-active-conflict' })
  );
  expect(invalidScopeInference.decisions['decision:a']).toMatchObject({ status: 'decided' });
  expect(invalidScopeInference.decisions['decision:b']).toMatchObject({ status: 'decided' });
});

test('story-ontology-scoped-validation-and-decision-authority ac:1-3 validates Graph maintenance scope with the real OntologyKernel', async () => {
  const snapshot = {
    project_code: 'brainbase',
    entities: [
      { id: 'decision:active', entity_type: 'decision', lifecycle_status: 'active', payload: { status: 'decided' } },
      { id: 'decision:retired', entity_type: 'decision', lifecycle_status: 'retired', payload: { status: 'decided' } },
      { id: 'decision:superseded', entity_type: 'decision', lifecycle_status: 'superseded', payload: { status: 'decided' } },
      { id: 'retired:unknown', entity_type: 'unknown_retired_type', lifecycle_status: 'retired', payload: {} }
    ],
    external_entities: [
      { id: 'app:external', entity_type: 'app', lifecycle_status: 'active', payload: {} }
    ],
    edges: []
  };
  snapshot.hash = hashGraphSnapshot(snapshot);
  const infoSSOTService = new InfoSSOTService({ pool: {} });
  infoSSOTService.withAccessContext = async (_access, callback) => callback({});
  const graphMaintenanceService = new GraphMaintenanceService({ infoSSOTService });
  graphMaintenanceService.loadSnapshot = async () => ({ snapshot });

  const result = await graphMaintenanceService.validate({
    organizationId: 'org:unson', projectCodes: ['brainbase'], role: 'gm'
  }, { projectCode: 'brainbase' });

  expect(result.ontology.violations).toEqual(expect.arrayContaining([
    expect.objectContaining({ rule_id: 'CON-DECISION-DECIDER-001', entity_id: 'decision:active' }),
    expect.objectContaining({ rule_id: 'CON-DECISION-SCOPE-001', entity_id: 'decision:active' }),
    expect.objectContaining({ rule_id: 'entity-type-registered', entity_id: 'retired:unknown' })
  ]));
  expect(result.ontology.violations).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ rule_id: 'CON-DECISION-DECIDER-001', entity_id: 'decision:retired' }),
    expect.objectContaining({ rule_id: 'CON-DECISION-SCOPE-001', entity_id: 'decision:retired' }),
    expect.objectContaining({ rule_id: 'CON-DECISION-DECIDER-001', entity_id: 'decision:superseded' }),
    expect.objectContaining({ rule_id: 'CON-DECISION-SCOPE-001', entity_id: 'decision:superseded' }),
    expect.objectContaining({ rule_id: 'CON-APP-OWNER-001', entity_id: 'app:external' })
  ]));
  expect(result.required_relation_scope_summary).toEqual({
    included: { active_local_entities: 1 },
    excluded: {
      retired_local_entities: 2,
      superseded_local_entities: 1,
      external_metadata_entities: 1
    }
  });
  expect(JSON.stringify(result.required_relation_scope_summary)).not.toContain('decision:retired');
  expect(JSON.stringify(result.required_relation_scope_summary)).not.toContain('decision:superseded');
  expect(JSON.stringify(result.required_relation_scope_summary)).not.toContain('app:external');
});

test(`${storyId} ac:3 entity-only validation cannot approve an effective Decision without authority edges`, async () => {
  const { kernel } = proposedRelease();
  const result = kernel.validateEntity({
    id: 'decision:entity-only',
    type: 'decision',
    payload: { status: 'decided' }
  });
  expect(result.valid).toBe(false);
  expect(result.violations.map((item) => item.rule_id)).toEqual(expect.arrayContaining([
    'CON-DECISION-DECIDER-001',
    'CON-DECISION-SCOPE-001'
  ]));
});

test(`${storyId} ac:4 preserves owner, orphan, and unverified-relation residuals`, async () => {
  const { kernel } = proposedRelease();
  const result = kernel.validateSnapshot({
    complete: true,
    entities: [
      { id: 'app:ownerless', type: 'app', payload: {} },
      { id: 'contact:one', type: 'contact', payload: {} },
      { id: 'project:one', type: 'project', payload: {} }
    ],
    edges: [
      { from_id: 'contact:one', to_id: 'project:one', relation: 'appeared_in' },
      { from_id: 'missing:source', to_id: 'project:one', relation: 'appeared_in' }
    ]
  });
  expect(result.violations, `${storyId} ac:4 honest residuals`).toEqual(expect.arrayContaining([
    expect.objectContaining({ rule_id: 'CON-APP-OWNER-001' }),
    expect.objectContaining({ rule_id: 'edge-reference-integrity' }),
    expect.objectContaining({ rule_id: 'relation-endpoint-appeared_in' })
  ]));
});

test(`${storyId} ac:5 records a complete read-only production shadow audit`, async () => {
  const artifact = JSON.parse(fs.readFileSync(path.join(
    sourceRoot,
    'docs/management/audit-artifacts/story-brainbase-ontology-production-compatibility/production-shadow-audit-2026-08-03.json'
  ), 'utf8'));
  expect(artifact, `${storyId} ac:5 audit`).toMatchObject({
    transaction: 'READ ONLY',
    verification: 'verified',
    baseline_violation_count: 6156,
    candidate_violation_count: 61,
    activation_decision: 'NO_GO'
  });
  expect(artifact.reduction_percent, `${storyId} ac:5 reduction`).toBeGreaterThanOrEqual(95);
  expect(Object.values(artifact.violations_by_rule).reduce((sum: number, count) => sum + Number(count), 0), `${storyId} ac:5 breakdown`).toBe(61);
  expect(artifact.collection_complete, `${storyId} ac:5 collection`).toBe(true);
  expect(artifact.release_status, `${storyId} ac:5 candidate status`).toBe('proposed');
  expect(artifact.baseline, `${storyId} ac:5 baseline provenance`).toMatchObject({
    source_ref: '92d94a90d5d1d072c2869842495a7e69787e70a9',
    release_digest: '7db6c39c06cf94f1f6c803ecd27671c03af813adca142bf578508f30a1ada1da',
    violation_count: 6156
  });
  expect(artifact.snapshot_digest, `${storyId} ac:5 snapshot digest`).toMatch(/^[a-f0-9]{64}$/);
  expect(artifact.inventory_digest, `${storyId} ac:5 inventory digest`).toBe(
    createHash('sha256').update(JSON.stringify(artifact.observed_inventory)).digest('hex')
  );
  expect(artifact.observed_inventory.relation_endpoints['belongs_to_project|decision|project'], `${storyId} ac:5 endpoint evidence`).toBe(235);
  const runner = fs.readFileSync(path.join(sourceRoot, 'scripts/ontology-shadow-audit.js'), 'utf8');
  expect(runner, `${storyId} ac:5 runner provenance`).toContain("execFileSync('git', ['show'");
  expect(runner, `${storyId} ac:5 runner snapshot digest`).toContain('snapshot_digest: snapshotDigest');
});

test(`${storyId} ac:6 keeps activation disabled until signed publication`, async () => {
  const index = JSON.parse(fs.readFileSync(path.join(rootDir, 'config/ontology/index.json'), 'utf8'));
  const { kernel } = proposedRelease();
  const { manifest } = kernel;
  expect(index.current, `${storyId} ac:6 current`).toBeNull();
  expect(manifest.governance, `${storyId} ac:6 governance`).toMatchObject({
    decision_id: 'dec_ontology_1_0_0_activation_20260803',
    decider_entity_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5'
  });
  expect(kernel.status, `${storyId} ac:6 release status`).toBe('proposed');
});
