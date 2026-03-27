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
        const statusToneClass = entry.statusTone ? ` feed-item-tone-${entry.statusTone}` : '';
        return `<div class="feed-item">
            <div class="feed-item-icon${statusToneClass}"><i data-lucide="${entry.icon}"></i></div>
            <div class="feed-item-content">
                <div class="feed-item-label">${escapeHtml(entry.label)}</div>
                ${taskBrief}
                ${currentStep}
                ${latestEvidence}
            </div>
            <div class="feed-item-time">${time}</div>
        </div>`;
    }

    _renderList() {
        if (!this._container) return;
        const list = this._container.querySelector('.live-feed-list');
        if (!list) return;
        const entries = this.liveFeedService.getEntries();
        list.innerHTML = entries.length > 0
            ? entries.map((entry) => this._renderEntry(entry)).join('')
            : `<div class="live-feed-empty">
                <p>セッションの動きを待機中...</p>
            </div>`;
        refreshIcons({ nodes: [list] });
    }

    _render() {
        if (!this._container) return;

        const entries = this.liveFeedService.getEntries();
        const entriesHtml = entries.length > 0
            ? entries.map(e => this._renderEntry(e)).join('')
            : `<div class="live-feed-empty">
                <p>セッションの動きを待機中...</p>
            </div>`;

        this._container.innerHTML = `<div class="live-feed-container">
            <div class="live-feed-header">
                <div class="live-feed-title">
                    <h3>Live Feed</h3>
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
