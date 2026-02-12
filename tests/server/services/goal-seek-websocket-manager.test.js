import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GoalSeekWebSocketManager } from '../../../server/services/goal-seek-websocket-manager.js';

/**
 * GoalSeekWebSocketManager 単体テスト
 *
 * テスト対象:
 * 1. handleConnection() - WebSocket接続処理
 * 2. handleMessage() - メッセージ処理
 * 3. authenticate() - 認証処理
 * 4. connection management - 接続管理
 * 5. error handling - エラーハンドリング
 * 6. intervention flow - 介入フロー
 */

// モックWebSocket
class MockWebSocket {
    constructor() {
        this.readyState = 1; // OPEN
        this.sentMessages = [];
        this.closed = false;
        this.closeCode = null;
        this._messageHandlers = [];
    }

    on(event, handler) {
        if (event === 'message') {
            this._messageHandlers.push(handler);
        }
    }

    // テストからメッセージをシミュレート
    _simulateMessage(data) {
        for (const handler of this._messageHandlers) {
            handler(data);
        }
    }

    send(data) {
        if (this.closed) return;
        this.sentMessages.push(JSON.parse(data));
    }

    close(code) {
        this.closed = true;
        this.closeCode = code;
        this.readyState = 3; // CLOSED
    }
}

// モック認証サービス
const createMockAuthService = () => ({
    verifyToken: vi.fn().mockResolvedValue({ userId: 'user-123', role: 'member' })
});

// モック計算サービス
const createMockCalculationService = () => ({
    calculate: vi.fn().mockResolvedValue({
        correlationId: 'test-id',
        dailyTarget: 33.33,
        target: 1000,
        period: 30,
        completed: 0,
        remaining: 1000
    }),
    checkInterventionNeeded: vi.fn().mockReturnValue({ needed: false })
});

