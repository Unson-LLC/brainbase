import { readFile } from 'node:fs/promises';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import * as indexer from '../src/entity-indexer.js';
import type { BaseEntity, EntitySource, Person, RetrievalEvidence } from '../src/entity-indexer.js';
import { createEntityIndexCache } from '../src/entity-index-cache.js';

const collections = [
  ['getProjects', 'projects'], ['getPeople', 'people'], ['getOrganizations', 'orgs'],
  ['getBrands', 'brands'], ['getRACIs', 'raci'], ['getApps', 'apps'],
  ['getCustomers', 'customers'], ['getPartners', 'partners'], ['getDecisions', 'decisions'],
  ['getGlossaryTerms', 'glossaryTerms'], ['getDocuments', 'documents'],
] as const;

function sourceStub(): EntitySource {
  return {
    initialize: vi.fn(async () => {}),
    ...Object.fromEntries(collections.map(([getter]) => [getter, vi.fn(async () => [])])),
    getExtensionTypeRegistrations: vi.fn(async () => []),
    getExtensionEntities: vi.fn(async () => []),
  } as unknown as EntitySource;
}

function person(id: string, extra: Partial<Person> = {}): Person {
  return { id, type: 'person', filePath: '', name: 'Sample Person', role: '', org: '',
    org_tags: [], projects: [], aliases: ['Sample'], status: 'active', content: '', ...extra };
}

