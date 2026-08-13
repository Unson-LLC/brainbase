/**
 * GraphAPISource Test
 * Graph SSOT APIからentity取得のテスト
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { GRAPH_ALIAS_TYPES, GraphAPISource } from '../../src/sources/graphapi-source.js';
import { TokenManager } from '../../src/auth/token-manager.js';
import { getGraphFetchTypes } from '../../src/indexer/ontology.js';

describe('GraphAPISource', () => {
  it('projects extension status and canonical summary from Graph payloads', async () => {
    const mockTokenManager = {
      getToken: mock.fn(async () => 'mock-token'),
      refresh: mock.fn(async () => {}),
    } as unknown as TokenManager;
    global.fetch = mock.fn(async (url: string) => {
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
      getToken: mock.fn(async () => 'mock-token'),
      refresh: mock.fn(async () => {}),
    } as unknown as TokenManager;
    const mockFetch = mock.fn(async (url: string) => {
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
        getToken: mock.fn(async () => 'mock-token'),
        refresh: mock.fn(async () => {}),
      } as unknown as TokenManager;

      // Mock fetch
      const mockFetch = mock.fn(async (url: string, options: any) => {
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
      assert.strictEqual(mockFetch.mock.callCount(), getGraphFetchTypes().length + GRAPH_ALIAS_TYPES.length);
      const [url, options] = mockFetch.mock.calls[0].arguments;
      assert.strictEqual(url, 'http://localhost:31013/api/info/graph/entities?type=project&limit=500');
      assert.strictEqual(options.headers['Authorization'], 'Bearer mock-token');
      assert.strictEqual(options.headers['x-brainbase-role'], 'gm');
      assert.strictEqual(options.headers['x-brainbase-projects'], 'brainbase');
      assert.strictEqual(options.headers['x-brainbase-clearance'], 'internal,restricted,finance,hr,contract');
    });

    it('should handle 401 and refresh token', async () => {
      let tokenCallCount = 0;
      const mockTokenManager = {
        getToken: mock.fn(async () => {
          tokenCallCount++;
          return tokenCallCount === 1 ? 'expired-token' : 'new-token';
        }),
        refresh: mock.fn(async () => {}),
      } as unknown as TokenManager;

      let fetchCallCount = 0;
      const mockFetch = mock.fn(async () => {
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
      assert.strictEqual((mockTokenManager.refresh as any).mock.callCount(), 1);
      // Verify retry succeeded for the first entity type, then continued with remaining types.
      assert.strictEqual(mockFetch.mock.callCount(), getGraphFetchTypes().length + GRAPH_ALIAS_TYPES.length + 1);
    });

    it('loads legacy alias rows as canonical aliases without duplicating org/person lists', async () => {
      const mockTokenManager = {
        getToken: mock.fn(async () => 'mock-token'),
        refresh: mock.fn(async () => {}),
      } as unknown as TokenManager;
      const mockFetch = mock.fn(async (url: string) => {
        const type = new URL(url).searchParams.get('type');
        const entities = type === 'org' ? [{
          entity_id: 'baao', entity_type: 'org', payload: { org_id: 'baao', name: 'BAAO', aliases: ['ビジネスAI推進機構'] }
        }] : type === 'person' ? [{
          entity_id: 'per_canonical', entity_type: 'person', payload: { name: '佐藤 圭吾' }
        }] : type === 'org_alias' ? [{
          entity_id: 'org_baao', entity_type: 'org_alias', payload: { canonical_entity_id: 'baao' }
        }] : type === 'person_alias' ? [{
          entity_id: 'per_legacy', entity_type: 'person_alias', payload: { canonical_entity_id: 'per_canonical' }
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

    it('SPEC-brainbase-mcp-core-ontology INV-3 S-2: should fetch raci from raci_assignment storage type', async () => {
      const mockTokenManager = {
        getToken: mock.fn(async () => 'mock-token'),
        refresh: mock.fn(async () => {}),
      } as unknown as TokenManager;
      const requestedTypes: string[] = [];
      const mockFetch = mock.fn(async (url: string) => {
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
        getToken: mock.fn(async () => 'mock-token'),
        refresh: mock.fn(async () => {}),
      } as unknown as TokenManager;
      const mockFetch = mock.fn(async (url: string) => {
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
        getToken: mock.fn(async () => 'mock-token'),
        refresh: mock.fn(async () => {}),
      } as unknown as TokenManager;

      const mockFetch = mock.fn(async (url: string) => {
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
      await source.initialize();

      const projects = await source.getProjects();

      // Should filter out 'other' project
      assert.strictEqual(projects.length, 2);
      assert.strictEqual(projects[0].id, 'brainbase-customer-delivery');
      assert.strictEqual(projects[1].id, 'zeims-beta-release');
    });
  });

  describe('getDecisions', () => {
    it('should return decisions with correct format', async () => {
      const mockTokenManager = {
        getToken: mock.fn(async () => 'mock-token'),
        refresh: mock.fn(async () => {}),
      } as unknown as TokenManager;

      const mockFetch = mock.fn(async (url: string) => {
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
        getToken: mock.fn(async () => 'mock-token'),
        refresh: mock.fn(async () => {}),
      } as unknown as TokenManager;

      const mockFetch = mock.fn(async () => ({
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
      const [url, options] = mockFetch.mock.calls[0].arguments;
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
