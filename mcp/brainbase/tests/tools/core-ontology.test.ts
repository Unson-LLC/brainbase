import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildIndex,
  getEntitiesByType,
  getExtensionEntitiesByType,
  getExtensionTypeRegistrations,
  searchEntities,
} from '../../src/indexer/index.js';
import type { EntitySource } from '../../src/sources/entity-source.js';
import type { App, Brand, Customer, Decision, Document, ExtensionEntity, GlossaryTerm, Organization, Partner, Person, Project, RACI } from '../../src/indexer/types.js';
import { CORE_ENTITY_TYPES } from '../../src/indexer/ontology.js';

function createSource(): EntitySource {
  const brand: Brand = {
    id: 'brand_baao',
    filePath: '[test]',
    type: 'brand',
    name: 'BAAO Brand Guide',
    aliases: ['BAAO'],
    related_orgs: ['baao'],
    related_apps: [],
    do: ['四半期で成果に寄せる'],
    dont: ['抽象論だけで終わらせない'],
    visual_assets: [],
    content: 'BAAOの名前、立ち位置、語り方、約束を定義する。',
  };
  const document: Document = { id: 'doc_sns_rules', filePath: '[test]', type: 'document', title: 'SNS Rules', name: 'SNS Rules', path: 'unson/sns-rules', tags: ['sns'], content: '運用ルール文書。' };
  const glossaryTerm: GlossaryTerm = { id: 'glossary_baao', filePath: '[test]', type: 'glossary_term', term: 'BAAO', name: 'BAAO', aliases: ['ビジネスAI推進機構'], description: '一般社団法人ビジネスAI推進機構', content: 'BAAOの正規表記。' };
  const frame: ExtensionEntity = { id: 'frame_ai_driven_management_framework', filePath: '[test]', type: 'frame', name: 'AI駆動経営フレームワーク', payload: { name: 'AI駆動経営フレームワーク' }, content: 'AI駆動経営の考え方。' };

  return {
    initialize: async () => {},
    getProjects: async (): Promise<Project[]> => [],
    getPeople: async (): Promise<Person[]> => [],
    getOrganizations: async (): Promise<Organization[]> => [],
    getBrands: async (): Promise<Brand[]> => [brand],
    getRACIs: async (): Promise<RACI[]> => [],
    getApps: async (): Promise<App[]> => [],
    getCustomers: async (): Promise<Customer[]> => [],
    getPartners: async (): Promise<Partner[]> => [],
    getDecisions: async (): Promise<Decision[]> => [],
    getGlossaryTerms: async (): Promise<GlossaryTerm[]> => [glossaryTerm],
    getDocuments: async (): Promise<Document[]> => [document],
    getExtensionTypeRegistrations: async () => getExtensionTypeRegistrations(),
    getExtensionEntities: async (type: string): Promise<ExtensionEntity[]> => type === 'frame' ? [frame] : [],
  };
}

describe('Brainbase MCP core ontology', () => {
  it('SPEC-brainbase-mcp-core-ontology INV-12: keeps the deliberate core type registry', () => {
    assert.deepStrictEqual([...CORE_ENTITY_TYPES], ['project', 'person', 'org', 'brand', 'app', 'customer', 'partner', 'decision', 'raci', 'glossary_term', 'document']);
  });

  it('SPEC-brainbase-mcp-core-ontology INV-1 INV-2 S-1: searches brand as a default core entity', async () => {
    const index = await buildIndex(createSource());
    const results = searchEntities(index, 'BAAO Brand Guide');
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].type, 'brand');
    assert.strictEqual(results[0].id, 'brand_baao');
  });

  it('SPEC-brainbase-mcp-core-ontology S-5: lists and searches documents as core context', async () => {
    const index = await buildIndex(createSource());
    assert.strictEqual(getEntitiesByType(index, 'document').length, 1);
    assert.strictEqual(searchEntities(index, 'SNS Rules')[0].type, 'document');
  });

  it('SPEC-brainbase-mcp-core-ontology INV-5 INV-9 S-3: excludes extension records from default search', async () => {
    const index = await buildIndex(createSource());
    assert.strictEqual(searchEntities(index, 'AI駆動経営').length, 0);
    const frames = getExtensionEntitiesByType(index, 'frame');
    assert.strictEqual(frames.length, 1);
    assert.strictEqual(frames[0].id, 'frame_ai_driven_management_framework');
  });
});
