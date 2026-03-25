import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { AdaptivePoller } from '../../core/adaptive-poller.js';
import { getSessionStatus } from '../../session-ui-state.js';
import { escapeHtml } from '../../ui-helpers.js';
import { BaseView } from './base-view.js';

/**
 * SessionContextBarView
 * 現在の作業コンテキストを上部バーに表示
 */
export class SessionContextBarView extends BaseView {
    constructor({ sessionService, pollIntervalMs = 8000 }) {
        super();
        this.sessionService = sessionService;
        this.pollIntervalMs = pollIntervalMs;
        this.switchDelayMs = 150;
        this._requestId = 0;
        this._pollTimer = null;
        this._refreshTimer = null;
        this._expanded = false;
        this._currentContext = null;
        this._poller = null;
        this._visibilityHandler = null;
    }

    mount(container) {
        this.container = container;
        this._setupEventListeners();
        this._renderEmpty('セッション未選択');
        this.refresh({ forceLoading: true });
        this._startPolling();
        this._visibilityHandler = () => {
            if (document.hidden) {
                this._stopPolling();
                return;
            }
            this._startPolling();
            this._syncPollerActivity();
            void this.refresh();
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
    }

    _setupEventListeners() {
        const refresh = () => this.refresh();
        this._addSubscriptions(
            appStore.subscribeToSelector(
                (state) => state.currentSessionId,
                () => this._scheduleRefresh({ forceLoading: false, delayMs: this.switchDelayMs })
            ),
            eventBus.on(EVENTS.SESSION_LOADED, refresh),
            eventBus.on(EVENTS.SESSION_UPDATED, refresh),
            eventBus.on(EVENTS.SESSION_ARCHIVED, refresh),
            eventBus.on(EVENTS.SESSION_CREATED, refresh),
            eventBus.on(EVENTS.SESSION_UI_STATE_CHANGED, () => this._syncPollerActivity())
        );
    }

    _startPolling() {
        if (this._poller) {
            this._poller.start();
            return;
        }
        this._poller = new AdaptivePoller(() => {
            if (document.hidden) return;
            void this.refresh();
        }, {
            activeIntervalMs: 3000,
            idleIntervalMs: 30000
        });
        this._poller.start();
        this._syncPollerActivity();
    }

    _stopPolling() {
        this._poller?.stop();
    }

    _syncPollerActivity() {
        const sessionId = appStore.getState().currentSessionId;
        const hookStatus = sessionId ? getSessionStatus(sessionId) : null;
        const isActive = Boolean(
            hookStatus?.status === 'working'
            || hookStatus?.isWorking
            || (hookStatus?.activeTurnIds?.length || 0) > 0
        );
        this._poller?.setActive(isActive);
    }

    _scheduleRefresh(options = {}) {
        const { forceLoading = false, delayMs = 0 } = options;
        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = null;
        }

        this._refreshTimer = setTimeout(() => {
            this._refreshTimer = null;
            void this.refresh({ forceLoading });
        }, delayMs);
    }

    _shortPath(pathValue) {
        if (!pathValue) return '-';
        if (pathValue.length <= 52) return pathValue;
        return `...${pathValue.slice(-49)}`;
    }

    _normalizePath(pathValue) {
        if (!pathValue || pathValue === '-') return '';
        const normalized = String(pathValue).trim().replace(/[\\/]+$/, '');
        if (!normalized) return '';
        if (/^[A-Z]:/.test(normalized)) {
            return `${normalized[0].toLowerCase()}${normalized.slice(1)}`;
        }
        return normalized;
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
        const hasCwdMismatch = this._normalizePath(workspacePath) !== this._normalizePath(currentDirectory);

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
        if (hasCwdMismatch) {
            alerts.push('<span class="context-alert is-cwd-mismatch" title="Current directory differs from workspace">⚠ cwd!=workspace</span>');
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
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }
        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = null;
        }
        super.unmount();
    }
}
