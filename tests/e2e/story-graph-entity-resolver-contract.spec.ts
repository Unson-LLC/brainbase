import { test, expect } from '@playwright/test';
import { createEmptyIndex, resolveEntities } from '../../mcp/brainbase/src/indexer/index';
import type { EntityIndex } from '../../mcp/brainbase/src/indexer/types';

function seedResolverIndex(): EntityIndex {
  const index = createEmptyIndex();

  index.people.set('per_wakamatsu_fuyumi', {
    id: 'per_wakamatsu_fuyumi',
    filePath: 'graph://person/per_wakamatsu_fuyumi',
    type: 'person',
    name: '若松 冬美',
    role: '役員',
    org: '株式会社リカルド',
    org_tags: ['riccardo'],
    projects: ['techknight'],
    aliases: ['若松冬美', 'Wakamatsu Fuyumi'],
    status: 'active',
    content: 'TechKnight relation record',
  });
  index.people.set('per_mochida_sho', {
    id: 'per_mochida_sho',
    filePath: 'graph://person/per_mochida_sho',
    type: 'person',
    name: '持田 渉',
    role: '営業',
    org: '株式会社リカルド',
    org_tags: ['riccardo'],
    projects: ['senpainurse'],
    aliases: ['Sho Mochida'],
    status: 'active',
    content: '',
  });

  return index;
}

test('story-graph-entity-resolver S-001 noisy person query returns 若松 as high-confidence name candidate', () => {
  const result = resolveEntities(seedResolverIndex(), {
    query: '若松 Lecaldo レカルド TechKnight 役員',
    types: ['person'],
    project: 'brainbase',
  });

  expect(result.absence_verdict).not.toBe('not_in_graph');
  expect(result.candidates[0]).toMatchObject({
    entity_id: 'per_wakamatsu_fuyumi',
    confidence: 'high',
  });
  expect(result.candidates[0]?.matched_fields).toContain('name');
  expect(result.candidates[0]?.matched_terms).toContain('若松');
});

test('story-graph-entity-resolver S-002 org-field query returns リカルド candidates instead of silent absence', () => {
  const result = resolveEntities(seedResolverIndex(), {
    query: 'リカルド',
    types: ['person', 'org'],
  });

  expect(result.absence_verdict).toBe('candidates_found');
  expect(result.candidates.length).toBeGreaterThan(0);
  expect(result.candidates.some(candidate => candidate.matched_fields.includes('org'))).toBe(true);
});
