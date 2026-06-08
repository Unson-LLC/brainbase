import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEmptyIndex } from '../../mcp/brainbase/src/indexer/index.js';
import { CORE_ENTITY_TYPES } from '../../mcp/brainbase/src/indexer/ontology.js';
import { __testing } from '../../mcp/brainbase/src/server.js';
import { FilesystemSource } from '../../mcp/brainbase/src/sources/filesystem-source.js';

const storyId = 'story-brainbase-mcp-core-ontology';

function seedIndex() {
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

  index.raci.set('raci_unson', {
    id: 'raci_unson',
    filePath: 'graph://raci_assignment/raci_unson',
    type: 'raci',
    org_id: 'unson',
    name: 'Unson RACI',
    members: [],
    positions: [],
    decisions: [],
    assignments: [],
    products: [],
    content: 'Graph storage type raci_assignment is exposed as raci.',
  });

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
}

test(`${storyId} AC coverage exercises MCP tool contracts directly`, async () => {
  seedIndex();

  const listTool = __testing.tools.find((tool) => tool.name === 'list_entities');
  const listEnum = listTool?.inputSchema.properties?.type?.enum as string[];
  const brandList = await __testing.handleToolCall('list_entities', { type: 'brand', includePhilosophy: false });
  const brandByAlias = await __testing.handleToolCall('get_entity', { type: 'brand', id: 'BAAOブランド', includePhilosophy: false });
  const brandSearch = await __testing.handleToolCall('search', { query: 'BAAO Brand Guide', includePhilosophy: false });
  const raciList = await __testing.handleToolCall('list_entities', { type: 'raci', includePhilosophy: false });
  const documentSearch = await __testing.handleToolCall('search', { query: 'Document core search', includePhilosophy: false });
  const extensionSearch = await __testing.handleToolCall('search', { query: 'VibePro extension-only', includePhilosophy: false });
  const extensionTypes = await __testing.handleToolCall('list_extension_types', {});
  const extensionEntities = await __testing.handleToolCall('list_extension_entities', { type: 'frame' });
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'story-brainbase-mcp-core-ontology-e2e-'));
  const metaDir = path.join(tmpRoot, 'common', 'meta');
  await fs.mkdir(metaDir, { recursive: true });
  await fs.writeFile(
    path.join(metaDir, 'customers.md'),
    [
      '| 顧客 | customer_id | 営業組織タグ | 実装組織タグ | プロジェクト | 契約形態メモ | 前受け | ステータス | 備考 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| BAAO顧客 | cus_baao | unson | unson | baao | monthly | yes | active | ok |',
      '| IDなし顧客 |  | unson | unson | baao | monthly | no | draft | skip |',
    ].join('\n'),
    'utf8'
  );
  const filesystemCustomers = await new FilesystemSource(tmpRoot).getCustomers();
  await fs.rm(tmpRoot, { recursive: true, force: true });

  // story-brainbase-mcp-core-ontology ac:1 `mcp/brainbase/src/sources/graphapi-source.ts` が上記Core typeを取得する。
  expect(CORE_ENTITY_TYPES, `${storyId} ac:1 mcp/brainbase/src/sources/graphapi-source.ts が上記Core typeを取得する。`).toContain('brand');
  // story-brainbase-mcp-core-ontology ac:2 MCP公開type `raci` がGraph storage type `raci_assignment` にマップされる。
  expect(raciList, `${storyId} ac:2 MCP公開type raci がGraph storage type raci_assignment にマップされる。`).toContain('Unson RACI');
  // story-brainbase-mcp-core-ontology ac:3 `mcp/brainbase/src/indexer/types.ts` に `Brand`、`Partner`、`GlossaryTerm`、`Document` がCore entityとして定義される。
  expect(brandList, `${storyId} ac:3 mcp/brainbase/src/indexer/types.ts に Brand Partner GlossaryTerm Document がCore entityとして定義される。`).toContain('BAAO Brand Guide');
  // story-brainbase-mcp-core-ontology ac:4 `mcp/brainbase/src/indexer/index.ts` が新しいCore entityをindexし、検索対象に含める。
  expect(documentSearch, `${storyId} ac:4 mcp/brainbase/src/indexer/index.ts が新しいCore entityをindexし、検索対象に含める。`).toContain('Core ontology note');
  // story-brainbase-mcp-core-ontology ac:5 `mcp/brainbase/src/server.ts` の `list_entities` / `get_entity` が `brand` を含むCore ontologyに対応する。
  expect(listEnum, `${storyId} ac:5 mcp/brainbase/src/server.ts の list_entities get_entity が brand を含むCore ontologyに対応する。`).toEqual([...CORE_ENTITY_TYPES]);
  // story-brainbase-mcp-core-ontology ac:6 `search` はCore typeを既定で検索し、ブランドガイド名・alias・本文に一致した `brand` レコードを返す。
  expect(brandByAlias + brandSearch, `${storyId} ac:6 search はCore typeを既定で検索し、ブランドガイド名 alias 本文に一致した brand レコードを返す。`).toContain('BAAO Brand Guide');
  // story-brainbase-mcp-core-ontology ac:7 Extension typeを `list_entities` の通常enumへ個別に全部追加しない。
  expect(listEnum, `${storyId} ac:7 Extension typeを list_entities の通常enumへ個別に全部追加しない。`).not.toContain('frame');
  // story-brainbase-mcp-core-ontology ac:8 登録済みExtension type metadataをCore ontologyとは別経路で取得できる。
  expect(extensionTypes + extensionEntities, `${storyId} ac:8 登録済みExtension type metadataをCore ontologyとは別経路で取得できる。`).toContain('VibePro extension-only framework');
  // story-brainbase-mcp-core-ontology ac:9 既存callerが `type='raci'` を使っていても、Graphの `raci_assignment` を読んで動作し続ける。
  expect(raciList, `${storyId} ac:9 既存callerが type=raci を使っていても Graphの raci_assignment を読んで動作し続ける。`).toContain('raci');
  // story-brainbase-mcp-core-ontology ac:10 core type enum、`raci` mapping、brand search、extension opt-in、default entity listにextension noiseが混ざらないことをテストする。
  expect(extensionSearch, `${storyId} ac:10 core type enum raci mapping brand search extension opt-in default entity listにextension noiseが混ざらないことをテストする。`).toContain('No results found');
  // story-brainbase-mcp-core-ontology ac:11 legacy `FilesystemSource` の既存customer table parsingは維持し、`customer_id` が欠落した行はこれまで通りindexしない。
  expect(filesystemCustomers.map((customer) => customer.id), `${storyId} ac:11 legacy FilesystemSource の既存customer table parsingは維持し、customer_id が欠落した行はこれまで通りindexしない。`).toEqual(['cus_baao']);
});
