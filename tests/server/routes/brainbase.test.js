import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createBrainbaseRouter } from '../../../server/routes/brainbase.js';
import { requireAuth } from '../../../server/middleware/auth.js';
import { errorHandler } from '../../../server/middleware/error-handler.js';
import { flushCache } from '../../../server/middleware/cache.js';

/**
 * API Endpoint統合テスト
 *
 * テスト対象エンドポイント:
 * 1. GET /api/brainbase/critical-alerts
 * 2. GET /api/brainbase/strategic-overview
 * 3. GET /api/brainbase/mana-workflow-stats
 * 4. GET /api/brainbase/projects
 * 5. GET /api/brainbase/projects/:id/stats
 */

// 共有mock関数（全インスタンスで同じ関数を参照）
const mockGetProjectStats = vi.fn();
const mockGetCriticalAlerts = vi.fn();
const mockGetStrategicOverview = vi.fn();
const mockGetWorkflowStats = vi.fn();
const mockGetTrends = vi.fn();

// gh CLI execSync/exec モック
const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({
  exec: mockExec,
  execSync: mockExecSync,
  default: { exec: mockExec, execSync: mockExecSync }
}));

// NocoDBServiceをモジュールレベルでモック
vi.mock('../../../server/services/nocodb-service.js', () => {
  return {
    NocoDBService: class NocoDBService {
      getProjectStats = mockGetProjectStats;
      getCriticalAlerts = mockGetCriticalAlerts;
      getStrategicOverview = mockGetStrategicOverview;
      getWorkflowStats = mockGetWorkflowStats;
      getTrends = mockGetTrends;
    }
  };
});

// Expressアプリのセットアップ
let app;
let mockConfigParser;
let mockAuthService;

beforeEach(async () => {
  // mock関数をリセット
  vi.clearAllMocks();

  // キャッシュをクリア
  flushCache();

  // Expressアプリ作成
  app = express();
  app.use(express.json());

  // ConfigParserのモック
  mockConfigParser = {
    getAll: vi.fn().mockResolvedValue({
      projects: {
        projects: [
          { id: 'project1', nocodb: { project_id: 'proj1' }, archived: false },
          { id: 'project2', nocodb: { project_id: 'proj2' }, archived: false },
          { id: 'project-without-nocodb', archived: false },
        ]
      }
    })
  };

  mockAuthService = {
    verifyToken: vi.fn((token) => {
      if (token === 'scoped-token') {
        return { sub: 'person-1', role: 'member', projectCodes: ['project1'] };
      }
      if (token === 'all-token') {
        return {
          sub: 'person-1',
          role: 'member',
          projectCodes: ['project1', 'project2', 'project-without-nocodb'],
        };
      }
      throw new Error('Invalid token');
    }),
  };

  // デフォルトのモック設定（各テストで上書き可能）
  mockGetProjectStats.mockResolvedValue({
    total: 10,
    completed: 5,
    inProgress: 3,
    pending: 2,
    blocked: 0,
    overdue: 1,
    completionRate: 50,
    averageProgress: 63,
  });

  // ルーター作成（ConfigParserを注入）
  const router = createBrainbaseRouter({
    configParser: mockConfigParser,
    projectCatalogAuthGuard: requireAuth(mockAuthService),
  });
  app.use('/api/brainbase', router);
  app.use(errorHandler);
});

// ==================== 1. GET /api/brainbase/critical-alerts ====================

describe('GET /api/brainbase/critical-alerts', () => {
  it('410: 退役を明示し、NocoDBへ接続しない', async () => {
    const res = await request(app).get('/api/brainbase/critical-alerts');

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({
      error: 'capability_retired',
      capability: 'brainbase.nocodb-auxiliary'
    });
    expect(mockGetCriticalAlerts).not.toHaveBeenCalled();
  });
});

// ==================== 2. GET /api/brainbase/strategic-overview ====================

describe('GET /api/brainbase/strategic-overview', () => {
  it('410: 退役を明示し、NocoDBへ接続しない', async () => {
    const res = await request(app).get('/api/brainbase/strategic-overview');

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({
      error: 'capability_retired',
      capability: 'brainbase.nocodb-auxiliary'
    });
    expect(mockGetProjectStats).not.toHaveBeenCalled();
  });
});

// ==================== 3. GET /api/brainbase/mana-workflow-stats ====================

