import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { groupSessionsByProject } from '../../session-manager.js';
import { getProjectFromSession } from '../../project-mapping.js';
import { renderSessionGroupHeaderHTML, renderSessionRowHTML } from '../../session-list-renderer.js';
import { updateSessionIndicators } from '../../session-indicators.js';
import { escapeHtml } from '../../ui-helpers.js';

/**
 * セッション表示のUIコンポーネント
 * 現行版と同じ構造でプロジェクトグループ表示
 */
export class SessionView {
    constructor({ sessionService }) {
        this.sessionService = sessionService;
        this.container = null;
        this._unsubscribers = [];
        // Drag and drop state
        this.draggedSessionId = null;
        this.draggedSessionProject = null;
    }

    /**
     * DOMコンテナにマウント
     * @param {HTMLElement} container - マウント先のコンテナ
     */
    mount(container) {
        this.container = container;
        this._setupEventListeners();
        this.render();
    }

    /**
     * イベントリスナーの設定
     */
    _setupEventListeners() {
        // イベント購読
        const unsub1 = eventBus.on(EVENTS.SESSION_LOADED, () => this.render());
        const unsub2 = eventBus.on(EVENTS.SESSION_CREATED, () => this.render());
        const unsub3 = eventBus.on(EVENTS.SESSION_UPDATED, () => this.render());
        const unsub4 = eventBus.on(EVENTS.SESSION_DELETED, () => this.render());
        const unsub5 = eventBus.on(EVENTS.SESSION_PAUSED, () => this.render());
        const unsub6 = eventBus.on(EVENTS.SESSION_RESUMED, () => this.render());
        const unsub7 = appStore.subscribeToSelector(
            state => state.ui?.sessionListView,
            () => this.render()
        );

        this._unsubscribers.push(unsub1, unsub2, unsub3, unsub4, unsub5, unsub6, unsub7);

        // ドロップダウンメニューの外側クリックで閉じる処理（document全体で1回のみ）
        this._outsideClickHandler = (e) => {
            // クリックされた要素がメニュートグルまたはドロップダウン内かチェック
            const isMenuToggle = e.target.closest('.session-menu-toggle');
            const isDropdownMenu = e.target.closest('.session-dropdown-menu');

            // どちらでもない場合、すべてのメニューを閉じる
            if (!isMenuToggle && !isDropdownMenu) {
                this._closeAllMenus();
            }
        };
        document.addEventListener('click', this._outsideClickHandler);

        // iframe上のオーバーレイクリックでメニューを閉じる
        const menuOverlay = document.getElementById('menu-overlay');
        if (menuOverlay) {
            menuOverlay.addEventListener('click', () => {
                this._closeAllMenus();
            });
        }
    }

    /**
     * すべてのドロップダウンメニューを閉じる
     */
    _closeAllMenus() {
        document.querySelectorAll('.session-dropdown-menu').forEach(menu => {
            menu.classList.add('hidden');
        });
        // オーバーレイを非表示
        const menuOverlay = document.getElementById('menu-overlay');
        if (menuOverlay) {
            menuOverlay.classList.add('hidden');
        }
    }

    /**
     * セッションリストをレンダリング（状態別セクション構造）
     */
    render() {
        if (!this.container) return;

        // Clear container
        this.container.innerHTML = '';

        const { sessions, currentSessionId, ui } = appStore.getState();
        const sessionListView = ui?.sessionListView || 'project';

        if (!sessions || sessions.length === 0) {
            this.container.innerHTML = '<div class="empty-state">セッションがありません</div>';
            return;
        }

        if (sessionListView === 'timeline') {
            const timelineList = this._renderTimelineList(sessions, currentSessionId);
            this.container.appendChild(timelineList);
        } else {
            // 状態別にセッションを分類（アーカイブを除く）
            const activeSessions = sessions.filter(s =>
                s.intendedState !== 'archived' &&
                s.intendedState !== 'paused' &&
                (!s.intendedState || s.intendedState === 'active')
            );
            const pausedSessions = sessions.filter(s => s.intendedState === 'paused');

            // 作業中セクション
            if (activeSessions.length > 0) {
                const workingSection = this._renderSection('作業中', activeSessions, currentSessionId, true);
                this.container.appendChild(workingSection);
            }

            // 一時停止セクション
            if (pausedSessions.length > 0) {
                const pausedSection = this._renderSection('一時停止', pausedSessions, currentSessionId, false);
                this.container.appendChild(pausedSection);
            }
        }

        // Lucideアイコンを初期化
        if (window.lucide) {
            window.lucide.createIcons();
        }

        // セッションインジケーターを更新（緑・オレンジのステータス表示）
        updateSessionIndicators(currentSessionId);
    }

