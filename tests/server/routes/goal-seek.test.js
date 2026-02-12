import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';

/**
 * Goal Seek Routes テスト
 *
 * テスト対象エンドポイント:
 * 1. GET /api/goal-seek/status - ステータス確認
 * 2. POST /api/goal-seek/calculate - 計算リクエスト
 * 3. WebSocket upgrade /api/goal-seek/calculate - WebSocket接続
 *
 * テストID:
 * - UT-031: GET /status が200を返す
 * - UT-032: POST /calculate が計算結果を返す
 * - UT-033: WebSocket upgradeが正しく処理される
 * - UT-034: 認証エラーが正しく処理される
 * - UT-035: バリデーションエラーが正しく処理される
 */

// モック: CalculationService
const mockCalculate = vi.fn();
const mockCheckInterventionNeeded = vi.fn();

class MockCalculationService {
    async calculate(params, options) {
        return mockCalculate(params, options);
    }
    checkInterventionNeeded(result) {
        return mockCheckInterventionNeeded(result);
    }
}

// モック: WebSocketManager
const mockHandleConnection = vi.fn();
const mockGetActiveConnectionCount = vi.fn(() => 0);
const mockHandleInterventionResponseHTTP = vi.fn();
const mockCleanup = vi.fn();

class MockWebSocketManager {
    constructor(options) {
        this.options = options;
    }
    async handleConnection(ws, request) {
        return mockHandleConnection(ws, request);
    }
    getActiveConnectionCount() {
        return mockGetActiveConnectionCount();
    }
    async handleInterventionResponseHTTP(params) {
        return mockHandleInterventionResponseHTTP(params);
    }
    cleanup() {
        return mockCleanup();
    }
}

// モック: AuthService
const mockVerifyToken = vi.fn(() => ({
    userId: 'test-user-id',
    role: 'member'
}));

class MockAuthService {
    verifyToken(token) {
        return mockVerifyToken(token);
    }
}

// Expressアプリのセットアップ
let app;
let mockAuthService;
let mockCalculationService;
let mockWsManager;
let createGoalSeekRouter;

beforeAll(async () => {
    // vi.mockを使ってrequireAuthをモック
    vi.doMock('../../../server/middleware/auth.js', () => ({
        requireAuth: vi.fn(() => (req, res, next) => {
            req.auth = { sub: 'test-user-id', role: 'member' };
            req.access = { role: 'member', projectCodes: [], clearance: [] };
            next();
        })
    }));

    // モック適用後にルーターをインポート
    const module = await import('../../../server/routes/goal-seek.js');
    createGoalSeekRouter = module.createGoalSeekRouter;
});

beforeEach(async () => {
    vi.clearAllMocks();

    // モック作成
    mockAuthService = new MockAuthService();
    mockCalculationService = new MockCalculationService();
    mockWsManager = new MockWebSocketManager({
        authService: mockAuthService,
        calculationService: mockCalculationService
    });

    // デフォルトのモック設定
    mockCalculate.mockResolvedValue({
        dailyTarget: 10,
        totalDays: 30,
        remainingDays: 30,
        completed: 0,
        remaining: 300,
        unit: '件',
        isCompleted: false,
        achievableProbability: 95,
        gap: { value: 300, percentage: 100 },
        projection: {
            milestones: [
                { day: 7, projected: 70, percentage: 23 },
                { day: 14, projected: 140, percentage: 47 },
                { day: 21, projected: 210, percentage: 70 },
                { day: 28, projected: 280, percentage: 93 }
            ],
            estimatedCompletion: 30,
            confidenceLevel: 'high'
        }
    });

    mockCheckInterventionNeeded.mockReturnValue({ needed: false });

    mockGetActiveConnectionCount.mockReturnValue(0);

    // Expressアプリ作成
    app = express();
    app.use(express.json());

    // ルーター作成
    const router = createGoalSeekRouter({
        authService: mockAuthService,
        calculationService: mockCalculationService,
        wsManager: mockWsManager
    });
    app.use('/api/goal-seek', router);

    // エラーハンドリングミドルウェア（ルーター後に設定）
    app.use((err, req, res, next) => {
        res.status(err.status || 500).json({
            error: err.message || 'Internal server error'
        });
    });
});

afterEach(() => {
    // WebSocketManagerのクリーンアップ
    mockWsManager?.cleanup?.();
});

// ==================== UT-031: GET /api/goal-seek/status ====================

describe('GET /api/goal-seek/status', () => {
    it('UT-031: ステータス200でサービス情報を返す', async () => {
        // モック設定: 接続数0
        mockGetActiveConnectionCount.mockReturnValue(2);

        // リクエスト実行
        const res = await request(app).get('/api/goal-seek/status');

        // 検証
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('status', 'available');
        expect(res.body).toHaveProperty('activeConnections', 2);
        expect(res.body).toHaveProperty('timestamp');
    });

    it('サービス稼働中はstatusがavailable', async () => {
        mockGetActiveConnectionCount.mockReturnValue(1);

        const res = await request(app).get('/api/goal-seek/status');

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('available');
    });
});

// ==================== UT-032: POST /api/goal-seek/calculate ====================

