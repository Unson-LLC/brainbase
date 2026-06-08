import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createEmptyIndex } from '../../src/indexer/index.js';
import { __testing } from '../../src/server.js';

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

    const extensionEntities = await __testing.handleToolCall('list_extension_entities', {
      type: 'frame',
    });
    assert.match(extensionEntities, /# frame extension entities \(1\)/);
    assert.match(extensionEntities, /frm_vibepro/);
    assert.match(extensionEntities, /VibePro extension-only framework/);
  });
});
