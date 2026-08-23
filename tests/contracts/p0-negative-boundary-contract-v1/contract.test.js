// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EFFECT_KEYS, validateBundle } from '../../../contracts/p0-negative-boundary-contract-v1/reference/validate.mjs';

const root = resolve('contracts/p0-negative-boundary-contract-v1');
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));

describe('P0 negative boundary contract v1', () => {
  it('GREEN: validates source-lock, schema, digests, complete inventory and all-zero effects', async () => {
    const result = await validateBundle(root);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.caseCount).toBe(49);
  });

  it('fixes the 2 tenant x 2 person bidirectional isolation matrix and privacy surfaces', async () => {
    const cases = await readJson('fixtures/cases.json');
    const byId = new Map(cases.negative_cases.map(entry => [entry.id, entry]));
    expect(cases.inventory.tenants).toEqual(['synthetic-tenant-a', 'synthetic-tenant-b']);
    expect(cases.inventory.persons).toEqual(['synthetic-person-a', 'synthetic-person-b']);
    expect(byId.get('NEG-CROSS-PERSON-A-B').mutation).toMatchObject({path:'/request/target_person',before:'synthetic-person-a',after:'synthetic-person-b'});
    expect(byId.get('NEG-CROSS-PERSON-B-A').mutation).toMatchObject({path:'/request/source_person',before:'synthetic-person-a',after:'synthetic-person-b'});
    expect(byId.get('NEG-CROSS-ORG-A-B').mutation).toMatchObject({path:'/request/target_tenant',before:'synthetic-tenant-a',after:'synthetic-tenant-b'});
    expect(byId.get('NEG-CROSS-ORG-B-A').mutation).toMatchObject({path:'/request/source_tenant',before:'synthetic-tenant-a',after:'synthetic-tenant-b'});
    for (const id of ['NEG-OWNER-APPROVAL-ALONE','NEG-REVIEWER-PERSONAL-BODY','NEG-GRAPH-RECONSTRUCTION','NEG-SEARCH-RECONSTRUCTION','NEG-EVENT-RECONSTRUCTION','NEG-RECEIPT-RECONSTRUCTION','NEG-LLM-REPETITION']) {
      expect(byId.get(id)?.expected.effects).toEqual(Object.fromEntries(EFFECT_KEYS.map(key => [key, 0])));
    }
  });

  it('binds P0 fields and all 12 cross-layer pairs to authoritative A0 paths, types and values', async () => {
    const result = await validateBundle(root);
    expect(result.a0MappingCount).toBe(12);
    expect(result.crossLayerBindingCount).toBe(12);
    expect(result.errors.filter(error => error.startsWith('a0-binding:'))).toEqual([]);
  });

  it('validates the complete 2 tenant x 2 person membership and bidirectional deny matrix', async () => {
    const result = await validateBundle(root);
    expect(result.membershipCount).toBe(4);
    expect(result.matrixDenialCount).toBe(4);
    expect(result.errors.filter(error => error.startsWith('tenant-matrix:'))).toEqual([]);
  });

  it('RED sensitivity: A0 schema path and type drift are rejected', async () => {
    for (const corruption of [
      binding => { binding.field_mappings[0].a0_path = '/provider_identity/nonexistent'; },
      binding => { binding.field_mappings[0].type = 'number'; },
      binding => { binding.cross_layer_bindings[0].a0_right = '/context/actor/nonexistent'; }
    ]) {
      const semanticBinding = await readJson('a0-semantic-binding.json');
      corruption(semanticBinding);
      const result = await validateBundle(root, { semanticBindingOverride: semanticBinding });
      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.startsWith('a0-binding:'))).toBe(true);
    }
  });

  it('RED sensitivity: incomplete tenant membership or denial direction is rejected', async () => {
    for (const corruption of [
      inventory => { inventory.memberships.pop(); },
      inventory => { inventory.bidirectional_denials.cross_tenant.pop(); },
      inventory => { inventory.resolution_contract.unknown_tenant = 'allow'; },
      inventory => { inventory.resolution_contract.ambiguous_tenant = 'first_match'; },
      inventory => { inventory.resolution_contract.unavailable_connection = 'fallback'; },
      inventory => { inventory.resolution_contract.no_data = 'allow'; }
    ]) {
      const tenantInventory = await readJson('tenant-person-inventory.json');
      corruption(tenantInventory);
      const result = await validateBundle(root, { tenantInventoryOverride: tenantInventory });
      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.startsWith('tenant-matrix:'))).toBe(true);
    }
  });

  it('maps AC-002 to bidirectional tenant and person isolation cases', async () => {
    const cases = await readJson('fixtures/cases.json');
    const ids = new Set(cases.negative_cases.map(entry => entry.id));
    expect(['NEG-CROSS-PERSON-A-B', 'NEG-CROSS-PERSON-B-A', 'NEG-CROSS-ORG-A-B', 'NEG-CROSS-ORG-B-A'].every(id => ids.has(id))).toBe(true);
  });

  it('maps AC-003 to separate owner and reviewer authorities', async () => {
    const cases = await readJson('fixtures/cases.json');
    const byId = new Map(cases.negative_cases.map(entry => [entry.id, entry]));
    expect(byId.get('NEG-OWNER-APPROVAL-ALONE').expected.violated_invariant).toBe('dual_authority_required');
    expect(byId.get('NEG-OWNER-REVIEWER-SAME').expected.violated_invariant).toBe('separate_authorities');
  });

  it('maps AC-004 to authority ingress receipt and cross-layer invariants', async () => {
    const cases = await readJson('fixtures/cases.json');
    const categories = new Set(cases.negative_cases.map(entry => entry.category));
    expect(['authority_binding', 'ingress', 'request_receipt_binding', 'cross_layer_binding'].every(category => categories.has(category))).toBe(true);
  });

  it('maps AC-005 to identity authority freshness replay and direct ingress denial', async () => {
    const cases = await readJson('fixtures/cases.json');
    const ids = new Set(cases.negative_cases.map(entry => entry.id));
    expect(['NEG-PERSON-UNKNOWN', 'NEG-PERSON-MISSING', 'NEG-PERSON-AMBIGUOUS', 'NEG-PERSON-INACTIVE', 'NEG-PERSON-MERGED', 'NEG-AUTHORITY-STALE', 'NEG-AUTHORITY-REPLAY', 'NEG-DIRECT-WEB', 'NEG-DIRECT-SERVICE', 'NEG-DIRECT-API', 'NEG-DIRECT-UI', 'NEG-DIRECT-LEGACY'].every(id => ids.has(id))).toBe(true);
  });

  it('RED sensitivity: changing deny to allow is rejected', async () => {
    const cases = await readJson('fixtures/cases.json');
    cases.negative_cases[0].expected.decision = 'allow';
    const result = await validateBundle(root, { casesOverride: cases });
    expect(result.ok).toBe(false);
    expect(result.errors.some(error => error.includes('decision:NEG-CROSS-PERSON-A-B') || error.startsWith('schema:'))).toBe(true);
  });

  it('RED sensitivity: changing any negative effect counter from zero is rejected', async () => {
    const cases = await readJson('fixtures/cases.json');
    cases.negative_cases.find(entry => entry.id === 'NEG-OWNER-APPROVAL-ALONE').expected.effects.graph = 1;
    const result = await validateBundle(root, { casesOverride: cases });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('effects:NEG-OWNER-APPROVAL-ALONE:graph');
  });

  it('RED sensitivity: mutation path, before value and invariant are contract-bound', async () => {
    for (const corruption of [
      entry => { entry.mutation.path = '/request/operation_id'; },
      entry => { entry.mutation.before = 'unrelated'; },
      entry => { entry.mutation.after = 'unrelated'; },
      entry => { entry.mutation.after = entry.mutation.before; },
      entry => { entry.expected.violated_invariant = 'unrelated'; },
      entry => { entry.expected.surface = 'unrelated'; }
    ]) {
      const cases = await readJson('fixtures/cases.json');
      const entry = cases.negative_cases.find(item => item.id === 'NEG-AUTHORITY-CAPABILITY');
      corruption(entry);
      const result = await validateBundle(root, { casesOverride: cases });
      expect(result.ok).toBe(false);
      expect(result.errors.some(error => error.startsWith('mutation:') || error.startsWith('schema:'))).toBe(true);
    }
  });

  it('RED sensitivity: canonical baseline changes are rejected', async () => {
    const cases = await readJson('fixtures/cases.json');
    cases.canonical_baseline.provider = 'unrelated';
    const result = await validateBundle(root, { casesOverride: cases });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('baseline:digest');
  });

  it('does not coerce unknown, partial, or not_collected contract evidence to pass', async () => {
    for (const state of ['unknown', 'partial', 'not_collected']) {
      const cases = await readJson('fixtures/cases.json');
      cases.evidence_state.contract = state;
      const result = await validateBundle(root, { casesOverride: cases });
      expect(result.ok, state).toBe(false);
    }
  });
});
