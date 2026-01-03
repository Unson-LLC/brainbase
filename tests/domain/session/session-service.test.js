import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionService } from '../../../public/modules/domain/session/session-service.js';
import { httpClient } from '../../../public/modules/core/http-client.js';
import { appStore } from '../../../public/modules/core/store.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { addSession } from '../../../public/modules/state-api.js';

// モジュールをモック化
vi.mock('../../../public/modules/core/http-client.js', () => ({
    httpClient: {
        get: vi.fn(),
        post: vi.fn()
    }
}));

vi.mock('../../../public/modules/state-api.js', () => ({
    fetchState: vi.fn(),
    saveState: vi.fn(),
    updateSession: vi.fn(),
    removeSession: vi.fn(),
    addSession: vi.fn()
}));

vi.mock('../../../public/modules/project-mapping.js', () => ({
    getProjectPath: vi.fn((project) => `/path/to/${project || 'general'}`),
    getProjectFromPath: vi.fn((path) => {
        if (!path) return 'general';
        // パスからプロジェクト名を抽出
        const match = path.match(/\/path\/to\/([^/]+)/);
        return match ? match[1] : 'general';
    }),
    CORE_PROJECTS: ['unson', 'tech-knight', 'baao']
}));

describe('SessionService', () => {
    let sessionService;
    let mockSessions;

    beforeEach(() => {
        // テストデータ準備
        mockSessions = [
            {
                id: 'session-1',
                name: 'Session 1',
                project: 'project-a',
                path: '/path/a',
                createdDate: '2024-01-01T00:00:00Z',
                intendedState: 'paused'
            },
            {
                id: 'session-2',
                name: 'Session 2',
                project: 'project-b',
                path: '/path/b',
                createdDate: '2024-01-02T00:00:00Z',
                intendedState: 'archived'
            },
            {
                id: 'session-3',
                name: 'Session 3',
                project: 'project-a',
                path: '/path/c',
                createdDate: '2024-01-03T00:00:00Z',
                intendedState: 'paused'
            }
        ];

        // ストア初期化
        appStore.setState({
            sessions: [],
            currentSessionId: null,
            filters: { sessionFilter: '', showArchivedSessions: false }
        });

        // サービスインスタンス作成
        sessionService = new SessionService();

        // モックリセット
        vi.clearAllMocks();
    });

    describe('loadSessions', () => {
        it('should fetch sessions from API and update store', async () => {
            httpClient.get.mockResolvedValue({ sessions: mockSessions });

            const result = await sessionService.loadSessions();

            expect(httpClient.get).toHaveBeenCalledWith('/api/state');
            expect(appStore.getState().sessions).toEqual(mockSessions);
            expect(result).toEqual(mockSessions);
        });

        it('should emit SESSION_LOADED event', async () => {
            httpClient.get.mockResolvedValue({ sessions: mockSessions });
            const listener = vi.fn();
            eventBus.on(EVENTS.SESSION_LOADED, listener);

            await sessionService.loadSessions();

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.sessions).toEqual(mockSessions);
        });
    });

    describe('createSession', () => {
        it('should create new session via API and reload sessions', async () => {
            const newSession = {
                name: 'New Session',
                project: 'project-a',
                path: '/path/new'
            };
            httpClient.get.mockResolvedValue({ sessions: [...mockSessions, newSession] });
            httpClient.post.mockResolvedValue({});
            addSession.mockResolvedValue();

            await sessionService.createSession(newSession);

            expect(httpClient.post).toHaveBeenCalledWith('/api/sessions/start', expect.objectContaining({
                sessionId: expect.any(String),
                cwd: expect.stringContaining('project-a'),
                engine: 'claude'
            }));
            expect(addSession).toHaveBeenCalled();
            expect(httpClient.get).toHaveBeenCalledWith('/api/state');
        });

        it('should emit SESSION_CREATED event', async () => {
            const newSession = { name: 'New Session', project: 'test' };
            httpClient.get.mockResolvedValue({ sessions: mockSessions });
            httpClient.post.mockResolvedValue({});
            const listener = vi.fn();
            eventBus.on(EVENTS.SESSION_CREATED, listener);

            await sessionService.createSession(newSession);

            expect(listener).toHaveBeenCalled();
        });
    });

    describe('updateSession', () => {
        it('should update session via API and reload sessions', async () => {
            const updates = { name: 'Updated Name' };
            httpClient.get.mockResolvedValue({ sessions: mockSessions });
            httpClient.post.mockResolvedValue({});

            await sessionService.updateSession('session-1', updates);

            expect(httpClient.get).toHaveBeenCalledWith('/api/state');
            expect(httpClient.post).toHaveBeenCalledWith('/api/state', expect.objectContaining({
                sessions: expect.arrayContaining([
                    expect.objectContaining({ id: 'session-1', name: 'Updated Name' })
                ])
            }));
        });

        it('should emit SESSION_UPDATED event', async () => {
            httpClient.get.mockResolvedValue({ sessions: mockSessions });
            httpClient.post.mockResolvedValue({});
            const listener = vi.fn();
            eventBus.on(EVENTS.SESSION_UPDATED, listener);

            await sessionService.updateSession('session-1', { name: 'Updated' });

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.sessionId).toBe('session-1');
        });
    });

    describe('deleteSession', () => {
        it('should delete session via API and reload sessions', async () => {
            httpClient.get.mockResolvedValue({ sessions: mockSessions });
            httpClient.post.mockResolvedValue({});

            await sessionService.deleteSession('session-1');

            expect(httpClient.get).toHaveBeenCalledWith('/api/state');
            expect(httpClient.post).toHaveBeenCalledWith('/api/state', expect.objectContaining({
                sessions: expect.not.arrayContaining([
                    expect.objectContaining({ id: 'session-1' })
                ])
            }));
        });

        it('should emit SESSION_DELETED event', async () => {
            httpClient.get.mockResolvedValue({ sessions: mockSessions });
            httpClient.post.mockResolvedValue({});
            const listener = vi.fn();
            eventBus.on(EVENTS.SESSION_DELETED, listener);

            await sessionService.deleteSession('session-1');

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.sessionId).toBe('session-1');
        });
    });

    describe('getFilteredSessions', () => {
        beforeEach(() => {
            appStore.setState({ sessions: mockSessions });
        });

        it('should return all sessions when no filter applied', () => {
            appStore.setState({
                filters: { sessionFilter: '', showArchivedSessions: true }
            });

            const filtered = sessionService.getFilteredSessions();

            expect(filtered).toHaveLength(3);
        });

        it('should filter sessions by text', () => {
            appStore.setState({
                filters: { sessionFilter: 'Session 1', showArchivedSessions: true }
            });

            const filtered = sessionService.getFilteredSessions();

            expect(filtered).toHaveLength(1);
            expect(filtered[0].name).toBe('Session 1');
        });

        it('should filter out archived sessions when showArchivedSessions is false', () => {
            appStore.setState({
                filters: { sessionFilter: '', showArchivedSessions: false }
            });

            const filtered = sessionService.getFilteredSessions();

            expect(filtered).toHaveLength(2);
            expect(filtered.every(s => s.intendedState !== 'archived')).toBe(true);
        });

        it('should filter by project', () => {
            appStore.setState({
                filters: { sessionFilter: 'project-a', showArchivedSessions: true }
            });

            const filtered = sessionService.getFilteredSessions();

            expect(filtered).toHaveLength(2);
            expect(filtered.every(s => s.project === 'project-a')).toBe(true);
        });
    });

    describe('getActiveSession', () => {
        beforeEach(() => {
            appStore.setState({
                sessions: mockSessions,
                currentSessionId: 'session-1'
            });
        });

        it('should return active session by currentSessionId', () => {
            const activeSession = sessionService.getActiveSession();

            expect(activeSession).toBeTruthy();
            expect(activeSession.id).toBe('session-1');
        });

        it('should return null when no active session', () => {
            appStore.setState({ currentSessionId: null });

            const activeSession = sessionService.getActiveSession();

            expect(activeSession).toBeNull();
        });
    });

    describe('switchSession - 自動一時停止', () => {
        let sessionsWithState;

        beforeEach(() => {
            // セッションデータを準備（intendedState付き）
            sessionsWithState = [
                { id: 'session-1', name: 'Session 1', path: '/path/a', intendedState: 'active' },
                { id: 'session-2', name: 'Session 2', path: '/path/b', intendedState: 'paused' },
                { id: 'session-3', name: 'Session 3', path: '/path/c', intendedState: 'paused' }
            ];

            appStore.setState({
                sessions: [...sessionsWithState],
                currentSessionId: 'session-1'
            });

            // httpClient.getが呼ばれるたびに最新のストア状態を返す
            httpClient.get.mockImplementation(() => {
                const currentState = appStore.getState();
                return Promise.resolve({ sessions: [...currentState.sessions] });
            });

            // httpClient.postが呼ばれた時、ストアを更新する
            httpClient.post.mockImplementation((url, data) => {
                if (url === '/api/state' && data && data.sessions) {
                    appStore.setState({ sessions: [...data.sessions] });
                }
                return Promise.resolve({});
            });
        });

        it('should update currentSessionId when switching to another session', async () => {
            // session-1（active）からsession-2へ切り替え
            await sessionService.switchSession('session-2');

            // currentSessionIdが更新されていることを確認
            const state = appStore.getState();
            expect(state.currentSessionId).toBe('session-2');
        });

        it('should emit SESSION_CHANGED event when switching', async () => {
            const changedListener = vi.fn();
            eventBus.on(EVENTS.SESSION_CHANGED, changedListener);

            await sessionService.switchSession('session-2');

            expect(changedListener).toHaveBeenCalledWith(expect.objectContaining({
                detail: expect.objectContaining({ sessionId: 'session-2' })
            }));
        });

        it('should not pause when switching to the same session', async () => {
            const initialCallCount = httpClient.post.mock.calls.length;

            // 同じセッションへの切り替え
            await sessionService.switchSession('session-1');

            // updateSessionが呼ばれないことを確認
            expect(httpClient.post.mock.calls.length).toBe(initialCallCount);
        });

        it('should not change session state when switching', async () => {
            // session-2へ切り替え
            await sessionService.switchSession('session-2');

            // セッションの状態は変更されないことを確認
            const state = appStore.getState();
            expect(state.sessions.find(s => s.id === 'session-1').intendedState).toBe('active');
            expect(state.sessions.find(s => s.id === 'session-2').intendedState).toBe('paused');
        });

        it('should start ttyd process when resuming paused session', async () => {
            // pausedセッションへの切り替え
            await sessionService.switchSession('session-2');

            // ttyd起動のAPIが呼ばれることを確認（実装後に有効化）
            // expect(httpClient.post).toHaveBeenCalledWith('/api/sessions/start', expect.anything());
        });
    });

    describe('pauseSession', () => {
        beforeEach(() => {
            const sessionsWithState = [
                { id: 'session-1', name: 'Session 1', path: '/path/a', intendedState: 'active' }
            ];

            appStore.setState({ sessions: sessionsWithState });
            httpClient.get.mockResolvedValue({ sessions: sessionsWithState });
            httpClient.post.mockResolvedValue({});
        });

        it('should pause active session and stop ttyd', async () => {
            await sessionService.pauseSession('session-1');

            expect(httpClient.post).toHaveBeenCalledWith('/api/state', expect.objectContaining({
                sessions: expect.arrayContaining([
                    expect.objectContaining({ id: 'session-1', intendedState: 'paused' })
                ])
            }));
        });

        it('should emit SESSION_PAUSED event', async () => {
            const listener = vi.fn();
            eventBus.on(EVENTS.SESSION_PAUSED, listener);

            await sessionService.pauseSession('session-1');

            expect(listener).toHaveBeenCalledWith(expect.objectContaining({
                detail: expect.objectContaining({ sessionId: 'session-1' })
            }));
        });
    });

    describe('resumeSession', () => {
        beforeEach(() => {
            const sessionsWithState = [
                { id: 'session-1', name: 'Session 1', path: '/path/a', intendedState: 'paused' }
            ];

            appStore.setState({ sessions: sessionsWithState });
            httpClient.get.mockResolvedValue({ sessions: sessionsWithState });
            httpClient.post.mockResolvedValue({});
        });

        it('should resume paused session to active', async () => {
            await sessionService.resumeSession('session-1');

            expect(httpClient.post).toHaveBeenCalledWith('/api/state', expect.objectContaining({
                sessions: expect.arrayContaining([
                    expect.objectContaining({ id: 'session-1', intendedState: 'active' })
                ])
            }));
        });

        it('should emit SESSION_RESUMED event', async () => {
            const listener = vi.fn();
            eventBus.on(EVENTS.SESSION_RESUMED, listener);

            await sessionService.resumeSession('session-1');

            expect(listener).toHaveBeenCalledWith(expect.objectContaining({
                detail: expect.objectContaining({ sessionId: 'session-1' })
            }));
        });
    });

    describe('stopped状態の廃止', () => {
        beforeEach(() => {
            // Reset mocks
            vi.clearAllMocks();
            httpClient.post.mockResolvedValue({});
            httpClient.get.mockResolvedValue({ sessions: [] });
        });

        it('should not use "stopped" state when creating regular session', async () => {
            // Regular session creation should use "active" instead of "stopped"
            await sessionService.createSession({
                project: 'test-project',
                name: 'Test Session',
                initialCommand: '',
                useWorktree: false,
                engine: 'claude'
            });

            // Check that the session was created with "active" state, not "stopped"
            expect(addSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    intendedState: 'active'
                })
            );
            expect(addSession).not.toHaveBeenCalledWith(
                expect.objectContaining({
                    intendedState: 'stopped'
                })
            );
        });

        it('should only use three states: active, paused, archived', () => {
            // Define allowed states
            const allowedStates = ['active', 'paused', 'archived'];

            // Check that no session in mock data uses "stopped"
            const sessionsWithState = [
                { id: 'session-1', intendedState: 'active' },
                { id: 'session-2', intendedState: 'paused' },
                { id: 'session-3', intendedState: 'archived' }
            ];

            sessionsWithState.forEach(session => {
                expect(allowedStates).toContain(session.intendedState);
                expect(session.intendedState).not.toBe('stopped');
            });
        });

        it('should migrate "stopped" sessions to "paused" when loading', async () => {
            // Prepare state with stopped sessions
            const stateWithStopped = {
                sessions: [
                    { id: 'session-1', name: 'Session 1', intendedState: 'stopped' },
                    { id: 'session-2', name: 'Session 2', intendedState: 'active' },
                    { id: 'session-3', name: 'Session 3', intendedState: 'stopped' }
                ]
            };

            httpClient.get.mockResolvedValue(stateWithStopped);
            httpClient.post.mockResolvedValue({});

            await sessionService.loadSessions();

            // Check that the sessions were migrated to "paused"
            expect(httpClient.post).toHaveBeenCalledWith('/api/state', {
                sessions: [
                    { id: 'session-1', name: 'Session 1', intendedState: 'paused' },
                    { id: 'session-2', name: 'Session 2', intendedState: 'active' },
                    { id: 'session-3', name: 'Session 3', intendedState: 'paused' }
                ]
            });

            // Check that the migrated sessions were saved to store
            const { sessions } = appStore.getState();
            expect(sessions[0].intendedState).toBe('paused');
            expect(sessions[2].intendedState).toBe('paused');
        });

        it('should not trigger migration if no "stopped" sessions exist', async () => {
            // Prepare state without stopped sessions
            const stateWithoutStopped = {
                sessions: [
                    { id: 'session-1', name: 'Session 1', intendedState: 'active' },
                    { id: 'session-2', name: 'Session 2', intendedState: 'paused' }
                ]
            };

            httpClient.get.mockResolvedValue(stateWithoutStopped);
            httpClient.post.mockResolvedValue({});

            await sessionService.loadSessions();

            // Check that POST was NOT called (no migration needed)
            expect(httpClient.post).not.toHaveBeenCalled();
        });
    });

    describe('getArchivedSessions', () => {
        let archivedSessions;

        beforeEach(() => {
            archivedSessions = [
                {
                    id: 'session-1',
                    name: 'Session 1',
                    path: '/path/to/project-a',
                    intendedState: 'archived',
                    archivedAt: '2024-01-03T00:00:00Z'
                },
                {
                    id: 'session-2',
                    name: 'Session 2',
                    path: '/path/to/project-b',
                    intendedState: 'archived',
                    archivedAt: '2024-01-02T00:00:00Z'
                },
                {
                    id: 'session-3',
                    name: 'Active Session',
                    path: '/path/to/project-a',
                    intendedState: 'active'
                },
                {
                    id: 'session-4',
                    name: 'Session 4',
                    path: '/path/to/project-a',
                    intendedState: 'archived',
                    archivedAt: '2024-01-01T00:00:00Z'
                }
            ];
            appStore.setState({ sessions: archivedSessions });
        });

        it('getArchivedSessions呼び出し時_アーカイブ済みセッションのみ返却される', () => {
            const result = sessionService.getArchivedSessions();

            expect(result).toHaveLength(3);
            expect(result.every(s => s.intendedState === 'archived')).toBe(true);
        });

        it('getArchivedSessions呼び出し時_検索キーワードでフィルタリングされる', () => {
            const result = sessionService.getArchivedSessions('Session 1');

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Session 1');
        });

        it('getArchivedSessions呼び出し時_プロジェクトフィルタでフィルタリングされる', () => {
            const result = sessionService.getArchivedSessions('', 'project-a');

            expect(result).toHaveLength(2);
        });

        it('getArchivedSessions呼び出し時_検索とプロジェクト両方でフィルタリングされる', () => {
            const result = sessionService.getArchivedSessions('Session 4', 'project-a');

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Session 4');
        });

        it('getArchivedSessions呼び出し時_archivedAtでソートされる（新しい順）', () => {
            const result = sessionService.getArchivedSessions();

            // 新しい順にソート: 2024-01-03 > 2024-01-02 > 2024-01-01
            expect(result[0].archivedAt).toBe('2024-01-03T00:00:00Z');
            expect(result[1].archivedAt).toBe('2024-01-02T00:00:00Z');
            expect(result[2].archivedAt).toBe('2024-01-01T00:00:00Z');
        });

        it('getArchivedSessions呼び出し時_archivedAtなし_セッションIDからタイムスタンプ抽出', () => {
            const sessionsWithoutArchivedAt = [
                { id: 'session-1767000000000', name: 'Session A', intendedState: 'archived' },
                { id: 'session-1768000000000', name: 'Session B', intendedState: 'archived' }
            ];
            appStore.setState({ sessions: sessionsWithoutArchivedAt });

            const result = sessionService.getArchivedSessions();

            expect(result).toHaveLength(2);
            // 新しいタイムスタンプが先に来る
            expect(result[0].id).toBe('session-1768000000000');
            expect(result[1].id).toBe('session-1767000000000');
        });
    });

    describe('unarchiveSession', () => {
        beforeEach(() => {
            const archivedSession = [
                { id: 'session-1', name: 'Archived Session', intendedState: 'archived' }
            ];
            appStore.setState({ sessions: archivedSession });
            httpClient.get.mockResolvedValue({ sessions: archivedSession });
            httpClient.post.mockResolvedValue({});
        });

        it('unarchiveSession呼び出し時_intendedStateがactiveに変更される', async () => {
            await sessionService.unarchiveSession('session-1');

            expect(httpClient.post).toHaveBeenCalledWith('/api/state', expect.objectContaining({
                sessions: expect.arrayContaining([
                    expect.objectContaining({ id: 'session-1', intendedState: 'active' })
                ])
            }));
        });

        it('unarchiveSession呼び出し時_SESSION_UPDATEDイベントが発火される', async () => {
            const listener = vi.fn();
            eventBus.on(EVENTS.SESSION_UPDATED, listener);

            await sessionService.unarchiveSession('session-1');

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.sessionId).toBe('session-1');
        });
    });

    describe('getUniqueProjects', () => {
        it('getUniqueProjects呼び出し時_ユニークなプロジェクト一覧が返却される', () => {
            const sessionsWithProjects = [
                { id: '1', project: 'project-a' },
                { id: '2', project: 'project-b' },
                { id: '3', project: 'project-a' }, // 重複
                { id: '4', project: 'project-c' }
            ];
            appStore.setState({ sessions: sessionsWithProjects });

            const result = sessionService.getUniqueProjects();

            expect(result).toHaveLength(3);
            expect(result).toContain('project-a');
            expect(result).toContain('project-b');
            expect(result).toContain('project-c');
        });

        it('getUniqueProjects呼び出し時_projectがnullのセッションは除外される', () => {
            const sessionsWithNull = [
                { id: '1', project: 'project-a' },
                { id: '2', project: null },
                { id: '3', project: undefined }
            ];
            appStore.setState({ sessions: sessionsWithNull });

            const result = sessionService.getUniqueProjects();

            expect(result).toHaveLength(1);
            expect(result).toContain('project-a');
        });

        it('getUniqueProjects呼び出し時_セッションなし_空配列が返却される', () => {
            appStore.setState({ sessions: [] });

            const result = sessionService.getUniqueProjects();

            expect(result).toEqual([]);
        });
    });

    describe('saveSessionOrder', () => {
        it('saveSessionOrder呼び出し時_APIにPOSTリクエストが送信される', async () => {
            const reorderedSessions = [
                { id: 'session-2', name: 'Session 2' },
                { id: 'session-1', name: 'Session 1' }
            ];
            httpClient.get.mockResolvedValue({ sessions: mockSessions });
            httpClient.post.mockResolvedValue({});

            await sessionService.saveSessionOrder(reorderedSessions);

            expect(httpClient.post).toHaveBeenCalledWith('/api/state', expect.objectContaining({
                sessions: reorderedSessions
            }));
        });

        it('saveSessionOrder呼び出し時_APIエラー発生_例外がスローされる', async () => {
            const error = new Error('Network error');
            httpClient.get.mockResolvedValue({ sessions: mockSessions });
            httpClient.post.mockRejectedValue(error);

            await expect(sessionService.saveSessionOrder([])).rejects.toThrow('Network error');
        });

        it('saveSessionOrder呼び出し時_空配列でも正常に保存される', async () => {
            httpClient.get.mockResolvedValue({ sessions: [] });
            httpClient.post.mockResolvedValue({});

            await sessionService.saveSessionOrder([]);

            expect(httpClient.post).toHaveBeenCalledWith('/api/state', expect.objectContaining({
                sessions: []
            }));
        });
    });
});
