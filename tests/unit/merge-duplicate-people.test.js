import { describe, expect, it } from 'vitest';
import {
  MERGES,
  buildAliasPayload,
  countLegacyReferences,
  deepReplaceExact,
  mergePayloads,
  sanitizedPlan,
  validateState,
} from '../../scripts/merge-duplicate-people.mjs';

describe('merge-duplicate-people', () => {
  it('keeps canonical scalar values and unions identity evidence', () => {
    const merge = {
      canonicalId: 'per_canonical',
      legacyId: 'per_legacy',
      name: '例示 太郎',
    };
    expect(mergePayloads(
      { name: '例示太郎', aliases: ['例示'], org: '正本組織', projects: ['alpha'] },
      { name: '例示 太郎', aliases: ['Taro Reiji'], email: 'taro@example.com', projects: ['beta'] },
      merge,
    )).toMatchObject({
      person_id: 'per_canonical',
      name: '例示 太郎',
      org: '正本組織',
      email: 'taro@example.com',
      projects: ['alpha', 'beta'],
      status: 'active',
      merged_person_ids: ['per_legacy'],
    });
  });

  it('creates a resolvable person alias without copying unrelated payload', () => {
    expect(buildAliasPayload({
      canonicalId: 'per_canonical',
      legacyId: 'per_legacy',
      name: '例示 太郎',
      legacyPayload: { name: '例示太郎', aliases: ['旧表記'], email: 'secret@example.com' },
      mergedAt: '2026-07-29T00:00:00.000Z',
    })).toEqual({
      name: '例示太郎',
      aliases: ['旧表記', 'per_legacy'],
      status: 'merged',
      canonical_entity_id: 'per_canonical',
      merged_at: '2026-07-29T00:00:00.000Z',
    });
  });

  it('repoints exact nested IDs and leaves substrings unchanged', () => {
    expect(deepReplaceExact({
      owner: 'per_legacy',
      refs: ['per_legacy', 'prefix-per_legacy'],
    }, { per_legacy: 'per_canonical' })).toEqual({
      owner: 'per_canonical',
      refs: ['per_canonical', 'prefix-per_legacy'],
    });
  });

  it('counts the canonical merged_person_ids entry as provenance', () => {
    expect(countLegacyReferences({
      operational: {},
      graphEdges: [],
      graphEntities: [
        { id: 'per_canonical', payload: { merged_person_ids: ['per_legacy'] } },
        { id: 'per_legacy', payload: { aliases: ['per_legacy'] } },
      ],
    }, 'per_legacy')).toEqual({
      direct: 0,
      graph_edges: 0,
      graph_payloads: 1,
    });
  });

  it('reports four merges and never plans a physical person delete', () => {
    const graphEntities = MERGES.flatMap(({ canonicalId, legacyId, name }) => [
      { id: canonicalId, entity_type: 'person', payload: { name } },
      { id: legacyId, entity_type: 'person', payload: { name } },
    ]);
    const plan = sanitizedPlan({
      graphEntities,
      graphEdges: [],
      people: [],
      operational: {},
      historicalCounts: { auth_audit_logs: 3 },
    });
    expect(plan.merges).toHaveLength(4);
    expect(plan.physical_person_deletes).toBe(0);
    expect(plan.preserved_historical_rows.auth_audit_logs).toBe(3);
  });

  it('reuses a duplicate legacy membership edge as alias provenance', () => {
    const graphEntities = MERGES.flatMap(({ canonicalId, legacyId, name }) => [
      { id: canonicalId, entity_type: 'person', payload: { name } },
      { id: legacyId, entity_type: 'person', payload: { name } },
    ]);
    const { canonicalId, legacyId } = MERGES[0];
    const result = validateState({
      graphEntities,
      graphEdges: [
        { id: 'edge_canonical', from_id: canonicalId, to_id: 'project_1', rel_type: 'member_of' },
        { id: 'edge_legacy', from_id: legacyId, to_id: 'project_1', rel_type: 'member_of' },
      ],
    });
    expect(result.aliasReuseByLegacy.get(legacyId)).toBe('edge_legacy');
  });
});
