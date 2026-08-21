import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createEmptyIndex } from '../../src/indexer/index.js';
import { __testing } from '../../src/server.js';
import { getExtensionTypeRegistrations } from '../../src/indexer/index.js';
import type { EntitySource } from '../../src/sources/entity-source.js';
import type { GraphAPISource } from '../../src/sources/graphapi-source.js';

function seedServerIndex() {
  const index = createEmptyIndex();

  index.brands.set('brand_baao', {
    id: 'brand_baao',
    filePath: 'graph://brand/brand_baao',
    type: 'brand',
    name: 'BAAO Brand Guide',
    scope: 'product',
    owner_entity_id: 'app_baao',
    related_orgs: ['unson'],
    related_apps: ['baao'],
    tagline: 'Business as an Orchestra',
    positioning: 'AI時代の組織運営',
    voice: ['clear'],
    do: ['Use direct language'],
    dont: ['Use vague promises'],
    visual_assets: [],
    aliases: ['BAAOブランド'],
    content: 'BAAO Brand Guide content',
  });
  index.aliasToBrandId.set('BAAOブランド', 'brand_baao');

  index.documents.set('doc_core_ontology', {
    id: 'doc_core_ontology',
    filePath: 'graph://document/doc_core_ontology',
    type: 'document',
    title: 'Core ontology note',
    name: 'Core ontology note',
    path: 'brainbase/core-ontology',
    tags: ['ontology'],
    content: 'Document core search content',
  });

  index.extensions.set('frame', new Map([[
    'frm_vibepro',
    {
      id: 'frm_vibepro',
      filePath: 'graph://frame/frm_vibepro',
      type: 'frame',
      title: 'VibePro frame',
      content: 'VibePro extension-only framework',
      payload: {},
    },
  ]]));

  __testing.setEntityIndex(index);
  return index;
}

describe('Brainbase MCP server core ontology tools', () => {
  it('shows maintenance lifecycle separately from the business payload status', () => {
    const formatted = __testing.formatEntity({
      id: 'dec_maintenance_projection',
      type: 'decision',
      name: 'VERIFY fixture',
      status: 'decided',
      lifecycle_status: 'retired',
      lifecycle_state: 'retired',
      semantic_state: 'superseded',
      version: 2,
    });

    assert.match(formatted, /Status.*decided/);
    assert.match(formatted, /Lifecycle.*retired/);
    assert.match(formatted, /Semantic State.*superseded/);
    assert.match(formatted, /Version.*2/);
  });

  it('refreshes project and extension listings before returning the current Graph snapshot', async () => {
    __testing.setEntityIndex(createEmptyIndex());
    const source: EntitySource = {
      async initialize() {},
      async getProjects() {
        return [{
          id: 'project_techknight_staye',
          filePath: 'graph://project/project_techknight_staye',
          type: 'project' as const,
          project_id: 'techknight-staye',
          name: 'STAYe 事業承継開発・PMS取得',
          status: 'active',
          team: [], orgs: ['techknight'], apps: [], customers: [], content: 'STAYe project',
        }];
      },
      async getPeople() { return []; },
      async getOrganizations() { return []; },
      async getBrands() { return []; },
      async getRACIs() { return []; },
      async getApps() { return []; },
      async getCustomers() { return []; },
      async getPartners() { return []; },
      async getDecisions() { return []; },
      async getGlossaryTerms() { return []; },
      async getDocuments() { return []; },
      async getExtensionTypeRegistrations() { return getExtensionTypeRegistrations(); },
      async getExtensionEntities(type: string) {
        return type === 'initiative' ? [{
          id: 'initiative_techknight_hotel_integration',
          filePath: 'graph://initiative/initiative_techknight_hotel_integration',
          type: 'initiative',
          name: 'ホテルAI電話・PBX・PMS連携施策',
          payload: { name: 'ホテルAI電話・PBX・PMS連携施策' },
          content: 'hotel integration',
        }] : [];
      },
    };
    __testing.setGraphSource(source as GraphAPISource);
    __testing.setIndexRefreshEnabled(true);

    try {
      const projects = await __testing.handleToolCall('list_entities', {
        type: 'project',
        includePhilosophy: false,
      });
      assert.match(projects, /STAYe 事業承継開発・PMS取得/);

      const initiatives = await __testing.handleToolCall('list_extension_entities', {
        type: 'initiative',
      });
      assert.match(initiatives, /ホテルAI電話・PBX・PMS連携施策/);
    } finally {
      __testing.setIndexRefreshEnabled(false);
      __testing.setGraphSource(null);
    }
  });

  it('SPEC-brainbase-mcp-core-ontology AC-5 AC-7: exposes fixed Core enum without extension noise', () => {
    const listTool = __testing.tools.find((tool) => tool.name === 'list_entities');
    const getTool = __testing.tools.find((tool) => tool.name === 'get_entity');
    const extensionTool = __testing.tools.find((tool) => tool.name === 'list_extension_entities');

    assert.ok(listTool);
    assert.ok(getTool);
    assert.ok(extensionTool);

    const listEnum = listTool.inputSchema.properties?.type?.enum as string[];
    const getEnum = getTool.inputSchema.properties?.type?.enum as string[];

    assert.ok(listEnum.includes('brand'));
    assert.ok(listEnum.includes('document'));
    assert.ok(!listEnum.includes('frame'));
    assert.ok(getEnum.includes('brand'));
    assert.ok(!getEnum.includes('frame'));
    assert.strictEqual(extensionTool.inputSchema.properties?.type?.type, 'string');
  });

  it('SPEC-brainbase-mcp-core-ontology AC-5 AC-6 AC-8: handles core and extension tool calls directly', async () => {
    seedServerIndex();

    const listedBrands = await __testing.handleToolCall('list_entities', {
      type: 'brand',
      includePhilosophy: false,
    });
    assert.match(listedBrands, /# brand entities \(1\)/);
    assert.match(listedBrands, /BAAO Brand Guide/);

    const brandByAlias = await __testing.handleToolCall('get_entity', {
      type: 'brand',
      id: 'BAAOブランド',
      includePhilosophy: false,
    });
    assert.match(brandByAlias, /## BAAO Brand Guide/);
    assert.match(brandByAlias, /Positioning/);

    const defaultSearch = await __testing.handleToolCall('search', {
      query: 'VibePro',
      includePhilosophy: false,
    });
    assert.match(defaultSearch, /No results found/);

    const extensionTypes = await __testing.handleToolCall('list_extension_types', {});
    assert.match(extensionTypes, /frame/);
    assert.match(extensionTypes, /contact/);
    assert.match(extensionTypes, /initiative/);

    const extensionEntities = await __testing.handleToolCall('list_extension_entities', {
      type: 'frame',
    });
    assert.match(extensionEntities, /# frame extension entities \(1\)/);
    assert.match(extensionEntities, /frm_vibepro/);
    assert.match(extensionEntities, /VibePro extension-only framework/);
  });
});
