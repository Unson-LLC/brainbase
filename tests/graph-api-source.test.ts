/**
 * GraphAPISource Test
 * Graph SSOT APIからentity取得のテスト
 */

import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert';
import { GRAPH_ALIAS_TYPES, GraphAPISource, mergeGraphAliasPointers } from '../src/graph-api-source.js';
import type { TokenProvider as TokenManager } from '../src/graph-token-provider.js';
import { getGraphFetchTypes } from '../src/entity-ontology.js';
import {
  buildIndex,
  getEntitiesByType,
  getEntity,
  resolveEntities,
  resolveOrgId,
  searchEntities,
} from '../src/entity-indexer.js';

describe('GraphAPISource', () => {
  it('projects the public app profile and tenant metadata without exposing raw payload fields', () => {
    const source = new GraphAPISource('http://localhost:31013', {
      getToken: vi.fn(async () => 'mock-token'),
      refresh: vi.fn(async () => {}),
    } as unknown as TokenManager);

    const app = source.convertEntity({
      entity_id: 'app_brainbase_omi',
      entity_type: 'app',
      project_code: 'brainbase',
      organization_id: 'unson',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      payload: {
        app_id: 'brainbase-omi',
        name: 'Brainbase Omi',
        projects: ['brainbase'],
        parent_project: 'brainbase',
        parent_project_entity_id: 'prj_01KGCS8CAJKKDWACPNK1E5WX8H',
        repository: {
          owner: 'Unson-LLC',
          repo: 'brainbase-omi',
          url: 'https://github.com/Unson-LLC/brainbase-omi',
          token: 'do-not-expose',
        },
        environments: {
          production: {
            worker: 'brainbase-omi-ingest',
            runtime: 'cloudflare-workers',
            endpoint: 'https://brainbase-omi-ingest.unson.workers.dev',
            ai_service: 'workers-ai',
            data_services: ['d1:brainbase-omi', 'r2:brainbase-omi-audio'],
            async_services: ['queue:brainbase-omi-transcription', 'queue:brainbase-omi-transcription-dlq'],
            credential_ref: 'cloudflare-profile:unson',
            bindings: { secret: 'do-not-expose' },
          },
          secret: { token: 'do-not-expose' },
        },
        record_class: 'service_application',
        service_profile_eligible: true,
        api_key: 'do-not-expose',
      },
    });

    assert.equal(app.type, 'app');
    assert.equal(app.project, 'brainbase');
    assert.deepEqual(app.projects, ['brainbase']);
    assert.equal(app.parent_project, 'brainbase');
    assert.equal(app.parent_project_entity_id, 'prj_01KGCS8CAJKKDWACPNK1E5WX8H');
    assert.deepEqual(app.repository, {
      owner: 'Unson-LLC',
      repo: 'brainbase-omi',
      url: 'https://github.com/Unson-LLC/brainbase-omi',
    });
    assert.deepEqual(app.environments, {
      production: {
        worker: 'brainbase-omi-ingest',
        runtime: 'cloudflare-workers',
        endpoint: 'https://brainbase-omi-ingest.unson.workers.dev',
        ai_service: 'workers-ai',
        data_services: ['d1:brainbase-omi', 'r2:brainbase-omi-audio'],
        async_services: ['queue:brainbase-omi-transcription', 'queue:brainbase-omi-transcription-dlq'],
      },
    });
    assert.equal(app.record_class, 'service_application');
    assert.equal(app.service_profile_eligible, true);
    assert.deepEqual(app.operational_profile_coverage, {
      available_fields: [
        'projects',
        'repository',
        'parent_project',
        'parent_project_entity_id',
        'environments',
        'record_class',
        'service_profile_eligible',
      ],
      omitted_fields: ['summary'],
    });
    assert.equal(app.organization_id, 'unson');
    assert.equal(app.tenant_id, 'ten_01JTESTTENANT00000000000000');
    const projected = JSON.stringify(app);
    assert.doesNotMatch(projected, /do-not-expose/);
    assert.doesNotMatch(projected, /credential_ref|bindings|api_key/);
    assert.equal('payload' in app, false);
  });

  it('keeps maintenance lifecycle, semantic state, and version separate from payload status', async () => {
    const mockTokenManager = {
      getToken: vi.fn(async () => 'mock-token'),
      refresh: vi.fn(async () => {}),
    } as unknown as TokenManager;
    global.fetch = vi.fn(async (url: string) => {
      const type = new URL(url).searchParams.get('type');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          entities: type === 'decision' ? [{
            entity_id: 'dec_maintenance',
            entity_type: 'decision',
            project_code: 'brainbase',
            lifecycle_status: 'retired',
            semantic_state: 'superseded',
            version: 2,
            payload: { title: '旧判断', status: 'decided', statement: 'Graphを正本にする', rationale: '関係と決定を保持する', source_pointer: 'docs/policy.md', provenance: { commit: 'abc123' } },
          }] : [],
        }),
      };
    }) as any;

    const source = new GraphAPISource('http://localhost:31013', mockTokenManager);
    await source.initialize();
    const [decision] = await source.getDecisions();

    assert.strictEqual(decision.status, 'decided');
    assert.strictEqual(decision.lifecycle_status, 'retired');
    assert.strictEqual(decision.lifecycle_state, 'retired');
    assert.strictEqual(decision.semantic_state, 'superseded');
    assert.strictEqual(decision.version, 2);

  });

  it('projects extension status and canonical summary from Graph payloads', async () => {
    const mockTokenManager = {
      getToken: vi.fn(async () => 'mock-token'),
      refresh: vi.fn(async () => {}),
    } as unknown as TokenManager;
    global.fetch = vi.fn(async (url: string) => {
      const type = new URL(url).searchParams.get('type');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          entities: type === 'product' ? [{
            entity_id: 'product_unson_dialogai',
            entity_type: 'product',
            project_code: 'dialogai',
            payload: {
              name: 'DialogAI',
              status: 'maintenance',
              summary: '保守運用契約に基づいて稼働中。',
              description: '旧説明',
            },
          }] : [],
        }),
      };
    }) as any;

    const source = new GraphAPISource('http://localhost:31013', mockTokenManager);
    await source.initialize();
    const products = await source.getExtensionEntities('product');

    assert.strictEqual(products.length, 1);
    assert.strictEqual(products[0].status, 'maintenance');
    assert.strictEqual(products[0].content, '保守運用契約に基づいて稼働中。');
  });

  it('searches the Graph API on demand for extension entities beyond the startup snapshot', async () => {
    const mockTokenManager = {
      getToken: vi.fn(async () => 'mock-token'),
      refresh: vi.fn(async () => {}),
    } as unknown as TokenManager;
    const mockFetch = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      assert.strictEqual(parsed.searchParams.get('type'), 'contact');
      assert.strictEqual(parsed.searchParams.get('query'), '佐藤');
      assert.strictEqual(parsed.searchParams.get('limit'), '500');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          entities: [{
            entity_id: 'contact_sato_keigo',
            entity_type: 'contact',
            payload: {
              name: '佐藤 圭吾',
              company_name: '株式会社雲孫',
              email: 'keigo@example.com',
            },
          }],
        }),
      };
    });
    global.fetch = mockFetch as any;

    const source = new GraphAPISource('http://localhost:31013', mockTokenManager);
    const contacts = await source.searchExtensionEntities('contact', '佐藤');

    assert.strictEqual(contacts.length, 1);
    assert.strictEqual(contacts[0].id, 'contact_sato_keigo');
    assert.strictEqual(contacts[0].payload.company_name, '株式会社雲孫');
  });

  describe('initialize', () => {
    it('should fetch entities from Graph API', async () => {
      // Mock TokenManager
      const mockTokenManager = {
        getToken: vi.fn(async () => 'mock-token'),
        refresh: vi.fn(async () => {}),
      } as unknown as TokenManager;

      // Mock fetch
      const mockFetch = vi.fn(async (url: string, options: any) => {
        const type = new URL(url).searchParams.get('type') || 'project';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            entities: [
              {
                entity_id: `${type}_001`,
                entity_type: type,
                payload: {
                  code: 'brainbase',
                  name: 'brainbase',
                  status: 'active',
                  team: ['佐藤圭吾'],
                  orgs: ['UNSON'],
                },
              },
              {
                entity_id: `${type}_002`,
                entity_type: type,
                payload: {
                  name: '佐藤圭吾',
                  role: 'CEO',
                  org: 'UNSON',
                },
              },
            ],
          }),
        };
      });

      global.fetch = mockFetch as any;

      const source = new GraphAPISource('http://localhost:31013', mockTokenManager);
      await source.initialize();

      // Verify fetch was called with correct parameters
      assert.strictEqual(mockFetch.mock.calls.length, getGraphFetchTypes().length + GRAPH_ALIAS_TYPES.length);
      const [url, options] = mockFetch.mock.calls[0];
      assert.strictEqual(url, 'http://localhost:31013/api/info/graph/entities?type=project&limit=500');
      assert.strictEqual(options.headers['Authorization'], 'Bearer mock-token');
      assert.strictEqual(options.headers['x-brainbase-role'], 'gm');
      assert.strictEqual(options.headers['x-brainbase-projects'], 'brainbase');
      assert.strictEqual(options.headers['x-brainbase-clearance'], 'internal,restricted,finance,hr,contract');
    });

    it('should reject an incomplete snapshot and recover without publishing partial data', async () => {
      const mockTokenManager = {
        getToken: vi.fn(async () => 'mock-token'),
        refresh: vi.fn(async () => {}),
      } as unknown as TokenManager;
      let unavailable = true;
      const mockFetch = vi.fn(async (url: string) => {
        const type = new URL(url).searchParams.get('type');
        if (unavailable && type === 'person') {
          return { ok: false, status: 503, statusText: 'Service Unavailable' };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            entities: type === 'project' ? [{
              entity_id: 'project_brainbase',
              entity_type: 'project',
              project_code: 'brainbase',
              payload: { code: 'brainbase', name: 'Brainbase' },
            }] : [],
          }),
        };
      });
      global.fetch = mockFetch as any;

      const source = new GraphAPISource('http://localhost:31013', mockTokenManager);
      await assert.rejects(
        source.initialize(),
        (error: any) => {
          assert.strictEqual(error.code, 'graph_source_unavailable');
          assert.strictEqual(error.entityType, 'person');
          assert.strictEqual(error.status, 503);
          assert.match(error.message, /snapshot incomplete: failed to fetch person \(503 Service Unavailable\)/);
          return true;
        },
      );
      assert.deepStrictEqual(await source.getProjects(), []);

      unavailable = false;
      await source.initialize();
      assert.strictEqual((await source.getProjects()).length, 1);
    });

    it('should reject a successful response with a missing entities array', async () => {
      const mockTokenManager = {
        getToken: vi.fn(async () => 'mock-token'),
        refresh: vi.fn(async () => {}),
      } as unknown as TokenManager;
      const mockFetch = vi.fn(async (url: string) => {
        const type = new URL(url).searchParams.get('type');
        return {
          ok: true,
          status: 200,
          json: async () => type === 'person' ? {} : { entities: [] },
        };
      });
      global.fetch = mockFetch as any;

      const source = new GraphAPISource('http://localhost:31013', mockTokenManager);
      await assert.rejects(
        source.initialize(),
        (error: any) => {
          assert.strictEqual(error.code, 'graph_source_unavailable');
          assert.strictEqual(error.entityType, 'person');
          assert.match(error.message, /snapshot incomplete: person response did not include an entities array/);
          return true;
        },
      );
      assert.deepStrictEqual(await source.getProjects(), []);
    });

    it('should reject a record without a non-empty entity_id or id', async () => {
      const mockTokenManager = {
        getToken: vi.fn(async () => 'mock-token'),
        refresh: vi.fn(async () => {}),
      } as unknown as TokenManager;
      const mockFetch = vi.fn(async (url: string) => {
        const type = new URL(url).searchParams.get('type');
        return {
          ok: true,
          status: 200,
          json: async () => type === 'person'
            ? { entities: [{ entity_type: 'person', payload: { name: 'Unknown' } }] }
            : { entities: [] },
        };
      });
      global.fetch = mockFetch as any;

      const source = new GraphAPISource('http://localhost:31013', mockTokenManager);
      await assert.rejects(
        source.initialize(),
        (error: any) => {
          assert.strictEqual(error.code, 'graph_source_unavailable');
          assert.strictEqual(error.entityType, 'person');
          assert.match(error.message, /record at index 0 did not include a non-empty entity_id or id/);
          return true;
        },
      );
      assert.deepStrictEqual(await source.getPeople(), []);
    });

    it('should reject a record whose payload is not an object', async () => {
      const mockTokenManager = {
        getToken: vi.fn(async () => 'mock-token'),
        refresh: vi.fn(async () => {}),
      } as unknown as TokenManager;
      const mockFetch = vi.fn(async (url: string) => {
        const type = new URL(url).searchParams.get('type');
        return {
          ok: true,
          status: 200,
          json: async () => type === 'person'
            ? { entities: [{ entity_id: 'person_invalid_payload', payload: [] }] }
            : { entities: [] },
        };
      });
      global.fetch = mockFetch as any;

      const source = new GraphAPISource('http://localhost:31013', mockTokenManager);
      await assert.rejects(
        source.initialize(),
        (error: any) => {
          assert.strictEqual(error.code, 'graph_source_unavailable');
          assert.strictEqual(error.entityType, 'person');
          assert.match(error.message, /record at index 0 did not include an object payload/);
          return true;
        },
      );
      assert.deepStrictEqual(await source.getPeople(), []);
    });

    it('should abort an in-flight request when total initialization exceeds its deadline', async () => {
      const mockTokenManager = {
        getToken: vi.fn(async () => 'mock-token'),
        refresh: vi.fn(async () => {}),
      } as unknown as TokenManager;
      const signals: AbortSignal[] = [];
      const mockFetch = vi.fn(async (_url: string, options: RequestInit) => {
        const signal = options.signal as AbortSignal;
        signals.push(signal);
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        throw new Error('unreachable');
      });
      global.fetch = mockFetch as any;

      const source = new GraphAPISource(
        'http://localhost:31013',
        mockTokenManager,
        undefined,
        { initializeTimeoutMs: 20, fetchTimeoutMs: 1_000 },
      );
      await assert.rejects(
        source.initialize(),
        (error: any) => {
          assert.strictEqual(error.code, 'graph_source_timeout');
          assert.match(error.message, /Graph index initialization timed out after 20ms/);
          return true;
        },
      );
      assert.strictEqual(signals.length, 1);
      assert.strictEqual(signals[0].aborted, true);
    });

    it('should abort response consumption when an individual request exceeds its deadline', async () => {
      const mockTokenManager = {
        getToken: vi.fn(async () => 'mock-token'),
        refresh: vi.fn(async () => {}),
      } as unknown as TokenManager;
      const signals: AbortSignal[] = [];
      const mockFetch = vi.fn(async (_url: string, options: RequestInit) => {
        const signal = options.signal as AbortSignal;
        signals.push(signal);
        return {
          ok: true,
          status: 200,
          json: async () => await new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
        };
      });
      global.fetch = mockFetch as any;

      const source = new GraphAPISource(
        'http://localhost:31013',
        mockTokenManager,
        undefined,
        { initializeTimeoutMs: 1_000, fetchTimeoutMs: 20 },
      );
      await assert.rejects(
        source.initialize(),
        (error: any) => {
          assert.strictEqual(error.code, 'graph_source_timeout');
          assert.match(error.message, /Graph API request timed out after 20ms/);
          return true;
        },
      );
      assert.strictEqual(signals.length, 1);
      assert.strictEqual(signals[0].aborted, true);
    });

    it('should handle 401 and refresh token', async () => {
      let tokenCallCount = 0;
      const mockTokenManager = {
        getToken: vi.fn(async () => {
          tokenCallCount++;
          return tokenCallCount === 1 ? 'expired-token' : 'new-token';
        }),
        refresh: vi.fn(async () => {}),
      } as unknown as TokenManager;

      let fetchCallCount = 0;
      const mockFetch = vi.fn(async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return {
            ok: false,
            status: 401,
          };
        } else {
          return {
            ok: true,
            status: 200,
            json: async () => ({ entities: [] }),
          };
        }
      });

      global.fetch = mockFetch as any;

      const source = new GraphAPISource('http://localhost:31013', mockTokenManager);
      await source.initialize();

      // Verify refresh was called
      assert.strictEqual((mockTokenManager.refresh as any).mock.calls.length, 1);
      // Verify retry succeeded for the first entity type, then continued with remaining types.
      assert.strictEqual(mockFetch.mock.calls.length, getGraphFetchTypes().length + GRAPH_ALIAS_TYPES.length + 1);
    });

    it('loads legacy alias rows as canonical aliases without duplicating org/person lists', async () => {
      const mockTokenManager = {
        getToken: vi.fn(async () => 'mock-token'),
        refresh: vi.fn(async () => {}),
      } as unknown as TokenManager;
      const mockFetch = vi.fn(async (url: string) => {
        const type = new URL(url).searchParams.get('type');
        const entities = type === 'org' ? [{
          entity_id: 'baao', entity_type: 'org', payload: { org_id: 'baao', name: 'BAAO', aliases: ['ビジネスAI推進機構'] }
        }] : type === 'person' ? [{
          entity_id: 'per_canonical', entity_type: 'person', payload: { name: '佐藤 圭吾' }
        }] : type === 'org_alias' ? [{
          entity_id: 'org_baao', entity_type: 'org_alias', payload: { canonical_entity_id: 'baao' },
        }, {
          entity_id: 'org_baao_retired', entity_type: 'org_alias', lifecycle_status: 'retired', payload: { canonical_entity_id: 'baao' },
        }, {
          entity_id: 'org_baao_superseded', entity_type: 'org_alias', lifecycle_state: 'superseded', payload: { canonical_entity_id: 'baao' },
        }] : type === 'person_alias' ? [{
          entity_id: 'per_legacy', entity_type: 'person_alias', payload: { canonical_entity_id: 'per_canonical' },
        }, {
          entity_id: 'per_retired', entity_type: 'person_alias', lifecycle_status: 'retired', payload: { canonical_entity_id: 'per_canonical' },
        }, {
          entity_id: 'per_superseded', entity_type: 'person_alias', lifecycle_state: 'superseded', payload: { canonical_entity_id: 'per_canonical' },
        }] : [];
        return { ok: true, status: 200, json: async () => ({ entities }) };
      });
      global.fetch = mockFetch as any;

      const source = new GraphAPISource('http://localhost:31013', mockTokenManager);
      await source.initialize();

      const orgs = await source.getOrganizations();
      const people = await source.getPeople();
      assert.strictEqual(orgs.length, 1);
      assert.deepStrictEqual(orgs[0].aliases, ['ビジネスAI推進機構', 'org_baao']);
      assert.strictEqual(people.length, 1);
      assert.deepStrictEqual(people[0].aliases, ['per_legacy']);
    });

    it('does not merge inactive canonical or retired/superseded alias pointers', () => {
      const merged = mergeGraphAliasPointers([
        { entity_id: 'per_active', entity_type: 'person', payload: { name: 'Active' } },
        { entity_id: 'per_inactive', entity_type: 'person', payload: { name: 'Inactive', status: 'inactive' } },
      ], [
        { entity_id: 'per_active_alias', entity_type: 'person_alias', payload: { canonical_entity_id: 'per_active' } },
        { entity_id: 'per_retired', entity_type: 'person_alias', lifecycle_status: 'retired', payload: { canonical_entity_id: 'per_active' } },
        { entity_id: 'per_superseded', entity_type: 'person_alias', lifecycle_state: 'superseded', payload: { canonical_entity_id: 'per_active' } },
        { entity_id: 'per_inactive_alias', entity_type: 'person_alias', payload: { canonical_entity_id: 'per_inactive' } },
      ]);

      assert.deepStrictEqual(merged[0].payload.aliases, ['per_active_alias']);
      assert.equal(merged[1].payload.aliases, undefined);
    });

    it('SPEC-brainbase-mcp-core-ontology INV-3 S-2: should fetch raci from raci_assignment storage type', async () => {
      const mockTokenManager = {
        getToken: vi.fn(async () => 'mock-token'),
        refresh: vi.fn(async () => {}),
      } as unknown as TokenManager;
      const requestedTypes: string[] = [];
      const mockFetch = vi.fn(async (url: string) => {
        const type = new URL(url).searchParams.get('type') || '';
        requestedTypes.push(type);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            entities: type === 'raci_assignment' ? [{
              entity_id: 'raci_unson',
              entity_type: 'raci_assignment',
              payload: { org_id: 'unson', name: 'UNSON', products: ['Brainbase'] },
            }] : [],
          }),
        };
      });
      global.fetch = mockFetch as any;

      const source = new GraphAPISource('http://localhost:31013', mockTokenManager);
      await source.initialize();
      const racis = await source.getRACIs();

      assert.ok(requestedTypes.includes('raci_assignment'));
      assert.strictEqual(racis.length, 1);
      assert.strictEqual(racis[0].type, 'raci');
      assert.strictEqual(racis[0].id, 'unson');
      assert.deepStrictEqual(racis[0].products, ['Brainbase']);
    });
  });

  describe('getBrands', () => {
    it('SPEC-brainbase-mcp-core-ontology INV-2 S-1: should return brand core entities', async () => {
      const mockTokenManager = {
        getToken: vi.fn(async () => 'mock-token'),
        refresh: vi.fn(async () => {}),
      } as unknown as TokenManager;
      const mockFetch = vi.fn(async (url: string) => {
        const type = new URL(url).searchParams.get('type');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            entities: type === 'brand' ? [{
              entity_id: 'brand_baao',
              entity_type: 'brand',
              payload: { name: 'BAAO Brand Guide', aliases: ['BAAO'], markdown: 'BAAOの語り方と約束。' },
            }] : [],
          }),
        };
      });
      global.fetch = mockFetch as any;

      const source = new GraphAPISource('http://localhost:31013', mockTokenManager);
      await source.initialize();
      const brands = await source.getBrands();

      assert.strictEqual(brands.length, 1);
      assert.strictEqual(brands[0].type, 'brand');
      assert.strictEqual(brands[0].name, 'BAAO Brand Guide');
      assert.deepStrictEqual(brands[0].aliases, ['BAAO']);
      assert.strictEqual(brands[0].content, 'BAAOの語り方と約束。');
    });
  });

  describe('getProjects', () => {
    it('should return projects filtered by project codes', async () => {
      const mockTokenManager = {
        getToken: vi.fn(async () => 'mock-token'),
        refresh: vi.fn(async () => {}),
      } as unknown as TokenManager;

      const mockFetch = vi.fn(async (url: string) => {
        const type = new URL(url).searchParams.get('type');
        return {
          ok: true,
          json: async () => ({
            entities: type === 'project' ? [
              {
                entity_id: 'prj_001',
                entity_type: 'project',
                project_code: 'brainbase',
                payload: {
                  code: 'brainbase-customer-delivery',
                  name: 'brainbase Project',
                  aliases: ['ブレインベース'],
                },
              },
              {
                entity_id: 'prj_002',
                entity_type: 'project',
                project_code: 'zeims',
                payload: {
                  code: 'zeims-beta-release',
                  name: 'zeims Project',
                },
              },
              {
                entity_id: 'prj_003',
                entity_type: 'project',
                project_code: 'other',
                payload: {
                  code: 'other-customer-delivery',
                  name: 'Other Project',
                },
              },
            ] : [],
          }),
        };
      });

      global.fetch = mockFetch as any;

      const source = new GraphAPISource('http://localhost:31013', mockTokenManager, ['brainbase', 'zeims']);
      const index = await buildIndex(source);
      const projects = [...index.projects.values()];

      // Should filter out 'other' project
      assert.strictEqual(projects.length, 2);
      assert.strictEqual(projects[0].id, 'brainbase-customer-delivery');
      assert.deepStrictEqual(projects[0].aliases, ['ブレインベース']);
      assert.deepStrictEqual(projects[1].aliases, []);
      assert.strictEqual(projects[1].id, 'zeims-beta-release');

      const resolved = resolveEntities(index, { query: 'ブレインベース', types: ['project'] });
      assert.strictEqual(resolved.candidates[0]?.entity_id, 'prj_001');
      assert.ok(resolved.candidates[0]?.matched_fields.includes('aliases'));
    });
  });

  describe('getDecisions', () => {
    it('should return decisions with correct format', async () => {
      const mockTokenManager = {
        getToken: vi.fn(async () => 'mock-token'),
        refresh: vi.fn(async () => {}),
      } as unknown as TokenManager;

      const mockFetch = vi.fn(async (url: string) => {
        const type = new URL(url).searchParams.get('type');
        return {
          ok: true,
          json: async () => ({
            entities: type === 'decision' ? [
              {
                entity_id: 'dec_001',
                entity_type: 'decision',
                payload: {
                  decision_id: 'dec_001',
                  title: 'brainbase MCPのDecision統合',
                  content: 'Graph SSOT APIにDecision entity typeを追加する',
                  decided_at: '2026-02-07T09:00:00Z',
                  decider: '佐藤圭吾',
                  project_id: 'brainbase',
                  status: 'decided',
                  tags: ['tech', 'architecture'],
                },
                updated_at: '2026-02-07T10:00:00Z',
              },
            ] : [],
          }),
        };
      });

      global.fetch = mockFetch as any;

      const source = new GraphAPISource('http://localhost:31013', mockTokenManager);
      await source.initialize();

      const decisions = await source.getDecisions();

      assert.strictEqual(decisions.length, 1);
      assert.strictEqual(decisions[0].type, 'decision');
      assert.strictEqual(decisions[0].decision_id, 'dec_001');
      assert.strictEqual(decisions[0].title, 'brainbase MCPのDecision統合');
      assert.strictEqual(decisions[0].decider, '佐藤圭吾');
      assert.strictEqual(decisions[0].project_id, 'brainbase');
      assert.strictEqual(decisions[0].status, 'decided');
      assert.deepStrictEqual(decisions[0].tags, ['tech', 'architecture']);
    });
  });

  describe('getPhilosophyContext', () => {
    it('should fetch philosophy context from Graph context API', async () => {
      const mockTokenManager = {
        getToken: vi.fn(async () => 'mock-token'),
        refresh: vi.fn(async () => {}),
      } as unknown as TokenManager;

      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          philosophy_context: {
            mode: 'graph_operation_context',
            project_code: 'brainbase',
            scope: 'crm',
            prompt_block: 'Brainbase Philosophy Context\nScope: crm',
            applied_ids: ['phi_push_case_center'],
          },
        }),
      }));
      global.fetch = mockFetch as any;

      const source = new GraphAPISource('http://localhost:31013', mockTokenManager);
      const context = await source.getPhilosophyContext({
        projectCode: 'brainbase',
        scope: 'crm',
        objectType: 'push_case',
        operation: 'write',
        maxRecommended: 4,
      });

      assert.strictEqual(context.prompt_block, 'Brainbase Philosophy Context\nScope: crm');
      const [url, options] = mockFetch.mock.calls[0];
      assert.strictEqual(
        url,
        'http://localhost:31013/api/info/context?project=brainbase&types=project&includePhilosophy=true&scope=crm&objectType=push_case&operation=write&maxRecommended=4'
      );
      assert.strictEqual(options.headers['Authorization'], 'Bearer mock-token');
      assert.strictEqual(options.headers['x-brainbase-role'], 'gm');
      assert.strictEqual(options.headers['x-brainbase-projects'], 'brainbase');
    });
  });
});