describe('GET /api/brainbase/mana-workflow-stats', () => {
  it('200: workflow_id指定時に該当ワークフローの統計を返す', async () => {
    // gh CLIのモックデータ（21件: success 18, failure 3）
    const runs = [
      ...Array.from({ length: 18 }, () => ({ conclusion: 'success', status: 'completed' })),
      ...Array.from({ length: 3 }, () => ({ conclusion: 'failure', status: 'completed' })),
    ];
    mockExecSync.mockReturnValue(JSON.stringify(runs));

    // リクエスト実行
    const res = await request(app).get('/api/brainbase/mana-workflow-stats?workflow_id=m1');

    // 検証
    expect(res.status).toBe(200);
    expect(res.body.workflow_id).toBe('m1');
    expect(res.body.stats.total_executions).toBe(21);
    expect(res.body.stats.success_rate).toBe(86);
  });

  it('400: workflow_id未指定時はバリデーションエラー', async () => {
    const res = await request(app).get('/api/brainbase/mana-workflow-stats');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('400: 不正なworkflow_idでバリデーションエラー', async () => {
    // 不正なworkflow_idを送信（例: 空文字）
    const res = await request(app).get('/api/brainbase/mana-workflow-stats?workflow_id=');

    // 検証
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('503: gh CLI失敗時は空の成功統計へ変換せず、再試行できる', async () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('gh auth is unavailable');
    });

    const failed = await request(app).get('/api/brainbase/mana-workflow-stats?workflow_id=m1');

    expect(failed.status).toBe(503);
    expect(failed.body).toMatchObject({
      code: 'mana_workflow_stats_unavailable',
      retryable: true,
      workflow_id: 'm1'
    });
    expect(failed.body).not.toHaveProperty('stats');

    mockExecSync.mockReturnValueOnce(JSON.stringify([]));
    const recovered = await request(app).get('/api/brainbase/mana-workflow-stats?workflow_id=m1');

    expect(recovered.status).toBe(200);
    expect(recovered.body.stats).toMatchObject({
      total_executions: 0,
      total_success: 0,
      total_failure: 0,
      success_rate: 0
    });
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });

  it('503: gh CLIの不正なJSON応答は利用可能な統計として扱わない', async () => {
    mockExecSync.mockReturnValueOnce('{not-json');

    const res = await request(app).get('/api/brainbase/mana-workflow-stats?workflow_id=m1');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: 'mana_workflow_stats_unavailable',
      retryable: true,
      workflow_id: 'm1'
    });
    expect(res.body).not.toHaveProperty('stats');
  });

  it('503: gh CLIの配列ではないJSON応答は利用可能な統計として扱わない', async () => {
    mockExecSync.mockReturnValueOnce(JSON.stringify({ runs: [] }));

    const res = await request(app).get('/api/brainbase/mana-workflow-stats?workflow_id=m1');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: 'mana_workflow_stats_unavailable',
      retryable: true,
      workflow_id: 'm1'
    });
    expect(res.body).not.toHaveProperty('stats');
  });

  it.each([
    ['nullのrun', [null]],
    ['statusがないrun', [{ conclusion: 'success' }]],
    ['statusが文字列ではないrun', [{ conclusion: 'success', status: 1 }]],
    ['conclusionが許可された型ではないrun', [{ conclusion: 1, status: 'completed' }]]
  ])('503: %sは利用可能な統計として扱わない', async (_label, runs) => {
    mockExecSync.mockReturnValueOnce(JSON.stringify(runs));

    const res = await request(app).get('/api/brainbase/mana-workflow-stats?workflow_id=m1');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: 'mana_workflow_stats_unavailable',
      retryable: true,
      workflow_id: 'm1'
    });
    expect(res.body).not.toHaveProperty('stats');
  });

  it('200: 未完了runのnullまたは空文字のconclusionを正常に集計する', async () => {
    mockExecSync.mockReturnValueOnce(JSON.stringify([
      { conclusion: null, status: 'in_progress' },
      { conclusion: '', status: 'queued' }
    ]));

    const res = await request(app).get('/api/brainbase/mana-workflow-stats?workflow_id=m1');

    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({
      total_executions: 2,
      total_success: 0,
      total_failure: 0,
      success_rate: 0
    });
  });
});

// ==================== 4. GET /api/brainbase/projects ====================

describe('GET /api/brainbase/projects', () => {
  it('401: 認証情報がない場合はproject catalogを返さない', async () => {
    const res = await request(app).get('/api/brainbase/projects');

    expect(res.status).toBe(401);
  });

  it('200: 認証grantのproject scopeだけを返す', async () => {
    const res = await request(app)
      .get('/api/brainbase/projects')
      .set('Authorization', 'Bearer scoped-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toHaveProperty('id');
    expect(res.body[0].id).toBe('project1');
    expect(res.body[0]).toMatchObject({
      healthStatus: 'unavailable',
      healthSource: 'nocodb_retired',
      healthScore: null,
      overdue: null,
      blocked: null,
      completionRate: null,
    });
    expect(mockGetProjectStats).not.toHaveBeenCalled();
  });

  it('200: NocoDB統計なしでもプロジェクト一覧と利用不能状態を返す', async () => {
    const res = await request(app)
      .get('/api/brainbase/projects')
      .set('Authorization', 'Bearer all-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.find((p) => p.id === 'project1')).toMatchObject({
      hasNocodb: true,
      healthStatus: 'unavailable',
      healthSource: 'nocodb_retired',
      healthScore: null,
      completionRate: null,
    });
    expect(res.body.find((p) => p.id === 'project-without-nocodb')).toMatchObject({
      hasNocodb: false,
      healthStatus: 'unmapped',
      healthSource: 'nocodb_retired',
    });
    expect(mockGetProjectStats).not.toHaveBeenCalled();
  });

  it('500: ConfigParser取得失敗を確認済み0件へ変換しない', async () => {
    mockConfigParser.getAll.mockRejectedValue(new Error('Config fetch failed'));

    const res = await request(app)
      .get('/api/brainbase/projects')
      .set('Authorization', 'Bearer all-token');

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
  });
});

// ==================== 5. GET /api/brainbase/projects/:id/stats ====================

describe('GET /api/brainbase/projects/:id/stats', () => {
  it('410: 指定プロジェクトの旧統計経路の退役を返す', async () => {
    const res = await request(app).get('/api/brainbase/projects/project1/stats');

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({
      error: 'capability_retired',
      capability: 'brainbase.nocodb-auxiliary'
    });
    expect(mockGetProjectStats).not.toHaveBeenCalled();
  });

  it('410: 存在しないproject_idでも旧統計経路の退役を返す', async () => {
    const res = await request(app).get('/api/brainbase/projects/non-existent/stats');

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({
      error: 'capability_retired',
      capability: 'brainbase.nocodb-auxiliary'
    });
    expect(mockGetProjectStats).not.toHaveBeenCalled();
  });
});
