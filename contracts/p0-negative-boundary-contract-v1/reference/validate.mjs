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
  {id:'provider_observed',p0_path:'/provider',a0_schema:'observed_request',a0_path:'/provider_identity/provider',a0_fixture_path:'/positive/0/request/provider_identity/provider',type:'string',relation:'exact',p0_value:'slack',a0_value:'slack'},
  {id:'provider_context',p0_path:'/provider',a0_schema:'canonical_context',a0_path:'/tenant_context/workspace_connection/provider',a0_fixture_path:'/positive/0/context/tenant_context/workspace_connection/provider',type:'string',relation:'exact',p0_value:'slack',a0_value:'slack'},
  {id:'audience_context',p0_path:'/audience',a0_schema:'canonical_context',a0_path:'/tenant_context/audience',a0_fixture_path:'/positive/0/context/tenant_context/audience',type:'array',relation:'contains',p0_value:'mana-runtime',a0_value:['mana-runtime']},
  {id:'capability',p0_path:'/request/capability_id',a0_schema:'observed_request',a0_path:'/requested_action/capability_id',a0_fixture_path:'/positive/0/request/requested_action/capability_id',type:'string',relation:'p0_specialization',p0_value:'personal_to_organization.promote',a0_value:'company_read'},
  {id:'resource',p0_path:'/request/resource_ref',a0_schema:'observed_request',a0_path:'/requested_action/resource_ref',a0_fixture_path:'/positive/0/request/requested_action/resource_ref',type:'string',relation:'p0_specialization',p0_value:'synthetic-personal-record-a',a0_value:'company://tenant-a/project-a/read'},
  {id:'effect',p0_path:'/request/desired_effect',a0_schema:'observed_request',a0_path:'/requested_action/desired_effect',a0_fixture_path:'/positive/0/request/requested_action/desired_effect',type:'string',relation:'p0_effect_alias',p0_value:'organization_event',a0_value:'read'},
  {id:'request_subject',p0_path:'/bindings/request_subject',a0_schema:'observed_request',a0_path:'/provider_identity/authenticated_subject_id',a0_fixture_path:'/positive/0/request/provider_identity/authenticated_subject_id',type:'string',relation:'synthetic_alias',p0_value:'U-SYNTH-A',a0_value:'person-sato'},
  {id:'request_workspace',p0_path:'/bindings/request_workspace',a0_schema:'observed_request',a0_path:'/provider_identity/workspace_id',a0_fixture_path:'/positive/0/request/provider_identity/workspace_id',type:'string',relation:'synthetic_alias',p0_value:'W-SYNTH-A',a0_value:'workspace-tenant-a'},
  {id:'request_app',p0_path:'/bindings/request_app',a0_schema:'observed_request',a0_path:'/provider_identity/app_id',a0_fixture_path:'/positive/0/request/provider_identity/app_id',type:'string',relation:'synthetic_alias',p0_value:'A-SYNTH-A',a0_value:'synthetic-app'},
  {id:'request_enterprise',p0_path:'/bindings/request_enterprise',a0_schema:'observed_request',a0_path:'/provider_identity/enterprise_id',a0_fixture_path:'/positive/0/request/provider_identity/enterprise_id',type:'string',relation:'synthetic_alias',p0_value:'E-SYNTH-A',a0_value:'synthetic-enterprise'},
  {id:'request_channel',p0_path:'/bindings/request_channel',a0_schema:'observed_request',a0_path:'/delivery/channel_id',a0_fixture_path:'/positive/0/request/delivery/channel_id',type:'string',relation:'synthetic_alias',p0_value:'C-SYNTH-A',a0_value:'channel-tenant-a'},
  {id:'request_event',p0_path:'/bindings/request_event',a0_schema:'observed_request',a0_path:'/delivery/event_id',a0_fixture_path:'/positive/0/request/delivery/event_id',type:'string',relation:'synthetic_alias',p0_value:'EV-SYNTH-A',a0_value:'evt-tenant-a-person-sato'}
];
const CROSS_LAYER_CONTRACT = [
  {id:'subject',p0_left:'/bindings/request_subject',p0_right:'/bindings/actor_external_subject',a0_left:'/request/provider_identity/authenticated_subject_id',a0_right:'/context/actor/external_subject_id'},
  {id:'actor_subject',p0_left:'/bindings/actor_external_subject',p0_right:'/bindings/tenant_actor_subject',a0_left:'/context/actor/external_subject_id',a0_right:'/context/tenant_context/actor/authenticated_subject_id'},
  {id:'principal',p0_left:'/bindings/canonical_person',p0_right:'/bindings/tenant_principal',a0_left:'/context/actor/canonical_person_id',a0_right:'/context/tenant_context/actor/principal_id'},
  {id:'organization',p0_left:'/bindings/requested_organization',p0_right:'/bindings/authorized_organization',a0_left:'/context/scope/organization_id',a0_right:'/context/tenant_context/authorization/organization_ids/0'},
  {id:'project',p0_left:'/bindings/requested_project',p0_right:'/bindings/authorized_project',a0_left:'/request/requested_action/project_hint',a0_right:'/context/scope/project_id'},
  {id:'placement',p0_left:'/bindings/placement',p0_right:'/bindings/deployment',a0_left:'/context/scope/placement_id',a0_right:'/context/tenant_context/placement/deployment_id'},
  {id:'workspace',p0_left:'/bindings/request_workspace',p0_right:'/bindings/context_workspace',a0_left:'/request/provider_identity/workspace_id',a0_right:'/context/tenant_context/workspace_connection/workspace_id'},
  {id:'app',p0_left:'/bindings/request_app',p0_right:'/bindings/context_app',a0_left:'/request/provider_identity/app_id',a0_right:'/context/tenant_context/workspace_connection/app_id'},
  {id:'enterprise',p0_left:'/bindings/request_enterprise',p0_right:'/bindings/context_enterprise',a0_left:'/request/provider_identity/enterprise_id',a0_right:'/context/tenant_context/slack/enterprise_id'},
  {id:'channel',p0_left:'/bindings/request_channel',p0_right:'/bindings/context_channel',a0_left:'/request/delivery/channel_id',a0_right:'/context/tenant_context/slack/channel_id'},
  {id:'thread',p0_left:'/bindings/request_thread',p0_right:'/bindings/context_thread',a0_left:'/request/delivery/thread_ts',a0_right:'/context/tenant_context/slack/thread_ts'},
  {id:'event',p0_left:'/bindings/request_event',p0_right:'/bindings/context_event',a0_left:'/request/delivery/event_id',a0_right:'/context/tenant_context/slack/event_id'}
];
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
    const expected = A0_FIELD_CONTRACT[index];
    const mapping = mappings[index];
    if (!mapping || JSON.stringify(mapping) !== JSON.stringify(expected)) {
      errors.push(`a0-binding:mapping-contract:${index}`); continue;
    }
    const { p0_path: p0Path, a0_schema: schemaName, a0_path: a0Path, type } = expected;
    const targetSchema = schemaName === 'observed_request' ? observedSchema : contextSchema;
    const node = schemaNode(targetSchema, a0Path);
    const fixtureValue = pointerValue(upstreamFixtures, mapping.a0_fixture_path);
    if (!node || (node.type && node.type !== type) || (!node.type && type === 'string' && !node.const && !node.enum)) errors.push(`a0-binding:schema:${index}`);
    if (valueType(fixtureValue) !== type || JSON.stringify(fixtureValue) !== JSON.stringify(mapping.a0_value)) errors.push(`a0-binding:fixture:${index}`);
    if (JSON.stringify(pointerValue(cases.canonical_baseline, p0Path)) !== JSON.stringify(mapping.p0_value)) errors.push(`a0-binding:p0-value:${index}`);
  }
  if (mappings.length !== A0_FIELD_CONTRACT.length) errors.push('a0-binding:mapping-count');
  const crossBindings = semanticBinding.cross_layer_bindings ?? [];
  for (let index = 0; index < CROSS_LAYER_CONTRACT.length; index++) {
    const binding = crossBindings[index];
    if (!binding || JSON.stringify(binding) !== JSON.stringify(CROSS_LAYER_CONTRACT[index])) { errors.push(`a0-binding:cross-layer-contract:${index}`); continue; }
    const p0Left = pointerValue(cases.canonical_baseline, binding.p0_left), p0Right = pointerValue(cases.canonical_baseline, binding.p0_right);
    const a0Left = pointerValue(upstreamFixtures.positive[0], binding.a0_left), a0Right = pointerValue(upstreamFixtures.positive[0], binding.a0_right);
    if (p0Left === undefined || p0Left !== p0Right) errors.push(`a0-binding:p0-cross-layer:${binding.id}`);
    if (a0Left === undefined || a0Left !== a0Right) errors.push(`a0-binding:a0-cross-layer:${binding.id}`);
  }
  if (crossBindings.length !== CROSS_LAYER_CONTRACT.length) errors.push('a0-binding:cross-layer-count');
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
