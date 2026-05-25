// @ts-check
/**
 * Live Feed View
 * セッション横断で現在のAIアクティビティを時系列表示する。
 */
import { escapeHtml, refreshIcons } from '../../ui-helpers.js';
import { appStore } from '../../core/store.js';

const FEED_SCOPES = [
    { id: 'current', label: 'このセッション' },
    { id: 'all', label: '全体' },
];

export class LiveFeedView {
    constructor({ liveFeedService, service, eventBus, container, store }) {
        this.liveFeedService = liveFeedService || service;
        this.store = store || this.liveFeedService?.store || appStore;
        this._container = container || null;
        this._unsubEntry = null;
        this._unsubCurrentSession = null;
        this._activeScope = 'current';
    }

    mount(container) {
        this._container = container;
        this.liveFeedService.start();
        this._render();
        this._unsubEntry = this.liveFeedService.onEntry(() => {
            this._render();
        });
        this._unsubCurrentSession = this.store?.subscribeToSelector?.(
            state => state.currentSessionId,
            () => this._render()
        ) || null;
    }

    _formatTime(date) {
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    _toneLabel(tone) {
        if (tone === 'working') return '進行中';
        if (tone === 'waiting') return '入力待ち';
        if (tone === 'done') return '完了';
        if (tone === 'blocked') return '停止';
        if (tone === 'paused') return '一時停止';
        return '待機';
    }

    _filterEntries(entries) {
        return entries;
    }

    _currentSessionId() {
        return this.store?.getState?.()?.currentSessionId || null;
    }

    _activeScopeLabel() {
        if (this._activeScope === 'current' && !this._currentSessionId()) return '全体';
        return FEED_SCOPES.find((scope) => scope.id === this._activeScope)?.label || '全体';
    }

    _displayModeLabel() {
        return `時系列 / 範囲: ${this._activeScopeLabel()}`;
    }

    _sourceLabel(entry) {
        const source = entry.provenanceLabel || '';
        if (entry.textSource === 'raw_prompt' || source === 'raw prompt') return 'ユーザー入力';
        if (entry.textSource === 'model_summary' || source === 'generated summary') return '要約';
        if (entry.evidenceSource === 'activity_report' || source === 'structured activity') return '活動報告';
        if (entry.textSource === 'structured_field' || source === 'structured field') return '作業状況';
        if (source === 'deterministic') return '抜粋';
        return source;
    }

    _getDisplayedEntries() {
        const currentSessionId = this._currentSessionId();
        if (typeof this.liveFeedService.getHistoryEntries === 'function') {
            return this._activeScope === 'current' && currentSessionId
                ? this.liveFeedService.getHistoryEntries({ mode: 'session', sessionId: currentSessionId })
                : this.liveFeedService.getHistoryEntries({ mode: 'all' });
        }
        const entries = this.liveFeedService.getEntries();
        return this._activeScope === 'current' && currentSessionId
            ? entries.filter((entry) => entry.sessionId === currentSessionId)
            : entries;
    }

    _sessionOptions(entries) {
        const byId = new Map();
        for (const entry of entries) {
            if (!entry?.sessionId) continue;
            byId.set(entry.sessionId, entry.label || entry.sessionId);
        }
        return Array.from(byId.entries()).map(([id, label]) => ({ id, label }));
    }

    _renderScopeControls(allEntries) {
        const currentSessionId = this._currentSessionId();
        const effectiveActiveScope = this._activeScope === 'current' && !currentSessionId ? 'all' : this._activeScope;
        const currentCount = currentSessionId
            ? allEntries.filter((entry) => entry.sessionId === currentSessionId).length
            : 0;
        const counts = { current: currentCount, all: allEntries.length };
        return FEED_SCOPES.map((scope) => {
            const disabled = scope.id === 'current' && !currentSessionId;
            const active = scope.id === effectiveActiveScope;
            return `<button class="feed-scope-btn${active ? ' active' : ''}" type="button" data-scope="${scope.id}" aria-pressed="${active ? 'true' : 'false'}" ${disabled ? 'disabled' : ''}>
                <span>${scope.label}</span>
                <span class="feed-scope-count">${counts[scope.id] || 0}</span>
            </button>`;
        }).join('');
    }

    _renderGroups(entries) {
        if (entries.length === 0) {
            const label = escapeHtml(this._activeScopeLabel());
            return `<div class="live-feed-empty">
                <i data-lucide="radio"></i>
                <p>${label}の更新はありません</p>
                <span>全体に切り替えると他セッションの更新を確認できます。</span>
            </div>`;
        }

        const groups = [
            ['新しい更新', entries.slice(0, 6)],
            ['前の更新', entries.slice(6)],
        ].filter(([, items]) => items.length > 0);

        return groups.map(([label, items]) => `<section class="feed-section">
            <div class="feed-section-label">${label}</div>
            ${items.map((entry) => this._renderEntry(entry)).join('')}
        </section>`).join('');
    }

    _renderEntry(entry) {
        const time = this._formatTime(entry.timestamp);
        const taskBrief = entry.taskBrief
            ? `<div class="feed-item-task">${escapeHtml(entry.taskBrief)}</div>`
            : '';
        const currentStep = entry.currentStep
            ? `<div class="feed-item-step">${escapeHtml(entry.currentStep)}</div>`
            : '';
        const latestEvidence = entry.latestEvidence
            ? `<div class="feed-item-evidence">${escapeHtml(entry.latestEvidence)}</div>`
            : '';
        const historyText = entry.text
            ? `<div class="feed-item-step feed-item-history-text">${escapeHtml(entry.text)}</div>`
            : '';
        const sourceLabel = this._sourceLabel(entry);
        const provenance = sourceLabel
            ? `<span class="feed-item-source">${escapeHtml(sourceLabel)}</span>`
            : '';
        const statusToneClass = entry.statusTone ? ` feed-item-tone-${entry.statusTone}` : '';
        const tone = entry.statusTone || 'idle';
        const status = escapeHtml(entry.statusText || this._toneLabel(tone));
        return `<div class="feed-item" data-tone="${escapeHtml(tone)}">
            <div class="feed-item-time">${time}</div>
            <div class="feed-item-rail"><span class="feed-item-dot ${escapeHtml(tone)}"></span></div>
            <div class="feed-item-icon${statusToneClass}"><i data-lucide="${entry.icon}"></i></div>
            <div class="feed-item-content">
                <div class="feed-item-mainline">
                    <span class="feed-item-label">${escapeHtml(entry.label)}</span>
                    <span class="feed-item-status">${status}</span>
                </div>
                <div class="feed-item-meta-line">
                    <span class="feed-item-session">${escapeHtml(entry.sessionId || '')}</span>
                    <span class="feed-item-time-inline">${time}</span>
                    ${provenance}
                </div>
                ${taskBrief}
                ${historyText}
                ${currentStep}
                ${latestEvidence}
            </div>
            <div class="feed-item-actions">
                <button class="feed-item-action" type="button" aria-label="詳細を開く" aria-disabled="true" disabled title="未対応" style="cursor: not-allowed; opacity: 0.55;"><i data-lucide="external-link"></i></button>
                <button class="feed-item-action" type="button" aria-label="コピー" aria-disabled="true" disabled title="未対応" style="cursor: not-allowed; opacity: 0.55;"><i data-lucide="copy"></i></button>
            </div>
        </div>`;
    }

    _renderList() {
        if (!this._container) return;
        const list = this._container.querySelector('.live-feed-list');
        if (!list) return;
        const entries = this._getDisplayedEntries();
        list.innerHTML = this._renderGroups(this._filterEntries(entries));
        refreshIcons({ nodes: [list] });
    }

    _render() {
        if (!this._container) return;

        const allEntries = typeof this.liveFeedService.getHistoryEntries === 'function'
            ? this.liveFeedService.getHistoryEntries({ mode: 'all' })
            : this.liveFeedService.getEntries();
        const entries = this._getDisplayedEntries();
        const filteredEntries = this._filterEntries(entries);
        const entriesHtml = this._renderGroups(filteredEntries);
        const isMobileSurface = Boolean(this._container.closest?.('.mobile-tab-content'));
        const surfacePadding = isMobileSurface
            ? ' style="padding-bottom: 72px; box-sizing: border-box;"'
            : '';
        const footerPadding = document.querySelector('.mana-chat-widget')
            ? ' style="padding-right: 96px;"'
            : '';

        this._container.innerHTML = `<div class="live-feed-container"${surfacePadding}>
            <div class="live-feed-header">
                <div class="live-feed-status-wrap">
                    <span class="live-feed-status active"><span class="live-feed-status-dot"></span>LIVE</span>
                </div>
                <div class="live-feed-scope-group" aria-label="Live Feed scope">
                    ${this._renderScopeControls(allEntries)}
                </div>
                <div class="live-feed-controls">
                    <button class="feed-control-btn" type="button" aria-label="一時停止" aria-disabled="true" disabled title="未対応" style="cursor: not-allowed; opacity: 0.55;"><i data-lucide="pause"></i></button>
                    <button class="feed-control-btn" type="button" aria-label="更新" aria-disabled="true" disabled title="未対応" style="cursor: not-allowed; opacity: 0.55;"><i data-lucide="refresh-cw"></i></button>
                    <button class="feed-control-btn" type="button" aria-label="フィルタ" aria-disabled="true" disabled title="未対応" style="cursor: not-allowed; opacity: 0.55;"><i data-lucide="sliders-horizontal"></i></button>
                </div>
            </div>
            <div class="live-feed-list">${entriesHtml}</div>
            <div class="live-feed-footer"${footerPadding}>
                <span><span class="live-feed-footer-dot"></span>リアルタイム接続中</span>
                <span>最終更新: ${allEntries[0] ? escapeHtml(this._formatTime(allEntries[0].timestamp)) : '--:--:--'}</span>
                <span>表示: ${escapeHtml(this._displayModeLabel())}</span>
            </div>
        </div>`;

        this._bindScopeEvents();
        refreshIcons({ nodes: [this._container] });
    }

    _bindScopeEvents() {
        if (!this._container) return;
        this._container.querySelectorAll('.feed-scope-btn[data-scope]').forEach((button) => {
            button.addEventListener('click', () => {
                const scope = button.dataset.scope || 'current';
                if (scope === this._activeScope || button.disabled) return;
                this._activeScope = scope;
                this._render();
            });
        });
    }

    unmount() {
        if (this._unsubEntry) {
            this._unsubEntry();
            this._unsubEntry = null;
        }
        if (this._unsubCurrentSession) {
            this._unsubCurrentSession();
            this._unsubCurrentSession = null;
        }
        this.liveFeedService.stop();
        if (this._container) this._container.innerHTML = '';
    }

    destroy() {
        this.unmount();
    }
}
