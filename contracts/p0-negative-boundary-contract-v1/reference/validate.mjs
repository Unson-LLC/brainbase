import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { CANONICAL_BASELINE, CASE_DEFINITIONS } from './generate-fixtures.mjs';

export const EFFECT_KEYS = ['database', 'organization_event', 'graph', 'search', 'llm', 'credential', 'external', 'deploy'];
const CASE_CONTRACT = new Map(CASE_DEFINITIONS.map(([id, category, path, after, invariant, surface]) => [id, { category, path, after, invariant, surface }]));
const pointerValue = (object, pointer) => pointer.slice(1).split('/').reduce((value, key) => value?.[key], object);
const BASELINE_SHA256 = '2487270b4a623894697590643dc06f12e48b9714dce62e559881a5588bd01b58';
const UPSTREAM = {
  merged_sha: 'ad908bce7b90678f9ed7f1c570f808bdf1a500ad',
  contract_id: 'mana-brainbase-company-authority/v1',
  contract_version: '1.0.0',
  fixture_set_sha256: '1d7af5b850abeb10e07db281c17341636d80a74cb37679b2c2b6ab5ce9b0a6ea',
  lock_status: 'producer_contract_ready'
};
const A0_FIELD_CONTRACT = [
  ['/provider','observed_request','/provider_identity/provider','string'], ['/provider','canonical_context','/tenant_context/workspace_connection/provider','string'],
  ['/audience','canonical_context','/tenant_context/audience','array'], ['/request/capability_id','observed_request','/requested_action/capability_id','string'],
  ['/request/resource_ref','observed_request','/requested_action/resource_ref','string'], ['/request/desired_effect','observed_request','/requested_action/desired_effect','string'],
  ['/bindings/request_subject','observed_request','/provider_identity/authenticated_subject_id','string'], ['/bindings/request_workspace','observed_request','/provider_identity/workspace_id','string'],
  ['/bindings/request_app','observed_request','/provider_identity/app_id','string'], ['/bindings/request_enterprise','observed_request','/provider_identity/enterprise_id','string'],
  ['/bindings/request_channel','observed_request','/delivery/channel_id','string'], ['/bindings/request_event','observed_request','/delivery/event_id','string']
];
const CROSS_LAYER_IDS = ['subject','actor_subject','principal','organization','project','placement','workspace','app','enterprise','channel','thread','event'];
const schemaNode = (schema, pointer) => {
  let node = schema;
  for (const key of pointer.slice(1).split('/')) {
    if (node?.$ref?.startsWith('#/')) node = pointerValue(schema, node.$ref.slice(1));
    node = node?.properties?.[key] ?? (node?.type === 'array' && /^\d+$/.test(key) ? node.items : undefined);
  }
  if (node?.$ref?.startsWith('#/')) node = pointerValue(schema, node.$ref.slice(1));
  return node;
};
const valueType = value => Array.isArray(value) ? 'array' : typeof value;

export async function digestFiles(root, files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update(Buffer.from([0]));
    hash.update(await readFile(resolve(root, file)));
  }
  return hash.digest('hex');
}

