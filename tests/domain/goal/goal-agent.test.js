import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GoalSeekAgent, AGENT_STATUS } from '../../../public/modules/domain/goal/goal-agent.js';
import { EventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

/**
 * GoalSeekAgent 単体テスト
 *
 * テスト対象:
 * 1. start() - Seek Phase開始
 * 2. checkProgress() - 定期進捗チェック
 * 3. detectStuck() - スタック検知
 * 4. selfImprove() - 自己改善
 * 5. executeNextAction() - 次アクション実行
 */

// モックService
const createMockGoalService = () => ({
    updateProgress: vi.fn(),
    detectIntervention: vi.fn(),
    completeGoal: vi.fn(),
    failGoal: vi.fn()
});

// モックRepository
const createMockRepository = () => ({
    getGoal: vi.fn(),
    updateGoal: vi.fn(),
    createLog: vi.fn()
});

describe('GoalSeekAgent', () => {
    let agent;
    let mockService;
    let mockRepository;
    let eventBus;
    let emittedEvents;

    beforeEach(() => {
        eventBus = new EventBus();
        mockService = createMockGoalService();
        mockRepository = createMockRepository();

        // イベントキャプチャ
        emittedEvents = [];
        Object.values(EVENTS).forEach(eventName => {
            if (eventName.startsWith('goal-seek:')) {
                eventBus.on(eventName, (e) => {
                    emittedEvents.push({ type: eventName, detail: e.detail });
                });
            }
        });

        agent = new GoalSeekAgent({
            goalService: mockService,
            repository: mockRepository,
            eventBus
        });
    });

    describe('start()', () => {
        it('Seek Phase開始時_アクションプランが生成される', async () => {
            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100 },
                current: { value: 0 },
                deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7日後
            };

            mockRepository.getGoal.mockResolvedValueOnce(goal);
            mockRepository.updateGoal.mockResolvedValueOnce({ ...goal, phase: 'seek' });

            const result = await agent.start('goal-123');

            // アクションプランが生成される
            expect(result.actionPlan).toBeDefined();
            expect(result.actionPlan.length).toBeGreaterThan(0);
            expect(result.status).toBe(AGENT_STATUS.SEEKING);
        });

        it('既存のアクションプランがある場合_それを再利用する', async () => {
            const existingPlan = [
                { id: 'action-1', type: 'daily', description: '毎日10件' }
            ];

            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                actionPlan: existingPlan
            };

            mockRepository.getGoal.mockResolvedValueOnce(goal);

            const result = await agent.start('goal-123');

            expect(result.actionPlan).toEqual(existingPlan);
        });
    });

    describe('checkProgress()', () => {
        it('定期チェック時_進捗が記録される', async () => {
            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100 },
                current: { value: 50 },
                deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
            };

            mockRepository.getGoal.mockResolvedValueOnce(goal);
            mockRepository.createLog.mockResolvedValueOnce({});

            const result = await agent.checkProgress('goal-123');

            // 進捗ログが記録される
            expect(mockRepository.createLog).toHaveBeenCalled();
            expect(result.progressPercentage).toBe(50);
            expect(result.daysRemaining).toBeGreaterThan(0);
        });

        it('期限切れの場合_失敗処理が呼ばれる', async () => {
            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100 },
                current: { value: 50 },
                deadline: new Date(Date.now() - 1000).toISOString() // 過去
            };

            mockRepository.getGoal.mockResolvedValueOnce(goal);
            mockService.failGoal.mockResolvedValueOnce({ id: 'goal-123', status: 'failed' });

            await agent.checkProgress('goal-123');

            expect(mockService.failGoal).toHaveBeenCalledWith('goal-123', expect.objectContaining({
                reason: expect.stringContaining('期限')
            }));
        });
    });

    describe('detectStuck()', () => {
        it('進捗がない場合_介入要求が発生する', async () => {
            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                current: { value: 10, last_updated: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() }
            };

            mockRepository.getGoal.mockResolvedValueOnce(goal);
            mockService.detectIntervention.mockResolvedValueOnce({
                id: 'intervention-123',
                type: 'stuck'
            });

            const result = await agent.detectStuck('goal-123', { stuckThreshold: 2 * 24 * 60 * 60 * 1000 });

            expect(mockService.detectIntervention).toHaveBeenCalledWith('goal-123', expect.objectContaining({
                type: 'stuck'
            }));
            expect(result.isStuck).toBe(true);
        });

        it('進捗がある場合_介入は発生しない', async () => {
            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                current: { value: 10, last_updated: new Date().toISOString() }
            };

            mockRepository.getGoal.mockResolvedValueOnce(goal);

            const result = await agent.detectStuck('goal-123', { stuckThreshold: 2 * 24 * 60 * 60 * 1000 });

            expect(mockService.detectIntervention).not.toHaveBeenCalled();
            expect(result.isStuck).toBe(false);
        });
    });

    describe('selfImprove()', () => {
        it('介入回答がproceedの場合_代替プランが生成される', async () => {
            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100 },
                current: { value: 30 }
            };

            const intervention = {
                id: 'intervention-123',
                goalId: 'goal-123',
                userChoice: 'modify',
                userReason: '目標を修正したい'
            };

            mockRepository.getGoal.mockResolvedValueOnce(goal);
            mockRepository.updateGoal.mockResolvedValueOnce({ ...goal, phase: 'self_improve' });

            const result = await agent.selfImprove('goal-123', intervention);

            // 新しいアクションプランが生成される
            expect(result.newActionPlan).toBeDefined();
        });
    });

    describe('executeNextAction()', () => {
        it('次のアクションを実行する', async () => {
            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                actionPlan: [
                    { id: 'action-1', type: 'daily', description: '10件完了', status: 'pending' },
                    { id: 'action-2', type: 'daily', description: '20件完了', status: 'pending' }
                ],
                current: { value: 0 }
            };

            mockRepository.getGoal.mockResolvedValueOnce(goal);
            mockService.updateProgress.mockResolvedValueOnce({ current: { value: 10 } });

            const result = await agent.executeNextAction('goal-123');

            // 最初のアクションが実行される
            expect(result.executedAction.id).toBe('action-1');
            expect(result.executedAction.status).toBe('completed');
        });

        it('全てのアクションが完了している場合_nullを返す', async () => {
            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                actionPlan: [
                    { id: 'action-1', status: 'completed' }
                ]
            };

            mockRepository.getGoal.mockResolvedValueOnce(goal);

            const result = await agent.executeNextAction('goal-123');

            expect(result).toBeNull();
        });
    });

    describe('calculateDailyTarget()', () => {
        it('残り日数から1日あたりの目標を計算する', async () => {
            const goal = {
                id: 'goal-123',
                target: { value: 100 },
                current: { value: 30 },
                deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            };

            mockRepository.getGoal.mockResolvedValueOnce(goal);

            const result = await agent.calculateDailyTarget('goal-123');

            // (100 - 30) / 7 = 10
            expect(result.dailyTarget).toBeCloseTo(10, 0);
            expect(result.remaining).toBe(70);
            expect(result.daysRemaining).toBeCloseTo(7, 0);
        });
    });

    describe('stop()', () => {
        it('エージェントを停止する', async () => {
            agent.status = AGENT_STATUS.SEEKING;

            await agent.stop('goal-123');

            expect(agent.status).toBe(AGENT_STATUS.STOPPED);
        });
    });
});
