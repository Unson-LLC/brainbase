import { describe, expect, it } from 'vitest';
import {
  IDS,
  buildCanonicalOrgPayload,
  buildOrgAliasPayload,
  deepReplaceExact,
  removePersonalAbsolutePaths,
} from '../../scripts/normalize-graph-data-ssot.mjs';

describe('normalize-graph-data-ssot', () => {
  it('repoints exact legacy IDs without rewriting prose substrings', () => {
    expect(deepReplaceExact({ org_id: 'org_baao', note: 'org_baao is legacy', nested: ['org_unson'] }, {
      org_baao: 'baao',
      org_unson: 'unson',
    })).toEqual({ org_id: 'baao', note: 'org_baao is legacy', nested: ['unson'] });
  });

  it('converts BAAO absolute source paths to repository-relative paths and drops other personal paths', () => {
    expect(removePersonalAbsolutePaths([
      '/Users/ksato/workspace/projects/baao/docs/ABOUT.md',
      '/Users/other/private.md',
      'docs/internal/OPERATIONS_HANDBOOK.md',
    ])).toEqual([
      'docs/ABOUT.md',
      'docs/internal/OPERATIONS_HANDBOOK.md',
    ]);
  });

  it('merges richer organization fields into the canonical record without finance data', () => {
    const payload = buildCanonicalOrgPayload({
      canonical: { name: 'old', mission: 'old mission', aliases: ['old alias'], bank_account: { secret: true } },
      alias: { mission: ['current mission'], vision_summary: 'current vision', description: 'current description', aliases: ['new alias'], bank_account: { secret: true } },
      id: 'unson',
      name: '合同会社雲孫',
      aliases: ['Unson LLC'],
    });
    expect(payload).toMatchObject({
      org_id: 'unson',
      name: '合同会社雲孫',
      mission: ['current mission'],
      vision_summary: 'current vision',
      description: 'current description',
      status: 'active',
    });
    expect(payload.aliases).toEqual(expect.arrayContaining(['old alias', 'new alias', 'Unson LLC']));
    expect(payload).not.toHaveProperty('bank_account');
  });

  it('keeps legacy org IDs as auditable aliases pointing to the canonical ID', () => {
    expect(buildOrgAliasPayload({ id: IDS.baaoOrgAlias, name: 'BAAO', aliases: ['BAAO'] })).toMatchObject({
      status: 'retired_alias',
      canonical_entity_id: IDS.baaoOrg,
      retired_reason: 'duplicate_org_normalization',
    });
  });
});
