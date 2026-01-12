import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { escapeHtml } from '../../ui-helpers.js';

/**
 * タイムライン表示のUIコンポーネント
 */
export class TimelineView {
    constructor({ scheduleService }) {
        this.scheduleService = scheduleService;
        this.container = null;
        this._unsubscribers = [];

        // モーダルコールバック
        this.onAddRequest = null;      // 追加モーダルを開く
        this.onEditRequest = null;     // 編集モーダルを開く

        // バインド
        this._handleClick = this._handleClick.bind(this);
        this._handleDoubleClick = this._handleDoubleClick.bind(this);
    }

    /**
     * DOMコンテナにマウント
     * @param {HTMLElement} container - マウント先のコンテナ
     */
    mount(container) {
        this.container = container;
        this._setupEventListeners();
        this._setupDOMEventListeners();
        this.render();
    }

    /**
     * EventBusイベントリスナーの設定
     */
    _setupEventListeners() {
        // イベント購読
        const unsub1 = eventBus.on(EVENTS.SCHEDULE_LOADED, () => this.render());
        const unsub2 = eventBus.on(EVENTS.SCHEDULE_UPDATED, () => this.render());

        this._unsubscribers.push(unsub1, unsub2);
    }

    /**
     * DOMイベントリスナーの設定（イベント委譲）
     */
    _setupDOMEventListeners() {
        if (!this.container) return;

        this.container.addEventListener('click', this._handleClick);
        this.container.addEventListener('dblclick', this._handleDoubleClick);
    }

    /**
     * クリックハンドラ（完了トグル・追加ボタン）
     * @param {Event} e
     */
    _handleClick(e) {
        // 追加ボタン
        const addBtn = e.target.closest('.timeline-add-btn');
        if (addBtn) {
            e.preventDefault();
            if (this.onAddRequest) {
                this.onAddRequest();
            }
            return;
        }

        // タイムラインアイテム（完了トグル）
        const item = e.target.closest('.timeline-item[data-event-id]');
        if (item) {
            const eventId = item.dataset.eventId;
            if (eventId) {
                this._toggleComplete(eventId);
            }
        }
    }

    /**
     * ダブルクリックハンドラ（編集モーダル）
     * @param {Event} e
     */
    _handleDoubleClick(e) {
        const item = e.target.closest('.timeline-item[data-event-id]');
        if (item) {
            const eventId = item.dataset.eventId;
            if (eventId && this.onEditRequest) {
                this.onEditRequest(eventId);
            }
        }
    }

    /**
     * 完了状態トグル
     * @param {string} eventId
     */
    async _toggleComplete(eventId) {
        try {
            await this.scheduleService.toggleEventComplete(eventId);
        } catch (error) {
            console.error('Failed to toggle event complete:', error);
        }
    }

    /**
     * タイムラインをレンダリング
     */
    render() {
        if (!this.container) return;

        // Kiro形式イベント（ID付き）を優先、なければlegacy形式
        const kiroEvents = this.scheduleService.getEvents();
        const legacyEvents = this.scheduleService.getTimeline();
        const events = kiroEvents.length > 0 ? kiroEvents : legacyEvents;
        const currentTime = this._getCurrentTimeStr();

        this.container.innerHTML = this._formatTimelineHTML(events, currentTime);
    }

    /**
     * 現在時刻を HH:MM 形式で取得
     * @returns {string}
     */
    _getCurrentTimeStr() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    /**
     * タイムラインHTMLを生成
     * @param {Array} events - イベント配列
     * @param {string} currentTime - 現在時刻 (HH:MM)
     * @returns {string} HTML文字列
     */
    _formatTimelineHTML(events, currentTime) {
        // 追加ボタン付きのコンテナ
        let html = '<div class="timeline">';
        html += '<button class="timeline-add-btn" title="予定を追加">+</button>';

        if (!events || events.length === 0) {
            html += '<div class="timeline-empty">予定なし</div>';
            html += '</div>';
            return html;
        }

        // Separate timed events from tasks
        const timedEvents = events.filter(e => e.start || e.allDay);
        const tasks = events.filter(e => !e.start && !e.allDay && e.isTask);

        const sortedEvents = this._sortEventsByTime(timedEvents);
        let nowInserted = false;

        sortedEvents.forEach((event) => {
            const eventTime = event.start || '00:00';

            // Insert "now" marker before future events
            if (!nowInserted && !event.allDay && eventTime > currentTime) {
                html += `<div class="timeline-now"><span class="timeline-now-label">現在 ${currentTime}</span></div>`;
                nowInserted = true;
            }

            // Determine if this is the current event
            const isCurrent = !event.allDay &&
                eventTime <= currentTime &&
                (event.end ? event.end > currentTime : true);

            // Build class list
            const currentClass = isCurrent ? ' current is-current' : '';
            const workTimeClass = event.isWorkTime ? ' is-worktime' : '';
            const completedClass = event.completed ? ' is-completed' : '';

            // Event ID for interactivity (Kiro format only)
            const eventIdAttr = event.id ? ` data-event-id="${escapeHtml(event.id)}"` : '';

            const timeLabel = event.allDay ? '終日' : (event.start + (event.end ? '-' + event.end : ''));
            const title = escapeHtml(event.title || event.task || '');

            html += `
                <div class="timeline-item is-event${currentClass}${workTimeClass}${completedClass}"${eventIdAttr}>
                    <div class="timeline-marker"></div>
                    <span class="timeline-time">${timeLabel}</span>
                    <span class="timeline-content">${title}</span>
                </div>
            `;
        });

        // Insert now marker at end if all events are past
        if (!nowInserted) {
            html += `<div class="timeline-now"><span class="timeline-now-label">現在 ${currentTime}</span></div>`;
        }

        // Add today's tasks section if any
        if (tasks.length > 0) {
            html += '<div class="timeline-tasks-section">';
            html += '<div class="timeline-tasks-header">今日のタスク</div>';
            tasks.forEach((task) => {
                html += `
                    <div class="timeline-item is-task">
                        <div class="timeline-marker task-marker"></div>
                        <span class="timeline-content">${escapeHtml(task.task || '')}</span>
                    </div>
                `;
            });
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    /**
     * イベントを開始時刻でソート
     * @param {Array} events - イベント配列
     * @returns {Array} ソート済み配列
     */
    _sortEventsByTime(events) {
        return [...events].sort((a, b) => {
            const timeA = a.start || '00:00';
            const timeB = b.start || '00:00';
            return timeA.localeCompare(timeB);
        });
    }

    /**
     * クリーンアップ
     */
    unmount() {
        // EventBus購読解除
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];

        // DOMイベントリスナー解除
        if (this.container) {
            this.container.removeEventListener('click', this._handleClick);
            this.container.removeEventListener('dblclick', this._handleDoubleClick);
            this.container.innerHTML = '';
            this.container = null;
        }
    }
}