// Graph returns entities ordered by entity_id, so a superseded record whose id
// sorts after the canonical one reaches the index last. These fixtures mirror
// the 2026-10-11 production merges (arinos / org_arinos, unson / organization_unson).
const GRAPH_ENTITIES: Record<string, unknown[]> = {
  org: [
    {
      entity_id: 'arinos', entity_type: 'org', lifecycle_status: 'active',
      payload: { org_id: 'arinos', name: '株式会社Arinos', aliases: ['Arinos', 'アリノス', 'org_arinos'] },
    },
    {
      entity_id: 'org_arinos', entity_type: 'org', lifecycle_status: 'superseded',
      payload: { org_id: 'arinos', name: '株式会社Arinos', aliases: ['Arinos', 'アリノス'], canonical_entity_id: 'arinos' },
    },
    {
      entity_id: 'org_old_trading', entity_type: 'org', lifecycle_status: 'retired',
      payload: { org_id: 'old-trading', name: '旧商事', aliases: [] },
    },
    {
      entity_id: 'org_merged_trading', entity_type: 'org', lifecycle_status: 'merged',
      payload: { org_id: 'merged-trading', name: '統合前商事', aliases: [] },
    },
    {
      entity_id: 'organization_unson', entity_type: 'org', lifecycle_status: 'superseded',
      payload: { name: '合同会社雲孫', aliases: ['雲孫'], canonical_entity_id: 'unson' },
    },
    {
      entity_id: 'unson', entity_type: 'org', lifecycle_status: 'active',
      payload: { org_id: 'unson', name: '合同会社雲孫', aliases: ['雲孫', 'organization_unson'] },
    },
  ],
  person: [
    {
      entity_id: 'per_tanaka', entity_type: 'person', lifecycle_status: 'active',
      payload: { name: '田中 一郎', aliases: [] },
    },
    {
      // The canonical person does not list this id as an alias; only canonical_entity_id points back.
      entity_id: 'per_tanaka_legacy', entity_type: 'person', lifecycle_status: 'superseded',
      payload: { name: '田中 一郎', aliases: [], canonical_entity_id: 'per_tanaka' },
    },
  ],
  customer: [
    {
      entity_id: 'cus_sankyo', entity_type: 'customer', lifecycle_status: 'active',
      payload: { customer_id: 'sankyo', name: '株式会社サンキョウ', status: 'active' },
    },
    {
      entity_id: 'cus_sankyo_dup', entity_type: 'customer', lifecycle_status: 'superseded',
      payload: { customer_id: 'sankyo', name: '株式会社サンキョウ', status: 'active', canonical_entity_id: 'cus_sankyo' },
    },
  ],
  partner: [
    {
      entity_id: 'ptn_furuya', entity_type: 'partner', lifecycle_status: 'active',
      payload: { name: '古家パートナーズ', aliases: [] },
    },
    {
      entity_id: 'ptn_furuya_old', entity_type: 'partner', lifecycle_status: 'superseded',
      payload: { name: '古家パートナーズ', aliases: [], canonical_entity_id: 'ptn_furuya' },
    },
  ],
};

