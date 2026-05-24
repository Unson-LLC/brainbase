import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionView } from '../../../public/modules/ui/views/session-view.js';
import { SessionService } from '../../../public/modules/domain/session/session-service.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { appStore } from '../../../public/modules/core/store.js';
import { __resetSessionIndicatorStateForTests, pollSessionStatus } from '../../../public/modules/session-indicators.js';
import { showSuccess } from '../../../public/modules/toast.js';

const mockSetSessionFavorite = vi.hoisted(() => vi.fn());

vi.mock('../../../public/modules/confirm-modal.js', () => ({
    showConfirm: vi.fn(async () => true)
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
                this.setSessionFavorite = mockSetSessionFavorite;
            }
        }
    };
});

describe('SessionView', () => {
    let sessionView;
    let mockSessionService;
    let container;

    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(callback, 0));
        vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));

        // DOM準備
        document.body.innerHTML = `
            <div id="test-container"></div>
            <div id="menu-overlay" class="hidden"></div>
        `;
        container = document.getElementById('test-container');

        // window.confirm, window.prompt をモック
        global.confirm = vi.fn(() => true);
        global.prompt = vi.fn((message) => 'Test Session');
        const storage = new Map();
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: {
                getItem: vi.fn((key) => storage.get(key) ?? null),
                setItem: vi.fn((key, value) => storage.set(key, String(value))),
                removeItem: vi.fn((key) => storage.delete(key)),
                clear: vi.fn(() => storage.clear())
            }
        });

        vi.clearAllMocks();

        // ストア初期化
        __resetSessionIndicatorStateForTests();
        appStore.setState({
            sessions: [],
            currentSessionId: null,
            sessionUi: { byId: {} },
            filters: { sessionFilter: '', showArchivedSessions: false },
            ui: { sessionListView: 'timeline' }
        });

        // モックサービス
        mockSessionService = new SessionService();
        mockSetSessionFavorite.mockImplementation(async (sessionId, favorite) => {
            const state = appStore.getState();
            appStore.setState({
                sessions: (state.sessions || []).map((session) =>
                    session.id === sessionId ? { ...session, favorite: favorite === true } : session
                )
            });
            return { success: true, sessionId, favorite: favorite === true };
        });
        sessionView = new SessionView({
            sessionService: mockSessionService
        });
    });

    afterEach(() => {
        sessionView?.unmount?.();
        delete window.__brainbaseSessionMenuDebug;
        vi.unstubAllGlobals();
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

        it('render時に開いていたセッションメニューと透明overlayを閉じる', () => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'project-a', intendedState: 'active' }
            ];
            appStore.setState({ sessions: mockSessions, ui: { sessionListView: 'timeline' } });
            sessionView.render();

            container.querySelector('[data-id="session-1"] .session-menu-toggle').click();

            expect(container.querySelector('.session-dropdown-menu').classList.contains('hidden')).toBe(false);
            expect(container.querySelector('[data-id="session-1"]').classList.contains('session-menu-open')).toBe(true);
            expect(document.getElementById('menu-overlay').classList.contains('hidden')).toBe(false);

            sessionView.render();

            expect(container.querySelector('.session-dropdown-menu').classList.contains('hidden')).toBe(true);
            expect(container.querySelector('[data-id="session-1"]').classList.contains('session-menu-open')).toBe(false);
            expect(document.getElementById('menu-overlay').classList.contains('hidden')).toBe(true);
        });

        it('セッションメニュー操作は開閉判定に必要な診断ログを残す', () => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'project-a', intendedState: 'active' }
            ];
            const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
            global.fetch = vi.fn(async () => ({ ok: true }));
            window.__brainbaseSessionMenuDebug = [];
            appStore.setState({ sessions: mockSessions, ui: { sessionListView: 'timeline' } });
            sessionView.render();

            const toggle = container.querySelector('[data-id="session-1"] .session-menu-toggle');
            toggle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
            toggle.click();

            const phases = window.__brainbaseSessionMenuDebug.map(entry => entry.phase);
            expect(phases).toContain('document-capture:pointerdown');
            expect(phases).toContain('toggle-pointerdown');
            expect(phases).toContain('toggle-pointerdown-before');
            expect(phases).toContain('toggle-pointerdown-opened-sync');
            expect(phases).toContain('document-capture:click');
            expect(phases).toContain('toggle-click-ignored-after-pointerdown');
            expect(window.__brainbaseSessionMenuDebug.at(-1)).toMatchObject({
                sessionId: 'session-1',
                dropdownMenu: { hidden: false },
                overlay: { hidden: false }
            });
            expect(consoleInfoSpy).toHaveBeenCalledWith(
                '[session-menu-debug]',
                expect.objectContaining({ phase: 'toggle-pointerdown-opened-sync', sessionId: 'session-1' })
            );
            expect(global.fetch).toHaveBeenCalledWith(
                '/api/client-diagnostics/session-menu',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    keepalive: true
                })
            );
        });

        it('clickが発火しないpointerdown/mousedownだけでもセッションメニューを開く', () => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'project-a', intendedState: 'active' }
            ];
            appStore.setState({ sessions: mockSessions, ui: { sessionListView: 'timeline' } });
            sessionView.render();

            const toggle = container.querySelector('[data-id="session-1"] .session-menu-toggle');
            toggle.dispatchEvent(new MouseEvent('pointerdown', {
                bubbles: true,
                button: 0,
                buttons: 1,
                clientX: 10,
                clientY: 10
            }));
            toggle.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true,
                button: 0,
                buttons: 1,
                clientX: 10,
                clientY: 10
            }));

            expect(container.querySelector('.session-dropdown-menu').classList.contains('hidden')).toBe(false);
            expect(container.querySelector('[data-id="session-1"]').classList.contains('session-menu-open')).toBe(true);
            expect(document.getElementById('menu-overlay').classList.contains('hidden')).toBe(false);
        });

        it('座標上はメニューボタンだがevent.targetが行になったpointerdownでもセッションメニューを開く', () => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'project-a', intendedState: 'active' }
            ];
            appStore.setState({ sessions: mockSessions, ui: { sessionListView: 'timeline' } });
            sessionView.render();

            const row = container.querySelector('[data-id="session-1"]');
            const toggle = row.querySelector('.session-menu-toggle');
            const originalElementFromPoint = document.elementFromPoint;
            document.elementFromPoint = vi.fn(() => toggle);

            try {
                row.dispatchEvent(new MouseEvent('pointerdown', {
                    bubbles: true,
                    cancelable: true,
                    button: 0,
                    buttons: 1,
                    clientX: 10,
                    clientY: 10
                }));
                row.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    button: 0,
                    buttons: 1,
                    clientX: 10,
                    clientY: 10
                }));

                expect(container.querySelector('.session-dropdown-menu').classList.contains('hidden')).toBe(false);
                expect(document.getElementById('menu-overlay').classList.contains('hidden')).toBe(false);
                expect(mockSessionService.switchSession).not.toHaveBeenCalled();
                expect(window.__brainbaseSessionMenuDebug.map(entry => entry.phase)).toContain('document-capture:hit-toggle-retarget');
            } finally {
                document.elementFromPoint = originalElementFromPoint;
            }
        });

        it('pointerdownで開いた後のclickが行targetにずれても行選択として閉じない', () => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'project-a', intendedState: 'active' }
            ];
            appStore.setState({ sessions: mockSessions, ui: { sessionListView: 'timeline' } });
            sessionView.render();

            const row = container.querySelector('[data-id="session-1"]');
            const toggle = row.querySelector('.session-menu-toggle');
            const originalElementFromPoint = document.elementFromPoint;
            document.elementFromPoint = vi.fn(() => toggle);

            try {
                toggle.dispatchEvent(new MouseEvent('pointerdown', {
                    bubbles: true,
                    cancelable: true,
                    button: 0,
                    buttons: 1,
                    clientX: 10,
                    clientY: 10
                }));
                row.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    button: 0,
                    buttons: 0,
                    clientX: 10,
                    clientY: 10
                }));

                expect(container.querySelector('.session-dropdown-menu').classList.contains('hidden')).toBe(false);
                expect(mockSessionService.switchSession).not.toHaveBeenCalled();
                expect(window.__brainbaseSessionMenuDebug.map(entry => entry.reason)).not.toContain('row-select');
            } finally {
                document.elementFromPoint = originalElementFromPoint;
            }
        });

        it('開いたセッションメニューは差分row更新で即閉じしない', async () => {
            const baseSession = {
                id: 'session-1',
                name: 'Session 1',
                project: 'project-a',
                intendedState: 'active',
                summary: { dirty: false, changesNotPushed: 0 }
            };
            appStore.setState({ sessions: [baseSession], ui: { sessionListView: 'timeline' } });
            sessionView.render();

            const toggle = container.querySelector('[data-id="session-1"] .session-menu-toggle');
            toggle.dispatchEvent(new MouseEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                button: 0,
                buttons: 1,
                clientX: 10,
                clientY: 10
            }));

            expect(container.querySelector('.session-dropdown-menu').classList.contains('hidden')).toBe(false);

            appStore.setState({
                sessions: [{
                    ...baseSession,
                    summary: { dirty: true, changesNotPushed: 1 }
                }]
            });
            sessionView._refreshSessionRows(['session-1']);
            await new Promise(resolve => setTimeout(resolve, 0));

            const refreshedRow = container.querySelector('[data-id="session-1"]');
            expect(refreshedRow.classList.contains('session-menu-open')).toBe(true);
            expect(refreshedRow.querySelector('.session-dropdown-menu').classList.contains('hidden')).toBe(false);
            expect(document.getElementById('menu-overlay').classList.contains('hidden')).toBe(false);
            expect(window.__brainbaseSessionMenuDebug.map(entry => entry.phase))
                .toContain('refresh-row-preserved-open-menu');
        });

        it('アーカイブクリック時_即時統合分岐ではなくfinalizer queuedとして処理開始を表示する', async () => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'project-a', intendedState: 'active' }
            ];
            mockSessionService.archiveSession.mockResolvedValue({ success: true, archive: { status: 'queued' } });
            appStore.setState({ sessions: mockSessions, ui: { sessionListView: 'timeline' } });
            sessionView.render();

            container.querySelector('[data-id="session-1"] .archive-session-btn').click();
            await Promise.resolve();

            expect(mockSessionService.archiveSession).toHaveBeenCalledWith('session-1');
            expect(mockSessionService.mergeSession).not.toHaveBeenCalled();
            expect(showSuccess).toHaveBeenCalledWith('セッション「Session 1」のアーカイブ処理を開始しました');
        });

        it('/api/sessions/statusのworking状態をsessionUi経由でtimeline sortへ反映する', async () => {
            const mockSessions = [
                {
                    id: 'session-working',
                    name: 'Old Working',
                    project: 'brainbase',
                    intendedState: 'active',
                    lastAccessedAt: '2026-05-01T00:00:00.000Z'
                },
                {
                    id: 'session-done',
                    name: 'Done Signal',
                    project: 'brainbase',
                    intendedState: 'active',
                    lastAccessedAt: '2026-05-02T00:00:00.000Z'
                },
                {
                    id: 'session-idle',
                    name: 'Newest Idle',
                    project: 'brainbase',
                    intendedState: 'active',
                    lastAccessedAt: '2026-05-03T00:00:00.000Z'
                }
            ];
            appStore.setState({ sessions: mockSessions, ui: { sessionListView: 'timeline' } });
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    'session-working': {
                        isWorking: true,
                        isDone: false,
                        lastWorkingAt: 100,
                        lastDoneAt: 0,
                        lastActivityAt: 100,
                        lastEventType: 'tmux-pane-title-spinner',
                        activeTurnCount: 1,
                        timestamp: 100
                    },
                    'session-done': {
                        isWorking: false,
                        isDone: true,
                        lastWorkingAt: 0,
                        lastDoneAt: 200,
                        lastActivityAt: 200,
                        lastEventType: 'agent-turn-complete',
                        activeTurnCount: 0,
                        timestamp: 200
                    }
                })
            });

            sessionView.render();
            expect([...container.querySelectorAll('.session-child-row')].map(row => row.dataset.id)).toEqual([
                'session-idle',
                'session-done',
                'session-working'
            ]);

            await pollSessionStatus('session-idle');

            await vi.waitFor(() => {
                expect([...container.querySelectorAll('.session-child-row')].map(row => row.dataset.id)).toEqual([
                    'session-working',
                    'session-done',
                    'session-idle'
                ]);
            });
            expect(container.querySelector('[data-id="session-working"] .session-activity-indicator')?.className)
                .toContain('working');
            expect(container.querySelector('[data-id="session-done"] .session-activity-indicator')?.className)
                .toContain('done');
            expect(container.querySelector('[data-id="session-idle"] .session-activity-indicator')?.className)
                .toContain('idle');
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

        it('should update active session when currentSessionId changes', async () => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'test', intendedState: 'active' },
                { id: 'session-2', name: 'Session 2', project: 'test', intendedState: 'active' }
            ];
            appStore.setState({
                sessions: mockSessions,
                currentSessionId: 'session-1',
                ui: { sidebarPrimaryView: 'sessions', sessionListView: 'timeline' }
            });

            sessionView.render();
            appStore.setState({ currentSessionId: 'session-2' });

            await vi.waitFor(() => {
                expect(container.querySelector('[data-id="session-2"]')?.classList.contains('active')).toBe(true);
            });
            expect(container.querySelector('[data-id="session-1"]')?.classList.contains('active')).toBe(false);
        });

        it('should restore active session styling when file viewer closes without changing currentSessionId', async () => {
            const mockSessions = [
                { id: 'session-1', name: 'Session 1', project: 'test', intendedState: 'active' },
                { id: 'session-2', name: 'Session 2', project: 'test', intendedState: 'active' }
            ];
            appStore.setState({
                sessions: mockSessions,
                currentSessionId: 'session-1',
                fileViewer: {
                    sessionId: 'session-1',
                    relativePath: 'README.md',
                    fileName: 'README.md',
                    content: '# Hello',
                    loading: false,
                    error: null
                },
                ui: { sidebarPrimaryView: 'sessions', sessionListView: 'timeline' }
            });

            sessionView.render();

            const activeRow = container.querySelector('[data-id="session-1"]');
            activeRow.classList.remove('active');

            appStore.setState({ fileViewer: null });

            await vi.waitFor(() => {
                expect(container.querySelector('[data-id="session-1"]')?.classList.contains('active')).toBe(true);
            });
            expect(appStore.getState().currentSessionId).toBe('session-1');
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

        it('should filter sessions from the session list search box', () => {
            const mockSessions = [
                { id: 'session-1', name: 'Brainbase Design', project: 'brainbase', intendedState: 'active' },
                { id: 'session-2', name: 'Sales Ops', project: 'salestailor', intendedState: 'active' }
            ];
            appStore.setState({ sessions: mockSessions, ui: { sessionListView: 'timeline' } });

            sessionView.render();
            const input = container.querySelector('.session-search-input');
            input.value = 'design';
            input.dispatchEvent(new Event('input', { bubbles: true }));

            expect([...container.querySelectorAll('.session-child-row')].map(row => row.dataset.id)).toEqual(['session-1']);
        });

        it('should keep the search input mounted while Japanese IME composition is active', () => {
            const mockSessions = [
                { id: 'session-kana', name: 'かきくけこ', project: 'brainbase', intendedState: 'active' },
                { id: 'session-alpha', name: 'Alpha', project: 'brainbase', intendedState: 'active' }
            ];
            appStore.setState({ sessions: mockSessions, ui: { sessionListView: 'timeline' } });

            sessionView.render();
            const input = container.querySelector('.session-search-input');
            input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
            input.value = 'k';
            input.dispatchEvent(new Event('input', { bubbles: true }));

            expect(container.querySelector('.session-search-input')).toBe(input);
            expect(sessionView.sessionSearchQuery).toBe('');
            expect([...container.querySelectorAll('.session-child-row')].map(row => row.dataset.id)).toEqual([
                'session-kana',
                'session-alpha'
            ]);

            input.value = 'か';
            input.dispatchEvent(new Event('compositionend', { bubbles: true }));

            expect(sessionView.sessionSearchQuery).toBe('か');
            expect([...container.querySelectorAll('.session-child-row')].map(row => row.dataset.id)).toEqual(['session-kana']);
        });

        it('should favorite sessions on the server state and pin them above normal sessions', () => {
            const mockSessions = [
                {
                    id: 'session-old',
                    name: 'Old Favorite',
                    project: 'brainbase',
                    intendedState: 'active',
                    createdAt: '2026-03-17T00:00:00.000Z'
                },
                {
                    id: 'session-new',
                    name: 'New Normal',
                    project: 'brainbase',
                    intendedState: 'active',
                    createdAt: '2026-03-17T00:00:01.000Z'
                }
            ];
            appStore.setState({ sessions: mockSessions, ui: { sessionListView: 'timeline' } });

            sessionView.render();
            expect([...container.querySelectorAll('.session-child-row')].map(row => row.dataset.id)).toEqual([
                'session-new',
                'session-old'
            ]);

            container.querySelector('[data-id="session-old"] .session-menu-toggle').click();
            expect(document.getElementById('menu-overlay')?.classList.contains('hidden')).toBe(false);
            container.querySelector('[data-id="session-old"] .favorite-session-btn').click();

            expect([...container.querySelectorAll('.session-child-row')].map(row => row.dataset.id)).toEqual([
                'session-old',
                'session-new'
            ]);
            expect(container.querySelector('[data-id="session-old"] .favorite-session-btn')?.getAttribute('aria-pressed')).toBe('true');
            expect(document.getElementById('menu-overlay')?.classList.contains('hidden')).toBe(true);
            expect(mockSessionService.setSessionFavorite).toHaveBeenCalledWith('session-old', true);
            expect((appStore.getState().sessions || []).find((session) => session.id === 'session-old')?.favorite).toBe(true);
            expect(window.localStorage.getItem('brainbase.sessionFavorites.v1')).toBeNull();
        });

        it('should migrate legacy localStorage favorites to server state', async () => {
            window.localStorage.setItem('brainbase.sessionFavorites.v1', JSON.stringify(['session-legacy']));
            sessionView = new SessionView({
                sessionService: mockSessionService
            });
            sessionView.mount(container);

            appStore.setState({
                sessions: [
                    { id: 'session-legacy', name: 'Legacy Favorite', project: 'brainbase', intendedState: 'active' }
                ],
                ui: { sessionListView: 'timeline' }
            });

            sessionView.render();
            await Promise.resolve();
            await Promise.resolve();

            expect(mockSessionService.setSessionFavorite).toHaveBeenCalledWith('session-legacy', true);
            expect(window.localStorage.getItem('brainbase.sessionFavorites.v1')).toBeNull();
        });

        it('should show only favorite sessions when the favorite filter is enabled', () => {
            const mockSessions = [
                { id: 'session-favorite', name: 'Favorite', project: 'brainbase', intendedState: 'active' },
                { id: 'session-normal', name: 'Normal', project: 'brainbase', intendedState: 'active' }
            ];
            appStore.setState({ sessions: mockSessions, ui: { sessionListView: 'timeline' } });

            sessionView.render();
            container.querySelector('[data-id="session-favorite"] .favorite-session-btn').click();
            container.querySelector('.session-favorites-filter-btn').click();

            expect([...container.querySelectorAll('.session-child-row')].map(row => row.dataset.id)).toEqual([
                'session-favorite'
            ]);
            expect(container.querySelector('.session-favorites-filter-btn')?.getAttribute('aria-pressed')).toBe('true');
        });

        it('should exclude archived favorites from the favorite badge and filter results', () => {
            const mockSessions = [
                { id: 'session-favorite', name: 'Favorite', project: 'brainbase', intendedState: 'active', favorite: true },
                { id: 'session-archived-favorite', name: 'Archived Favorite', project: 'brainbase', intendedState: 'archived', favorite: true },
                { id: 'session-normal', name: 'Normal', project: 'brainbase', intendedState: 'active' }
            ];
            appStore.setState({ sessions: mockSessions, ui: { sessionListView: 'timeline' } });

            sessionView.render();

            expect(container.querySelector('.session-favorites-count')?.textContent).toBe('1');

            container.querySelector('.session-favorites-filter-btn').click();

            expect([...container.querySelectorAll('.session-child-row')].map(row => row.dataset.id)).toEqual([
                'session-favorite'
            ]);
            expect(container.textContent).not.toContain('Archived Favorite');
        });

        it('should refresh cloned mobile session list after favorite actions and filter taps', () => {
            const mockSessions = [
                {
                    id: 'session-old',
                    name: 'Old Favorite',
                    project: 'brainbase',
                    intendedState: 'active',
                    createdAt: '2026-03-17T00:00:00.000Z'
                },
                {
                    id: 'session-new',
                    name: 'New Normal',
                    project: 'brainbase',
                    intendedState: 'active',
                    createdAt: '2026-03-17T00:00:01.000Z'
                }
            ];
            appStore.setState({ sessions: mockSessions, ui: { sessionListView: 'timeline' } });
            sessionView.render();

            const mobileContainer = document.createElement('div');
            document.body.appendChild(mobileContainer);
            const syncMobileList = () => {
                mobileContainer.innerHTML = container.innerHTML;
                sessionView.attachToolbarHandlersToContainer(mobileContainer, {
                    afterRender: syncMobileList,
                    focusRoot: () => mobileContainer
                });
                sessionView.attachActionHandlersToContainer(mobileContainer, {
                    enableDrag: false,
                    afterRender: syncMobileList
                });
            };
            syncMobileList();

            expect([...mobileContainer.querySelectorAll('.session-child-row')].map(row => row.dataset.id)).toEqual([
                'session-new',
                'session-old'
            ]);

            mobileContainer.querySelector('[data-id="session-old"] .session-menu-toggle').click();
            mobileContainer.querySelector('[data-id="session-old"] .favorite-session-btn').click();

            expect([...mobileContainer.querySelectorAll('.session-child-row')].map(row => row.dataset.id)).toEqual([
                'session-old',
                'session-new'
            ]);
            expect(mobileContainer.querySelector('[data-id="session-old"] .favorite-session-btn')?.getAttribute('aria-pressed'))
                .toBe('true');

            mobileContainer.querySelector('.session-favorites-filter-btn').click();
            expect([...mobileContainer.querySelectorAll('.session-child-row')].map(row => row.dataset.id)).toEqual([
                'session-old'
            ]);
            expect(mobileContainer.querySelector('.session-favorites-filter-btn')?.getAttribute('aria-pressed')).toBe('true');
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

        it('should not render legacy pause actions in the session list', () => {
            expect(container.querySelector('.session-dropdown-menu .pause-session-btn')).toBeNull();
            expect(container.textContent).not.toContain('一時停止');
        });

        it('should close menus and switch session on row click', async () => {
            const closeMenusSpy = vi.spyOn(sessionView, '_closeAllMenus');
            const row = container.querySelector('.session-child-row');

            row.click();

            await vi.waitFor(() => {
                expect(closeMenusSpy).toHaveBeenCalled();
                expect(mockSessionService.switchSession).toHaveBeenCalledWith('session-1');
            });
        });

        it('should not switch session when drag handle is clicked', async () => {
            const dragHandle = container.querySelector('.drag-handle');

            dragHandle.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            await new Promise(resolve => queueMicrotask(resolve));
            expect(mockSessionService.switchSession).not.toHaveBeenCalled();
        });

        it('should attach dragstart and dragend to drag handle only', () => {
            appStore.setState({
                sessions: [
                    { id: 'session-1', name: 'Session 1', project: 'test', intendedState: 'active' }
                ],
                ui: { sessionListView: 'project' }
            });
            sessionView.render();

            const row = container.querySelector('.session-child-row');
            const dragHandle = row.querySelector('.drag-handle');
            const dragStartDataTransfer = {
                effectAllowed: '',
                setData: vi.fn(),
                setDragImage: vi.fn()
            };
            const dragStartEvent = new Event('dragstart', { bubbles: true });
            Object.defineProperty(dragStartEvent, 'dataTransfer', {
                value: dragStartDataTransfer
            });

            dragHandle.dispatchEvent(dragStartEvent);

            expect(sessionView.draggedSessionId).toBe('session-1');
            expect(row.classList.contains('dragging')).toBe(true);
            expect(dragStartDataTransfer.effectAllowed).toBe('move');
            expect(dragStartDataTransfer.setData).toHaveBeenCalledWith('text/plain', 'session-1');
            expect(dragStartDataTransfer.setDragImage).toHaveBeenCalledWith(row, 0, 0);

            const dragEndEvent = new Event('dragend', { bubbles: true });
            dragHandle.dispatchEvent(dragEndEvent);

            expect(sessionView.draggedSessionId).toBeNull();
            expect(row.classList.contains('dragging')).toBe(false);
        });
    });

    describe('event subscriptions', () => {
        beforeEach(() => {
            sessionView.mount(container);
        });

        it('should schedule re-render on SESSION_LOADED event', async () => {
            const scheduleSpy = vi.spyOn(sessionView, '_scheduleRender');

            await eventBus.emit(EVENTS.SESSION_LOADED, { sessions: [] });

            expect(scheduleSpy).toHaveBeenCalled();
        });

        it('should schedule re-render on SESSION_CREATED event', async () => {
            const scheduleSpy = vi.spyOn(sessionView, '_scheduleRender');

            await eventBus.emit(EVENTS.SESSION_CREATED, { session: {} });

            expect(scheduleSpy).toHaveBeenCalled();
        });

        it('should schedule re-render on SESSION_UPDATED event', async () => {
            const scheduleSpy = vi.spyOn(sessionView, '_scheduleRender');

            await eventBus.emit(EVENTS.SESSION_UPDATED, { sessionId: 'test' });

            expect(scheduleSpy).toHaveBeenCalled();
        });

        it('should schedule re-render on SESSION_DELETED event', async () => {
            const scheduleSpy = vi.spyOn(sessionView, '_scheduleRender');

            await eventBus.emit(EVENTS.SESSION_DELETED, { sessionId: 'test' });

            expect(scheduleSpy).toHaveBeenCalled();
        });

        it('should sort done-unread sessions to the top in timeline view', async () => {
            appStore.setState({
                sessions: [
                    {
                        id: 'session-1',
                        name: 'Session 1',
                        project: 'test',
                        intendedState: 'active',
                        createdAt: '2026-03-17T00:00:00.000Z',
                        updatedAt: '2026-03-17T00:10:00.000Z'
                    },
                    {
                        id: 'session-2',
                        name: 'Session 2',
                        project: 'test',
                        intendedState: 'active',
                        createdAt: '2026-03-17T00:00:01.000Z',
                        updatedAt: '2026-03-17T00:00:01.000Z'
                    }
                ],
                ui: {
                    sessionListView: 'timeline'
                },
                sessionUi: {
                    byId: {
                        'session-1': { hookStatus: null },
                        'session-2': { hookStatus: null }
                    }
                }
            });
            sessionView.render();

            const before = Array.from(container.querySelectorAll('.session-child-row')).map((row) => row.dataset.id);
            expect(before).toEqual(['session-2', 'session-1']);

            appStore.setState({
                sessionUi: {
                    byId: {
                        'session-1': { hookStatus: { isDone: true } },
                        'session-2': { hookStatus: null }
                    }
                }
            });

            sessionView.render();

            const after = Array.from(container.querySelectorAll('.session-child-row')).map((row) => row.dataset.id);
            expect(after).toEqual(['session-1', 'session-2']);
        });

        it('should keep timeline order when a green done session is marked read', async () => {
            appStore.setState({
                sessions: [
                    {
                        id: 'session-1',
                        name: 'Older Done',
                        project: 'test',
                        intendedState: 'active',
                        createdAt: '2026-03-17T00:00:00.000Z'
                    },
                    {
                        id: 'session-2',
                        name: 'Newer Idle',
                        project: 'test',
                        intendedState: 'active',
                        createdAt: '2026-03-17T00:00:04.000Z'
                    }
                ],
                ui: {
                    sessionListView: 'timeline'
                },
                sessionUi: {
                    byId: {
                        'session-1': {
                            hookStatus: {
                                isDone: true,
                                isWorking: false,
                                lastDoneAt: Date.parse('2026-03-17T00:00:05.000Z')
                            }
                        },
                        'session-2': { hookStatus: null }
                    }
                }
            });
            sessionView.render();

            const beforeRead = Array.from(container.querySelectorAll('.session-child-row')).map((row) => row.dataset.id);
            expect(beforeRead).toEqual(['session-1', 'session-2']);

            appStore.setState({
                sessionUi: {
                    byId: {
                        'session-1': { hookStatus: null },
                        'session-2': { hookStatus: null }
                    }
                }
            });
            sessionView.render();

            const afterRead = Array.from(container.querySelectorAll('.session-child-row')).map((row) => row.dataset.id);
            expect(afterRead).toEqual(['session-1', 'session-2']);
            expect(container.querySelector('[data-id="session-1"] .session-activity-indicator')?.className)
                .not.toContain('done');
        });

        it('should promote sessions from working heartbeat in timeline view', async () => {
            appStore.setState({
                sessions: [
                    {
                        id: 'session-1',
                        name: 'Session 1',
                        project: 'test',
                        intendedState: 'active',
                        createdAt: '2026-03-17T00:00:00.000Z',
                        updatedAt: '2026-03-17T00:10:00.000Z'
                    },
                    {
                        id: 'session-2',
                        name: 'Session 2',
                        project: 'test',
                        intendedState: 'active',
                        createdAt: '2026-03-17T00:00:01.000Z',
                        updatedAt: '2026-03-17T00:00:01.000Z'
                    }
                ],
                ui: {
                    sessionListView: 'timeline'
                },
                sessionUi: {
                    byId: {
                        'session-1': { hookStatus: null },
                        'session-2': { hookStatus: null }
                    }
                }
            });
            sessionView.render();

            const before = Array.from(container.querySelectorAll('.session-child-row')).map((row) => row.dataset.id);
            expect(before).toEqual(['session-2', 'session-1']);

            appStore.setState({
                sessionUi: {
                    byId: {
                        'session-1': {
                            hookStatus: {
                                isWorking: true,
                                lastWorkingAt: Date.parse('2026-03-17T00:00:02.000Z')
                            }
                        },
                        'session-2': { hookStatus: null }
                    }
                }
            });

            sessionView.render();

            const after = Array.from(container.querySelectorAll('.session-child-row')).map((row) => row.dataset.id);
            expect(after).toEqual(['session-1', 'session-2']);
        });

        it('S-1: should sort active thinking sessions to the top in timeline view', async () => {
            appStore.setState({
                sessions: [
                    {
                        id: 'session-1',
                        name: 'Session 1',
                        project: 'test',
                        intendedState: 'active',
                        createdAt: '2026-03-17T00:00:00.000Z',
                        updatedAt: '2026-03-17T00:10:00.000Z'
                    },
                    {
                        id: 'session-2',
                        name: 'Session 2',
                        project: 'test',
                        intendedState: 'active',
                        createdAt: '2026-03-17T00:00:01.000Z',
                        updatedAt: '2026-03-17T00:00:01.000Z'
                    }
                ],
                ui: {
                    sessionListView: 'timeline'
                },
                sessionUi: {
                    byId: {
                        'session-1': {
                            hookStatus: {
                                isWorking: true,
                                isDone: false,
                                activeTurnCount: 1,
                                lastWorkingAt: Date.parse('2026-03-17T00:00:02.000Z')
                            }
                        },
                        'session-2': { hookStatus: null }
                    }
                }
            });

            sessionView.render();

            const after = Array.from(container.querySelectorAll('.session-child-row')).map((row) => row.dataset.id);
            expect(after).toEqual(['session-1', 'session-2']);
        });

        it('should sort active working sessions to the top in timeline view', async () => {
            appStore.setState({
                sessions: [
                    {
                        id: 'session-1',
                        name: 'Older Working',
                        project: 'test',
                        intendedState: 'active',
                        createdAt: '2026-03-17T00:00:00.000Z',
                        updatedAt: '2026-03-17T00:00:00.000Z'
                    },
                    {
                        id: 'session-2',
                        name: 'Newer Idle',
                        project: 'test',
                        intendedState: 'active',
                        createdAt: '2026-03-17T00:00:01.000Z',
                        updatedAt: '2026-03-17T00:00:01.000Z'
                    }
                ],
                ui: {
                    sessionListView: 'timeline'
                },
                sessionUi: {
                    byId: {
                        'session-1': {
                            hookStatus: {
                                isWorking: true,
                                isDone: false,
                                activeTurnCount: 0,
                                lastWorkingAt: Date.parse('2026-03-17T00:00:02.000Z')
                            }
                        },
                        'session-2': { hookStatus: null }
                    }
                }
            });

            sessionView.render();

            const after = Array.from(container.querySelectorAll('.session-child-row')).map((row) => row.dataset.id);
            expect(after).toEqual(['session-1', 'session-2']);
        });

        it('should sort active thinking sessions to the top in timeline view', async () => {
            appStore.setState({
                sessions: [
                    {
                        id: 'session-1',
                        name: 'Session 1',
                        project: 'test',
                        intendedState: 'active',
                        createdAt: '2026-03-17T00:00:00.000Z',
                        updatedAt: '2026-03-17T00:10:00.000Z'
                    },
                    {
                        id: 'session-2',
                        name: 'Session 2',
                        project: 'test',
                        intendedState: 'active',
                        createdAt: '2026-03-17T00:00:01.000Z',
                        updatedAt: '2026-03-17T00:00:01.000Z'
                    }
                ],
                ui: {
                    sessionListView: 'timeline'
                },
                sessionUi: {
                    byId: {
                        'session-1': {
                            hookStatus: {
                                isWorking: true,
                                isDone: false,
                                activeTurnCount: 1,
                                lastWorkingAt: Date.parse('2026-03-17T00:00:02.000Z')
                            }
                        },
                        'session-2': { hookStatus: null }
                    }
                }
            });

            sessionView.render();

            const after = Array.from(container.querySelectorAll('.session-child-row')).map((row) => row.dataset.id);
            expect(after).toEqual(['session-1', 'session-2']);
        });

        it('should promote sessions with new assistant output in timeline view', async () => {
            appStore.setState({
                sessions: [
                    {
                        id: 'session-1',
                        name: 'Session 1',
                        project: 'test',
                        intendedState: 'active',
                        createdAt: '2026-03-17T00:00:00.000Z',
                        updatedAt: '2026-03-17T00:10:00.000Z'
                    },
                    {
                        id: 'session-2',
                        name: 'Session 2',
                        project: 'test',
                        intendedState: 'active',
                        createdAt: '2026-03-17T00:00:01.000Z',
                        updatedAt: '2026-03-17T00:00:01.000Z'
                    }
                ],
                ui: {
                    sessionListView: 'timeline'
                },
                sessionUi: {
                    byId: {
                        'session-1': {
                            hookStatus: {
                                isWorking: true,
                                liveActivity: {
                                    assistantSnippetUpdatedAt: Date.parse('2026-03-17T00:00:02.000Z')
                                }
                            }
                        },
                        'session-2': { hookStatus: null }
                    }
                }
            });

            sessionView.render();

            const after = Array.from(container.querySelectorAll('.session-child-row')).map((row) => row.dataset.id);
            expect(after).toEqual(['session-1', 'session-2']);
        });

        it('should do differential update (refresh + reorder) on SESSION_UI_STATE_CHANGED in timeline view', async () => {
            appStore.setState({
                ui: {
                    sessionListView: 'timeline'
                }
            });
            await new Promise(resolve => queueMicrotask(resolve));
            const refreshSpy = vi.spyOn(sessionView, '_refreshSessionRows');
            const reorderSpy = vi.spyOn(sessionView, '_reorderTimelineRows');
            const scheduleSpy = vi.spyOn(sessionView, '_scheduleRender');

            await eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, { sessionIds: ['session-1'] });

            expect(refreshSpy).toHaveBeenCalledWith(['session-1']);
            expect(reorderSpy).toHaveBeenCalled();
            expect(scheduleSpy).not.toHaveBeenCalled();
        });

        it('should only refresh affected rows on SESSION_UI_STATE_CHANGED in project view', async () => {
            appStore.setState({
                sessions: [
                    { id: 'session-1', name: 'Session 1', project: 'test', intendedState: 'active' }
                ],
                ui: {
                    sessionListView: 'project'
                }
            });
            sessionView.render();

            // Drain any pending microtasks from setState subscriptions before setting up spy
            await new Promise(resolve => queueMicrotask(resolve));
            const renderSpy = vi.spyOn(sessionView, 'render');

            await eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, { sessionIds: ['session-1'] });
            await new Promise(resolve => queueMicrotask(resolve));

            expect(renderSpy).not.toHaveBeenCalled();
        });
    });
});
