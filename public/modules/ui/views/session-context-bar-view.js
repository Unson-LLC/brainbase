import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { escapeHtml } from '../../ui-helpers.js';

/**
 * SessionContextBarView
 * 現在の作業コンテキストを上部バーに表示
 */
export class SessionContextBarView {
    constructor({ sessionService, pollIntervalMs = 8000 }) {
        this.sessionService = sessionService;
        this.pollIntervalMs = pollIntervalMs;
        this.container = null;
        this._requestId = 0;
        this._unsubscribers = [];
        this._pollTimer = null;
        this._expanded = false;
        this._currentContext = null;
    }

    mount(container) {
        this.container = container;
        this._setupEventListeners();
        this._renderEmpty('セッション未選択');
        this.refresh({ forceLoading: true });
        this._startPolling();
    }

    _setupEventListeners() {
        const unsub1 = appStore.subscribeToSelector(
            (state) => state.currentSessionId,
            () => this.refresh({ forceLoading: true })
        );

        const refresh = () => this.refresh();
        const unsub2 = eventBus.on(EVENTS.SESSION_LOADED, refresh);
        const unsub3 = eventBus.on(EVENTS.SESSION_UPDATED, refresh);
        const unsub4 = eventBus.on(EVENTS.SESSION_ARCHIVED, refresh);
        const unsub5 = eventBus.on(EVENTS.SESSION_CREATED, refresh);

        this._unsubscribers.push(unsub1, unsub2, unsub3, unsub4, unsub5);
    }

    _startPolling() {
        this._stopPolling();
        this._pollTimer = setInterval(() => {
            this.refresh();
        }, this.pollIntervalMs);
    }