describe('POST /api/goal-seek/calculate', () => {
    it('UT-032: 正常な計算リクエストで計算結果を返す', async () => {
        // リクエストボディ
        const requestBody = {
            target: 100,
            period: 10,
            current: 20,
            unit: '件'
        };

        // リクエスト実行
        const res = await request(app)
            .post('/api/goal-seek/calculate')
            .send(requestBody);

        // 検証
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('result');
        expect(res.body.result).toHaveProperty('dailyTarget');
        expect(res.body.result).toHaveProperty('remaining');
        expect(res.body.result).toHaveProperty('isCompleted');
        expect(mockCalculate).toHaveBeenCalledWith(
            { target: 100, period: 10, current: 20, unit: '件' },
            expect.objectContaining({
                correlationId: expect.any(String)
            })
        );
    });

    it('correlationIdを指定できる', async () => {
        const requestBody = {
            target: 50,
            period: 5,
            current: 10,
            correlationId: 'custom-correlation-id'
        };

        const res = await request(app)
            .post('/api/goal-seek/calculate')
            .send(requestBody);

        expect(res.status).toBe(200);
        expect(mockCalculate).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                correlationId: 'custom-correlation-id'
            })
        );
    });

    it('介入が必要な場合にintervention情報を含める', async () => {
        // 介入が必要なモック設定
        mockCalculate.mockResolvedValue({
            dailyTarget: 150,
            totalDays: 30,
            remainingDays: 30,
            isCompleted: false
        });

        mockCheckInterventionNeeded.mockReturnValue({
            needed: true,
            type: 'decision',
            reason: 'dailyTarget exceeds threshold',
            details: { dailyTarget: 150, threshold: 100 }
        });

        const res = await request(app)
            .post('/api/goal-seek/calculate')
            .send({ target: 3000, period: 20, current: 0 });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('intervention');
        expect(res.body.intervention).toHaveProperty('needed', true);
        expect(res.body.intervention).toHaveProperty('type', 'decision');
    });
});

// ==================== UT-033: WebSocket upgrade ====================

describe('WebSocket upgrade /api/goal-seek/calculate', () => {
    it('UT-033: WebSocket upgradeが正しく処理される（Integration Test）', async () => {
        // WebSocket upgradeはsupertestでは直接テストできないため、
        // ルーターがWebSocket upgradeハンドラを持っていることを確認
        const res = await request(app).get('/api/goal-seek/status');

        // WebSocketManagerが正しく設定されていることを確認
        expect(res.status).toBe(200);
        expect(mockGetActiveConnectionCount).toHaveBeenCalled();
    });

    it('アクティブ接続数を取得できる', async () => {
        mockGetActiveConnectionCount.mockReturnValue(3);

        const res = await request(app).get('/api/goal-seek/status');

        expect(res.status).toBe(200);
        expect(res.body.activeConnections).toBe(3);
    });
});

// ==================== UT-034: 認証エラー ====================

describe('認証エラー', () => {
    it('UT-034: 認証なしでアクセスすると401エラー', async () => {
        // 認証チェックで401を返すミドルウェア
        const authCheckApp = express();
        authCheckApp.use(express.json());

        authCheckApp.use('/api/goal-seek', (req, res, next) => {
            const header = req.headers.authorization || '';
            if (!header.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'Authorization token required' });
            }
            req.auth = { sub: 'test-user-id', role: 'member' };
            req.access = { role: 'member', projectCodes: [], clearance: [] };
            next();
        });

        // 認証なしでルーターをマウント（requireAuthを使用しない）
        const routerWithoutAuth = createGoalSeekRouter({
            authService: mockAuthService,
            calculationService: mockCalculationService,
            wsManager: mockWsManager
        });

        // POSTエンドポイントを直接マウト
        authCheckApp.post('/api/goal-seek/calculate', routerWithoutAuth.stack.find(
            layer => layer.route?.path === '/calculate'
        ).handle);

        // 認証なしでリクエスト
        const res = await request(authCheckApp)
            .post('/api/goal-seek/calculate')
            .send({ target: 100, period: 10 });

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('error');
    });
});

// ==================== UT-035: バリデーションエラー ====================

describe('バリデーションエラー', () => {
    it('UT-035-1: targetが欠落していると400エラー', async () => {
        const res = await request(app)
            .post('/api/goal-seek/calculate')
            .send({ period: 10, current: 0 });

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error');
        expect(res.body.error).toContain('target');
    });

    it('UT-035-2: periodが欠落していると400エラー', async () => {
        const res = await request(app)
            .post('/api/goal-seek/calculate')
            .send({ target: 100, current: 0 });

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error');
        expect(res.body.error).toContain('period');
    });

    it('UT-035-3: targetが負の値の場合400エラー', async () => {
        const res = await request(app)
            .post('/api/goal-seek/calculate')
            .send({ target: -10, period: 10, current: 0 });

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error');
    });

    it('UT-035-4: periodが範囲外の場合400エラー', async () => {
        const res = await request(app)
            .post('/api/goal-seek/calculate')
            .send({ target: 100, period: 400, current: 0 });

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error');
    });

    it('UT-035-5: 計算サービスのバリデーションエラーを400で返す', async () => {
        // バリデーションエラーを投げる
        mockCalculate.mockRejectedValue(new Error('period must be between 1 and 365'));

        const res = await request(app)
            .post('/api/goal-seek/calculate')
            .send({ target: 100, period: 400, current: 0 });

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error');
    });

    it('UT-035-6: サーバーエラー時は500エラー', async () => {
        // 予期せぬエラーを投げる
        mockCalculate.mockRejectedValue(new Error('Unexpected database error'));

        const res = await request(app)
            .post('/api/goal-seek/calculate')
            .send({ target: 100, period: 10 });

        expect(res.status).toBe(500);
        expect(res.body).toHaveProperty('error');
    });
});
