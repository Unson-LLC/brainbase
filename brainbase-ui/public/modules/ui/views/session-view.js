import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * セッション表示のUIコンポーネント
 * app.jsから抽出したセッション表示機能を集約
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
     * セッションリストをレンダリング
     */
    render() {
        if (!this.container) return;

        const sessions = this.sessionService.getFilteredSessions();
        const { currentSessionId, filters } = appStore.getState();

        if (sessions.length === 0) {
            this.container.innerHTML = '<div class="empty-state">セッションがありません</div>';
            return;
        }

        // プロジェクトごとにグループ化
        const grouped = this._groupByProject(sessions);

        let html = '';

        // フィルター入力欄
        html += `
            <div class="filter-section">
                <input
                    type="text"
                    data-filter-input
                    value="${filters.sessionFilter || ''}"
                    placeholder="セッションをフィルター..."
                />
            </div>
        `;

        // セッション作成ボタン
        html += `
            <div class="actions-section">
                <button class="create-btn" data-action="create">
                    新規セッション作成
                </button>
            </div>
        `;

        // プロジェクトグループ表示
        for (const [project, projectSessions] of Object.entries(grouped)) {
            html += this._renderProjectGroup(project, projectSessions, currentSessionId);
        }

        this.container.innerHTML = html;
        this._attachEventHandlers();
    }

    /**
     * プロジェクトごとにグループ化
     * @private
     */
    _groupByProject(sessions) {
        const grouped = {};
        sessions.forEach(session => {
            const project = session.project || 'その他';
            if (!grouped[project]) {
                grouped[project] = [];
            }
            grouped[project].push(session);
        });
        return grouped;
    }

    /**
     * プロジェクトグループのHTML生成
     * @private
     */
    _renderProjectGroup(project, sessions, currentSessionId) {
        return `
            <div class="session-group" data-project="${project}">
                ${this._renderGroupHeader(project)}
                <div class="session-group-children">
                    ${sessions.map(s => this._renderSession(s, currentSessionId)).join('')}
                </div>
            </div>
        `;
    }

    /**
     * グループヘッダーのHTML生成
     * @private
     */
    _renderGroupHeader(project) {
        return `
            <div class="session-group-header">
                <span class="folder-icon"><i data-lucide="folder-open"></i></span>
                <span class="group-title">${project}</span>
                <button class="add-project-session-btn" data-project="${project}" title="New Session in ${project}">
                    <i data-lucide="plus"></i>
                </button>
            </div>
        `;
    }

    /**
     * セッションのHTML生成
     * @private
     */
    _renderSession(session, currentSessionId) {
        const isActive = session.id === currentSessionId;
        return `
            <div class="session-child-row ${isActive ? 'active' : ''}" data-session-id="${session.id}">
                <div class="session-name-container">
                    <span class="session-icon"><i data-lucide="file-text"></i></span>
                    <span class="session-name">${session.name || session.id}</span>
                </div>
                <button
                    class="delete-session-btn"
                    data-action="delete"
                    title="削除"
                >
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;
    }

    /**
     * DOMイベントハンドラーをアタッチ
     * @private
     */
    _attachEventHandlers() {
        // 削除ボタン
        this.container.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const sessionItem = e.target.closest('[data-session-id]');
                const sessionId = sessionItem?.dataset.sessionId;
                if (sessionId && confirm('このセッションを削除しますか？')) {
                    await this.sessionService.deleteSession(sessionId);
                }
            });
        });

        // フィルター入力
        const filterInput = this.container.querySelector('[data-filter-input]');
        if (filterInput) {
            filterInput.addEventListener('input', (e) => {
                const { filters } = appStore.getState();
                appStore.setState({
                    filters: { ...filters, sessionFilter: e.target.value }
                });
                this.render();
            });
        }

        // セッション作成ボタン
        const createButton = this.container.querySelector('[data-action="create"]');
        if (createButton) {
            createButton.addEventListener('click', async () => {
                const name = prompt('新しいセッション名を入力してください:');
                if (name) {
                    await this.sessionService.createSession({
                        name,
                        project: 'default',
                        path: '.'
                    });
                }
            });
        }

        // プロジェクトグループ内の新規セッション作成ボタン
        this.container.querySelectorAll('.add-project-session-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const project = btn.dataset.project;
                const name = prompt(`${project} に新しいセッションを作成:`);
                if (name) {
                    await this.sessionService.createSession({
                        name,
                        project,
                        path: '.'
                    });
                }
            });
        });

        // セッションクリック（切り替え）
        this.container.querySelectorAll('[data-session-id]').forEach(item => {
            item.addEventListener('click', (e) => {
                // 削除ボタンのクリックは除外
                if (e.target.closest('[data-action="delete"]')) return;

                const sessionId = item.dataset.sessionId;
                appStore.setState({ currentSessionId: sessionId });
                eventBus.emit(EVENTS.SESSION_CHANGED, { sessionId });
                this.render();
            });
        });
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
