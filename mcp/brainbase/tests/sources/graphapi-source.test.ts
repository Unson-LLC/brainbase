/**
 * GraphAPISource Test
 * Graph SSOT APIからentity取得のテスト
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { GraphAPISource } from '../../src/sources/graphapi-source.js';
import { TokenManager } from '../../src/auth/token-manager.js';

describe('GraphAPISource', () => {
  describe('initialize', () => {
    it('should fetch entities from Graph API', async () => {
      // Mock TokenManager
      const mockTokenManager = {
        getToken: mock.fn(async () => 'mock-token'),
        refresh: mock.fn(async () => {}),
      } as unknown as TokenManager;

      // Mock fetch
      const mockFetch = mock.fn(async (url: string, options: any) => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            entities: [
              {
                entity_id: 'prj_001',
                entity_type: 'project',
                payload: {
                  code: 'brainbase',
                  name: 'brainbase',
                  status: 'active',
                  team: ['佐藤圭吾'],
                  orgs: ['UNSON'],
                },
              },
              {
                entity_id: 'per_001',
                entity_type: 'person',
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
      assert.strictEqual(mockFetch.mock.callCount(), 1);
      const [url, options] = mockFetch.mock.calls[0].arguments;
      assert.strictEqual(url, 'http://localhost:31013/api/info/graph/entities');
      assert.strictEqual(options.headers['Authorization'], 'Bearer mock-token');
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
      // Verify retry succeeded
      assert.strictEqual(mockFetch.mock.callCount(), 2);
    });
  });

  describe('getProjects', () => {
    it('should return projects filtered by project codes', async () => {
      const mockTokenManager = {
        getToken: mock.fn(async () => 'mock-token'),
        refresh: mock.fn(async () => {}),
      } as unknown as TokenManager;

      const mockFetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          entities: [
            {
              entity_id: 'prj_001',
              entity_type: 'project',
              payload: {
                code: 'brainbase',
                name: 'brainbase Project',
              },
            },
            {
              entity_id: 'prj_002',
              entity_type: 'project',
              payload: {
                code: 'zeims',
                name: 'zeims Project',
              },
            },
            {
              entity_id: 'prj_003',
              entity_type: 'project',
              payload: {
                code: 'other',
                name: 'Other Project',
              },
            },
          ],
        }),
      }));

      global.fetch = mockFetch as any;

      const source = new GraphAPISource('http://localhost:31013', mockTokenManager, ['brainbase', 'zeims']);
      await source.initialize();

      const projects = await source.getProjects();

      // Should filter out 'other' project
      assert.strictEqual(projects.length, 2);
      assert.strictEqual(projects[0].id, 'brainbase');
      assert.strictEqual(projects[1].id, 'zeims');
    });
  });

  describe('getDecisions', () => {
    it('should return decisions with correct format', async () => {
      const mockTokenManager = {
        getToken: mock.fn(async () => 'mock-token'),
        refresh: mock.fn(async () => {}),
      } as unknown as TokenManager;

      const mockFetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          entities: [
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
          ],
        }),
      }));

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
});
