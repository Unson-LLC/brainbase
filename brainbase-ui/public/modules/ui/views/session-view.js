import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { groupSessionsByProject } from '../../session-manager.js';
import { renderSessionGroupHeaderHTML, renderSessionRowHTML } from '../../session-list-renderer.js';
import { updateSessionIndicators } from '../../session-indicators.js';

/**
 * セッション表示のUIコンポーネント
 * 現行版と同じ構造でプロジェクトグループ表示
 */
export class SessionView {
    constructor({ sessionService }) {
        this.sessionService = sessionService;
        this.container = null;
        this._unsubscribers = [];
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

        this._unsubscribers.push(unsub1, unsub2, unsub3, unsub4);
    }

    /**
     * セッションリストをレンダリング（現行版と同じ構造）
     */
    render() {
        if (!this.container) return;

        // Clear container
        this.container.innerHTML = '';

        const { sessions, currentSessionId } = appStore.getState();

        if (!sessions || sessions.length === 0) {
            this.container.innerHTML = '<div class="empty-state">セッションがありません</div>';
            return;
        }

        // プロジェクトごとにグループ化（現行版と同じロジック）
        const grouped = groupSessionsByProject(sessions, {
            excludeArchived: true,
            includeEmptyProjects: true
        });

        // プロジェクトグループごとにレンダリング
        for (const [project, projectSessions] of Object.entries(grouped)) {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'session-group';

            // ヘッダー作成
            const header = document.createElement('div');
            header.innerHTML = renderSessionGroupHeaderHTML(project, { isExpanded: true });
            const headerEl = header.firstElementChild;

            // ヘッダークリックで展開/折りたたみ
            headerEl.addEventListener('click', (e) => {
                if (!e.target.closest('.add-project-session-btn')) {
                    const container = groupDiv.querySelector('.session-group-children');
                    container.style.display = container.style.display === 'none' ? 'block' : 'none';
                    const icon = headerEl.querySelector('.folder-icon i');
                    icon.setAttribute('data-lucide', container.style.display === 'none' ? 'folder' : 'folder-open');
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

            // セッション行のコンテナ
            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'session-group-children';

            // 各セッションをレンダリング
            projectSessions.forEach(session => {
                const wrapper = document.createElement('div');
                wrapper.innerHTML = renderSessionRowHTML(session, {
                    isActive: currentSessionId === session.id,
                    project
                });
                const childRow = wrapper.firstElementChild;

                // セッションクリックで切り替え
                childRow.addEventListener('click', (e) => {
                    if (!e.target.closest('button')) {
                        const sessionId = childRow.dataset.id;
                        if (sessionId) {
                            eventBus.emit(EVENTS.SESSION_CHANGED, { sessionId });
                        } else {
                            console.error('Session ID not found in row:', childRow);
                        }
                    }
                });

                // アクションボタンのイベントハンドラー
                this._attachSessionActionHandlers(childRow, session);

                childrenDiv.appendChild(childRow);
            });

            groupDiv.appendChild(headerEl);
            groupDiv.appendChild(childrenDiv);
            this.container.appendChild(groupDiv);
        }

        // Lucideアイコンを初期化
        if (window.lucide) {
            window.lucide.createIcons();
        }

        // セッションインジケーターを更新（緑・オレンジのステータス表示）
        updateSessionIndicators(currentSessionId);
    }

    /**
     * セッション行のアクションボタンにイベントハンドラーを設定
     */
    _attachSessionActionHandlers(row, session) {
        // Rename button
        const renameBtn = row.querySelector('.rename-session-btn');
        if (renameBtn) {
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                eventBus.emit(EVENTS.RENAME_SESSION, { session });
            });
        }

        // Delete button
        const deleteBtn = row.querySelector('.delete-session-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
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
                const newState = session.intendedState === 'archived' ? 'active' : 'archived';
                await this.sessionService.updateSession(session.id, { intendedState: newState });
            });
        }

        // Restart button
        const restartBtn = row.querySelector('.restart-session-btn');
        if (restartBtn) {
            restartBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                eventBus.emit(EVENTS.RESTART_SESSION, { sessionId: session.id });
            });
        }

        // Stop button
        const stopBtn = row.querySelector('.stop-session-btn');
        if (stopBtn) {
            stopBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                eventBus.emit(EVENTS.STOP_SESSION, { sessionId: session.id });
            });
        }

        // Merge button
        const mergeBtn = row.querySelector('.merge-session-btn');
        if (mergeBtn) {
            mergeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                eventBus.emit(EVENTS.MERGE_SESSION, { sessionId: session.id });
            });
        }
    }

    /**
     * クリーンアップ
     */
    unmount() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        if (this.container) {
            this.container.innerHTML = '';
            this.container = null;
        }
    }
}