    /**
     * 時系列リストをレンダリング
     * @private
     */
    _renderTimelineList(sessions, currentSessionId) {
        const listDiv = document.createElement('div');
        listDiv.className = 'session-timeline-list';

        const timelineSessions = this._getTimelineSessions(sessions);

        timelineSessions.forEach(session => {
            const project = getProjectFromSession(session);
            const wrapper = document.createElement('div');
            wrapper.innerHTML = renderSessionRowHTML(session, {
                isActive: currentSessionId === session.id,
                project,
                showProjectEmoji: true,
                isDraggable: false
            });
            const childRow = wrapper.firstElementChild;

            childRow.addEventListener('click', async (e) => {
                if (!e.target.closest('button')) {
                    const sessionId = childRow.dataset.id;
                    if (sessionId) {
                        await this.sessionService.switchSession(sessionId);
                    } else {
                        console.error('Session ID not found in row:', childRow);
                    }
                }
            });

            this._attachSessionActionHandlers(childRow, session, { enableDrag: false });
            listDiv.appendChild(childRow);
        });

        return listDiv;
    }

    /**
     * 時系列表示用のセッション一覧を取得
     * @private
     */
    _getTimelineSessions(sessions) {
        const filtered = (sessions || []).filter(s => s.intendedState !== 'archived');
        const sorted = [...filtered].sort((a, b) => {
            return this._getSessionSortTimestamp(b) - this._getSessionSortTimestamp(a);
        });
        return sorted;
    }

    /**
     * セッションのソート用タイムスタンプを取得
     * @private
     */
    _getSessionSortTimestamp(session) {
        const pickTimestamp = (value) => {
            if (!value) return null;
            if (typeof value === 'number') return value;
            const parsed = Date.parse(value);
            return Number.isNaN(parsed) ? null : parsed;
        };

        const candidates = [
            session.updatedAt,
            session.pausedAt,
            session.created,
            session.createdAt,
            session.createdDate
        ];

        for (const candidate of candidates) {
            const picked = pickTimestamp(candidate);
            if (picked) return picked;
        }

        if (session.id) {
            const match = session.id.match(/session-(\d{13})/);
            if (match) {
                return parseInt(match[1], 10);
            }
        }

        return 0;
    }

    /**
     * セクションをレンダリング（プロジェクトごとにグループ化）
     * @private
     */
    _renderSection(title, sessions, currentSessionId, isExpanded) {
        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'session-section';

        // セクションヘッダー
        const header = document.createElement('div');
        header.className = 'session-section-header';
        header.innerHTML = `
            <i data-lucide="${isExpanded ? 'chevron-down' : 'chevron-right'}"></i>
            <span>${escapeHtml(title)}</span>
            <span class="session-count">${sessions.length}</span>
        `;

        // セクションコンテナ
        const childrenDiv = document.createElement('div');
        childrenDiv.className = 'session-section-children';
        childrenDiv.style.display = isExpanded ? 'block' : 'none';

        // ヘッダークリックで展開/折りたたみ
        header.addEventListener('click', () => {
            const isCurrentlyExpanded = childrenDiv.style.display !== 'none';
            childrenDiv.style.display = isCurrentlyExpanded ? 'none' : 'block';
            const icon = header.querySelector('i');
            if (icon) {
                icon.setAttribute('data-lucide', isCurrentlyExpanded ? 'chevron-right' : 'chevron-down');
                if (window.lucide) window.lucide.createIcons();
            }
        });

        // プロジェクトごとにグループ化
        const grouped = groupSessionsByProject(sessions, {
            excludeArchived: false,
            includeEmptyProjects: false
        });

        // プロジェクトグループごとにレンダリング
        for (const [project, projectSessions] of Object.entries(grouped)) {
            const projectGroup = this._renderProjectGroup(project, projectSessions, currentSessionId);
            childrenDiv.appendChild(projectGroup);
        }

        sectionDiv.appendChild(header);
        sectionDiv.appendChild(childrenDiv);
        return sectionDiv;
    }

