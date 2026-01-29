import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createBrainbaseRouter } from '../../../server/routes/brainbase.js';
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
        ]
      }
    })
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
  const router = createBrainbaseRouter({ configParser: mockConfigParser });
  app.use('/api/brainbase', router);
});

// ==================== 1. GET /api/brainbase/critical-alerts ====================

describe('GET /api/brainbase/critical-alerts', () => {
  it('200: Critical Alertsを正しく返す', async () => {
    // モック設定
    const mockAlerts = {
      alerts: [
        {
          type: 'blocker',
          project: 'project1',
          task: 'タスク1',
          owner: 'テストユーザー',
          days_blocked: 5,
          severity: 'critical',
        },
      ],
      total_critical: 1,
      total_warning: 0,
    };

    mockGetCriticalAlerts.mockResolvedValue(mockAlerts);

    // リクエスト実行
    const res = await request(app).get('/api/brainbase/critical-alerts');

    // 検証
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('alerts');
    expect(res.body).toHaveProperty('total_critical');
    expect(res.body).toHaveProperty('total_warning');
    expect(res.body.total_critical).toBe(1);
    expect(res.body.alerts).toHaveLength(1);
  });

  it('500: NocoDB API失敗時にエラーレスポンス', async () => {
    // モック設定: エラーを投げる
    mockGetCriticalAlerts.mockRejectedValue(new Error('NocoDB API failed'));

    // リクエスト実行
    const res = await request(app).get('/api/brainbase/critical-alerts');

    // 検証
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

// ==================== 2. GET /api/brainbase/strategic-overview ====================

describe('GET /api/brainbase/strategic-overview', () => {
  it('200: Strategic Overviewを正しく返す', async () => {
    // モック設定
    const mockStats = {
      total: 10,
      completed: 5,
      inProgress: 3,
      pending: 2,
      blocked: 0,
      overdue: 1,
      completionRate: 50,
      averageProgress: 75,
    };

    mockGetProjectStats.mockResolvedValue(mockStats);

    // リクエスト実行
    const res = await request(app).get('/api/brainbase/strategic-overview');

    // 検証
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('projects');
    expect(res.body).toHaveProperty('bottlenecks');
    expect(res.body.projects).toBeInstanceOf(Array);
  });

  it('500: データ取得失敗時にエラーレスポンス', async () => {
    // モック設定: エラーを投げる
    mockGetProjectStats.mockRejectedValue(new Error('Data fetch failed'));

    // リクエスト実行
    const res = await request(app).get('/api/brainbase/strategic-overview');

    // 検証
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
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
});

// ==================== 4. GET /api/brainbase/projects ====================

describe('GET /api/brainbase/projects', () => {
  it('200: 全プロジェクトリストを返す', async () => {
    // ConfigParserから取得されるプロジェクト一覧を検証
    // リクエスト実行
    const res = await request(app).get('/api/brainbase/projects');

    // 検証
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toHaveProperty('id');
    expect(res.body[0].id).toBe('project1');
    expect(res.body[1].id).toBe('project2');
  });

  it('500: ConfigParser取得失敗時にエラーレスポンス', async () => {
    // モック設定: エラーを投げる
    mockConfigParser.getAll.mockRejectedValue(new Error('Config fetch failed'));

    // リクエスト実行
    const res = await request(app).get('/api/brainbase/projects');

    // 検証
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

// ==================== 5. GET /api/brainbase/projects/:id/stats ====================

describe('GET /api/brainbase/projects/:id/stats', () => {
  it('200: 指定プロジェクトの統計を返す', async () => {
    // モック設定
    const mockStats = {
      total: 10,
      completed: 5,
      inProgress: 3,
      pending: 2,
      blocked: 0,
      overdue: 1,
      completionRate: 50,
      averageProgress: 60,
    };

    mockGetProjectStats.mockResolvedValue(mockStats);

    // リクエスト実行
    const res = await request(app).get('/api/brainbase/projects/project1/stats');

    // 検証
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(10);
    expect(res.body.completionRate).toBe(50);
    expect(res.body.averageProgress).toBe(60);
  });

  it('404: 存在しないproject_idで404エラー', async () => {
    // モック設定: プロジェクトが見つからない
    mockGetProjectStats.mockRejectedValue(new Error('Project not found'));

    // リクエスト実行
    const res = await request(app).get('/api/brainbase/projects/non-existent/stats');

    // 検証
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});
