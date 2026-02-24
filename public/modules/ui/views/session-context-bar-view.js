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

        const sessionId = context.sessionId || '-';
        const engine = context.engine || '-';
        const repo = context.repo || '-';
        const workspacePath = context.workspacePath || '-';
        const bookmark = context.bookmark || '-';
        const dirtyLabel = context.dirty ? 'dirty' : 'clean';
        const dirtyClass = context.dirty ? 'is-warning' : 'is-ok';
        const changesNotPushed = Number(context.changesNotPushed || 0);
        const prStatus = context.prStatus || 'none';
        const prText = prStatus === 'merged' ? 'merged' : prStatus === 'open_or_pending' ? 'pending' : 'none';
        const prClass = prStatus === 'merged' ? 'is-ok' : (prStatus === 'open_or_pending' ? 'is-warning' : '');

        const items = [
            this._renderItem('Session', sessionId),
            this._renderItem('Engine', engine),
            this._renderItem('Repo', repo, { title: context.repoPath || repo }),
            this._renderItem('Workspace', this._shortPath(workspacePath), { title: workspacePath, full: workspacePath }),
            this._renderItem('Bookmark', bookmark),
            this._renderItem('Dirty', dirtyLabel, { valueClass: dirtyClass }),
            this._renderItem('Ahead', `${changesNotPushed}`),
            this._renderItem('PR', prText, { valueClass: prClass })
        ];

        this.container.innerHTML = `<div class="session-context-bar-inner">${items.join('')}</div>`;
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
