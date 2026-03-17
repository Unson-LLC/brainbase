import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionView } from '../../../public/modules/ui/views/session-view.js';
import { SessionService } from '../../../public/modules/domain/session/session-service.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { appStore } from '../../../public/modules/core/store.js';

vi.mock('../../../public/modules/confirm-modal.js', () => ({
    showConfirm: vi.fn(async () => true),
    showConfirmWithAction: vi.fn(async () => true)
}));

vi.mock('../../../public/modules/toast.js', () => ({
    showError: vi.fn(),
    showInfo: vi.fn(),
    showSuccess: vi.fn()
}));

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
                this.pauseSession = vi.fn();
                this.resumeSession = vi.fn();
                this.archiveSession = vi.fn(async () => ({ success: true }));
                this.unarchiveSession = vi.fn();
                this.mergeSession = vi.fn(async () => ({ success: true }));
                this.switchSession = vi.fn(async () => ({ success: true }));
            }
        }
    };
});

describe('SessionView', () => {
    let sessionView;
    let mockSessionService;
    let mockCommitTreeService;
    let container;

    beforeEach(() => {
        // DOM準備
        document.body.innerHTML = `
            <div id="test-container"></div>
            <div id="menu-overlay" class="hidden"></div>
            <aside id="commit-tree-panel" class="commit-tree-panel is-collapsed" style="display: none;"></aside>
            <button id="commit-tree-expand-btn" type="button"></button>
        `;
        container = document.getElementById('test-container');
        const expandBtn = document.getElementById('commit-tree-expand-btn');
        const commitTreePanel = document.getElementById('commit-tree-panel');
        expandBtn.addEventListener('click', () => {
            commitTreePanel.classList.remove('is-collapsed');
            commitTreePanel.style.display = 'flex';
        });

        // window.confirm, window.prompt をモック
        global.confirm = vi.fn(() => true);
        global.prompt = vi.fn((message) => 'Test Session');

        // モックサービス
        mockSessionService = new SessionService();
        mockCommitTreeService = {
            loadCommitLog: vi.fn()
        };
        sessionView = new SessionView({
            sessionService: mockSessionService,
            commitTreeService: mockCommitTreeService
        });

        // ストア初期化
        appStore.setState({
            sessions: [],
            currentSessionId: null,
            filters: { sessionFilter: '', showArchivedSessions: false },
            ui: { sessionListView: 'timeline' }
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
                { id: 'session-1', name: 'Session 1', project: 'project-a', intendedState: 'active' },
                { id: 'session-2', name: 'Session 2', project: 'project-b', intendedState: 'active' }
            ];
            appStore.setState({ sessions: mockSessions });

            sessionView.render();

            const sessionElements = container.querySelectorAll('[data-id]');
            expect(sessionElements.length).toBe(2);
        });

        it('should render timeline list when sessionListView is timeline', () => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'project-a', intendedState: 'active' },
                { id: 'session-2', name: 'Session 2', project: 'project-b', intendedState: 'active' }
            ];
            appStore.setState({ sessions: mockSessions, ui: { sessionListView: 'timeline' } });

            sessionView.render();

            expect(container.querySelector('.session-timeline-list')).toBeTruthy();
        });

        it('should display empty state when no sessions', () => {
            appStore.setState({ sessions: [] });

            sessionView.render();

            expect(container.innerHTML).toContain('セッションがありません');
        });

        it('should highlight active session', () => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'test', intendedState: 'active' },
                { id: 'session-2', name: 'Session 2', project: 'test', intendedState: 'active' }
            ];
            appStore.setState({ sessions: mockSessions, currentSessionId: 'session-1' });

            sessionView.render();

            const activeElement = container.querySelector('[data-id="session-1"]');
            expect(activeElement.classList.contains('active')).toBe(true);
        });

        it('should group sessions by project', () => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'brainbase', intendedState: 'active', path: '.worktrees/session-1-brainbase' },
                { id: 'session-2', name: 'Session 2', project: 'brainbase', intendedState: 'active', path: '.worktrees/session-2-brainbase' },
                { id: 'session-3', name: 'Session 3', project: 'unson', intendedState: 'active', path: '.worktrees/session-3-unson' }
            ];
            appStore.setState({ sessions: mockSessions, ui: { sessionListView: 'project' } });

            sessionView.render();

            const projectGroups = container.querySelectorAll('.session-project-group');
            expect(projectGroups.length).toBe(2);
        });
    });

    describe('session group header', () => {
        beforeEach(() => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'brainbase', intendedState: 'active', path: '.worktrees/session-1-brainbase' },
                { id: 'session-2', name: 'Session 2', project: 'brainbase', intendedState: 'active', path: '.worktrees/session-2-brainbase' }
            ];
            appStore.setState({ sessions: mockSessions, ui: { sessionListView: 'project' } });
            sessionView.mount(container);
        });

        it('should render folder icon in group header', () => {
            const folderIcon = container.querySelector('.folder-icon');
            expect(folderIcon).toBeTruthy();
        });

        it('should render project title in group header', () => {
            const groupTitle = container.querySelector('.group-title');
            expect(groupTitle).toBeTruthy();
            expect(groupTitle.textContent).toBe('brainbase');
        });

        it('should render add session button in group header', () => {
            const addBtn = container.querySelector('.add-project-session-btn');
            expect(addBtn).toBeTruthy();
            expect(addBtn.dataset.project).toBe('brainbase');
        });

        it('should show folder-open icon when expanded', () => {
            // Default state should be expanded
            const groupHeader = container.querySelector('.session-group-header');
            expect(groupHeader.innerHTML).toContain('folder-open');
        });

        it('should create new session when add button clicked', async () => {
            const emitSpy = vi.spyOn(eventBus, 'emit');

            const addBtn = container.querySelector('.add-project-session-btn');
            addBtn.click();

            expect(emitSpy).toHaveBeenCalledWith(
                EVENTS.CREATE_SESSION,
                expect.objectContaining({
                    project: 'brainbase'
                })
            );
        });
    });

    describe('event handling', () => {
        beforeEach(() => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'test', intendedState: 'active' }
            ];
            appStore.setState({ sessions: mockSessions });
            sessionView.mount(container);
        });

        it('should delete session on delete button click', async () => {
            mockSessionService.deleteSession.mockResolvedValue();

            const deleteButton = container.querySelector('.delete-session-btn');
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

        it('should pause session from child actions', async () => {
            mockSessionService.pauseSession.mockResolvedValue();

            const pauseButton = container.querySelector('.child-actions .pause-session-btn');
            pauseButton.click();

            await vi.waitFor(() => {
                expect(mockSessionService.pauseSession).toHaveBeenCalledWith('session-1');
            });
        });

        it('should archive session from child actions', async () => {
            mockSessionService.archiveSession.mockResolvedValue({ success: true });

            const archiveButton = container.querySelector('.child-actions .archive-session-btn');
            archiveButton.click();

            await vi.waitFor(() => {
                expect(mockSessionService.archiveSession).toHaveBeenCalledWith('session-1');
            });
        });

        it('should pause session from dropdown actions', async () => {
            mockSessionService.pauseSession.mockResolvedValue();

            const pauseButton = container.querySelector('.session-dropdown-menu .pause-session-btn');
            pauseButton.click();

            await vi.waitFor(() => {
                expect(mockSessionService.pauseSession).toHaveBeenCalledWith('session-1');
            });
        });

        it('should expand commit tree panel from session action', async () => {
            mockSessionService.switchSession.mockResolvedValue({ success: true, sessionId: 'session-1' });

            const commitTreeButton = container.querySelector('.session-dropdown-menu .commit-tree-btn');
            commitTreeButton.click();

            await vi.waitFor(() => {
                expect(mockSessionService.switchSession).toHaveBeenCalledWith('session-1');
                expect(document.getElementById('commit-tree-panel').classList.contains('is-collapsed')).toBe(false);
            });
        });

        it('should refresh commit tree when clicking current session while panel is open', async () => {
            mockSessionService.switchSession.mockResolvedValue(null);
            const commitTreePanel = document.getElementById('commit-tree-panel');
            commitTreePanel.classList.remove('is-collapsed');
            commitTreePanel.style.display = 'flex';
            appStore.setState({
                sessions: [{ id: 'session-1', name: 'Session 1', project: 'test', intendedState: 'active' }],
                currentSessionId: 'session-1'
            });
            sessionView.render();

            const commitTreeButton = container.querySelector('.child-actions .commit-tree-btn');
            commitTreeButton.click();

            await vi.waitFor(() => {
                expect(mockCommitTreeService.loadCommitLog).toHaveBeenCalledWith('session-1');
            });
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
