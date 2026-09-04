import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import {
  createEmptyIndex,
  resolveEntities,
} from '../../src/indexer/index.js';
import { __testing } from '../../src/server.js';
import type { EntityIndex } from '../../src/indexer/types.js';
import type { GraphAPISource } from '../../src/sources/graphapi-source.js';
import type { EntitySource } from '../../src/sources/entity-source.js';

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
  index.people.set('per_sato_keigo', {
    id: 'per_sato_keigo',
    filePath: 'graph://person/per_sato_keigo',
    type: 'person',
    name: '佐藤 圭吾',
    role: '代表',
    org: '合同会社雲孫',
    org_tags: ['unson'],
    projects: ['brainbase'],
    aliases: ['佐藤圭吾', 'per_sato_keigo_merged'],
    status: 'active',
    content: '',
  });
  index.people.set('per_sato_keigo_merged', {
    id: 'per_sato_keigo_merged',
    filePath: 'graph://person/per_sato_keigo_merged',
    type: 'person',
    name: '佐藤 圭吾',
    role: '代表',
    org: '合同会社雲孫',
    org_tags: ['unson'],
    projects: ['brainbase'],
    aliases: [],
    status: 'merged',
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
  index.extensions.set('contact', new Map([
    ['contact_sato_keigo', {
      id: 'contact_sato_keigo',
      filePath: 'graph://contact/contact_sato_keigo',
      type: 'contact',
      name: '佐藤 圭吾',
      title: '代表取締役',
      content: '',
      payload: {
        name: '佐藤 圭吾',
        company_name: '株式会社雲孫',
        department: '経営',
        title: '代表取締役',
        email: 'keigo@example.com',
        mobile: '090-0000-0001',
        exchanged_at: '2026-07-01',
      },
    }],
    ['contact_sato_hanako', {
      id: 'contact_sato_hanako',
      filePath: 'graph://contact/contact_sato_hanako',
      type: 'contact',
      name: '佐藤 花子',
      title: '部長',
      content: '',
      payload: {
        name: '佐藤 花子',
        company_name: '株式会社Example',
        department: '営業部',
        title: '部長',
        email: 'hanako@example.com',
        tel_company: '03-0000-0000',
        exchanged_at: '2025-12-10',
      },
    }],
  ]));

  return index;
}

describe('Graph entity resolver', () => {
  it('excludes merged rows and resolves an explicit legacy ID through the active canonical alias', () => {
    const index = seedResolverIndex();
    const byName = resolveEntities(index, { query: '佐藤圭吾', types: ['person'] });
    assert.deepStrictEqual(byName.candidates.map(candidate => candidate.entity_id), ['per_sato_keigo']);

    const byLegacyId = resolveEntities(index, { query: 'per_sato_keigo_merged', types: ['person'] });
    assert.deepStrictEqual(byLegacyId.candidates.map(candidate => candidate.entity_id), ['per_sato_keigo']);
  });

  it('binds first-person expressions only to the authenticated active canonical person', () => {
    const index = seedResolverIndex();
    const unauthenticated = resolveEntities(index, { query: '俺 自分', types: ['person'] });
    assert.deepStrictEqual(unauthenticated.candidates, []);

    const authenticated = resolveEntities(index, {
      query: '俺のデータと自分の判断',
      types: ['person'],
      ownerPersonId: 'per_sato_keigo_merged',
    });
    assert.strictEqual(authenticated.candidates[0]?.entity_id, 'per_sato_keigo');
    assert.ok(authenticated.candidates[0]?.matched_fields.includes('authenticated_owner'));
  });

  it('refreshes the Graph snapshot atomically before a runtime person lookup', async () => {
    __testing.setEntityIndex(seedResolverIndex());
    const refreshed = seedResolverIndex().people.get('per_wakamatsu_fuyumi')!;
    const source: EntitySource = {
      async initialize() {},
      async getProjects() { return []; },
      async getPeople() {
        return [{
          ...refreshed,
          id: 'per_sugiyama_miki',
          name: '杉山 美紀',
          aliases: ['杉山みき', '杉山さん（ユニバーサルアーツ）'],
        }];
      },
      async getOrganizations() { return []; },
      async getBrands() { return []; },
      async getRACIs() { return []; },
      async getApps() { return []; },
      async getCustomers() { return []; },
      async getPartners() { return []; },
      async getDecisions() { return []; },
      async getGlossaryTerms() { return []; },
      async getDocuments() { return []; },
      async getExtensionTypeRegistrations() { return []; },
      async getExtensionEntities() { return []; },
    };
    __testing.setGraphSource(source as GraphAPISource);
    __testing.setIndexRefreshEnabled(true);

    try {
      const output = await __testing.handleToolCall('resolve_entity', {
        query: '杉山美紀',
        types: ['person'],
        includePhilosophy: false,
      });
      const parsed = JSON.parse(output);
      assert.strictEqual(parsed.candidates[0]?.entity_id, 'per_sugiyama_miki');
    } finally {
      __testing.setIndexRefreshEnabled(false);
      __testing.setGraphSource(null);
    }
  });

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

  it('resolves an explicitly requested contact surname to every matching candidate', () => {
    const contactOnly = resolveEntities(seedResolverIndex(), {
      query: '佐藤さん',
      types: ['contact'],
    });

    assert.deepStrictEqual(contactOnly.unsupported_types, []);
    assert.strictEqual(contactOnly.absence_verdict, 'candidates_found');
    assert.deepStrictEqual(
      contactOnly.candidates.map(candidate => candidate.entity_id),
      ['contact_sato_hanako', 'contact_sato_keigo'],
    );
  });

  it('returns structured contact details needed to disambiguate people', () => {
    const result = resolveEntities(seedResolverIndex(), {
      query: '佐藤圭吾',
      types: ['contact'],
    });

    assert.deepStrictEqual(result.candidates[0]?.details, {
      company_name: '株式会社雲孫',
      department: '経営',
      title: '代表取締役',
      email: 'keigo@example.com',
      mobile: '090-0000-0001',
      exchanged_at: '2026-07-01',
    });
  });

  it('still reports genuinely unsupported type filters', () => {
    const mixed = resolveEntities(seedResolverIndex(), {
      query: '若松',
      types: ['unknown_type', 'person'],
    });

    assert.deepStrictEqual(mixed.unsupported_types, ['unknown_type']);
    assert.strictEqual(mixed.candidates[0]?.entity_id, 'per_wakamatsu_fuyumi');
  });

  it('filters list_extension_entities by query and renders contact details', async () => {
    __testing.setEntityIndex(seedResolverIndex());

    const output = await __testing.handleToolCall('list_extension_entities', {
      type: 'contact',
      query: '佐藤圭吾',
    });

    assert.match(output, /佐藤 圭吾/);
    assert.doesNotMatch(output, /佐藤 花子/);
    assert.match(output, /株式会社雲孫/);
    assert.match(output, /keigo@example.com/);
    assert.match(output, /090-0000-0001/);
    assert.match(output, /2026-07-01/);
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

  it('binds resolve_entity first-person text to the personId claim in the authenticated token', async () => {
    __testing.setEntityIndex(seedResolverIndex());
    __testing.setTokenManager({ getToken: async () => jwt({ sub: 'service-runtime', personId: 'per_sato_keigo_merged' }) });

    const output = await __testing.handleToolCall('resolve_entity', {
      query: '俺',
      types: ['person'],
      includePhilosophy: false,
    });
    assert.strictEqual(JSON.parse(output).candidates[0]?.entity_id, 'per_sato_keigo');
  });

  it('allows Personal KG lookup only for the authenticated canonical Graph person ID', async () => {
    __testing.setEntityIndex(seedResolverIndex());
    const tool = __testing.tools.find(item => item.name === 'search_personal_kg');
    assert.ok(tool && 'properties' in tool.inputSchema && 'person_entity_id' in tool.inputSchema.properties);
    __testing.setWikiApiBaseUrl('https://bb.example.test');
    __testing.setTokenManager({ getToken: async () => jwt({ sub: 'service-runtime' }) });
    const ownerToken = jwt({ sub: 'per_sato_keigo_merged' });
    __testing.setOwnerTokenManager({ getToken: async () => ownerToken });
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    try {
      await __testing.handleToolCall('search_personal_kg', {
        query: '判断基準',
        person_entity_id: 'per_sato_keigo',
      });
      assert.strictEqual(fetchMock.mock.callCount(), 1);
      const authorization = new Headers(fetchMock.mock.calls[0].arguments[1]?.headers).get('authorization');
      assert.equal(authorization, `Bearer ${ownerToken}`);

      await assert.rejects(
        __testing.handleToolCall('search_personal_kg', {
          query: '判断基準',
          person_entity_id: 'per_mochida_sho',
        }),
        /authenticated person/i,
      );
      assert.strictEqual(fetchMock.mock.callCount(), 1);
    } finally {
      fetchMock.mock.restore();
    }
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

  it('story-graph-entity-resolver: rejects search when required philosophy context fetch fails', async () => {
    __testing.setEntityIndex(seedResolverIndex());
    __testing.setGraphSource({
      async getPhilosophyContext() {
        throw new Error('context unavailable');
      },
    } as unknown as GraphAPISource);

    try {
      await assert.rejects(
        __testing.handleToolCall('search', {
          query: '若松 リカルド',
          project: 'brainbase',
        }),
        /context unavailable/
      );
    } finally {
      __testing.setGraphSource(null);
    }
  });

  it('story-graph-entity-resolver: exposes unsupported type filters in MCP output', async () => {
    __testing.setEntityIndex(seedResolverIndex());

    const output = await __testing.handleToolCall('resolve_entity', {
      query: '若松',
      types: ['unknown_type'],
      includePhilosophy: false,
    });
    const parsed = JSON.parse(output);

    assert.deepStrictEqual(parsed.unsupported_types, ['unknown_type']);
    assert.ok(parsed.fallbacks_used.includes('unsupported_type_reported'));
    assert.strictEqual(parsed.candidates.length, 0);
  });

  it('story-graph-entity-resolver: keeps default resolve_entity output parseable JSON', async () => {
    __testing.setEntityIndex(seedResolverIndex());
    __testing.setGraphSource({
      async getPhilosophyContext() {
        return { prompt_block: 'Philosophy Context' };
      },
    } as unknown as GraphAPISource);

    try {
      const output = await __testing.handleToolCall('resolve_entity', {
        query: '若松さん',
        types: ['person'],
      });
      const parsed = JSON.parse(output);

      assert.strictEqual(parsed.candidates[0].entity_id, 'per_wakamatsu_fuyumi');
      assert.strictEqual(parsed.philosophy_context, 'Philosophy Context');
    } finally {
      __testing.setGraphSource(null);
    }
  });

  it('story-graph-entity-resolver: rejects resolve_entity when required philosophy context fetch fails', async () => {
    __testing.setEntityIndex(seedResolverIndex());
    __testing.setGraphSource({
      async getPhilosophyContext() {
        throw new Error('fetch failed');
      },
    } as unknown as GraphAPISource);

    try {
      await assert.rejects(
        __testing.handleToolCall('resolve_entity', {
          query: '若松さん',
          types: ['person'],
        }),
        /fetch failed/
      );
    } finally {
      __testing.setGraphSource(null);
    }
  });

  it('story-graph-entity-resolver: rejects missing Graph source unless philosophy is explicitly disabled', async () => {
    __testing.setEntityIndex(seedResolverIndex());
    __testing.setGraphSource(null);

    await assert.rejects(
      __testing.handleToolCall('resolve_entity', {
        query: '若松さん',
        types: ['person'],
      }),
      /Graph source is unavailable/
    );

    const output = await __testing.handleToolCall('resolve_entity', {
      query: '若松さん',
      types: ['person'],
      includePhilosophy: false,
    });
    assert.strictEqual(JSON.parse(output).candidates[0].entity_id, 'per_wakamatsu_fuyumi');
  });
});

function jwt(payload: Record<string, unknown>): string {
  const segment = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${segment}.signature`;
}
