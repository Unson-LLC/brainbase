// @ts-check
/**
 * Live Feed View
 * セッション横断で現在のAIアクティビティを時系列表示する。
 */
import { escapeHtml, refreshIcons } from '../../ui-helpers.js';

const FEED_FILTERS = [
    { id: 'all', label: 'すべて' },
    { id: 'task', label: 'タスク' },
    { id: 'wiki', label: 'Wiki' },
    { id: 'session', label: 'セッション' },
    { id: 'system', label: 'システム' },
];

export class LiveFeedView {
    constructor({ liveFeedService, service, eventBus, container }) {
        this.liveFeedService = liveFeedService || service;
        this._container = container || null;
        this._unsubEntry = null;
        this._activeFilter = 'all';
        this._activeSessionId = null;
        this._activityDisplayMode = 'groups';
    }

    mount(container) {
        this._container = container;
        this.liveFeedService.start();
        this._render();
        this._unsubEntry = this.liveFeedService.onEntry(() => {
            this._render();
        });
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

    _entryText(entry) {
        return [
            entry.label,
            entry.sessionId,
            entry.taskBrief,
            entry.currentStep,
            entry.latestEvidence,
            entry.text,
            entry.provenanceLabel,
            entry.statusText,
            entry.icon,
        ].filter(Boolean).join(' ');
    }

    _entryCategories(entry) {
        const text = this._entryText(entry).toLowerCase();
        const categories = new Set();

        if (entry.taskBrief || /(^|\s)#?p\d\b/i.test(text) || text.includes('task') || text.includes('タスク') || text.includes('nocodb') || text.includes('bug-')) {
            categories.add('task');
        }

        if (text.includes('wiki') || text.includes('ウィキ') || text.includes('記事') || entry.icon === 'file-text' || entry.icon === 'book-open') {
            categories.add('wiki');
        }

        if (
            entry.statusTone === 'blocked'
            || entry.statusTone === 'paused'
            || ['square', 'settings', 'alert-triangle', 'circle-alert'].includes(entry.icon)
            || text.includes('system')
            || text.includes('システム')
            || text.includes('auto-update')
            || text.includes('エラー')
            || text.includes('停止')
        ) {
            categories.add('system');
        }

        if (
            categories.size === 0
            || text.includes('session')
            || text.includes('セッション')
            || text.includes('応答')
            || text.includes('入力待ち')
            || text.includes('待機')
            || text.includes('完了')
            || entry.sessionId
        ) {
            categories.add('session');
        }

        return categories;
    }

    _filterEntries(entries) {
        if (this._activeFilter === 'all') return entries;
        return entries.filter((entry) => this._entryCategories(entry).has(this._activeFilter));
    }

    _filterCounts(entries) {
        const counts = { all: entries.length, task: 0, wiki: 0, session: 0, system: 0 };
        for (const entry of entries) {
            const categories = this._entryCategories(entry);
            for (const category of categories) {
                if (category in counts) counts[category] += 1;
            }
        }
        return counts;
    }

    _activeFilterLabel() {
        return FEED_FILTERS.find((filter) => filter.id === this._activeFilter)?.label || 'すべて';
    }

    _getDisplayedEntries() {
        if (typeof this.liveFeedService.getHistoryEntries === 'function') {
            return this.liveFeedService.getHistoryEntries(this._activeSessionId
                ? { mode: 'session', sessionId: this._activeSessionId }
                : { mode: 'all' });
        }
        return this.liveFeedService.getEntries();
    }

    _getSessionHistoryGroups() {
        if (
            this._activeSessionId
            || this._activityDisplayMode !== 'groups'
            || typeof this.liveFeedService.getSessionHistoryGroups !== 'function'
        ) {
            return null;
        }
        return this.liveFeedService.getSessionHistoryGroups({ limitPerSession: 5 });
    }

    _sessionOptions(entries) {
        const byId = new Map();
        for (const entry of entries) {
            if (!entry?.sessionId) continue;
            byId.set(entry.sessionId, entry.label || entry.sessionId);
        }
        return Array.from(byId.entries()).map(([id, label]) => ({ id, label }));
    }

    _renderFilters(entries) {
        const counts = this._filterCounts(entries);
        return FEED_FILTERS.map((filter) => {
            const active = filter.id === this._activeFilter;
            return `<button class="feed-filter-btn${active ? ' active' : ''}" type="button" data-filter="${filter.id}" aria-pressed="${active ? 'true' : 'false'}">
                <span>${filter.label}</span>
                <span class="feed-filter-count">${counts[filter.id] || 0}</span>
            </button>`;
        }).join('');
    }

    _renderSessionScope(entries) {
        const scopeEntries = typeof this.liveFeedService.getHistoryEntries === 'function'
            ? this.liveFeedService.getHistoryEntries({ mode: 'all' })
            : entries;
        const sessions = this._sessionOptions(scopeEntries);
        if (sessions.length <= 1) return '';
        const allActive = !this._activeSessionId;
        return `<div class="live-feed-session-scope" aria-label="Live Feed session scope">
            <button class="feed-session-chip${allActive ? ' active' : ''}" type="button" data-session-scope="all" aria-pressed="${allActive ? 'true' : 'false'}">全体</button>
            ${sessions.map((session) => {
                const active = session.id === this._activeSessionId;
                return `<button class="feed-session-chip${active ? ' active' : ''}" type="button" data-session-scope="${escapeHtml(session.id)}" aria-pressed="${active ? 'true' : 'false'}">${escapeHtml(session.label)}</button>`;
            }).join('')}
        </div>`;
    }

    _renderDisplayModeToggle() {
        if (this._activeSessionId || typeof this.liveFeedService.getSessionHistoryGroups !== 'function') {
            return '';
        }
        const modes = [
            { id: 'groups', label: '履歴' },
            { id: 'log', label: 'ログ' }
        ];
        return `<div class="live-feed-display-mode" aria-label="Live Feed display mode">
            ${modes.map((mode) => {
                const active = mode.id === this._activityDisplayMode;
                return `<button class="feed-view-mode-btn${active ? ' active' : ''}" type="button" data-feed-mode="${mode.id}" aria-pressed="${active ? 'true' : 'false'}">${mode.label}</button>`;
            }).join('')}
        </div>`;
    }

    _renderGroups(entries) {
        if (entries.length === 0) {
            const label = escapeHtml(this._activeFilterLabel());
            return `<div class="live-feed-empty">
                <i data-lucide="radio"></i>
                <p>${label}の更新はありません</p>
                <span>別のフィルタを選ぶと他の更新を確認できます。</span>
            </div>`;
        }

        const groups = [
            ['NOW', entries.slice(0, 3)],
            ['RECENT', entries.slice(3, 8)],
            ['EARLIER', entries.slice(8)],
        ].filter(([, items]) => items.length > 0);

        return groups.map(([label, items]) => `<section class="feed-section">
            <div class="feed-section-label">${label}</div>
            ${items.map((entry) => this._renderEntry(entry)).join('')}
        </section>`).join('');
    }

    _renderSessionGroups(groups) {
        const visibleGroups = groups
            .map((group) => ({
                ...group,
                entries: this._filterEntries(group.entries)
            }))
            .filter((group) => group.entries.length > 0);

        if (visibleGroups.length === 0) {
            const label = escapeHtml(this._activeFilterLabel());
            return `<div class="live-feed-empty">
                <i data-lucide="radio"></i>
                <p>${label}の更新はありません</p>
                <span>別のフィルタを選ぶと他の更新を確認できます。</span>
            </div>`;
        }

        return visibleGroups.map((group) => {
            const latestTime = group.latestTimestamp ? this._formatTime(group.latestTimestamp) : '--:--:--';
            return `<section class="feed-section feed-session-section" data-session-id="${escapeHtml(group.sessionId)}">
                <div class="feed-section-label feed-session-section-label">
                    <span>${escapeHtml(group.label)}</span>
                    <span>${escapeHtml(group.sessionId)}</span>
                    <span>${escapeHtml(latestTime)}</span>
                </div>
                ${group.entries.map((entry) => this._renderEntry(entry)).join('')}
            </section>`;
        }).join('');
    }

    _renderEntry(entry) {
        const time = this._formatTime(entry.timestamp);
        const taskBrief = entry.taskBrief
            ? `<span class="feed-item-task">${escapeHtml(entry.taskBrief)}</span>`
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
        const provenance = entry.provenanceLabel
            ? `<span class="feed-item-source">${escapeHtml(entry.provenanceLabel)}</span>`
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
                    ${taskBrief}
                    <span class="feed-item-session">${escapeHtml(entry.sessionId || '')}</span>
                    ${provenance}
                </div>
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
        const sessionGroups = this._getSessionHistoryGroups();
        if (sessionGroups) {
            list.innerHTML = this._renderSessionGroups(sessionGroups);
            refreshIcons({ nodes: [list] });
            return;
        }
        const entries = this._getDisplayedEntries();
        list.innerHTML = this._renderGroups(this._filterEntries(entries));
        refreshIcons({ nodes: [list] });
    }

    _render() {
        if (!this._container) return;

        const entries = this._getDisplayedEntries();
        const sessionGroups = this._getSessionHistoryGroups();
        const filteredEntries = this._filterEntries(entries);
        const entriesHtml = sessionGroups
            ? this._renderSessionGroups(sessionGroups)
            : this._renderGroups(filteredEntries);
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
                <div class="live-feed-filter-group" aria-label="Live Feed filters">
                    ${this._renderFilters(entries)}
                </div>
                <div class="live-feed-controls">
                    ${this._renderDisplayModeToggle()}
                    <button class="feed-control-btn" type="button" aria-label="一時停止" aria-disabled="true" disabled title="未対応" style="cursor: not-allowed; opacity: 0.55;"><i data-lucide="pause"></i></button>
                    <button class="feed-control-btn" type="button" aria-label="更新" aria-disabled="true" disabled title="未対応" style="cursor: not-allowed; opacity: 0.55;"><i data-lucide="refresh-cw"></i></button>
                    <button class="feed-control-btn" type="button" aria-label="フィルタ" aria-disabled="true" disabled title="未対応" style="cursor: not-allowed; opacity: 0.55;"><i data-lucide="sliders-horizontal"></i></button>
                </div>
            </div>
            ${this._renderSessionScope(entries)}
            <div class="live-feed-list">${entriesHtml}</div>
            <div class="live-feed-footer"${footerPadding}>
                <span><span class="live-feed-footer-dot"></span>リアルタイム接続中</span>
                <span>最終更新: ${entries[0] ? escapeHtml(this._formatTime(entries[0].timestamp)) : '--:--:--'}</span>
                <span>表示: ${escapeHtml(this._activeSessionId ? 'セッション履歴' : this._activeFilterLabel())}</span>
            </div>
        </div>`;

        this._bindFilterEvents();
        this._bindSessionScopeEvents();
        this._bindDisplayModeEvents();
        refreshIcons({ nodes: [this._container] });
    }

    _bindFilterEvents() {
        if (!this._container) return;
        this._container.querySelectorAll('.feed-filter-btn[data-filter]').forEach((button) => {
            button.addEventListener('click', () => {
                const filter = button.dataset.filter || 'all';
                if (filter === this._activeFilter) return;
                this._activeFilter = filter;
                this._render();
            });
        });
    }

    _bindSessionScopeEvents() {
        if (!this._container) return;
        this._container.querySelectorAll('.feed-session-chip[data-session-scope]').forEach((button) => {
            button.addEventListener('click', () => {
                const scope = button.dataset.sessionScope || 'all';
                const nextSessionId = scope === 'all' ? null : scope;
                if (nextSessionId === this._activeSessionId) return;
                this._activeSessionId = nextSessionId;
                this._activeFilter = 'all';
                this._render();
            });
        });
    }

    _bindDisplayModeEvents() {
        if (!this._container) return;
        this._container.querySelectorAll('.feed-view-mode-btn[data-feed-mode]').forEach((button) => {
            button.addEventListener('click', () => {
                const mode = button.dataset.feedMode || 'groups';
                if (mode === this._activityDisplayMode) return;
                this._activityDisplayMode = mode === 'log' ? 'log' : 'groups';
                this._render();
            });
        });
    }

    unmount() {
        if (this._unsubEntry) {
            this._unsubEntry();
            this._unsubEntry = null;
        }
        this.liveFeedService.stop();
        if (this._container) this._container.innerHTML = '';
    }

    destroy() {
        this.unmount();
    }
}