describe('entity index builder', () => {
  it('initializes once and indexes all eleven core collections without truncation or network access', async () => {
    const source = sourceStub();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    for (const [getter] of collections) {
      vi.mocked(source[getter]).mockImplementation(async () => {
        expect(source.initialize).toHaveBeenCalledOnce();
        await gate;
        return Array.from({ length: 501 }, (_, i) => ({ id: `item-${i}`, aliases: [] })) as never;
      });
    }
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('unexpected network'); });
    try {
      const pending = indexer.buildIndex(source);
      await vi.waitFor(() => {
        for (const [getter] of collections) expect(source[getter]).toHaveBeenCalledOnce();
      });
      release();
      const index = await pending;
      for (const [, key] of collections) expect(index[key].size).toBe(501);
      expect(network).not.toHaveBeenCalled();
      expect(indexer.createEmptyIndex().people.size).toBe(0);
    } finally { network.mockRestore(); }
  });

  it('indexes registered extensions and falls back to default registrations when empty', async () => {
    const source = sourceStub();
    vi.mocked(source.getExtensionTypeRegistrations).mockResolvedValue([
      { type: 'custom', category: 'extension', displayName: 'Custom', description: '', defaultSearch: false },
    ]);
    vi.mocked(source.getExtensionEntities).mockResolvedValue([
      { id: 'custom-1', type: 'custom', name: 'Example', filePath: '', payload: {}, content: '' },
    ]);
    expect((await indexer.buildIndex(source)).extensions.get('custom')?.size).toBe(1);
    expect(source.getExtensionEntities).toHaveBeenCalledExactlyOnceWith('custom');
    const fallback = sourceStub();
    const index = await indexer.buildIndex(fallback);
    expect([...index.extensions.keys()]).toEqual(indexer.getExtensionRegistrations().map(item => item.type));
    expect(indexer.getStorageType('raci')).toBe('raci_assignment');
    expect(indexer.getPublicType('raci_assignment')).toBe('raci');
    expect(indexer.getGraphFetchTypes()).toContain('raci_assignment');
  });

  it('rejects initialization and getter failures without returning an index', async () => {
    for (const getter of ['initialize', ...collections.map(([name]) => name), 'getExtensionTypeRegistrations', 'getExtensionEntities'] as const) {
      const source = sourceStub();
      const failure = new Error(`failed ${getter}`);
      vi.mocked(source[getter]).mockRejectedValue(failure);
      await expect(indexer.buildIndex(source)).rejects.toBe(failure);
      if (getter === 'initialize') expect(source.getProjects).not.toHaveBeenCalled();
    }
  });

  it('rejects non-array collections, empty ids, and duplicate ids within a type', async () => {
    for (const getter of [...collections.map(([name]) => name), 'getExtensionEntities'] as const) {
      for (const malformed of [null, {}, [{ }], [{ id: '' }], [{ id: '  ' }], [{ id: 'same' }, { id: 'same' }]]) {
        const source = sourceStub();
        vi.mocked(source[getter]).mockResolvedValue(malformed as never);
        await expect(indexer.buildIndex(source)).rejects.toThrow();
      }
    }
    const source = sourceStub();
    vi.mocked(source.getExtensionTypeRegistrations).mockResolvedValue(null as never);
    await expect(indexer.buildIndex(source)).rejects.toThrow('collection must be an array');
  });

  it('preserves canonical replacement pointers and excludes inactive-person aliases', async () => {
    for (const state of ['superseded', 'merged', 'retired']) {
      const source = sourceStub();
      const active = person('current', { graph_entity_id: 'graph-current' });
      vi.mocked(source.getPeople).mockResolvedValue([
        person('current', { graph_entity_id: 'graph-old', lifecycle_status: state, canonical_entity_id: 'graph-current', aliases: ['Old'] }),
        active,
        person('legacy', { lifecycle_state: state, canonical_entity_id: 'graph-current', aliases: ['Legacy'] }),
        person('inactive', { status: 'inactive', aliases: ['Inactive'] }),
      ]);
      vi.mocked(source.getOrganizations).mockResolvedValue([
        { id: 'org-row', type: 'org', org_id: 'org-key', filePath: '', name: 'Example Org', aliases: ['Org Alias'], orgType: 'legal_entity', content: '' },
      ]);
      vi.mocked(source.getBrands).mockResolvedValue([
        { id: 'brand-key', type: 'brand', filePath: '', name: 'Example Brand', aliases: ['Brand Alias'], related_orgs: [], related_apps: [], do: [], dont: [], visual_assets: [], content: '' },
      ]);
      const index = await indexer.buildIndex(source);
      expect(index.aliasToOrgId.get('Org Alias')).toBe('org-key');
      expect(index.aliasToBrandId.get('Brand Alias')).toBe('brand-key');
      expect(index.people.get('current')).toBe(active);
      expect(index.people.has('legacy')).toBe(true);
      expect(index.replacedIdToCanonicalId.get('person')?.get('graph-old')).toBe('current');
      expect(index.replacedIdToCanonicalId.get('person')?.get('legacy')).toBe('current');
      expect([...index.aliasToPersonId.keys()]).toEqual(['Sample Person', 'SamplePerson', 'Sample']);
      expect(indexer.isReplacedLifecycle({ lifecycle_status: state })).toBe(true);
    }
    expect(indexer.isActiveLifecycle({ payload: { semantic_state: ' INACTIVE ' } })).toBe(false);
    expect(indexer.isActiveCanonicalPerson({})).toBe(true);
  });

  it('drives createEntityIndexCache as its build without adding a second cache', async () => {
    const source = sourceStub();
    let now = 0;
    let revision = 'a';
    const cache = createEntityIndexCache({ build: () => indexer.buildIndex(source), ttlMs: 100, now: () => now, revision: async () => revision });
    const first = await cache.get();
    expect(await cache.get()).toBe(first);
    expect(source.initialize).toHaveBeenCalledTimes(1);
    now = 101;
    expect(await cache.get()).not.toBe(first);
    cache.invalidate();
    await cache.get();
    revision = 'b';
    await cache.get();
    expect(source.initialize).toHaveBeenCalledTimes(4);
    expect(await indexer.buildIndex(source)).not.toBe(await indexer.buildIndex(source));
    expect(source.initialize).toHaveBeenCalledTimes(6);
  });

  it('exports only the builder surface and omits legacy resolver, search, context, and tenant metadata', async () => {
    expect(Object.keys(indexer).sort()).toEqual([
      'buildIndex', 'createEmptyIndex', 'isActiveLifecycle', 'isActiveCanonicalPerson', 'isReplacedLifecycle',
      'CORE_ENTITY_TYPES', 'EXTENSION_ENTITY_TYPES', 'ENTITY_TYPE_REGISTRY', 'EXTENSION_ENTITY_TYPE_SET',
      'getStorageType', 'getPublicType', 'getExtensionRegistrations', 'getGraphFetchTypes',
    ].sort());
    const source = await readFile(new URL('../src/entity-indexer.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bimport\b|entity-resolution|resolveEntities|searchEntities|getContextForTopic|TERM_EQUIVALENTS|GraphAPISource|TokenProvider|process\.env|fetch\(/);
    expect(source).not.toMatch(/organization_id|tenant_id/);
    expectTypeOf<Extract<keyof BaseEntity, 'organization_id' | 'tenant_id'>>().toEqualTypeOf<never>();
    expectTypeOf<BaseEntity['retrieval_evidence']>().toEqualTypeOf<RetrievalEvidence | undefined>();
  });
});