    _stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }

    _shortPath(pathValue) {
        if (!pathValue) return '-';
        if (pathValue.length <= 52) return pathValue;
        return `...${pathValue.slice(-49)}`;
    }

    _renderItem(label, value, options = {}) {
        const { valueClass = '', title = '', full = '' } = options;
        const classAttr = valueClass ? ` session-context-value ${valueClass}` : 'session-context-value';
        const fullText = full || title || value || '-';
        const fullAttr = ` data-full="${escapeHtml(fullText)}"`;
        const ariaAttr = ` aria-label="${escapeHtml(fullText)}"`;
        return `<div class="session-context-pill"><span class="session-context-label">${escapeHtml(label)}</span><span class="${classAttr}"${fullAttr}${ariaAttr}>${escapeHtml(value || '-')}</span></div>`;
    }

    _renderEmpty(message) {
        if (!this.container) return;
        this.container.innerHTML = `<div class="session-context-bar-inner"><div class="session-context-empty">${escapeHtml(message)}</div></div>`;
    }

    _renderLoading(sessionId) {
        if (!this.container) return;
        const title = sessionId ? `読み込み中: ${sessionId}` : '読み込み中';
        this.container.innerHTML = `<div class="session-context-bar-inner"><div class="session-context-empty">${escapeHtml(title)}</div></div>`;
    }

    _renderContext(context) {
        if (!this.container) return;

        const sessionName = context.sessionName || context.sessionId || '-';
        const sessionId = context.sessionId || '-';
        const engine = context.engine || 'claude';
        const repo = context.repo || '-';
        const baseBranch = context.baseBranch || '-';
        const repoPath = context.repoPath || '-';
        const workspacePath = context.workspacePath || '-';
        const currentDirectory = context.currentDirectory || context.cwd || workspacePath || '-';
        const dirty = context.dirty;
        const changesNotPushed = Number(context.changesNotPushed || 0);
        const prStatus = context.prStatus || 'none';

        // Engine icon (既存のSVGアイコンを使用)
        const engineMeta = engine === 'codex'
            ? { title: 'OpenAI Codex', className: 'engine-icon engine-codex' }
            : { title: 'Claude Code', className: 'engine-icon engine-claude' };
        const engineIcon = `<img src="/icons/${engine}.svg" class="engine-svg-icon" alt="${engineMeta.title}" title="${engineMeta.title}">`;

        // 常時表示項目
        const primaryInfo = `${escapeHtml(sessionName)} ${engineIcon} @ ${escapeHtml(repo)}/${escapeHtml(baseBranch)}`;

        // 異常時のみ表示（アクションが必要な情報）
        const alerts = [];
        if (dirty) {
            alerts.push('<span class="context-alert is-warning" title="Uncommitted changes">⚠️ dirty</span>');
        }
        if (changesNotPushed > 0) {
            alerts.push(`<span class="context-alert is-warning" title="${changesNotPushed} commits not pushed">↑ ${changesNotPushed}</span>`);
        }
        if (prStatus === 'merged') {
            alerts.push('<span class="context-alert is-ok" title="PR merged">🔀 merged</span>');
        } else if (prStatus === 'open_or_pending') {
            alerts.push('<span class="context-alert is-warning" title="PR pending">🔀 pending</span>');
        }

        const alertsHtml = alerts.length > 0 ? ` <span class="context-separator">|</span> ${alerts.join(' ')}` : '';

        // 展開ボタン
        const expandIcon = this._expanded ? '▲' : '▼';
        const expandBtn = `<button class="context-expand-btn" title="詳細を${this._expanded ? '折りたたむ' : '展開'}">${expandIcon}</button>`;

        // 詳細情報（展開時のみ表示）
        const detailsHtml = this._expanded ? `
            <div class="context-details">
                <div class="context-detail-item">
                    <span class="context-detail-label">Clone:</span>
                    <span class="context-detail-value" title="${escapeHtml(repoPath)}">${escapeHtml(repoPath)}</span>
                </div>
                <div class="context-detail-item">
                    <span class="context-detail-label">Workspace:</span>
                    <span class="context-detail-value" title="${escapeHtml(workspacePath)}">${escapeHtml(this._shortPath(workspacePath))}</span>
                </div>
                <div class="context-detail-item">
                    <span class="context-detail-label">Current:</span>
                    <span class="context-detail-value" title="${escapeHtml(currentDirectory)}">${escapeHtml(this._shortPath(currentDirectory))}</span>
                </div>
                <div class="context-detail-item">
                    <span class="context-detail-label">Session:</span>
                    <span class="context-detail-value">${escapeHtml(sessionId)}</span>
                </div>
            </div>
        ` : '';

        this.container.innerHTML = `
            <div class="session-context-bar-inner">
                <div class="context-primary">
                    ${primaryInfo}${alertsHtml}
                    ${expandBtn}
                </div>
                ${detailsHtml}
            </div>
        `;

        // contextを保存（展開/折りたたみ時に再利用）
        this._currentContext = context;

        // 展開ボタンのイベントリスナー
        const expandButton = this.container.querySelector('.context-expand-btn');
        if (expandButton) {
            expandButton.addEventListener('click', () => {
                this._expanded = !this._expanded;
                this._renderContext(this._currentContext);
            });
        }
    }

    async refresh(options = {}) {
        if (!this.container) return;

        const { forceLoading = false } = options;
        const sessionId = appStore.getState().currentSessionId;

        if (!sessionId) {
            this._renderEmpty('セッション未選択');
            return;
        }

        const requestId = ++this._requestId;
        if (forceLoading) {
            this._renderLoading(sessionId);
        }

        const context = await this.sessionService.getSessionContext(sessionId);
        if (requestId !== this._requestId) return;
        if (!context) {
            this._renderEmpty('コンテキスト取得失敗');
            return;
        }
        this._renderContext(context);
    }

    unmount() {
        this._stopPolling();
        this._unsubscribers.forEach((unsub) => unsub());
        this._unsubscribers = [];
        if (this.container) {
            this.container.innerHTML = '';
            this.container = null;
        }
    }
}
