import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionView } from '../../public/modules/ui/views/session-view.js';

// モックStore（appStoreとして使う）
let mockStoreState = { currentSessionId: 'session-current' };
let mockUiStateBySessionId = {};

vi.mock('../../public/modules/session-ui-state.js', () => ({
    deriveSessionUiState: vi.fn((sessionId) => mockUiStateBySessionId[sessionId] || ({
        activity: 'idle',
        transport: 'disconnected',
        attention: 'none',
        summary: null,
        recentFile: null,
        recentFiles: [],
        hookStatus: null
    }))
}));

// モックappStore
vi.mock('../../public/modules/core/store.js', () => ({
    appStore: {
        getState: () => mockStoreState,
        setState: vi.fn((next) => {
            mockStoreState = { ...mockStoreState, ...next };
        })
    },
    subscribeToSessionChange: vi.fn()
}));

// モックEventBus
vi.mock('../../public/modules/core/event-bus.js', () => ({
    eventBus: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn()
    },
    EVENTS: {
        SESSION_LOADED: 'session:loaded',
        SESSION_CREATED: 'session:created',
        SESSION_UPDATED: 'session:updated',
        SESSION_DELETED: 'session:deleted',
        SESSION_PAUSED: 'session:paused'
    }
}));

describe('SessionView', () => {
    describe('_getTimelineSessions', () => {
        let sessionView;

        beforeEach(async () => {
            vi.clearAllMocks();

            // mockStoreStateをリセット
            mockStoreState = { currentSessionId: 'session-current' };
            mockUiStateBySessionId = {};

            // SessionViewインスタンス作成
            sessionView = new SessionView({
                sessionService: {}
            });
        });

        it('緑インジケータセッションが最上部に配置される', () => {
            // Arrange: テストデータ準備
            const sessions = [
                { id: 'session-a', intendedState: 'running', createdAt: 1000 },
                { id: 'session-b', intendedState: 'running', createdAt: 2000 }, // 緑インジケータ
                { id: 'session-c', intendedState: 'running', createdAt: 3000 }
            ];

            mockUiStateBySessionId['session-b'] = {
                activity: 'done-unread',
                hookStatus: { isDone: true, isWorking: false, lastDoneAt: 2500 }
            };

            // Act: ソート実行
            const result = sessionView._getTimelineSessions(sessions);

            // Assert: session-b が最上部に配置される
            expect(result[0].id).toBe('session-b');
            expect(result[1].id).toBe('session-c'); // 残りは時系列順（最新が上）
            expect(result[2].id).toBe('session-a');
        });

        it('緑インジケータセッションが複数ある場合_時系列順で表示される', () => {
            // Arrange
            const sessions = [
                { id: 'session-a', intendedState: 'running', createdAt: 1000 },
                { id: 'session-b', intendedState: 'running', createdAt: 2000 }, // 緑
                { id: 'session-c', intendedState: 'running', createdAt: 3000 }, // 緑
                { id: 'session-d', intendedState: 'running', createdAt: 4000 }
            ];

            mockUiStateBySessionId['session-b'] = {
                activity: 'done-unread',
                hookStatus: { isDone: true, isWorking: false }
            };
            mockUiStateBySessionId['session-c'] = {
                activity: 'done-unread',
                hookStatus: { isDone: true, isWorking: false }
            };

            // Act
            const result = sessionView._getTimelineSessions(sessions);

            // Assert: 緑セッション同士は時系列順（最新が上）
            expect(result[0].id).toBe('session-c'); // 緑・最新
            expect(result[1].id).toBe('session-b'); // 緑・古い
            expect(result[2].id).toBe('session-d'); // 通常・最新
            expect(result[3].id).toBe('session-a'); // 通常・古い
        });

        it('現在のセッションが緑インジケータの場合_優先される', () => {
            // Arrange
            const sessions = [
                { id: 'session-a', intendedState: 'running', createdAt: 1000 },
                { id: 'session-current', intendedState: 'running', createdAt: 2000 }, // 現在のセッション（緑）
                { id: 'session-c', intendedState: 'running', createdAt: 3000 }
            ];

            mockUiStateBySessionId['session-current'] = {
                activity: 'done-unread',
                hookStatus: { isDone: true, isWorking: false }
            };

            // Act
            const result = sessionView._getTimelineSessions(sessions);

            // Assert: 現在のセッションでも緑インジケータなら優先される
            expect(result[0].id).toBe('session-current');
            expect(result[1].id).toBe('session-c');
            expect(result[2].id).toBe('session-a'); // 通常・古い
        });

        it('アーカイブセッションは除外される', () => {
            // Arrange
            const sessions = [
                { id: 'session-a', intendedState: 'running', createdAt: 1000 },
                { id: 'session-archived', intendedState: 'archived', createdAt: 2000 },
                { id: 'session-c', intendedState: 'running', createdAt: 3000 }
            ];

            // Act
            const result = sessionView._getTimelineSessions(sessions);

            // Assert: archived は除外される
            expect(result.length).toBe(2);
            expect(result.find(s => s.id === 'session-archived')).toBeUndefined();
        });
    });

    describe('AI integration prompt delivery', () => {
        let sessionView;

        beforeEach(() => {
            vi.clearAllMocks();
            sessionView = new SessionView({
                sessionService: {
                    askAiToResolveIntegration: vi.fn()
                }
            });
            delete window.mobileInputController;
            delete window.copyToClipboardMobile;
        });

        it('_deliverInvestigationPrompt呼び出し時_clipboard書き込み成功_clipboardモードを返す', async () => {
            const writeText = vi.fn().mockResolvedValue(undefined);
            Object.defineProperty(navigator, 'clipboard', {
                value: { writeText },
                configurable: true
            });

            const result = await sessionView._deliverInvestigationPrompt('test prompt');

            expect(result).toEqual({ mode: 'clipboard' });
            expect(writeText).toHaveBeenCalledWith('test prompt');
        });

        it('_deliverInvestigationPrompt呼び出し時_clipboard失敗_mobile fallback成功_clipboardモードを返す', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const writeText = vi.fn().mockRejectedValue(new Error('denied'));
            Object.defineProperty(navigator, 'clipboard', {
                value: { writeText },
                configurable: true
            });
            window.copyToClipboardMobile = vi.fn().mockResolvedValue(true);

            const result = await sessionView._deliverInvestigationPrompt('test prompt');

            expect(result).toEqual({ mode: 'clipboard' });
            expect(window.copyToClipboardMobile).toHaveBeenCalledWith('test prompt');
            warnSpy.mockRestore();
        });
    });
});
