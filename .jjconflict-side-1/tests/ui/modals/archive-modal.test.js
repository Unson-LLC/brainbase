import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArchiveModal } from '../../../public/modules/ui/modals/archive-modal.js';
import { SessionService } from '../../../public/modules/domain/session/session-service.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { appStore } from '../../../public/modules/core/store.js';

// SessionServiceをモック化
vi.mock('../../../public/modules/domain/session/session-service.js', () => {
    return {
        SessionService: class MockSessionService {
            constructor() {
                this.getArchivedSessions = vi.fn(() => []);
                this.unarchiveSession = vi.fn();
                this.deleteSession = vi.fn();
                this.getUniqueProjects = vi.fn(() => []);
            }
        }
    };
});

describe('ArchiveModal', () => {
    let modal;
    let mockSessionService;
    let modalElement;

    beforeEach(() => {
        // DOM準備
        document.body.innerHTML = `
            <div id="archive-modal" class="modal">
                <div class="modal-content modal-large">
                    <div class="modal-header">
                        <h3><i data-lucide="archive"></i> 過去のセッション</h3>
                        <button class="close-modal-btn"><i data-lucide="x"></i></button>
                    </div>
                    <div class="modal-body">
                        <div class="archive-filters">
                            <input type="text" id="archive-search" class="form-input" placeholder="セッション名で検索...">
                            <select id="archive-project-filter" class="form-input">
                                <option value="">すべてのプロジェクト</option>
                            </select>
                        </div>
                        <div id="archive-list" class="archive-list">
                            <!-- Archived sessions will be loaded here -->
                        </div>
                        <div id="archive-empty" class="archive-empty" style="display: none;">
                            <i data-lucide="inbox"></i>
                            <p>アーカイブされたセッションはありません</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        modalElement = document.getElementById('archive-modal');
        mockSessionService = new SessionService();
        modal = new ArchiveModal({ sessionService: mockSessionService });

        // ストア初期化
        appStore.setState({
            sessions: []
        });

        vi.clearAllMocks();
    });

    describe('initialization', () => {
        it('should initialize with modal element', () => {
            modal.mount();
            expect(modal.modalElement).toBe(modalElement);
        });

        it('should be initially hidden', () => {
            modal.mount();
            expect(modalElement.classList.contains('active')).toBe(false);
        });
    });

    describe('open', () => {
        beforeEach(() => {
            modal.mount();
        });

        it('should open modal', () => {
            modal.open();
            expect(modalElement.classList.contains('active')).toBe(true);
        });

        it('should populate project filter options from archived sessions', () => {
            const archivedSessions = [
                { id: 'session-1', name: 'Archived 1', project: 'brainbase', archived: true, path: '.worktrees/session-1-brainbase' },
                { id: 'session-2', name: 'Archived 2', project: 'unson', archived: true, path: '.worktrees/session-2-unson' }
            ];
            mockSessionService.getArchivedSessions.mockReturnValue(archivedSessions);

            modal.open();

            const projectFilter = document.getElementById('archive-project-filter');
            const options = Array.from(projectFilter.options).map(opt => opt.value);

            expect(options).toContain('brainbase');
            expect(options).toContain('unson');
        });

        it('should render archived sessions', () => {
            const archivedSessions = [
                { id: 'session-1', name: 'Archived 1', project: 'project-a', archived: true },
                { id: 'session-2', name: 'Archived 2', project: 'project-b', archived: true }
            ];
            mockSessionService.getArchivedSessions.mockReturnValue(archivedSessions);

            modal.open();

            const archiveList = document.getElementById('archive-list');
            expect(archiveList.innerHTML).toContain('Archived 1');
            expect(archiveList.innerHTML).toContain('Archived 2');
        });

        it('should display empty state when no archived sessions', () => {
            mockSessionService.getArchivedSessions.mockReturnValue([]);

            modal.open();

            const emptyState = document.getElementById('archive-empty');
            expect(emptyState.style.display).not.toBe('none');
        });

        it('should clear search input on open', () => {
            const searchInput = document.getElementById('archive-search');
            searchInput.value = 'previous search';

            modal.open();

            expect(searchInput.value).toBe('');
        });
    });

    describe('close', () => {
        beforeEach(() => {
            modal.mount();
        });

        it('should close modal', () => {
            modal.open();
            expect(modalElement.classList.contains('active')).toBe(true);

            modal.close();
            expect(modalElement.classList.contains('active')).toBe(false);
        });

        it('should close on X button click', () => {
            modal.open();

            const closeBtn = modalElement.querySelector('.close-modal-btn');
            closeBtn.click();

            expect(modalElement.classList.contains('active')).toBe(false);
        });

        it('should close on backdrop click', () => {
            modal.open();

            const event = new MouseEvent('click', { bubbles: true });
            Object.defineProperty(event, 'target', { value: modalElement });
            modalElement.dispatchEvent(event);

            expect(modalElement.classList.contains('active')).toBe(false);
        });
    });

    describe('search and filter', () => {
        beforeEach(() => {
            const allSessions = [
                { id: 'session-1', name: 'Test Session', project: 'brainbase', archived: true, path: '.worktrees/session-1-brainbase' },
                { id: 'session-2', name: 'Another Session', project: 'unson', archived: true, path: '.worktrees/session-2-unson' },
                { id: 'session-3', name: 'Test Task', project: 'brainbase', archived: true, path: '.worktrees/session-3-brainbase' }
            ];

            // ストアにセッションを設定
            appStore.setState({ sessions: allSessions });

            // モックが実際のフィルタリング処理を模倣するようにする
            mockSessionService.getArchivedSessions.mockImplementation((searchTerm = '', projectFilter = '') => {
                let filtered = allSessions.filter(s => s.archived);

                if (searchTerm) {
                    filtered = filtered.filter(s =>
                        s.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        s.project?.toLowerCase().includes(searchTerm.toLowerCase())
                    );
                }

                if (projectFilter) {
                    filtered = filtered.filter(s => s.project === projectFilter);
                }

                return filtered;
            });

            // getUniqueProjectsのモック
            mockSessionService.getUniqueProjects.mockReturnValue(['brainbase', 'unson']);

            modal.mount();
            modal.open();
        });

        it('should filter by search term', () => {
            const searchInput = document.getElementById('archive-search');
            searchInput.value = 'Test';
            searchInput.dispatchEvent(new Event('input'));

            const archiveList = document.getElementById('archive-list');
            expect(archiveList.innerHTML).toContain('Test Session');
            expect(archiveList.innerHTML).toContain('Test Task');
            expect(archiveList.innerHTML).not.toContain('Another Session');
        });

        it('should filter by project', () => {
            const projectFilter = document.getElementById('archive-project-filter');
            projectFilter.value = 'brainbase';
            projectFilter.dispatchEvent(new Event('change'));

            const archiveList = document.getElementById('archive-list');
            expect(archiveList.innerHTML).toContain('Test Session');
            expect(archiveList.innerHTML).toContain('Test Task');
            expect(archiveList.innerHTML).not.toContain('Another Session');
        });

        it('should filter by both search and project', () => {
            const searchInput = document.getElementById('archive-search');
            const projectFilter = document.getElementById('archive-project-filter');

            searchInput.value = 'Test';
            projectFilter.value = 'brainbase';
            searchInput.dispatchEvent(new Event('input'));

            const archiveList = document.getElementById('archive-list');
            expect(archiveList.innerHTML).toContain('Test Session');
            expect(archiveList.innerHTML).toContain('Test Task');
            expect(archiveList.innerHTML).not.toContain('Another Session');
        });
    });

    describe('unarchive session', () => {
        beforeEach(() => {
            const archivedSessions = [
                { id: 'session-1', name: 'Archived Session', project: 'project-a', archived: true }
            ];
            mockSessionService.getArchivedSessions.mockReturnValue(archivedSessions);
            modal.mount();
            modal.open();
        });

        it('should unarchive session on button click', async () => {
            mockSessionService.unarchiveSession.mockResolvedValue();

            const unarchiveBtn = modalElement.querySelector('[data-action="unarchive"]');
            unarchiveBtn.click();

            await vi.waitFor(() => {
                expect(mockSessionService.unarchiveSession).toHaveBeenCalledWith('session-1');
            });
        });
    });

    describe('delete session', () => {
        beforeEach(() => {
            const archivedSessions = [
                { id: 'session-1', name: 'Archived Session', project: 'project-a', archived: true }
            ];
            mockSessionService.getArchivedSessions.mockReturnValue(archivedSessions);
            modal.mount();
            modal.open();
        });

        it('should delete session on confirm', async () => {
            mockSessionService.deleteSession.mockResolvedValue();
            global.confirm = vi.fn(() => true);

            const deleteBtn = modalElement.querySelector('[data-action="delete"]');
            deleteBtn.click();

            await vi.waitFor(() => {
                expect(mockSessionService.deleteSession).toHaveBeenCalledWith('session-1');
            });
        });

        it('should not delete if user cancels', async () => {
            global.confirm = vi.fn(() => false);

            const deleteBtn = modalElement.querySelector('[data-action="delete"]');
            deleteBtn.click();

            await vi.waitFor(() => {
                expect(mockSessionService.deleteSession).not.toHaveBeenCalled();
            });
        });
    });

    describe('unmount', () => {
        it('should clean up event listeners', () => {
            modal.mount();
            modal.unmount();

            expect(() => modal.open()).not.toThrow();
        });
    });
});
