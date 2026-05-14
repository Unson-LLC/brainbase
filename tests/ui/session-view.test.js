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

        it('緑インジケータが既読で消えても_直前のタイムライン位置を維持する', () => {
            const sessions = [
                { id: 'session-old-done', intendedState: 'running', createdAt: 1000 },
                { id: 'session-new-idle', intendedState: 'running', createdAt: 4000 }
            ];

            mockUiStateBySessionId['session-old-done'] = {
                activity: 'done-unread',
                hookStatus: { isDone: true, isWorking: false, lastDoneAt: 5000 }
            };

            expect(sessionView._getTimelineSessions(sessions).map(session => session.id)).toEqual([
                'session-old-done',
                'session-new-idle'
            ]);

            mockUiStateBySessionId['session-old-done'] = {
                activity: 'idle',
                hookStatus: null
            };

            expect(sessionView._getTimelineSessions(sessions).map(session => session.id)).toEqual([
                'session-old-done',
                'session-new-idle'
            ]);
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

        it('updatedAtだけの更新ではタイムライン順が上がらない', () => {
            const sessions = [
                {
                    id: 'session-a',
                    intendedState: 'running',
                    createdAt: '2026-03-17T00:00:00.000Z',
                    updatedAt: '2026-03-17T00:10:00.000Z'
                },
                {
                    id: 'session-b',
                    intendedState: 'running',
                    createdAt: '2026-03-17T00:01:00.000Z',
                    updatedAt: '2026-03-17T00:02:00.000Z'
                }
            ];

            const result = sessionView._getTimelineSessions(sessions);

            expect(result[0].id).toBe('session-b');
            expect(result[1].id).toBe('session-a');
        });

        it('AIのassistant更新があるセッションはタイムライン順が上がる', () => {
            const sessions = [
                {
                    id: 'session-a',
                    intendedState: 'running',
                    createdAt: '2026-03-17T00:00:00.000Z',
                    lastAssistantSnippetAt: '2026-03-17T00:05:00.000Z'
                },
                {
                    id: 'session-b',
                    intendedState: 'running',
                    createdAt: '2026-03-17T00:01:00.000Z'
                }
            ];

            const result = sessionView._getTimelineSessions(sessions);

            expect(result[0].id).toBe('session-a');
            expect(result[1].id).toBe('session-b');
        });
    });

});
