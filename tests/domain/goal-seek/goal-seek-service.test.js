import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GoalSeekService } from '../../../public/modules/domain/goal-seek/goal-seek-service.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

/**
 * GoalSeekService 単体テスト (Frontend)
 *
 * テスト対象:
 * 1. WebSocket接続管理
 * 2. 計算リクエスト送信 (type: 'calculate')
 * 3. 進捗通知受信 (type: 'progress')
 * 4. 介入リクエスト処理 (type: 'intervention_required')
 * 5. 介入回答送信 (type: 'intervention_response')
 * 6. EventBus統合 (GOAL_SEEK_* イベント)
 */

describe('GoalSeekService', () => {
    let service;
    let mockToken;
    let mockWs;

    beforeEach(() => {
        vi.clearAllMocks();
        mockToken = 'test-bearer-token';

        // WebSocketコンストラクタをモック（vi.fnではなくclassを使用）
        const MockWebSocketClass = class {
            constructor(url) {
                this.url = url;
                this.readyState = 0;
                this.sentMessages = [];
                this.closed = false;
                this.closeCode = null;
                this.onmessage = null;
                this.onopen = null;
                this.onclose = null;
                this.onerror = null;
                mockWs = this; // 参照を保持
            }

            send(data) {
                if (this.readyState !== 1) return;
                this.sentMessages.push(JSON.parse(data));
            }

            close(code = 1000) {
                this.closed = true;
                this.closeCode = code;
                this.readyState = 3;
                if (this.onclose) {
                    this.onclose({ code, reason: '' });
                }
            }

            _simulateOpen() {
                this.readyState = 1;
                if (this.onopen) {
                    this.onopen();
                }
            }

            _simulateMessage(data) {
                if (this.onmessage) {
                    const messageEvent = { data: typeof data === 'string' ? data : JSON.stringify(data) };
                    this.onmessage(messageEvent);
                }
            }

            _simulateClose(code = 1000, reason = '') {
                this.readyState = 3;
                if (this.onclose) {
                    this.onclose({ code, reason });
                }
            }

            _simulateError(error) {
                if (this.onerror) {
                    this.onerror(error);
                }
            }
        };
        MockWebSocketClass.CONNECTING = 0;
        MockWebSocketClass.OPEN = 1;
        MockWebSocketClass.CLOSING = 2;
        MockWebSocketClass.CLOSED = 3;

        global.WebSocket = MockWebSocketClass;

        service = new GoalSeekService({
            wsUrl: 'ws://localhost:31013/api/goal-seek/calculate',
            token: mockToken
        });
    });

    afterEach(() => {
        service?.disconnect();
        vi.restoreAllMocks();
    });

    // ヘルパー: 接続してopenイベントを発火
    async function connectAndWait(svc) {
        const promise = svc.connect();
        mockWs._simulateOpen();
        await promise;
        return mockWs;
    }

    describe('constructor()', () => {
        it('UT-031: インスタンスを正しく初期化できる', () => {
            expect(service).toBeDefined();
            expect(service.wsUrl).toBe('ws://localhost:31013/api/goal-seek/calculate');
            expect(service.token).toBe(mockToken);
            expect(service.ws).toBeNull();
        });

        it('UT-031: デフォルトURLで初期化できる', () => {
            const defaultService = new GoalSeekService();
            expect(defaultService.wsUrl).toBe('ws://localhost:31013/api/goal-seek/calculate');
            defaultService.disconnect();
        });
    });

    describe('connect()', () => {
        it('UT-032: WebSocket接続を確立できる', async () => {
            await connectAndWait(service);

            expect(service.ws).toBeDefined();
            expect(service.ws.url).toBe('ws://localhost:31013/api/goal-seek/calculate');
        });

        it('UT-032: 既存接続がある場合は再接続しない', async () => {
            await connectAndWait(service);

            const originalWs = service.ws;

            // 2回目のconnect（onopenは発火しないが、Promiseは即座に解決される）
            await service.connect();

            expect(service.ws).toBe(originalWs);
        });
    });

    describe('disconnect()', () => {
        it('UT-033: WebSocket接続を正しく切断できる', async () => {
            await connectAndWait(service);

            service.disconnect();

            expect(mockWs.closed).toBe(true);
            expect(mockWs.closeCode).toBe(1000);
        });

        it('UT-033: 接続がない場合は何もしない', () => {
            // 接続せずにdisconnectを呼び出し
            service.disconnect();

            // エラーが発生しないことを確認
            expect(service.ws).toBeNull();
        });
    });

    describe('calculate()', () => {
        it('UT-034: 計算リクエストを送信できる', async () => {
            await connectAndWait(service);

            const payload = {
                target: 1000,
                period: 30,
                current: 0,
                unit: '件'
            };

            const resultPromise = service.calculate(payload);

            // 送信されたメッセージを確認
            const sentMessage = mockWs.sentMessages.find(m => m.type === 'calculate');
            expect(sentMessage).toBeDefined();
            expect(sentMessage.payload).toEqual(payload);
            expect(sentMessage.correlationId).toBeDefined();
        });

        it('UT-034: 計算結果を受信して返す', async () => {
            await connectAndWait(service);

            const payload = {
                target: 1000,
                period: 30,
                current: 0
            };

            const resultPromise = service.calculate(payload);

            // サーバーからの完了メッセージをシミュレート
            const sentMessage = mockWs.sentMessages.find(m => m.type === 'calculate');
            mockWs._simulateMessage({
                type: 'completed',
                correlationId: sentMessage.correlationId,
                result: {
                    dailyTarget: 33.33,
                    target: 1000,
                    period: 30
                }
            });

            const result = await resultPromise;
            expect(result.dailyTarget).toBe(33.33);
            expect(result.target).toBe(1000);
        });

        it('UT-034: 接続がない場合は自動接続してから送信', async () => {
            const payload = {
                target: 1000,
                period: 30,
                current: 0
            };

            // calculate()を呼び出す（内部でconnect()が開始される）
            const resultPromise = service.calculate(payload);

            // WebSocketが作成される
            expect(service.ws).toBeDefined();

            // onopenを発火（これによりconnect()が完了し、その後メッセージが送信される）
            mockWs._simulateOpen();

            // メッセージが送信されるのを少し待つ（microtaskの実行を待つ）
            await new Promise(resolve => setTimeout(resolve, 0));

            // メッセージが送信されたことを確認
            expect(mockWs.sentMessages.length).toBeGreaterThan(0);
            const sentMessage = mockWs.sentMessages.find(m => m.type === 'calculate');
            expect(sentMessage).toBeDefined();

            // 完了メッセージを送信してPromiseを解決
            mockWs._simulateMessage({
                type: 'completed',
                correlationId: sentMessage.correlationId,
                result: { dailyTarget: 33.33, target: 1000 }
            });

            const result = await resultPromise;
            expect(result.dailyTarget).toBe(33.33);
        });
    });

    describe('progress handling', () => {
        it('UT-035: 進捗通知を受信してイベントを発火する', async () => {
            await connectAndWait(service);

            const progressListener = vi.fn();
            service.onProgress(progressListener);

            // 進捗メッセージをシミュレート
            mockWs._simulateMessage({
                type: 'progress',
                correlationId: 'test-correlation-id',
                progress: {
                    step: 'calculating',
                    percent: 50,
                    message: '計算中...'
                }
            });

            expect(progressListener).toHaveBeenCalledWith({
                step: 'calculating',
                percent: 50,
                message: '計算中...'
            });
        });

        it('UT-035: GOAL_SEEK_PROGRESSイベントが発火される', async () => {
            await connectAndWait(service);

            const eventListener = vi.fn();
            eventBus.on(EVENTS.GOAL_SEEK_PROGRESS, eventListener);

            // 進捗メッセージをシミュレート
            mockWs._simulateMessage({
                type: 'progress',
                correlationId: 'test-correlation-id',
                progress: {
                    step: 'calculating',
                    percent: 75
                }
            });

            expect(eventListener).toHaveBeenCalled();
        });
    });

    describe('intervention handling', () => {
        it('UT-036: 介入リクエストを受信してイベントを発火する', async () => {
            await connectAndWait(service);

            const interventionListener = vi.fn();
            service.onIntervention(interventionListener);

            // 介入リクエストメッセージをシミュレート
            mockWs._simulateMessage({
                type: 'intervention_required',
                correlationId: 'intervention-correlation-id',
                intervention: {
                    id: 'intervention-123',
                    type: 'decision',
                    reason: 'dailyTarget exceeds threshold',
                    calculation: {
                        dailyTarget: 3333.33,
                        target: 100000,
                        period: 30
                    }
                }
            });

            expect(interventionListener).toHaveBeenCalledWith({
                id: 'intervention-123',
                type: 'decision',
                reason: 'dailyTarget exceeds threshold',
                calculation: expect.objectContaining({
                    dailyTarget: 3333.33
                })
            });
        });

        it('UT-036: GOAL_SEEK_INTERVENTIONイベントが発火される', async () => {
            await connectAndWait(service);

            const eventListener = vi.fn();
            eventBus.on(EVENTS.GOAL_SEEK_INTERVENTION, eventListener);

            // 介入リクエストメッセージをシミュレート
            mockWs._simulateMessage({
                type: 'intervention_required',
                correlationId: 'intervention-correlation-id',
                intervention: {
                    id: 'intervention-456',
                    type: 'confirmation',
                    reason: 'Are you sure?'
                }
            });

            expect(eventListener).toHaveBeenCalled();
        });
    });

    describe('sendInterventionResponse()', () => {
        it('UT-037: 介入回答を送信できる', async () => {
            await connectAndWait(service);

            const response = {
                interventionId: 'intervention-123',
                choice: 'proceed',
                reason: 'Target is correct'
            };

            service.sendInterventionResponse(response);

            // 送信されたメッセージを確認
            const sentMessage = mockWs.sentMessages.find(m => m.type === 'intervention_response');
            expect(sentMessage).toBeDefined();
            expect(sentMessage.payload.interventionId).toBe('intervention-123');
            expect(sentMessage.payload.choice).toBe('proceed');
            expect(sentMessage.payload.reason).toBe('Target is correct');
        });

        it('UT-037: 介入確認メッセージを受信して返す', async () => {
            await connectAndWait(service);

            const response = {
                interventionId: 'intervention-123',
                choice: 'proceed'
            };

            const ackPromise = service.sendInterventionResponse(response);

            // サーバーからのackメッセージをシミュレート
            const sentMessage = mockWs.sentMessages.find(m => m.type === 'intervention_response');
            mockWs._simulateMessage({
                type: 'intervention_acknowledged',
                correlationId: sentMessage.correlationId,
                interventionId: 'intervention-123',
                choice: 'proceed'
            });

            const result = await ackPromise;
            expect(result.interventionId).toBe('intervention-123');
            expect(result.choice).toBe('proceed');
        });
    });

    describe('cancel()', () => {
        it('UT-038: キャンセルリクエストを送信できる', async () => {
            await connectAndWait(service);

            // 計算を開始
            const calculatePromise = service.calculate({ target: 1000, period: 30 });

            // キャンセルを送信
            const cancelPromise = service.cancel();

            // 送信されたメッセージを確認
            const sentMessage = mockWs.sentMessages.find(m => m.type === 'cancel');
            expect(sentMessage).toBeDefined();

            // キャンセル確認メッセージをシミュレート
            mockWs._simulateMessage({
                type: 'cancelled',
                correlationId: sentMessage.correlationId
            });

            const result = await cancelPromise;
            expect(result.cancelled).toBe(true);
        });
    });

    describe('error handling', () => {
        it('UT-039: エラーメッセージを受信してイベントを発火する', async () => {
            await connectAndWait(service);

            const errorListener = vi.fn();
            service.onError(errorListener);

            // エラーメッセージをシミュレート
            mockWs._simulateMessage({
                type: 'error',
                correlationId: 'error-correlation-id',
                code: 'VALIDATION_ERROR',
                message: 'period must be between 1 and 365'
            });

            expect(errorListener).toHaveBeenCalledWith({
                code: 'VALIDATION_ERROR',
                message: 'period must be between 1 and 365'
            });
        });

        it('UT-039: GOAL_SEEK_ERRORイベントが発火される', async () => {
            await connectAndWait(service);

            const eventListener = vi.fn();
            eventBus.on(EVENTS.GOAL_SEEK_ERROR, eventListener);

            // エラーメッセージをシミュレート
            mockWs._simulateMessage({
                type: 'error',
                code: 'INTERNAL_ERROR',
                message: 'Something went wrong'
            });

            expect(eventListener).toHaveBeenCalled();
        });

        it('UT-039: 計算中にエラーが発生した場合はrejectされる', async () => {
            await connectAndWait(service);

            const payload = { target: 1000, period: 30 };
            const resultPromise = service.calculate(payload);

            // エラーメッセージをシミュレート
            const sentMessage = mockWs.sentMessages.find(m => m.type === 'calculate');
            mockWs._simulateMessage({
                type: 'error',
                correlationId: sentMessage.correlationId,
                code: 'CALCULATION_ERROR',
                message: 'Calculation failed'
            });

            await expect(resultPromise).rejects.toThrow('Calculation failed');
        });
    });

    describe('EventBus integration', () => {
        it('UT-040: 接続成功時にGOAL_SEEK_CONNECTEDイベントが発火される', async () => {
            const eventListener = vi.fn();
            eventBus.on(EVENTS.GOAL_SEEK_CONNECTED, eventListener);

            await connectAndWait(service);

            expect(eventListener).toHaveBeenCalled();
        });

        it('UT-040: 切断時にGOAL_SEEK_DISCONNECTEDイベントが発火される', async () => {
            await connectAndWait(service);

            const eventListener = vi.fn();
            eventBus.on(EVENTS.GOAL_SEEK_DISCONNECTED, eventListener);

            service.disconnect();

            expect(eventListener).toHaveBeenCalled();
        });

        it('UT-040: 完了時にGOAL_SEEK_COMPLETEDイベントが発火される', async () => {
            await connectAndWait(service);

            const eventListener = vi.fn();
            eventBus.on(EVENTS.GOAL_SEEK_COMPLETED, eventListener);

            const payload = { target: 1000, period: 30 };
            const resultPromise = service.calculate(payload);

            // 完了メッセージをシミュレート
            const sentMessage = mockWs.sentMessages.find(m => m.type === 'calculate');
            mockWs._simulateMessage({
                type: 'completed',
                correlationId: sentMessage.correlationId,
                result: {
                    dailyTarget: 33.33,
                    target: 1000
                }
            });

            await resultPromise;

            expect(eventListener).toHaveBeenCalled();
        });
    });

    describe('connection state', () => {
        it('isConnected()で接続状態を取得できる', async () => {
            expect(service.isConnected()).toBeFalsy(); // null or false

            await connectAndWait(service);

            expect(service.isConnected()).toBe(true);

            service.disconnect();

            // disconnect後はwsがnullになるため、isConnected()はfalsyを返す
            expect(service.isConnected()).toBeFalsy();
        });
    });
});