export async function validateBundle(root, { casesOverride, semanticBindingOverride, tenantInventoryOverride } = {}) {
  const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
  const [manifest, sourceLock, schema, cases, liveUpstream, semanticBinding, tenantInventory, observedSchema, contextSchema, upstreamFixtures] = await Promise.all([
    readJson('manifest.json'), readJson('source-lock.json'), readJson('schema/negative-case.schema.json'),
    casesOverride ?? readJson('fixtures/cases.json'),
    JSON.parse(await readFile(resolve(root, '../mana-brainbase-company-authority/v1/source-lock.json'), 'utf8')),
    semanticBindingOverride ?? readJson('a0-semantic-binding.json'), tenantInventoryOverride ?? readJson('tenant-person-inventory.json'),
    readJson('../mana-brainbase-company-authority/v1/schema/observed-execution-request.schema.json'),
    readJson('../mana-brainbase-company-authority/v1/schema/canonical-execution-context.schema.json'),
    readJson('../mana-brainbase-company-authority/v1/fixtures/cases.json')
  ]);
  const errors = [];
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  if (!ajv.validate(schema, cases)) errors.push(...(ajv.errors ?? []).map(error => `schema:${error.instancePath}:${error.keyword}`));
  for (const [key, value] of Object.entries(UPSTREAM)) {
    if (sourceLock.upstream?.[key] !== value) errors.push(`source-lock:${key}`);
  }
  if (liveUpstream.contract_id !== UPSTREAM.contract_id || liveUpstream.producer?.contract_version !== UPSTREAM.contract_version ||
      liveUpstream.fixture_set_sha256 !== UPSTREAM.fixture_set_sha256 || liveUpstream.lock_status !== UPSTREAM.lock_status) {
    errors.push('source-lock:live-upstream-mismatch');
  }
  const fixtureDigest = await digestFiles(root, manifest.fixture_files);
  const schemaDigest = createHash('sha256').update(await readFile(resolve(root, 'schema/negative-case.schema.json'))).digest('hex');
  if (manifest.fixture_set_sha256 !== fixtureDigest || sourceLock.fixture_set_sha256 !== fixtureDigest) errors.push('digest:fixture-set');
  if (sourceLock.schema_sha256 !== schemaDigest) errors.push('digest:schema');
  const ids = cases.negative_cases?.map(entry => entry.id) ?? [];
  const baselineDigest = createHash('sha256').update(JSON.stringify(cases.canonical_baseline)).digest('hex');
  if (baselineDigest !== BASELINE_SHA256) errors.push('baseline:digest');
  if (new Set(ids).size !== ids.length) errors.push('inventory:duplicate-case-id');
  for (const required of cases.inventory?.required_case_ids ?? []) if (!ids.includes(required)) errors.push(`inventory:missing:${required}`);
  for (const actual of ids) if (!cases.inventory?.required_case_ids?.includes(actual)) errors.push(`inventory:undeclared:${actual}`);
  if (JSON.stringify(cases.inventory?.effect_counters) !== JSON.stringify(EFFECT_KEYS)) errors.push('inventory:effect-counters');
  for (const entry of cases.negative_cases ?? []) {
    if (entry.expected?.decision !== 'deny') errors.push(`decision:${entry.id}`);
    if (JSON.stringify(Object.keys(entry.expected?.effects ?? {})) !== JSON.stringify(EFFECT_KEYS)) errors.push(`effects:inventory:${entry.id}`);
    for (const key of EFFECT_KEYS) if (entry.expected?.effects?.[key] !== 0) errors.push(`effects:${entry.id}:${key}`);
    const contract = CASE_CONTRACT.get(entry.id);
    if (!contract) errors.push(`mutation:unknown-contract:${entry.id}`);
    else {
      const { category, path, after, invariant, surface } = contract;
      if (entry.category !== category) errors.push(`mutation:category:${entry.id}`);
      if (entry.mutation?.mode !== 'single') errors.push(`mutation:mode:${entry.id}`);
      if (entry.mutation?.path !== path) errors.push(`mutation:path:${entry.id}`);
      if (JSON.stringify(entry.mutation?.before) !== JSON.stringify(pointerValue(cases.canonical_baseline, path))) errors.push(`mutation:before:${entry.id}`);
      if (JSON.stringify(entry.mutation?.after) === JSON.stringify(entry.mutation?.before)) errors.push(`mutation:no-op:${entry.id}`);
      if (JSON.stringify(entry.mutation?.after) !== JSON.stringify(after)) errors.push(`mutation:after:${entry.id}`);
      if (entry.expected?.violated_invariant !== invariant) errors.push(`mutation:invariant:${entry.id}`);
      if (entry.expected?.surface !== surface) errors.push(`mutation:surface:${entry.id}`);
    }
  }
  if (CASE_CONTRACT.size !== ids.length) errors.push('inventory:contract-catalog');
  if (JSON.stringify(cases.canonical_baseline) !== JSON.stringify(CANONICAL_BASELINE)) errors.push('baseline:canonical-values');
  const sourceByPath = new Map(semanticBinding.authoritative_sources?.map(source => [source.path, source]));
  for (const path of ['../mana-brainbase-company-authority/v1/schema/observed-execution-request.schema.json','../mana-brainbase-company-authority/v1/schema/canonical-execution-context.schema.json','../mana-brainbase-company-authority/v1/fixtures/cases.json']) {
    const actual = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
    if (sourceByPath.get(path)?.sha256 !== actual) errors.push(`a0-binding:source-digest:${path}`);
  }
  const mappings = semanticBinding.field_mappings ?? [];
  for (let index = 0; index < A0_FIELD_CONTRACT.length; index++) {
    const [p0Path, schemaName, a0Path, type] = A0_FIELD_CONTRACT[index];
    const mapping = mappings[index];
    if (!mapping || mapping.p0_path !== p0Path || mapping.a0_schema !== schemaName || mapping.a0_path !== a0Path || mapping.type !== type) {
      errors.push(`a0-binding:mapping-contract:${index}`); continue;
    }
    const targetSchema = schemaName === 'observed_request' ? observedSchema : contextSchema;
    const node = schemaNode(targetSchema, a0Path);
    const fixtureValue = pointerValue(upstreamFixtures, mapping.a0_fixture_path);
    if (!node || (node.type && node.type !== type) || (!node.type && type === 'string' && !node.const && !node.enum)) errors.push(`a0-binding:schema:${index}`);
    if (valueType(fixtureValue) !== type || JSON.stringify(fixtureValue) !== JSON.stringify(mapping.a0_value)) errors.push(`a0-binding:fixture:${index}`);
    if (JSON.stringify(pointerValue(cases.canonical_baseline, p0Path)) !== JSON.stringify(mapping.p0_value)) errors.push(`a0-binding:p0-value:${index}`);
  }
  if (mappings.length !== A0_FIELD_CONTRACT.length) errors.push('a0-binding:mapping-count');
  const crossBindings = semanticBinding.cross_layer_bindings ?? [];
  for (let index = 0; index < CROSS_LAYER_IDS.length; index++) {
    const binding = crossBindings[index];
    if (!binding || binding.id !== CROSS_LAYER_IDS[index]) { errors.push(`a0-binding:cross-layer-contract:${index}`); continue; }
    const p0Left = pointerValue(cases.canonical_baseline, binding.p0_left), p0Right = pointerValue(cases.canonical_baseline, binding.p0_right);
    const a0Left = pointerValue(upstreamFixtures.positive[0], binding.a0_left), a0Right = pointerValue(upstreamFixtures.positive[0], binding.a0_right);
    if (p0Left === undefined || p0Left !== p0Right) errors.push(`a0-binding:p0-cross-layer:${binding.id}`);
    if (a0Left === undefined || a0Left !== a0Right) errors.push(`a0-binding:a0-cross-layer:${binding.id}`);
  }
  if (crossBindings.length !== 12) errors.push('a0-binding:cross-layer-count');
  const expectedMemberships = tenantInventory.tenants?.flatMap(tenant_id => tenantInventory.persons?.map(person_id => `${tenant_id}:${person_id}`)) ?? [];
  const actualMemberships = tenantInventory.memberships?.map(item => `${item.tenant_id}:${item.person_id}`) ?? [];
  if (expectedMemberships.length !== 4 || new Set(actualMemberships).size !== 4 || expectedMemberships.some(item => !actualMemberships.includes(item))) errors.push('tenant-matrix:memberships');
  if (JSON.stringify(tenantInventory.same_tenant_baseline) !== JSON.stringify({tenant_id:'synthetic-tenant-a',source_person:'synthetic-person-a',target_person:'synthetic-person-a'})) errors.push('tenant-matrix:baseline');
  if (JSON.stringify(tenantInventory.resolution_contract) !== JSON.stringify({unknown_tenant:'deny',ambiguous_tenant:'deny',unavailable_connection:'unavailable',no_data:'empty'})) errors.push('tenant-matrix:resolution-contract');
  const expectedDenials = {cross_person:['NEG-CROSS-PERSON-A-B','NEG-CROSS-PERSON-B-A'],cross_tenant:['NEG-CROSS-ORG-A-B','NEG-CROSS-ORG-B-A']};
  if (JSON.stringify(tenantInventory.bidirectional_denials) !== JSON.stringify(expectedDenials)) errors.push('tenant-matrix:denials');
  for (const id of [...expectedDenials.cross_person, ...expectedDenials.cross_tenant]) if (!ids.includes(id)) errors.push(`tenant-matrix:missing-case:${id}`);
  const statuses = [cases.evidence_state?.contract, cases.evidence_state?.runtime, cases.evidence_state?.production, sourceLock.evidence_state?.production, manifest.production_evidence];
  if (statuses.includes('unknown') || statuses.includes('partial')) errors.push('evidence:unknown-or-partial');
  if (cases.evidence_state?.contract !== 'collected' || cases.evidence_state?.runtime !== 'not_collected' || cases.evidence_state?.production !== 'not_collected') errors.push('evidence:state');
  if (cases.synthetic_data_only !== true || manifest.synthetic_data_only !== true) errors.push('fixtures:not-synthetic');
  return { ok: errors.length === 0, errors, fixtureDigest, schemaDigest, caseCount: ids.length, a0MappingCount: mappings.length, crossLayerBindingCount: crossBindings.length, membershipCount: actualMemberships.length, matrixDenialCount: Object.values(tenantInventory.bidirectional_denials ?? {}).flat().length };
}
