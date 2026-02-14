import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SessionView } from '../../public/modules/ui/views/session-view.js';
import { GoalSeekView } from '../../public/modules/domain/goal/goal-view.js';
import { eventBus, EVENTS } from '../../public/modules/core/event-bus.js';
import { appStore } from '../../public/modules/core/store.js';

/**
 * Goal Seek x Session 統合テスト
 *
 * テスト対象:
 * 1. セッションドロップダウンに「ゴール設定」ボタンが表示される
 * 2. クリックでゴール設定モーダルが開く
 * 3. GoalSeekViewがセッションと連携する
 */

// モックSessionService
const createMockSessionService = () => ({
    switchSession: vi.fn(),
    deleteSession: vi.fn(),
    archiveSession: vi.fn(),
    unarchiveSession: vi.fn(),
    pauseSession: vi.fn(),
    resumeSession: vi.fn(),
    saveSessionOrder: vi.fn(),
    getWorktreeStatus: vi.fn(),
    updateLocalMain: vi.fn()
});

// モックGoalService
const createMockGoalService = () => ({
    createGoal: vi.fn(),
    getGoal: vi.fn(),
    getGoalsBySession: vi.fn().mockResolvedValue([]),
    updateProgress: vi.fn(),
    cancelGoal: vi.fn()
});

// モックDOM環境
const createMockContainer = () => {
    const container = document.createElement('div');
    container.id = 'session-list-container';
    document.body.appendChild(container);
    return container;
};

// モックセッションデータ
const mockSessions = [
    {
        id: 'session-123',
        name: 'テストセッション',
        project: 'brainbase',
        intendedState: 'active',
        createdAt: new Date().toISOString()
    }
];

describe('Goal Seek x Session Integration', () => {
    let sessionView;
    let goalView;
    let mockSessionService;
    let mockGoalService;
    let container;
    let goalContainer;

    beforeEach(async () => {
        // DOM環境セットアップ
        container = createMockContainer();
        goalContainer = document.createElement('div');
        goalContainer.id = 'goal-seek-container';
        document.body.appendChild(goalContainer);

        mockSessionService = createMockSessionService();
        mockGoalService = createMockGoalService();

        // Storeにテストデータをセット
        appStore.setState({
            sessions: mockSessions,
            currentSessionId: 'session-123',
            ui: { sessionListView: 'timeline' }
        });

        // SessionView作成
        sessionView = new SessionView({
            sessionService: mockSessionService
        });

        // GoalSeekView作成
        goalView = new GoalSeekView({
            service: mockGoalService,
            eventBus: eventBus,
            containerSelector: '#goal-seek-container'
        });
    });

    afterEach(() => {
        sessionView?.unmount?.();
        goalView?.destroy?.();
        container?.remove?.();
        goalContainer?.remove?.();
        appStore.setState({ sessions: [], currentSessionId: null });
    });

    describe('Session Dropdown Menu', () => {
        it('ドロップダウンメニューにゴール設定ボタンが含まれる', () => {
            sessionView.mount(container);

            // セッション行を探す
            const sessionRow = container.querySelector('[data-id="session-123"]');
            expect(sessionRow).not.toBeNull();

            // ゴール設定ボタンを探す
            const goalButton = sessionRow.querySelector('.goal-setup-btn');
            expect(goalButton).not.toBeNull();
            expect(goalButton.textContent).toContain('ゴール');
        });

        it('ゴール設定ボタンクリックでイベントが発火される', async () => {
            let eventFired = false;
            let eventDetail = null;

            eventBus.on(EVENTS.GOAL_SEEK_SETUP_REQUEST, (e) => {
                eventFired = true;
                eventDetail = e.detail;
            });

            sessionView.mount(container);

            const sessionRow = container.querySelector('[data-id="session-123"]');
            const goalButton = sessionRow.querySelector('.goal-setup-btn');

            goalButton?.click();

            expect(eventFired).toBe(true);
            expect(eventDetail.sessionId).toBe('session-123');
        });
    });

    describe('GoalSeekView Integration', () => {
        it('イベント受信時にゴール設定UIが表示される', async () => {
            goalView.render({ goal: null, sessionId: 'session-123' });

            // 初期状態：ゴール設定ボタンが表示される
            expect(goalContainer.querySelector('.goal-setup-button')).not.toBeNull();
        });

        it('ゴール設定後_進捗が表示される', async () => {
            const goal = {
                id: 'goal-123',
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100, unit: '件' },
                current: { value: 50 },
                status: 'seeking'
            };

            goalView.render({ goal, sessionId: 'session-123' });

            // 進捗バーが表示される
            expect(goalContainer.querySelector('.progress-bar')).not.toBeNull();
            expect(goalContainer.querySelector('.progress-text').textContent).toContain('50');
        });
    });

    describe('End-to-End Flow', () => {
        it('ゴール設定→進捗更新→完了のフロー', async () => {
            mockGoalService.createGoal.mockResolvedValue({
                id: 'goal-new',
                sessionId: 'session-123',
                status: 'seeking'
            });

            // 1. 初期表示
            goalView.render({ goal: null, sessionId: 'session-123' });
            expect(goalContainer.querySelector('.goal-setup-button')).not.toBeNull();

            // 2. ゴール設定
            await goalView.setupGoal({
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100 }
            });

            expect(mockGoalService.createGoal).toHaveBeenCalled();

            // 3. 進捗更新
            goalView.updateProgress({ value: 75 });

            // 4. 完了状態
            goalView.render({
                goal: {
                    id: 'goal-new',
                    sessionId: 'session-123',
                    status: 'completed',
                    target: { value: 100 },
                    current: { value: 100 }
                },
                sessionId: 'session-123'
            });

            expect(goalContainer.querySelector('.goal-completed')).not.toBeNull();
        });
    });
});