    /**
     * プロジェクトグループをレンダリング
     * @private
     */
    _renderProjectGroup(project, sessions, currentSessionId) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'session-project-group';

        // プロジェクトヘッダー
        const header = document.createElement('div');
        header.innerHTML = renderSessionGroupHeaderHTML(project, { isExpanded: true });
        const headerEl = header.firstElementChild;
        headerEl.classList.add('session-project-header');

        // プロジェクトセッションコンテナ
        const projectSessionsDiv = document.createElement('div');
        projectSessionsDiv.className = 'session-project-children';

        // ヘッダークリックで展開/折りたたみ
        headerEl.addEventListener('click', (e) => {
            if (!e.target.closest('.add-project-session-btn')) {
                const isCurrentlyExpanded = projectSessionsDiv.style.display !== 'none';
                projectSessionsDiv.style.display = isCurrentlyExpanded ? 'none' : 'block';
                const icon = headerEl.querySelector('.folder-icon i');
                icon.setAttribute('data-lucide', isCurrentlyExpanded ? 'folder' : 'folder-open');
                if (window.lucide) window.lucide.createIcons();
            }
        });

        // 新規セッション追加ボタン
        const addBtn = headerEl.querySelector('.add-project-session-btn');
        if (addBtn) {
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetProject = addBtn.dataset.project;
                eventBus.emit(EVENTS.CREATE_SESSION, { project: targetProject });
            });
        }

        // 各セッションをレンダリング
        sessions.forEach(session => {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = renderSessionRowHTML(session, {
                isActive: currentSessionId === session.id,
                project
            });
            const childRow = wrapper.firstElementChild;

            // セッションクリックで切り替え
            childRow.addEventListener('click', async (e) => {
                if (!e.target.closest('button')) {
                    const sessionId = childRow.dataset.id;
                    if (sessionId) {
                        await this.sessionService.switchSession(sessionId);
                    } else {
                        console.error('Session ID not found in row:', childRow);
                    }
                }
            });

            // アクションボタンのイベントハンドラー
            this._attachSessionActionHandlers(childRow, session);

            projectSessionsDiv.appendChild(childRow);
        });

        groupDiv.appendChild(headerEl);
        groupDiv.appendChild(projectSessionsDiv);
        return groupDiv;
    }

    /**
     * セッション行のアクションボタンにイベントハンドラーを設定
     */
    _attachSessionActionHandlers(row, session, options = {}) {
        const { enableDrag = true } = options;
        // Menu toggle button
        const menuToggle = row.querySelector('.session-menu-toggle');
        const dropdownMenu = row.querySelector('.session-dropdown-menu');

        if (menuToggle && dropdownMenu) {
            menuToggle.addEventListener('click', (e) => {
                e.stopPropagation();

                // Close all other open menus
                document.querySelectorAll('.session-dropdown-menu').forEach(menu => {
                    if (menu !== dropdownMenu) {
                        menu.classList.add('hidden');
                    }
                });

                // Toggle this menu
                const isOpening = dropdownMenu.classList.contains('hidden');
                dropdownMenu.classList.toggle('hidden');

                // オーバーレイの表示/非表示
                const menuOverlay = document.getElementById('menu-overlay');
                if (menuOverlay) {
                    if (isOpening) {
                        // メニューを開く場合、オーバーレイを表示
                        menuOverlay.classList.remove('hidden');
                    } else {
                        // メニューを閉じる場合、他に開いているメニューがなければオーバーレイを非表示
                        const hasOpenMenu = Array.from(document.querySelectorAll('.session-dropdown-menu'))
                            .some(menu => !menu.classList.contains('hidden'));
                        if (!hasOpenMenu) {
                            menuOverlay.classList.add('hidden');
                        }
                    }
                }
            });
        }

        // Helper function to close dropdown menu
        const closeDropdown = () => {
            if (dropdownMenu) {
                dropdownMenu.classList.add('hidden');
            }
        };

        // Rename button
        const renameBtn = row.querySelector('.rename-session-btn');
        if (renameBtn) {
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeDropdown();
                eventBus.emit(EVENTS.RENAME_SESSION, { session });
            });
        }

        // Delete button
        const deleteBtn = row.querySelector('.delete-session-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                closeDropdown();
                if (confirm(`セッション "${session.name || session.id}" を削除しますか？`)) {
                    await this.sessionService.deleteSession(session.id);
                }
            });
        }

        // Archive button
        const archiveBtn = row.querySelector('.archive-session-btn');
        if (archiveBtn) {
            archiveBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                closeDropdown();
                const newState = session.intendedState === 'archived' ? 'active' : 'archived';
                await this.sessionService.updateSession(session.id, { intendedState: newState });
            });
        }

        // Pause button (for active sessions)
        const pauseBtn = row.querySelector('.pause-session-btn');
        if (pauseBtn) {
            pauseBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                closeDropdown();
                await this.sessionService.pauseSession(session.id);
            });
        }

        // Resume button (for paused sessions)
        const resumeBtn = row.querySelector('.resume-session-btn');
        if (resumeBtn) {
            resumeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                closeDropdown();
                await this.sessionService.resumeSession(session.id);
            });
        }

        // Merge button
        const mergeBtn = row.querySelector('.merge-session-btn');
        if (mergeBtn) {
            mergeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeDropdown();
                eventBus.emit(EVENTS.MERGE_SESSION, { sessionId: session.id });
            });
        }

        if (enableDrag) {
            // Drag and Drop handlers
            const project = row.dataset.project;

            row.addEventListener('dragstart', (e) => {
                this.draggedSessionId = session.id;
                this.draggedSessionProject = project;
                row.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', session.id);
            });

            row.addEventListener('dragend', () => {
                this.draggedSessionId = null;
                this.draggedSessionProject = null;
                row.classList.remove('dragging');
                // Remove drag-over class from all rows
                document.querySelectorAll('.session-child-row.drag-over').forEach(el => {
                    el.classList.remove('drag-over');
                });
            });

            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Only allow drop within the same project
                if (this.draggedSessionId &&
                    this.draggedSessionProject === project &&
                    this.draggedSessionId !== session.id) {
                    e.dataTransfer.dropEffect = 'move';
                    row.classList.add('drag-over');
                }
            });

            row.addEventListener('dragleave', (e) => {
                e.preventDefault();
                row.classList.remove('drag-over');
            });

            row.addEventListener('drop', async (e) => {
                // Capture values immediately before async operations
                const droppedSessionId = this.draggedSessionId;
                const droppedSessionProject = this.draggedSessionProject;

                e.preventDefault();
                e.stopPropagation();
                row.classList.remove('drag-over');

                if (!droppedSessionId ||
                    droppedSessionProject !== project ||
                    droppedSessionId === session.id) {
                    return;
                }

                try {
                    // Get current sessions from store
                    const { sessions } = appStore.getState();

                    // Find indices
                    const draggedIndex = sessions.findIndex(s => s.id === droppedSessionId);
                    const targetIndex = sessions.findIndex(s => s.id === session.id);

                    if (draggedIndex === -1 || targetIndex === -1) {
                        console.error('Session not found for reordering');
                        return;
                    }

                    // Reorder sessions array
                    const reorderedSessions = [...sessions];
                    const [draggedSession] = reorderedSessions.splice(draggedIndex, 1);

                    // Calculate new target index after removal
                    const adjustedTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;

                    // Insert at the adjusted target position
                    reorderedSessions.splice(adjustedTargetIndex, 0, draggedSession);

                    // Update store and save to backend
                    appStore.setState({ sessions: reorderedSessions });
                    await this.sessionService.saveSessionOrder(reorderedSessions);

                    // Re-render to reflect new order
                    this.render();
                } catch (err) {
                    console.error('Failed to reorder sessions:', err);
                }
            });
        }
    }

    /**
     * クリーンアップ
     */
    unmount() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];

        // 外側クリックハンドラーを削除
        if (this._outsideClickHandler) {
            document.removeEventListener('click', this._outsideClickHandler);
            this._outsideClickHandler = null;
        }

        if (this.container) {
            this.container.innerHTML = '';
            this.container = null;
        }
    }
}
