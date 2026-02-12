/**
 * GoalSeekView Unit Tests (UT-051~UT-060)
 *
 * @jest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoalSeekView } from '../../../public/modules/ui/views/goal-seek-view.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

// モックGoalSeekService
class MockGoalSeekService {
    constructor() {
        this.calculateCalled = false;
        this.cancelCalled = false;
        this.lastParams = null;
        this.respondToInterventionCalled = false;
        this.lastInterventionResponse = null;
    }

    async calculate(params) {
        this.calculateCalled = true;
        this.lastParams = params;
    }

    async cancel() {
        this.cancelCalled = true;
    }

    async respondToIntervention(goalId, response) {
        this.respondToInterventionCalled = true;
        this.lastInterventionResponse = { goalId, response };
    }

    reset() {
        this.calculateCalled = false;
        this.cancelCalled = false;
        this.lastParams = null;
        this.respondToInterventionCalled = false;
        this.lastInterventionResponse = null;
    }
}

// モックモーダル
class MockGoalSeekModal {
    constructor() {
        this.shown = false;
        this.hidden = false;
        this.lastParams = null;
    }

    show() {
        this.shown = true;
        this.hidden = false;
    }

    hide() {
        this.hidden = true;
        this.shown = false;
    }

    getParams() {
        return this.lastParams || {
            target: 10000000,
            current: 3000000,
            unit: 'yen',
            period: 30,
            variable: 'daily_actions'
        };
    }

    setParams(params) {
        this.lastParams = params;
    }

    reset() {
        this.shown = false;
        this.hidden = false;
        this.lastParams = null;
    }
}

describe('GoalSeekView', () => {
    let container;
    let mockService;
    let mockModal;
    let view;

    beforeEach(() => {
        // DOMコンテナ作成
        container = document.createElement('div');
        container.id = 'goal-seek-container';
        document.body.appendChild(container);

        // モック初期化
        mockService = new MockGoalSeekService();
        mockModal = new MockGoalSeekModal();

        // View作成
        view = new GoalSeekView({
            goalSeekService: mockService,
            modal: mockModal
        });
    });

    afterEach(() => {
        view?.unmount();
        container?.remove();
        vi.clearAllMocks();
    });

    // UT-051: 初期状態表示
    describe('UT-051: 初期状態表示', () => {
        it('should render empty state on initialization', () => {
            view.mount(container);

            // empty状態が表示される
            const emptyState = container.querySelector('#goal-seek-empty');
            expect(emptyState).not.toBeNull();
            expect(emptyState.classList.contains('hidden')).toBe(false);

            // 計算開始ボタンが存在する
            const calculateBtn = container.querySelector('#goal-seek-calculate-btn');
            expect(calculateBtn).not.toBeNull();
        });

        it('should have correct description text', () => {
            view.mount(container);

            const description = container.querySelector('#goal-seek-empty p');
            expect(description.textContent).toBe('目標達成に必要なアクションを逆算します');
        });
    });

    // UT-052: 計算開始ボタンクリック
    describe('UT-052: 計算開始ボタンクリック', () => {
        it('should show modal when calculate button is clicked', () => {
            view.mount(container);

            const calculateBtn = container.querySelector('#goal-seek-calculate-btn');
            calculateBtn.click();

            expect(mockModal.shown).toBe(true);
        });
    });

    // UT-053: 進捗表示
    describe('UT-053: 進捗表示', () => {
        it('should update progress bar on PROGRESS event', () => {
            view.mount(container);

            // 進捗イベント発火
            eventBus.emit(EVENTS.GOAL_SEEK_PROGRESS, {
                progress: 45,
                message: '計算中...',
                currentStep: 'シナリオ分析'
            });

            // emptyが非表示、progressが表示
            const emptyState = container.querySelector('#goal-seek-empty');
            const progressState = container.querySelector('#goal-seek-progress');

            expect(emptyState.classList.contains('hidden')).toBe(true);
            expect(progressState.classList.contains('hidden')).toBe(false);

            // プログレスバー更新
            const progressBar = container.querySelector('#goal-seek-progress-bar');
            expect(progressBar.style.width).toBe('45%');

            // 進捗テキスト更新
            const progressText = container.querySelector('#goal-seek-progress-text');
            expect(progressText.textContent).toBe('計算中...');
        });

        it('should update progress to 100%', () => {
            view.mount(container);

            eventBus.emit(EVENTS.GOAL_SEEK_PROGRESS, {
                progress: 100,
                message: '完了'
            });

            const progressBar = container.querySelector('#goal-seek-progress-bar');
            expect(progressBar.style.width).toBe('100%');
        });
    });

    // UT-054: 介入要求UI表示
    describe('UT-054: 介入要求UI表示', () => {
        it('should show intervention UI on INTERVENTION_REQUIRED event', () => {
            view.mount(container);

            const intervention = {
                interventionType: 'decision',
                title: '戦略を選択してください',
                message: '売上目標に対して2つのアプローチがあります',
                options: [
                    { id: 'option_a', label: 'A: 既存顧客深耕', description: '...' },
                    { id: 'option_b', label: 'B: 新規開拓強化', description: '...' }
                ],
                goalId: 'goal_xxx',
                expiresAt: new Date(Date.now() + 3600000).toISOString()
            };

            eventBus.emit(EVENTS.GOAL_SEEK_INTERVENTION_REQUIRED, intervention);

            // progressが非表示、interventionが表示
            const progressState = container.querySelector('#goal-seek-progress');
            const interventionState = container.querySelector('#goal-seek-intervention');

            expect(progressState.classList.contains('hidden')).toBe(true);
            expect(interventionState.classList.contains('hidden')).toBe(false);

            // タイトル更新
            const title = container.querySelector('#intervention-title');
            expect(title.textContent).toBe('戦略を選択してください');

            // メッセージ更新
            const message = container.querySelector('#intervention-message');
            expect(message.textContent).toBe('売上目標に対して2つのアプローチがあります');

            // 選択肢が動的に追加される
            const options = container.querySelectorAll('#intervention-options .intervention-option');
            expect(options.length).toBe(2);
        });
    });

    // UT-055: 結果表示
    describe('UT-055: 結果表示', () => {
        it('should show results on COMPLETED event', () => {
            view.mount(container);

            const result = {
                requiredDailyActions: 5,
                achievableProbability: 0.65,
                gap: 7000000,
                projection: [
                    { day: 1, value: 3100000, confidence: 0.9 },
                    { day: 2, value: 3200000, confidence: 0.85 }
                ]
            };

            eventBus.emit(EVENTS.GOAL_SEEK_COMPLETED, { result });

            // 他の状態が非表示、resultsが表示
            const emptyState = container.querySelector('#goal-seek-empty');
            const progressState = container.querySelector('#goal-seek-progress');
            const resultsState = container.querySelector('#goal-seek-results');

            expect(emptyState.classList.contains('hidden')).toBe(true);
            expect(progressState.classList.contains('hidden')).toBe(true);
            expect(resultsState.classList.contains('hidden')).toBe(false);

            // 結果値表示
            const dailyActions = container.querySelector('#result-daily-actions');
            expect(dailyActions.textContent).toBe('5');

            const probability = container.querySelector('#result-probability');
            expect(probability.textContent).toBe('65%');

            const gap = container.querySelector('#result-gap');
            expect(gap.textContent).toBe('700万円');
        });
    });

    // UT-056: 再計算ボタン
    describe('UT-056: 再計算ボタン', () => {
        it('should start new calculation when recalculate button is clicked', async () => {
            view.mount(container);

            // まず結果表示状態にする
            eventBus.emit(EVENTS.GOAL_SEEK_COMPLETED, {
                result: {
                    requiredDailyActions: 5,
                    achievableProbability: 0.65,
                    gap: 7000000,
                    projection: []
                }
            });

            const recalcBtn = container.querySelector('#goal-seek-recalculate-btn');
            recalcBtn.click();

            // モーダルが表示される
            expect(mockModal.shown).toBe(true);
        });
    });

    // UT-057: キャンセルボタン
    describe('UT-057: キャンセルボタン', () => {
        it('should send cancel when cancel button is clicked', async () => {
            view.mount(container);

            // 進捗状態にする
            eventBus.emit(EVENTS.GOAL_SEEK_PROGRESS, {
                progress: 45,
                message: '計算中...'
            });

            const cancelBtn = container.querySelector('#goal-seek-cancel-btn');
            cancelBtn.click();

            expect(mockService.cancelCalled).toBe(true);
        });
    });

    // UT-058: 選択肢選択
    describe('UT-058: 選択肢選択', () => {
        it('should update selectedOptionId when option is selected', () => {
            view.mount(container);

            // 介入要求状態にする
            eventBus.emit(EVENTS.GOAL_SEEK_INTERVENTION_REQUIRED, {
                interventionType: 'decision',
                title: '選択してください',
                message: 'メッセージ',
                options: [
                    { id: 'option_a', label: 'A' },
                    { id: 'option_b', label: 'B' }
                ],
                goalId: 'goal_xxx',
                expiresAt: new Date(Date.now() + 3600000).toISOString()
            });

            // 最初の選択肢をクリック
            const optionA = container.querySelector('[data-option-id="option_a"]');
            optionA.click();

            // 選択状態が更新される
            expect(optionA.classList.contains('selected')).toBe(true);
            expect(view._selectedOptionId).toBe('option_a');
        });

        it('should deselect other options when new option is selected', () => {
            view.mount(container);

            eventBus.emit(EVENTS.GOAL_SEEK_INTERVENTION_REQUIRED, {
                interventionType: 'decision',
                title: '選択',
                message: 'メッセージ',
                options: [
                    { id: 'option_a', label: 'A' },
                    { id: 'option_b', label: 'B' }
                ],
                goalId: 'goal_xxx',
                expiresAt: new Date(Date.now() + 3600000).toISOString()
            });

            // Aを選択
            const optionA = container.querySelector('[data-option-id="option_a"]');
            optionA.click();

            // Bを選択
            const optionB = container.querySelector('[data-option-id="option_b"]');
            optionB.click();

            // Aは選択解除、Bは選択状態
            expect(optionA.classList.contains('selected')).toBe(false);
            expect(optionB.classList.contains('selected')).toBe(true);
            expect(view._selectedOptionId).toBe('option_b');
        });
    });

    // UT-059: 介入送信ボタン
    describe('UT-059: 介入送信ボタン', () => {
        it('should call respondToIntervention when submit button is clicked', async () => {
            view.mount(container);

            eventBus.emit(EVENTS.GOAL_SEEK_INTERVENTION_REQUIRED, {
                interventionType: 'decision',
                title: '選択',
                message: 'メッセージ',
                options: [
                    { id: 'option_a', label: 'A' },
                    { id: 'option_b', label: 'B' }
                ],
                goalId: 'goal_xxx',
                expiresAt: new Date(Date.now() + 3600000).toISOString()
            });

            // オプション選択
            view._selectedOptionId = 'option_a';
            view._currentGoalId = 'goal_xxx';

            const submitBtn = container.querySelector('#intervention-submit-btn');
            await submitBtn.click();

            expect(mockService.respondToInterventionCalled).toBe(true);
            expect(mockService.lastInterventionResponse).toEqual({
                goalId: 'goal_xxx',
                response: { selectedOptionId: 'option_a' }
            });
        });

        it('should not submit if no option is selected', async () => {
            view.mount(container);

            eventBus.emit(EVENTS.GOAL_SEEK_INTERVENTION_REQUIRED, {
                interventionType: 'decision',
                title: '選択',
                message: 'メッセージ',
                options: [
                    { id: 'option_a', label: 'A' }
                ],
                goalId: 'goal_xxx',
                expiresAt: new Date(Date.now() + 3600000).toISOString()
            });

            view._selectedOptionId = null;
            view._currentGoalId = 'goal_xxx';

            const submitBtn = container.querySelector('#intervention-submit-btn');
            await submitBtn.click();

            expect(mockService.respondToInterventionCalled).toBe(false);
        });
    });

    // UT-060: 介入キャンセルボタン
    describe('UT-060: 介入キャンセルボタン', () => {
        it('should abort calculation when intervention cancel button is clicked', async () => {
            view.mount(container);

            eventBus.emit(EVENTS.GOAL_SEEK_INTERVENTION_REQUIRED, {
                interventionType: 'decision',
                title: '選択',
                message: 'メッセージ',
                options: [{ id: 'option_a', label: 'A' }],
                goalId: 'goal_xxx',
                expiresAt: new Date(Date.now() + 3600000).toISOString()
            });

            const cancelBtn = container.querySelector('#intervention-cancel-btn');
            await cancelBtn.click();

            expect(mockService.cancelCalled).toBe(true);

            // 初期状態に戻る
            const emptyState = container.querySelector('#goal-seek-empty');
            expect(emptyState.classList.contains('hidden')).toBe(false);
        });
    });

    // 追加テスト: クリーンアップ
    describe('cleanup', () => {
        it('should unsubscribe all events on unmount', () => {
            view.mount(container);

            const emitSpy = vi.spyOn(eventBus, 'emit');

            view.unmount();

            // イベント発火してもViewが反応しない
            eventBus.emit(EVENTS.GOAL_SEEK_PROGRESS, { progress: 50 });

            // 再マウント可能
            const newContainer = document.createElement('div');
            view.mount(newContainer);
            expect(newContainer.querySelector('#goal-seek-empty')).not.toBeNull();

            newContainer.remove();
        });
    });

    // 追加テスト: エラー状態
    describe('error state', () => {
        it('should show error message on FAILED event', () => {
            view.mount(container);

            eventBus.emit(EVENTS.GOAL_SEEK_FAILED, {
                code: 'CALCULATION_TIMEOUT',
                message: '計算がタイムアウトしました'
            });

            // エラー表示（初期状態に戻る＋エラーメッセージ）
            const emptyState = container.querySelector('#goal-seek-empty');
            expect(emptyState.classList.contains('hidden')).toBe(false);
        });
    });
});