describe('GoalSeekWebSocketManager', () => {
    let manager;
    let mockAuthService;
    let mockCalculationService;
    let mockWs;

    beforeEach(() => {
        mockAuthService = createMockAuthService();
        mockCalculationService = createMockCalculationService();
        mockWs = new MockWebSocket();

        manager = new GoalSeekWebSocketManager({
            authService: mockAuthService,
            calculationService: mockCalculationService,
            maxConnections: 3
        });
    });

    afterEach(() => {
        manager?.cleanup();
    });

    describe('handleConnection()', () => {
        it('UT-016: 有効なトークンで接続できる', async () => {
            const request = {
                headers: { authorization: 'Bearer valid-token' }
            };

            await manager.handleConnection(mockWs, request);

            expect(mockAuthService.verifyToken).toHaveBeenCalledWith('valid-token');
            expect(manager.getActiveConnectionCount()).toBe(1);
        });

        it('UT-017: 無効なトークンでは接続拒否', async () => {
            mockAuthService.verifyToken.mockRejectedValueOnce(new Error('Invalid token'));
            const request = {
                headers: { authorization: 'Bearer invalid-token' }
            };

            await manager.handleConnection(mockWs, request);

            expect(mockWs.closed).toBe(true);
            expect(mockWs.closeCode).toBe(4001); // Auth error
        });

        it('UT-018: 最大接続数を超えると拒否', async () => {
            const limitedManager = new GoalSeekWebSocketManager({
                authService: mockAuthService,
                calculationService: mockCalculationService,
                maxConnections: 1
            });

            const request = {
                headers: { authorization: 'Bearer valid-token' }
            };

            // 1つ目の接続
            const ws1 = new MockWebSocket();
            await limitedManager.handleConnection(ws1, request);

            // 2つ目の接続（拒否されるはず）
            const ws2 = new MockWebSocket();
            await limitedManager.handleConnection(ws2, request);

            expect(ws2.closed).toBe(true);
            expect(ws2.closeCode).toBe(4002); // Max connections

            limitedManager.cleanup();
        });

        it('UT-019: Authorizationヘッダーがない場合は拒否', async () => {
            const request = {
                headers: {}
            };

            await manager.handleConnection(mockWs, request);

            expect(mockWs.closed).toBe(true);
            expect(mockWs.closeCode).toBe(4001);
        });
    });

    describe('handleMessage()', () => {
        beforeEach(async () => {
            const request = {
                headers: { authorization: 'Bearer valid-token' }
            };
            await manager.handleConnection(mockWs, request);
            mockWs.sentMessages = []; // 接続時のメッセージをクリア
        });

        it('UT-020: calculateメッセージを処理できる', async () => {
            const message = JSON.stringify({
                type: 'calculate',
                correlationId: 'calc-123',
                payload: {
                    target: 1000,
                    period: 30,
                    current: 0,
                    unit: '件'
                }
            });

            await manager.handleMessage(mockWs, message);

            expect(mockCalculationService.calculate).toHaveBeenCalled();
            expect(mockWs.sentMessages.length).toBeGreaterThan(0);

            const response = mockWs.sentMessages.find(m => m.type === 'completed');
            expect(response).toBeDefined();
            expect(response.correlationId).toBe('calc-123');
        });

        it('UT-021: 無効なJSONメッセージはエラー応答', async () => {
            const invalidMessage = 'not a json';

            await manager.handleMessage(mockWs, invalidMessage);

            const response = mockWs.sentMessages[mockWs.sentMessages.length - 1];
            expect(response.type).toBe('error');
            expect(response.code).toBe('INVALID_MESSAGE');
        });

        it('UT-022: 不明なメッセージタイプはエラー応答', async () => {
            const message = JSON.stringify({
                type: 'unknown_type',
                correlationId: 'test-123'
            });

            await manager.handleMessage(mockWs, message);

            const response = mockWs.sentMessages[mockWs.sentMessages.length - 1];
            expect(response.type).toBe('error');
            expect(response.code).toBe('UNKNOWN_MESSAGE_TYPE');
        });

        it('UT-023: cancelメッセージで計算をキャンセル', async () => {
            const message = JSON.stringify({
                type: 'cancel',
                correlationId: 'cancel-123'
            });

            await manager.handleMessage(mockWs, message);

            const response = mockWs.sentMessages.find(m => m.type === 'cancelled');
            expect(response).toBeDefined();
            expect(response.correlationId).toBe('cancel-123');
        });
    });

    describe('intervention flow', () => {
        beforeEach(async () => {
            const request = {
                headers: { authorization: 'Bearer valid-token' }
            };
            await manager.handleConnection(mockWs, request);
            mockWs.sentMessages = [];
        });

        it('UT-024: 介入が必要な場合intervention_requiredメッセージを送信', async () => {
            mockCalculationService.checkInterventionNeeded.mockReturnValueOnce({
                needed: true,
                type: 'decision',
                reason: 'dailyTarget exceeds threshold'
            });

            const message = JSON.stringify({
                type: 'calculate',
                correlationId: 'intervention-123',
                payload: {
                    target: 100000,
                    period: 1,
                    current: 0
                }
            });

            await manager.handleMessage(mockWs, message);

            const response = mockWs.sentMessages.find(m => m.type === 'intervention_required');
            expect(response).toBeDefined();
            expect(response.intervention.type).toBe('decision');
        });

        it('UT-025: 介入回答メッセージを処理できる', async () => {
            // まず介入を発生させる
            mockCalculationService.checkInterventionNeeded.mockReturnValueOnce({
                needed: true,
                type: 'decision',
                reason: 'dailyTarget exceeds threshold'
            });

            const calcMessage = JSON.stringify({
                type: 'calculate',
                correlationId: 'intervention-123',
                payload: {
                    target: 100000,
                    period: 1,
                    current: 0
                }
            });

            await manager.handleMessage(mockWs, calcMessage);

            // 介入IDを取得
            const interventionResponse = mockWs.sentMessages.find(m => m.type === 'intervention_required');
            expect(interventionResponse).toBeDefined();
            const interventionId = interventionResponse.intervention.id;

            // 介入回答を送信
            mockWs.sentMessages = [];
            const responseMessage = JSON.stringify({
                type: 'intervention_response',
                correlationId: 'response-123',
                payload: {
                    interventionId,
                    choice: 'proceed'
                }
            });

            await manager.handleMessage(mockWs, responseMessage);

            const response = mockWs.sentMessages.find(m => m.type === 'intervention_acknowledged');
            expect(response).toBeDefined();
        });
    });

    describe('error handling', () => {
        beforeEach(async () => {
            const request = {
                headers: { authorization: 'Bearer valid-token' }
            };
            await manager.handleConnection(mockWs, request);
            mockWs.sentMessages = [];
        });

        it('UT-026: 計算エラーを適切にハンドリング', async () => {
            mockCalculationService.calculate.mockRejectedValueOnce(
                new Error('Calculation failed')
            );

            const message = JSON.stringify({
                type: 'calculate',
                correlationId: 'error-123',
                payload: {
                    target: 1000,
                    period: 30
                }
            });

            await manager.handleMessage(mockWs, message);

            const response = mockWs.sentMessages.find(m => m.type === 'error');
            expect(response).toBeDefined();
            expect(response.correlationId).toBe('error-123');
        });

        it('UT-027: パラメータ検証エラーをハンドリング', async () => {
            mockCalculationService.calculate.mockRejectedValueOnce(
                new Error('period must be between 1 and 365')
            );

            const message = JSON.stringify({
                type: 'calculate',
                correlationId: 'validation-123',
                payload: {
                    target: 1000,
                    period: 0
                }
            });

            await manager.handleMessage(mockWs, message);

            const response = mockWs.sentMessages.find(m => m.type === 'error');
            expect(response).toBeDefined();
            expect(response.message).toContain('period');
        });
    });

    describe('connection management', () => {
        it('UT-028: 接続が閉じるとリストから削除される', async () => {
            const request = {
                headers: { authorization: 'Bearer valid-token' }
            };

            await manager.handleConnection(mockWs, request);
            expect(manager.getActiveConnectionCount()).toBe(1);

            // 接続を閉じる
            mockWs.readyState = 3;
            manager.handleDisconnect(mockWs);

            expect(manager.getActiveConnectionCount()).toBe(0);
        });

        it('UT-029: cleanup()ですべての接続を閉じる', async () => {
            const request = {
                headers: { authorization: 'Bearer valid-token' }
            };

            // 複数接続
            const ws1 = new MockWebSocket();
            const ws2 = new MockWebSocket();
            await manager.handleConnection(ws1, request);
            await manager.handleConnection(ws2, request);

            expect(manager.getActiveConnectionCount()).toBe(2);

            manager.cleanup();

            expect(manager.getActiveConnectionCount()).toBe(0);
        });

        it('UT-030: 接続ユーザー情報を追跡できる', async () => {
            const request = {
                headers: { authorization: 'Bearer valid-token' }
            };

            await manager.handleConnection(mockWs, request);

            const connectionInfo = manager.getConnectionInfo(mockWs);
            expect(connectionInfo).toBeDefined();
            expect(connectionInfo.userId).toBe('user-123');
        });
    });
});
