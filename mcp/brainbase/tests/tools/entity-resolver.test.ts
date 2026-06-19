import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createEmptyIndex,
  resolveEntities,
} from '../../src/indexer/index.js';
import { __testing } from '../../src/server.js';
import type { EntityIndex } from '../../src/indexer/types.js';
import type { GraphAPISource } from '../../src/sources/graphapi-source.js';

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
  index.projects.set('senpainurse', {
    id: 'senpainurse',
    filePath: 'graph://project/senpainurse',
    type: 'project',
    project_id: 'senpainurse',
    name: 'senpainurse',
    status: 'active',
    team: ['per_mochida_sho'],
    orgs: ['riccardo'],
    apps: [],
    customers: [],
    content: '',
  });

  return index;
}

describe('Graph entity resolver', () => {
  it('story-graph-entity-resolver: resolves a noisy compound query by exact person name evidence', () => {
    const result = resolveEntities(seedResolverIndex(), {
      query: '若松 Lecaldo レカルド TechKnight 役員',
      types: ['person'],
    });

    assert.notStrictEqual(result.absence_verdict, 'not_in_graph');
    assert.strictEqual(result.candidates[0]?.entity_id, 'per_wakamatsu_fuyumi');
    assert.strictEqual(result.candidates[0]?.confidence, 'high');
    assert.ok(result.candidates[0]?.matched_terms.includes('若松'));
    assert.ok(result.candidates[0]?.matched_fields.includes('name'));
  });

  it('story-graph-entity-resolver: treats project as context instead of a strict candidate filter', () => {
    const result = resolveEntities(seedResolverIndex(), {
      query: '若松 Lecaldo レカルド TechKnight 役員',
      types: ['person'],
      project: 'brainbase',
    });

    assert.strictEqual(result.absence_verdict, 'candidates_found');
    assert.strictEqual(result.candidates[0]?.entity_id, 'per_wakamatsu_fuyumi');
    assert.strictEqual(result.candidates[0]?.project_code, 'techknight');
  });

  it('story-graph-entity-resolver: normalizes honorifics, spaces, and romanized aliases', () => {
    const index = seedResolverIndex();

    assert.strictEqual(resolveEntities(index, { query: '若松さん', types: ['person'] }).candidates[0]?.entity_id, 'per_wakamatsu_fuyumi');
    assert.strictEqual(resolveEntities(index, { query: '若松冬美', types: ['person'] }).candidates[0]?.entity_id, 'per_wakamatsu_fuyumi');
    assert.strictEqual(resolveEntities(index, { query: 'Wakamatsu Fuyumi', types: ['person'] }).candidates[0]?.entity_id, 'per_wakamatsu_fuyumi');
    assert.strictEqual(resolveEntities(index, { query: '持田', types: ['person'] }).candidates[0]?.entity_id, 'per_mochida_sho');
  });

  it('story-graph-entity-resolver: reports structured-field matches instead of silent absence', () => {
    const riccardo = resolveEntities(seedResolverIndex(), {
      query: 'リカルド',
      types: ['person', 'org'],
    });

    assert.notStrictEqual(riccardo.absence_verdict, 'not_in_graph');
    assert.ok(riccardo.candidates.length > 0);
    assert.ok(riccardo.candidates.some(candidate => candidate.matched_fields.includes('org')));

    const lecaldo = resolveEntities(seedResolverIndex(), {
      query: 'Le caldo',
      types: ['person', 'org'],
    });
    assert.ok(lecaldo.candidates.some(candidate => candidate.entity_id === 'per_wakamatsu_fuyumi'));
    assert.ok(lecaldo.searched_terms.includes('リカルド'));

    const project = resolveEntities(seedResolverIndex(), {
      query: 'senpainurse',
      types: ['person', 'project'],
    });
    assert.ok(project.candidates.some(candidate => candidate.entity_id === 'senpainurse' || candidate.matched_fields.includes('projects')));
  });

  it('story-graph-entity-resolver: reports unsupported type filters instead of silently dropping them', () => {
    const contactOnly = resolveEntities(seedResolverIndex(), {
      query: '若松',
      types: ['contact'],
    });

    assert.deepStrictEqual(contactOnly.unsupported_types, ['contact']);
    assert.ok(contactOnly.fallbacks_used.includes('unsupported_type_reported'));
    assert.strictEqual(contactOnly.candidates.length, 0);
    assert.strictEqual(contactOnly.absence_verdict, 'no_candidate_after_resolver_checks');

    const mixed = resolveEntities(seedResolverIndex(), {
      query: '若松',
      types: ['contact', 'person'],
    });

    assert.deepStrictEqual(mixed.unsupported_types, ['contact']);
    assert.strictEqual(mixed.candidates[0]?.entity_id, 'per_wakamatsu_fuyumi');
  });

  it('story-graph-entity-resolver: exposes resolve_entity MCP tool with structured JSON output', async () => {
    __testing.setEntityIndex(seedResolverIndex());

    const tool = __testing.tools.find(item => item.name === 'resolve_entity');
    assert.ok(tool);

    const output = await __testing.handleToolCall('resolve_entity', {
      query: '若松 Lecaldo レカルド TechKnight 役員',
      types: ['person'],
      project: 'brainbase',
      includePhilosophy: false,
    });
    const parsed = JSON.parse(output);

    assert.strictEqual(parsed.candidates[0].entity_id, 'per_wakamatsu_fuyumi');
    assert.strictEqual(parsed.candidates[0].confidence, 'high');
    assert.ok(parsed.searched_terms.includes('若松'));
    assert.ok(parsed.fallbacks_used.includes('tokenized_field_match'));
  });

  it('story-graph-entity-resolver: falls back from search to resolver candidates for noisy compound queries', async () => {
    __testing.setEntityIndex(seedResolverIndex());

    const output = await __testing.handleToolCall('search', {
      query: '若松 リカルド',
      project: 'brainbase',
      includePhilosophy: false,
    });

    assert.match(output, /No exact text-search results found/);
    assert.match(output, /Resolver candidates/);
    assert.match(output, /per_wakamatsu_fuyumi/);
    assert.match(output, /若松 冬美/);
  });

  it('story-graph-entity-resolver: keeps search fallback output when philosophy context fetch fails', async () => {
    __testing.setEntityIndex(seedResolverIndex());
    __testing.setGraphSource({
      async getPhilosophyContext() {
        throw new Error('context unavailable');
      },
    } as unknown as GraphAPISource);

    try {
      const output = await __testing.handleToolCall('search', {
        query: '若松 リカルド',
        project: 'brainbase',
      });

      assert.match(output, /No exact text-search results found/);
      assert.match(output, /per_wakamatsu_fuyumi/);
      assert.match(output, /若松 冬美/);
    } finally {
      __testing.setGraphSource(null);
    }
  });

  it('story-graph-entity-resolver: exposes unsupported type filters in MCP output', async () => {
    __testing.setEntityIndex(seedResolverIndex());

    const output = await __testing.handleToolCall('resolve_entity', {
      query: '若松',
      types: ['contact'],
      includePhilosophy: false,
    });
    const parsed = JSON.parse(output);

    assert.deepStrictEqual(parsed.unsupported_types, ['contact']);
    assert.ok(parsed.fallbacks_used.includes('unsupported_type_reported'));
    assert.strictEqual(parsed.candidates.length, 0);
  });

  it('story-graph-entity-resolver: keeps default resolve_entity output parseable JSON', async () => {
    __testing.setEntityIndex(seedResolverIndex());

    const output = await __testing.handleToolCall('resolve_entity', {
      query: '若松さん',
      types: ['person'],
    });
    const parsed = JSON.parse(output);

    assert.strictEqual(parsed.candidates[0].entity_id, 'per_wakamatsu_fuyumi');
    assert.ok(Object.prototype.hasOwnProperty.call(parsed, 'philosophy_context'));
  });

  it('story-graph-entity-resolver: keeps default resolve_entity JSON when philosophy context fetch fails', async () => {
    __testing.setEntityIndex(seedResolverIndex());
    __testing.setGraphSource({
      async getPhilosophyContext() {
        throw new Error('fetch failed');
      },
    } as unknown as GraphAPISource);

    try {
      const output = await __testing.handleToolCall('resolve_entity', {
        query: '若松さん',
        types: ['person'],
      });
      const parsed = JSON.parse(output);

      assert.strictEqual(parsed.philosophy_context, null);
      assert.strictEqual(parsed.candidates[0].entity_id, 'per_wakamatsu_fuyumi');
      assert.ok(parsed.searched_terms.includes('若松'));
    } finally {
      __testing.setGraphSource(null);
    }
  });
});
