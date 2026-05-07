// @ts-check
/**
 * Live Feed View
 * セッション横断で現在のAIアクティビティを時系列表示する。
 */
import { escapeHtml, refreshIcons } from '../../ui-helpers.js';

export class LiveFeedView {
    constructor({ liveFeedService, service, eventBus, container }) {
        this.liveFeedService = liveFeedService || service;
        this._container = container || null;
        this._unsubEntry = null;
    }

    mount(container) {
        this._container = container;
        this.liveFeedService.start();
        this._render();
        this._unsubEntry = this.liveFeedService.onEntry(() => {
            this._renderList();
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

    _renderGroups(entries) {
        if (entries.length === 0) {
            return `<div class="live-feed-empty">
                <i data-lucide="radio"></i>
                <p>セッションの動きを待機中</p>
                <span>セッション更新、タスク変更、Wiki更新がここに流れます。</span>
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
                </div>
                ${currentStep}
                ${latestEvidence}
            </div>
            <div class="feed-item-actions">
                <button class="feed-item-action" type="button" aria-label="詳細を開く"><i data-lucide="external-link"></i></button>
                <button class="feed-item-action" type="button" aria-label="コピー"><i data-lucide="copy"></i></button>
            </div>
        </div>`;
    }

    _renderList() {
        if (!this._container) return;
        const list = this._container.querySelector('.live-feed-list');
        if (!list) return;
        const entries = this.liveFeedService.getEntries();
        list.innerHTML = this._renderGroups(entries);
        refreshIcons({ nodes: [list] });
    }

    _render() {
        if (!this._container) return;

        const entries = this.liveFeedService.getEntries();
        const entriesHtml = this._renderGroups(entries);

        this._container.innerHTML = `<div class="live-feed-container">
            <div class="live-feed-header">
                <div class="live-feed-status-wrap">
                    <span class="live-feed-status active"><span class="live-feed-status-dot"></span>LIVE</span>
                </div>
                <div class="live-feed-filter-group" aria-label="Live Feed filters">
                    <button class="feed-filter-btn active" type="button">すべて</button>
                    <button class="feed-filter-btn" type="button">タスク</button>
                    <button class="feed-filter-btn" type="button">Wiki</button>
                    <button class="feed-filter-btn" type="button">セッション</button>
                    <button class="feed-filter-btn" type="button">システム</button>
                </div>
                <div class="live-feed-controls">
                    <button class="feed-control-btn" type="button" aria-label="一時停止"><i data-lucide="pause"></i></button>
                    <button class="feed-control-btn" type="button" aria-label="更新"><i data-lucide="refresh-cw"></i></button>
                    <button class="feed-control-btn" type="button" aria-label="フィルタ"><i data-lucide="sliders-horizontal"></i></button>
                </div>
            </div>
            <div class="live-feed-list">${entriesHtml}</div>
            <div class="live-feed-footer">
                <span><span class="live-feed-footer-dot"></span>リアルタイム接続中</span>
                <span>最終更新: ${entries[0] ? escapeHtml(this._formatTime(entries[0].timestamp)) : '--:--:--'}</span>
                <span>自動スクロール: ON</span>
            </div>
        </div>`;

        refreshIcons({ nodes: [this._container] });
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
