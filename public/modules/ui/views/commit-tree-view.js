/**
 * CommitTreeView
 * コミットツリーパネルのUIコンポーネント
 */
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';
import { escapeHtml } from '../../ui-helpers.js';

export class CommitTreeView {
    constructor({ commitTreeService }) {
        this.commitTreeService = commitTreeService;
        this.container = null;
        this._unsubscribers = [];
    }

    /**
     * DOMコンテナにマウント
     * @param {HTMLElement} container - マウント先 (#commit-tree-list)
     */
    mount(container) {
        this.container = container;
        this._setupEventListeners();
        this.render();
    }

    _setupEventListeners() {
        // セッション切替時にコミットログを取得
        const unsub1 = eventBus.on(EVENTS.SESSION_CHANGED, (e) => {
            const sessionId = e.detail?.sessionId || appStore.getState().currentSessionId;
            this.commitTreeService.loadCommitLog(sessionId);
        });

        // コミットログ取得完了時にレンダリング
        const unsub2 = eventBus.on(EVENTS.COMMIT_LOG_LOADED, () => {
            this.render();
        });

        this._unsubscribers.push(unsub1, unsub2);
    }

    /**
     * コミットツリーをレンダリング
     */
    render() {
        if (!this.container) return;

        const commitLog = appStore.getState().commitLog;

        // 未選択 or データなし
        if (!commitLog) {
            this.container.innerHTML = '<div class="commit-tree-empty">セッションを選択してください</div>';
            this._updatePanelHeader(null);
            return;
        }

        const { commits, repoType } = commitLog;

        if (!commits || commits.length === 0) {
            this.container.innerHTML = '<div class="commit-tree-empty">コミットなし</div>';
            this._updatePanelHeader(repoType);
            return;
        }

        this._updatePanelHeader(repoType);

        const html = commits.map(commit => {
            const currentClass = commit.isWorkingCopy ? ' current' : '';
            const bookmarkHtml = commit.bookmarks.length > 0
                ? commit.bookmarks.map(b => `<span class="commit-bookmark">${escapeHtml(b)}</span>`).join('')
                : '';
            const timeStr = this._formatTime(commit.timestamp);

            return `<div class="commit-node${currentClass}">
                <div class="commit-dot"></div>
                <div class="commit-line"></div>
                <div class="commit-info">
                    <div class="commit-header">
                        <span class="commit-hash">${escapeHtml(commit.hash)}</span>
                        ${bookmarkHtml}
                    </div>
                    <div class="commit-desc">${escapeHtml(commit.description)}</div>
                    <div class="commit-meta">
                        <span class="commit-time">${escapeHtml(timeStr)}</span>
                        <span class="commit-author">${escapeHtml(commit.author)}</span>
                    </div>
                </div>
            </div>`;
        }).join('');

        this.container.innerHTML = html;
    }

    /**
     * パネルヘッダーのrepoType表示を更新
     * @private
     */
    _updatePanelHeader(repoType) {
        const badge = document.getElementById('commit-tree-repo-type');
        if (!badge) return;

        if (repoType) {
            badge.textContent = repoType;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    /**
     * タイムスタンプをHH:MM形式にフォーマット
     * @private
     */
    _formatTime(timestamp) {
        if (!timestamp) return '';
        try {
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) return timestamp;
            return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        } catch {
            return timestamp;
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
        }
    }
}