const originalLifecycleFetch = global.fetch;

async function buildFixtureIndex() {
  global.fetch = vi.fn(async (url: string) => {
    const type = new URL(url).searchParams.get('type') || '';
    return { ok: true, json: async () => ({ entities: GRAPH_ENTITIES[type] ?? [] }) };
  }) as unknown as typeof fetch;
  const source = new GraphAPISource('http://localhost:31013', {
    getToken: vi.fn(async () => 'mock-token'),
    refresh: vi.fn(async () => {}),
  } as unknown as TokenManager);
  return buildIndex(source);
}

const graphIds = (entities: Array<{ graph_entity_id?: string; id: string }>) =>
  entities.map(entity => entity.graph_entity_id || entity.id).sort();

describe('entity index lifecycle', () => {
  afterEach(() => {
    global.fetch = originalLifecycleFetch;
  });

  it('keeps the active org when a superseded org shares its org_id', async () => {
    const index = await buildFixtureIndex();
    assert.strictEqual(index.orgs.get('arinos')?.graph_entity_id, 'arinos');
    assert.strictEqual(index.orgs.get('arinos')?.lifecycle_status, 'active');
  });

  it('keeps the active customer when a superseded customer shares its customer_id', async () => {
    const index = await buildFixtureIndex();
    assert.deepStrictEqual(graphIds(getEntitiesByType(index, 'customer')), ['cus_sankyo']);
  });

  it('lists only active records for org, person, customer, and partner', async () => {
    const index = await buildFixtureIndex();
    assert.deepStrictEqual(graphIds(getEntitiesByType(index, 'org')), ['arinos', 'unson']);
    assert.deepStrictEqual(graphIds(getEntitiesByType(index, 'person')), ['per_tanaka']);
    assert.deepStrictEqual(graphIds(getEntitiesByType(index, 'customer')), ['cus_sankyo']);
    assert.deepStrictEqual(graphIds(getEntitiesByType(index, 'partner')), ['ptn_furuya']);
  });

  it('never returns superseded, merged, or retired records from resolve_entity or search', async () => {
    const index = await buildFixtureIndex();
    const cases: Array<[string, string, string[]]> = [
      ['Arinos', 'org', ['arinos']],
      ['雲孫', 'org', ['unson']],
      ['旧商事', 'org', []],
      ['統合前商事', 'org', []],
      ['田中 一郎', 'person', ['per_tanaka']],
      ['サンキョウ', 'customer', ['cus_sankyo']],
      ['古家パートナーズ', 'partner', ['ptn_furuya']],
    ];
    for (const [query, type, expected] of cases) {
      const result = resolveEntities(index, { query, types: [type] });
      assert.deepStrictEqual(result.candidates.map(candidate => candidate.entity_id).sort(), expected, `${type}:${query}`);
    }
    assert.deepStrictEqual(graphIds(searchEntities(index, 'Arinos')), ['arinos']);
    assert.strictEqual(resolveOrgId(index, 'old-trading'), undefined);
  });

  it('leads a superseded id to the canonical_entity_id record', async () => {
    const index = await buildFixtureIndex();
    assert.strictEqual(getEntity(index, 'org', 'org_arinos')?.graph_entity_id, 'arinos');
    assert.strictEqual(getEntity(index, 'org', 'organization_unson')?.graph_entity_id, 'unson');
    assert.strictEqual(getEntity(index, 'person', 'per_tanaka_legacy')?.graph_entity_id, 'per_tanaka');
    assert.strictEqual(getEntity(index, 'customer', 'cus_sankyo_dup')?.graph_entity_id, 'cus_sankyo');
    assert.strictEqual(getEntity(index, 'partner', 'ptn_furuya_old')?.graph_entity_id, 'ptn_furuya');
    assert.strictEqual(getEntity(index, 'org', 'org_old_trading'), undefined);
  });
});
