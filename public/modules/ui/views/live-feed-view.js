/**
 * Live Feed View
 * EventBusイベントのリアルタイムフィード表示
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
        this._unsubEntry = this.liveFeedService.onEntry((entry) => {
            this._prependEntry(entry);
        });
    }

    _formatTime(date) {
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    _renderEntry(entry) {
        const time = this._formatTime(entry.timestamp);
        const detail = entry.detail
            ? `<div class="feed-item-detail">${escapeHtml(entry.detail)}</div>`
            : '';
        return `<div class="feed-item">
            <div class="feed-item-icon"><i data-lucide="${entry.icon}"></i></div>
            <div class="feed-item-content">
                <div class="feed-item-label">${escapeHtml(entry.label)}</div>
                ${detail}
            </div>
            <div class="feed-item-time">${time}</div>
        </div>`;
    }

    _prependEntry(entry) {
        if (!this._container) return;
        const list = this._container.querySelector('.live-feed-list');
        if (!list) return;

        const empty = list.querySelector('.live-feed-empty');
        if (empty) empty.remove();

        const div = document.createElement('div');
        div.innerHTML = this._renderEntry(entry);
        const el = div.firstElementChild;
        list.prepend(el);

        while (list.children.length > 200) {
            list.lastElementChild.remove();
        }

        refreshIcons({ nodes: [el] });
    }

    _render() {
        if (!this._container) return;

        const entries = this.liveFeedService.getEntries();
        const entriesHtml = entries.length > 0
            ? entries.map(e => this._renderEntry(e)).join('')
            : `<div class="live-feed-empty">
                <p>イベントを待機中...</p>
            </div>`;

        this._container.innerHTML = `<div class="live-feed-container">
            <div class="live-feed-header">
                <div class="live-feed-title">
                    <h3>Activity</h3>
                    <span class="live-feed-status active">LIVE</span>
                </div>
            </div>
            <div class="live-feed-list">${entriesHtml}</div>
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
