import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionService } from '../../../public/modules/domain/session/session-service.js';
import { httpClient } from '../../../public/modules/core/http-client.js';
import { appStore } from '../../../public/modules/core/store.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

// モジュールをモック化
vi.mock('../../../public/modules/core/http-client.js', () => ({
    httpClient: {
        get: vi.fn(),
        post: vi.fn()
    }
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
                createdDate: '2024-01-01T00:00:00Z'
            },
            {
                id: 'session-2',
                name: 'Session 2',
                project: 'project-b',
                path: '/path/b',
                createdDate: '2024-01-02T00:00:00Z',
                archived: true
            },
            {
                id: 'session-3',
                name: 'Session 3',
                project: 'project-a',
                path: '/path/c',
                createdDate: '2024-01-03T00:00:00Z'
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

            await sessionService.createSession(newSession);

            expect(httpClient.post).toHaveBeenCalledWith('/api/state', expect.objectContaining({
                sessions: expect.arrayContaining([expect.objectContaining(newSession)])
            }));
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
            expect(filtered.every(s => !s.archived)).toBe(true);
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
});
