import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GoalSeekView } from '../../../public/modules/domain/goal/goal-view.js';
import { EventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

/**
 * GoalSeekView 単体テスト
 *
 * テスト対象:
 * 1. render() - ゴール状態に応じたUI表示
 * 2. setupGoal() - ゴール設定フォーム送信
 * 3. showIntervention() - 介入モーダル表示
 * 4. updateProgress() - 進捗更新UI
 * 5. hide() - UI非表示
 */

// モックService
const createMockGoalService = () => ({
    createGoal: vi.fn(),
    updateProgress: vi.fn(),
    getGoal: vi.fn(),
    cancelGoal: vi.fn()
});

// モックDOM環境
const createMockContainer = () => {
    const container = document.createElement('div');
    container.id = 'goal-seek-container';
    document.body.appendChild(container);
    return container;
};

describe('GoalSeekView', () => {
    let view;
    let mockService;
    let eventBus;
    let container;
    let emittedEvents;

    beforeEach(() => {
        // DOM環境セットアップ
        container = createMockContainer();

        eventBus = new EventBus();
        mockService = createMockGoalService();

        // イベントキャプチャ
        emittedEvents = [];
        Object.values(EVENTS).forEach(eventName => {
            if (eventName.startsWith('goal-seek:')) {
                eventBus.on(eventName, (e) => {
                    emittedEvents.push({ type: eventName, detail: e.detail });
                });
            }
        });

        view = new GoalSeekView({
            service: mockService,
            eventBus,
            containerSelector: '#goal-seek-container'
        });
    });

    afterEach(() => {
        view?.destroy?.();
        container?.remove?.();
    });

    describe('render()', () => {
        it('ゴールがない場合_ゴール設定UIを表示する', () => {
            view.render({ goal: null, sessionId: 'session-123' });

            const goalButton = container.querySelector('.goal-setup-button');
            expect(goalButton).not.toBeNull();
            expect(goalButton.textContent).toContain('ゴール設定');
        });

        it('ゴールがある場合_進捗インジケーターを表示する', () => {
            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100, unit: '件' },
                current: { value: 50 },
                status: 'seeking',
                phase: 'seek'
            };

            view.render({ goal, sessionId: 'session-123' });

            const progressBar = container.querySelector('.progress-bar');
            expect(progressBar).not.toBeNull();

            const progressText = container.querySelector('.progress-text');
            expect(progressText.textContent).toContain('50');
        });

        it('完了状態のゴール_完了メッセージを表示する', () => {
            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                status: 'completed',
                target: { value: 100 },
                current: { value: 100 }
            };

            view.render({ goal, sessionId: 'session-123' });

            const completedMessage = container.querySelector('.goal-completed');
            expect(completedMessage).not.toBeNull();
        });
    });

    describe('setupGoal()', () => {
        it('ゴール設定フォーム送信時_createGoalが呼ばれる', async () => {
            mockService.createGoal.mockResolvedValueOnce({
                id: 'goal-new',
                sessionId: 'session-123'
            });

            const goalData = {
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100, unit: '件' },
                deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                successCriteria: ['100件達成']
            };

            await view.setupGoal(goalData);

            expect(mockService.createGoal).toHaveBeenCalledWith(goalData);
        });

        it('ゴール設定フォーム送信時_GOAL_SEEK_STARTEDイベントが発火される', async () => {
            mockService.createGoal.mockResolvedValueOnce({
                id: 'goal-new',
                sessionId: 'session-123'
            });

            await view.setupGoal({
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100 }
            });

            expect(emittedEvents.some(e => e.type === EVENTS.GOAL_SEEK_STARTED)).toBe(true);
        });
    });

    describe('showIntervention()', () => {
        it('介入モーダルが正しく表示される', () => {
            const intervention = {
                id: 'intervention-123',
                goalId: 'goal-123',
                type: 'blocker',
                reason: 'エラーが発生しました',
                choices: [
                    { value: 'proceed', label: '継続' },
                    { value: 'abort', label: '中止' }
                ]
            };

            view.showIntervention(intervention);

            const modal = container.querySelector('.intervention-modal');
            expect(modal).not.toBeNull();
            expect(modal.textContent).toContain('エラーが発生しました');

            const choiceButtons = modal.querySelectorAll('.intervention-choice');
            expect(choiceButtons.length).toBe(2);
        });

        it('介入選択時_選択内容が送信される', async () => {
            const intervention = {
                id: 'intervention-123',
                goalId: 'goal-123',
                type: 'blocker',
                choices: [
                    { value: 'proceed', label: '継続' },
                    { value: 'abort', label: '中止' }
                ]
            };

            view.showIntervention(intervention);

            const proceedButton = container.querySelector('[data-choice="proceed"]');
            proceedButton?.click();

            // イベント発火確認
            expect(emittedEvents.some(e =>
                e.type === EVENTS.GOAL_SEEK_INTERVENTION_RESPONDED &&
                e.detail.choice === 'proceed'
            )).toBe(true);
        });
    });

    describe('updateProgress()', () => {
        it('進捗更新時_UIが再描画される', () => {
            // 初期描画
            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100 },
                current: { value: 50 },
                status: 'seeking'
            };
            view.render({ goal, sessionId: 'session-123' });

            // 進捗更新
            view.updateProgress({ value: 75 });

            const progressText = container.querySelector('.progress-text');
            expect(progressText.textContent).toContain('75');
        });
    });

    describe('cancelGoal()', () => {
        it('キャンセル時_cancelGoalが呼ばれる', async () => {
            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                status: 'seeking'
            };
            view.render({ goal, sessionId: 'session-123' });

            mockService.cancelGoal.mockResolvedValueOnce({});

            await view.cancelGoal('goal-123');

            expect(mockService.cancelGoal).toHaveBeenCalledWith('goal-123');
        });

        it('キャンセル時_GOAL_SEEK_CANCELLEDイベントが発火される', async () => {
            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                status: 'seeking'
            };
            view.render({ goal, sessionId: 'session-123' });

            mockService.cancelGoal.mockResolvedValueOnce({});

            await view.cancelGoal('goal-123');

            expect(emittedEvents.some(e => e.type === EVENTS.GOAL_SEEK_CANCELLED)).toBe(true);
        });
    });

    describe('hide()', () => {
        it('hide呼び出し時_コンテナが空になる', () => {
            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                status: 'seeking',
                target: { value: 100 },
                current: { value: 50 }
            };
            view.render({ goal, sessionId: 'session-123' });

            view.hide();

            expect(container.innerHTML).toBe('');
        });
    });

    describe('destroy()', () => {
        it('destroy呼び出し時_イベントリスナーが削除される', () => {
            const unsubscribeSpy = vi.fn();

            view.eventSubscriptions = [unsubscribeSpy];

            view.destroy();

            expect(unsubscribeSpy).toHaveBeenCalled();
        });
    });
});
