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

export async function digestFiles(root, files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update(Buffer.from([0]));
    hash.update(await readFile(resolve(root, file)));
  }
  return hash.digest('hex');
}

export async function validateBundle(root, { casesOverride } = {}) {
  const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
  const [manifest, sourceLock, schema, cases, liveUpstream] = await Promise.all([
    readJson('manifest.json'), readJson('source-lock.json'), readJson('schema/negative-case.schema.json'),
    casesOverride ?? readJson('fixtures/cases.json'),
    JSON.parse(await readFile(resolve(root, '../mana-brainbase-company-authority/v1/source-lock.json'), 'utf8'))
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
  const statuses = [cases.evidence_state?.contract, cases.evidence_state?.runtime, cases.evidence_state?.production, sourceLock.evidence_state?.production, manifest.production_evidence];
  if (statuses.includes('unknown') || statuses.includes('partial')) errors.push('evidence:unknown-or-partial');
  if (cases.evidence_state?.contract !== 'collected' || cases.evidence_state?.runtime !== 'not_collected' || cases.evidence_state?.production !== 'not_collected') errors.push('evidence:state');
  if (cases.synthetic_data_only !== true || manifest.synthetic_data_only !== true) errors.push('fixtures:not-synthetic');
  return { ok: errors.length === 0, errors, fixtureDigest, schemaDigest, caseCount: ids.length };
}
