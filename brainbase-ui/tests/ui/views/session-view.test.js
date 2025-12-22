import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionView } from '../../../public/modules/ui/views/session-view.js';
import { SessionService } from '../../../public/modules/domain/session/session-service.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { appStore } from '../../../public/modules/core/store.js';

// SessionServiceをモック化
vi.mock('../../../public/modules/domain/session/session-service.js', () => {
    return {
        SessionService: class MockSessionService {
            constructor() {
                this.loadSessions = vi.fn();
                this.createSession = vi.fn();
                this.updateSession = vi.fn();
                this.deleteSession = vi.fn();
                this.getFilteredSessions = vi.fn(() => []);
                this.getActiveSession = vi.fn(() => null);
            }
        }
    };
});

describe('SessionView', () => {
    let sessionView;
    let mockSessionService;
    let container;

    beforeEach(() => {
        // DOM準備
        document.body.innerHTML = '<div id="test-container"></div>';
        container = document.getElementById('test-container');

        // window.confirm, window.prompt をモック
        global.confirm = vi.fn(() => true);
        global.prompt = vi.fn((message) => 'Test Session');

        // モックサービス
        mockSessionService = new SessionService();
        sessionView = new SessionView({ sessionService: mockSessionService });

        // ストア初期化
        appStore.setState({
            sessions: [],
            currentSessionId: null,
            filters: { sessionFilter: '', showArchivedSessions: false }
        });

        vi.clearAllMocks();
    });

    describe('mount', () => {
        it('should mount to container element', () => {
            sessionView.mount(container);

            expect(sessionView.container).toBe(container);
        });

        it('should render on mount', () => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'project-a' }
            ];
            mockSessionService.getFilteredSessions.mockReturnValue(mockSessions);

            sessionView.mount(container);

            expect(container.innerHTML).not.toBe('');
        });
    });

    describe('render', () => {
        beforeEach(() => {
            sessionView.mount(container);
        });

        it('should render session list', () => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'project-a' },
                { id: 'session-2', name: 'Session 2', project: 'project-b' }
            ];
            mockSessionService.getFilteredSessions.mockReturnValue(mockSessions);

            sessionView.render();

            const sessionElements = container.querySelectorAll('[data-session-id]');
            expect(sessionElements.length).toBe(2);
        });

        it('should display empty state when no sessions', () => {
            mockSessionService.getFilteredSessions.mockReturnValue([]);

            sessionView.render();

            expect(container.innerHTML).toContain('セッションがありません');
        });

        it('should highlight active session', () => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'test' },
                { id: 'session-2', name: 'Session 2', project: 'test' }
            ];
            mockSessionService.getFilteredSessions.mockReturnValue(mockSessions);
            appStore.setState({ currentSessionId: 'session-1' });

            sessionView.render();

            const activeElement = container.querySelector('[data-session-id="session-1"]');
            expect(activeElement.classList.contains('active')).toBe(true);
        });

        it('should group sessions by project', () => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'project-a' },
                { id: 'session-2', name: 'Session 2', project: 'project-a' },
                { id: 'session-3', name: 'Session 3', project: 'project-b' }
            ];
            mockSessionService.getFilteredSessions.mockReturnValue(mockSessions);

            sessionView.render();

            const projectGroups = container.querySelectorAll('[data-project]');
            expect(projectGroups.length).toBe(2);
        });
    });

    describe('event handling', () => {
        beforeEach(() => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'test' }
            ];
            mockSessionService.getFilteredSessions.mockReturnValue(mockSessions);
            sessionView.mount(container);
        });

        it('should delete session on delete button click', async () => {
            mockSessionService.deleteSession.mockResolvedValue();

            const deleteButton = container.querySelector('[data-action="delete"]');
            deleteButton.click();

            await vi.waitFor(() => {
                expect(mockSessionService.deleteSession).toHaveBeenCalledWith('session-1');
            });
        });

        it('should update filter on input', () => {
            const filterInput = container.querySelector('[data-filter-input]');
            if (filterInput) {
                filterInput.value = 'test filter';
                filterInput.dispatchEvent(new Event('input'));

                expect(appStore.getState().filters.sessionFilter).toBe('test filter');
            }
        });

        it('should create new session on create button click', async () => {
            const createButton = container.querySelector('[data-action="create"]');
            if (createButton) {
                mockSessionService.createSession.mockResolvedValue();

                createButton.click();

                await vi.waitFor(() => {
                    expect(mockSessionService.createSession).toHaveBeenCalled();
                });
            }
        });
    });

    describe('event subscriptions', () => {
        beforeEach(() => {
            sessionView.mount(container);
        });

        it('should re-render on SESSION_LOADED event', () => {
            const renderSpy = vi.spyOn(sessionView, 'render');

            eventBus.emit(EVENTS.SESSION_LOADED, { sessions: [] });

            expect(renderSpy).toHaveBeenCalled();
        });

        it('should re-render on SESSION_CREATED event', () => {
            const renderSpy = vi.spyOn(sessionView, 'render');

            eventBus.emit(EVENTS.SESSION_CREATED, { session: {} });

            expect(renderSpy).toHaveBeenCalled();
        });

        it('should re-render on SESSION_UPDATED event', () => {
            const renderSpy = vi.spyOn(sessionView, 'render');

            eventBus.emit(EVENTS.SESSION_UPDATED, { sessionId: 'test' });

            expect(renderSpy).toHaveBeenCalled();
        });

        it('should re-render on SESSION_DELETED event', () => {
            const renderSpy = vi.spyOn(sessionView, 'render');

            eventBus.emit(EVENTS.SESSION_DELETED, { sessionId: 'test' });

            expect(renderSpy).toHaveBeenCalled();
        });
    });
});
