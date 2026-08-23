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
    expect(byId.get('NEG-CROSS-PERSON-A-B')).toMatchObject({source_person:'synthetic-person-a',target_person:'synthetic-person-b'});
    expect(byId.get('NEG-CROSS-PERSON-B-A')).toMatchObject({source_person:'synthetic-person-b',target_person:'synthetic-person-a'});
    expect(byId.get('NEG-CROSS-ORG-A-B')).toMatchObject({source_tenant:'synthetic-tenant-a',target_tenant:'synthetic-tenant-b'});
    expect(byId.get('NEG-CROSS-ORG-B-A')).toMatchObject({source_tenant:'synthetic-tenant-b',target_tenant:'synthetic-tenant-a'});
    for (const id of ['NEG-OWNER-APPROVAL-ALONE','NEG-REVIEWER-PERSONAL-BODY','NEG-GRAPH-RECONSTRUCTION','NEG-SEARCH-RECONSTRUCTION','NEG-EVENT-RECONSTRUCTION','NEG-RECEIPT-RECONSTRUCTION','NEG-LLM-REPETITION']) {
      expect(byId.get(id)?.expected.effects).toEqual(Object.fromEntries(EFFECT_KEYS.map(key => [key, 0])));
    }
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

  it('does not coerce unknown, partial, or not_collected contract evidence to pass', async () => {
    for (const state of ['unknown', 'partial', 'not_collected']) {
      const cases = await readJson('fixtures/cases.json');
      cases.evidence_state.contract = state;
      const result = await validateBundle(root, { casesOverride: cases });
      expect(result.ok, state).toBe(false);
    }
  });
});
