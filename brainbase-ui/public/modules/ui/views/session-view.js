import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { groupSessionsByProject } from '../../session-manager.js';
import { renderSessionGroupHeaderHTML, renderSessionRowHTML } from '../../session-list-renderer.js';

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
        const unsub5 = eventBus.on(EVENTS.SESSION_PAUSED, () => this.render());
        const unsub6 = eventBus.on(EVENTS.SESSION_RESUMED, () => this.render());

        this._unsubscribers.push(unsub1, unsub2, unsub3, unsub4, unsub5, unsub6);
    }

    /**
     * セッションリストをレンダリング（状態別セクション構造）
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

        // アーカイブボタン
        const archiveBtn = document.createElement('button');
        archiveBtn.className = 'archive-view-btn';
        archiveBtn.innerHTML = '<i data-lucide="archive"></i> アーカイブを見る';
        archiveBtn.onclick = () => {
            const archiveModal = document.getElementById('archive-modal');
            if (archiveModal) archiveModal.classList.add('active');
        };
        this.container.appendChild(archiveBtn);

        // Lucideアイコンを初期化
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    /**
     * セクションをレンダリング
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
            <span>${title}</span>
            <span class="session-count">${sessions.length}</span>
        `;

        // ヘッダークリックで展開/折りたたみ
        header.addEventListener('click', () => {
            const isCurrentlyExpanded = childrenDiv.style.display !== 'none';
            childrenDiv.style.display = isCurrentlyExpanded ? 'none' : 'block';
            const icon = header.querySelector('i');
            icon.setAttribute('data-lucide', isCurrentlyExpanded ? 'chevron-right' : 'chevron-down');
            if (window.lucide) window.lucide.createIcons();
        });

        // セッションリスト
        const childrenDiv = document.createElement('div');
        childrenDiv.className = 'session-section-children';
        childrenDiv.style.display = isExpanded ? 'block' : 'none';

        // 各セッションをレンダリング
        sessions.forEach(session => {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = renderSessionRowHTML(session, {
                isActive: currentSessionId === session.id,
                project: session.project || 'general'
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

            childrenDiv.appendChild(childRow);
        });

        sectionDiv.appendChild(header);
        sectionDiv.appendChild(childrenDiv);
        return sectionDiv;
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

        // Pause button (for active sessions)
        const pauseBtn = row.querySelector('.pause-session-btn');
        if (pauseBtn) {
            pauseBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.sessionService.pauseSession(session.id);
            });
        }

        // Resume button (for paused sessions)
        const resumeBtn = row.querySelector('.resume-session-btn');
        if (resumeBtn) {
            resumeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.sessionService.resumeSession(session.id);
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
