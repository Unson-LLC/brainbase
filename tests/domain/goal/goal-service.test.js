import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GoalSeekService } from '../../../public/modules/domain/goal/goal-service.js';
import { EventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { Store } from '../../../public/modules/core/store.js';

/**
 * GoalSeekService 単体テスト
 *
 * テスト対象:
 * 1. createGoal() - ゴール作成
 * 2. getGoal() - ゴール取得
 * 3. updateProgress() - 進捗更新
 * 4. detectIntervention() - 介入検知
 * 5. respondToIntervention() - 介入回答
 * 6. completeGoal() - ゴール完了
 * 7. failGoal() - ゴール失敗
 * 8. cancelGoal() - ゴールキャンセル
 *
 * 各操作で適切なEventBusイベントが発火されることを確認
 */

// モックHttpClient
const createMockHttpClient = () => ({
    get: vi.fn(),
    post: vi.fn()
});

// モックRepository
const createMockRepository = () => ({
    createGoal: vi.fn(),
    getGoal: vi.fn(),
    updateGoal: vi.fn(),
    deleteGoal: vi.fn(),
    createIntervention: vi.fn(),
    getIntervention: vi.fn(),
    updateIntervention: vi.fn(),
    createLog: vi.fn()
});

describe('GoalSeekService', () => {
    let service;
    let mockHttpClient;
    let mockRepository;
    let eventBus;
    let store;
    let emittedEvents;

    beforeEach(() => {
        // 新しいEventBusインスタンス（テストごとにリセット）
        eventBus = new EventBus();
        store = new Store({
            sessions: [],
            currentSessionId: null,
            goalSeek: {
                goals: [],
                currentGoalId: null,
                interventions: []
            }
        });

        mockHttpClient = createMockHttpClient();
        mockRepository = createMockRepository();

        // 発火されたイベントをキャプチャ
        emittedEvents = [];
        Object.values(EVENTS).forEach(eventName => {
            if (eventName.startsWith('goal-seek:')) {
                eventBus.on(eventName, (e) => {
                    emittedEvents.push({ type: eventName, detail: e.detail });
                });
            }
        });

        service = new GoalSeekService({
            httpClient: mockHttpClient,
            repository: mockRepository,
            eventBus,
            store
        });
    });

    describe('createGoal()', () => {
        it('ゴール作成時_GOAL_SEEK_STARTEDイベントが発火される', async () => {
            const goalData = {
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100, unit: '件', description: '100件達成' },
                deadline: new Date('2026-03-01').toISOString(),
                successCriteria: ['100件達成', '品質95%以上']
            };

            mockRepository.createGoal.mockResolvedValueOnce({
                id: 'goal-123',
                ...goalData,
                current: { value: 0 },
                status: 'seeking',
                phase: 'seek',
                createdAt: new Date().toISOString()
            });

            const result = await service.createGoal(goalData);

            // 結果確認
            expect(result.id).toBe('goal-123');
            expect(result.sessionId).toBe('session-123');

            // イベント発火確認
            const startedEvent = emittedEvents.find(e => e.type === EVENTS.GOAL_SEEK_STARTED);
            expect(startedEvent).toBeDefined();
            expect(startedEvent.detail.goalId).toBe('goal-123');
            expect(startedEvent.detail.sessionId).toBe('session-123');
        });

        it('必須フィールドが欠けている場合_エラーが投げられる', async () => {
            const invalidData = {
                sessionId: 'session-123'
                // goalType, target が欠けている
            };

            await expect(service.createGoal(invalidData)).rejects.toThrow();
        });
    });

    describe('getGoal()', () => {
        it('ゴールをIDで取得できる', async () => {
            mockRepository.getGoal.mockResolvedValueOnce({
                id: 'goal-123',
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100 },
                current: { value: 50 },
                status: 'seeking'
            });

            const result = await service.getGoal('goal-123');

            expect(result.id).toBe('goal-123');
            expect(mockRepository.getGoal).toHaveBeenCalledWith('goal-123');
        });
    });

    describe('updateProgress()', () => {
        it('進捗更新時_GOAL_SEEK_PROGRESSイベントが発火される', async () => {
            mockRepository.getGoal.mockResolvedValueOnce({
                id: 'goal-123',
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100 },
                current: { value: 0 },
                status: 'seeking'
            });
            mockRepository.updateGoal.mockResolvedValueOnce({
                id: 'goal-123',
                current: { value: 50, last_updated: new Date().toISOString() },
                status: 'seeking'
            });

            const result = await service.updateProgress('goal-123', { value: 50 });

            // イベント発火確認
            const progressEvent = emittedEvents.find(e => e.type === EVENTS.GOAL_SEEK_PROGRESS);
            expect(progressEvent).toBeDefined();
            expect(progressEvent.detail.goalId).toBe('goal-123');
            expect(progressEvent.detail.progress).toEqual({ value: 50 });
        });

        it('進捗が目標に達した場合_completeGoalが呼ばれる', async () => {
            mockRepository.getGoal.mockResolvedValueOnce({
                id: 'goal-123',
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100 },
                current: { value: 0 },
                status: 'seeking'
            });
            // updateProgress 用
            mockRepository.updateGoal.mockResolvedValueOnce({
                id: 'goal-123',
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100 },
                status: 'seeking',
                current: { value: 100, last_updated: new Date().toISOString() }
            });
            // completeGoal 用
            mockRepository.updateGoal.mockResolvedValueOnce({
                id: 'goal-123',
                sessionId: 'session-123',
                goalType: 'count',
                status: 'completed',
                completedAt: new Date().toISOString()
            });
            mockRepository.createLog.mockResolvedValue({});

            const result = await service.updateProgress('goal-123', { value: 100 });

            // 完了イベントが発火される
            const completedEvent = emittedEvents.find(e => e.type === EVENTS.GOAL_SEEK_COMPLETED);
            expect(completedEvent).toBeDefined();
        });
    });

    describe('detectIntervention()', () => {
        it('介入が必要な場合_GOAL_SEEK_INTERVENTION_REQUIREDイベントが発火される', async () => {
            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                status: 'seeking',
                phase: 'seek'
            };

            const interventionData = {
                type: 'blocker',
                reason: '予期しないエラーが発生しました',
                choices: [
                    { value: 'proceed', label: '継続' },
                    { value: 'abort', label: '中止' },
                    { value: 'modify', label: '目標修正' }
                ]
            };

            mockRepository.getGoal.mockResolvedValueOnce(goal);
            mockRepository.createIntervention.mockResolvedValueOnce({
                id: 'intervention-123',
                goalId: 'goal-123',
                ...interventionData,
                status: 'pending'
            });
            mockRepository.updateGoal.mockResolvedValueOnce({
                ...goal,
                status: 'intervention'
            });

            const result = await service.detectIntervention('goal-123', interventionData);

            // イベント発火確認
            const interventionEvent = emittedEvents.find(
                e => e.type === EVENTS.GOAL_SEEK_INTERVENTION_REQUIRED
            );
            expect(interventionEvent).toBeDefined();
            expect(interventionEvent.detail.goalId).toBe('goal-123');
            expect(interventionEvent.detail.interventionId).toBe('intervention-123');
        });
    });

    describe('respondToIntervention()', () => {
        it('介入回答時_GOAL_SEEK_INTERVENTION_RESPONDEDイベントが発火される', async () => {
            const intervention = {
                id: 'intervention-123',
                goalId: 'goal-123',
                type: 'blocker',
                status: 'pending',
                choices: [
                    { value: 'proceed', label: '継続' },
                    { value: 'abort', label: '中止' }
                ]
            };

            mockRepository.getIntervention.mockResolvedValueOnce(intervention);
            mockRepository.updateIntervention.mockResolvedValueOnce({
                ...intervention,
                status: 'responded',
                userChoice: 'proceed',
                respondedAt: new Date().toISOString()
            });
            mockRepository.getGoal.mockResolvedValueOnce({
                id: 'goal-123',
                status: 'intervention'
            });
            mockRepository.updateGoal.mockResolvedValueOnce({
                id: 'goal-123',
                status: 'seeking'
            });

            const result = await service.respondToIntervention('intervention-123', {
                choice: 'proceed',
                reason: '継続します'
            });

            // イベント発火確認
            const respondedEvent = emittedEvents.find(
                e => e.type === EVENTS.GOAL_SEEK_INTERVENTION_RESPONDED
            );
            expect(respondedEvent).toBeDefined();
            expect(respondedEvent.detail.interventionId).toBe('intervention-123');
            expect(respondedEvent.detail.choice).toBe('proceed');
        });

        it('不正な選択肢の場合_エラーが投げられる', async () => {
            const intervention = {
                id: 'intervention-123',
                goalId: 'goal-123',
                status: 'pending',
                choices: [
                    { value: 'proceed', label: '継続' }
                ]
            };

            mockRepository.getIntervention.mockResolvedValueOnce(intervention);

            await expect(service.respondToIntervention('intervention-123', {
                choice: 'invalid_choice'
            })).rejects.toThrow();
        });
    });

    describe('completeGoal()', () => {
        it('ゴール完了時_GOAL_SEEK_COMPLETEDイベントが発火される', async () => {
            mockRepository.getGoal.mockResolvedValueOnce({
                id: 'goal-123',
                sessionId: 'session-123',
                status: 'seeking'
            });
            mockRepository.updateGoal.mockResolvedValueOnce({
                id: 'goal-123',
                status: 'completed',
                completedAt: new Date().toISOString()
            });
            mockRepository.createLog.mockResolvedValueOnce({});

            const result = await service.completeGoal('goal-123', {
                reason: '目標達成'
            });

            // イベント発火確認
            const completedEvent = emittedEvents.find(e => e.type === EVENTS.GOAL_SEEK_COMPLETED);
            expect(completedEvent).toBeDefined();
            expect(completedEvent.detail.goalId).toBe('goal-123');
        });
    });

    describe('failGoal()', () => {
        it('ゴール失敗時_GOAL_SEEK_FAILEDイベントが発火される', async () => {
            mockRepository.getGoal.mockResolvedValueOnce({
                id: 'goal-123',
                sessionId: 'session-123',
                status: 'seeking'
            });
            mockRepository.updateGoal.mockResolvedValueOnce({
                id: 'goal-123',
                status: 'failed',
                failedAt: new Date().toISOString()
            });
            mockRepository.createLog.mockResolvedValueOnce({});

            const result = await service.failGoal('goal-123', {
                reason: '期限切れ',
                error: 'Deadline exceeded'
            });

            // イベント発火確認
            const failedEvent = emittedEvents.find(e => e.type === EVENTS.GOAL_SEEK_FAILED);
            expect(failedEvent).toBeDefined();
            expect(failedEvent.detail.goalId).toBe('goal-123');
            expect(failedEvent.detail.reason).toBe('期限切れ');
        });
    });

    describe('cancelGoal()', () => {
        it('ゴールキャンセル時_GOAL_SEEK_CANCELLEDイベントが発火される', async () => {
            mockRepository.getGoal.mockResolvedValueOnce({
                id: 'goal-123',
                sessionId: 'session-123',
                status: 'seeking'
            });
            mockRepository.updateGoal.mockResolvedValueOnce({
                id: 'goal-123',
                status: 'cancelled',
                cancelledAt: new Date().toISOString()
            });
            mockRepository.createLog.mockResolvedValueOnce({});

            const result = await service.cancelGoal('goal-123', {
                reason: 'ユーザーによるキャンセル'
            });

            // イベント発火確認
            const cancelledEvent = emittedEvents.find(e => e.type === EVENTS.GOAL_SEEK_CANCELLED);
            expect(cancelledEvent).toBeDefined();
            expect(cancelledEvent.detail.goalId).toBe('goal-123');
        });
    });

    describe('getGoalsBySession()', () => {
        it('セッションIDでゴール一覧を取得できる', async () => {
            const goals = [
                { id: 'goal-1', sessionId: 'session-123', status: 'seeking' },
                { id: 'goal-2', sessionId: 'session-123', status: 'completed' }
            ];

            // Storeにセット
            store.setState({ goalSeek: { goals, currentGoalId: null, interventions: [] } });

            const result = service.getGoalsBySession('session-123');

            expect(result).toHaveLength(2);
            expect(result[0].sessionId).toBe('session-123');
        });
    });

    describe('getActiveGoal()', () => {
        it('アクティブなゴールを取得できる', () => {
            const goals = [
                { id: 'goal-1', sessionId: 'session-123', status: 'seeking' },
                { id: 'goal-2', sessionId: 'session-456', status: 'completed' }
            ];

            store.setState({
                goalSeek: {
                    goals,
                    currentGoalId: 'goal-1',
                    interventions: []
                }
            });

            const result = service.getActiveGoal();

            expect(result).toBeDefined();
            expect(result.id).toBe('goal-1');
            expect(result.status).toBe('seeking');
        });

        it('アクティブなゴールがない場合_nullを返す', () => {
            store.setState({
                goalSeek: {
                    goals: [],
                    currentGoalId: null,
                    interventions: []
                }
            });

            const result = service.getActiveGoal();

            expect(result).toBeNull();
        });
    });
});
