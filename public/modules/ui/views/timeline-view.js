import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { escapeHtml, refreshIcons } from '../../ui-helpers.js';
import { BaseView } from './base-view.js';

/**
 * タイムライン表示のUIコンポーネント
 */
export class TimelineView extends BaseView {
    constructor({ scheduleService }) {
        super();
        this.scheduleService = scheduleService;
        this.googleCalendarAuthStatus = null;
        this._googleCalendarBusy = false;
        this._showGoogleCalendarDiagnostics = false;

        // モーダルコールバック
        this.onAddRequest = null;      // 追加モーダルを開く
        this.onEditRequest = null;     // 編集モーダルを開く

        // バインド
        this._handleClick = this._handleClick.bind(this);
        this._handleDoubleClick = this._handleDoubleClick.bind(this);
        this._handleGoogleCalendarButtonClick = this._handleGoogleCalendarButtonClick.bind(this);
        this._handleGoogleCalendarDiagnosticsClick = this._handleGoogleCalendarDiagnosticsClick.bind(this);
    }

    /**
     * DOMコンテナにマウント
     * @param {HTMLElement} container - マウント先のコンテナ
     */
    mount(container) {
        super.mount(container);
        this._setupDOMEventListeners();
        void this._refreshGoogleCalendarAuthStatus();
    }

    _setupEventListeners() {
        this._addSubscriptions(
            eventBus.on(EVENTS.SCHEDULE_LOADED, () => this.render()),
            eventBus.on(EVENTS.SCHEDULE_UPDATED, () => this.render())
        );
    }

    /**
     * DOMイベントリスナーの設定（イベント委譲）
     */
    _setupDOMEventListeners() {
        if (!this.container) return;

        this.container.addEventListener('click', this._handleClick);
        this.container.addEventListener('dblclick', this._handleDoubleClick);

        // section-header内のプラスボタン
        const addBtn = document.getElementById('add-schedule-btn');
        if (addBtn) {
            addBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (this.onAddRequest) {
                    this.onAddRequest();
                }
            });
        }

        const googleBtn = document.getElementById('google-calendar-connect-btn');
        if (googleBtn) {
            googleBtn.addEventListener('click', this._handleGoogleCalendarButtonClick);
        }

        const diagnostics = document.getElementById('google-calendar-diagnostics');
        if (diagnostics) {
            diagnostics.addEventListener('click', this._handleGoogleCalendarDiagnosticsClick);
        }
    }

    /**
     * クリックハンドラ（完了トグル・追加ボタン）
     * @param {Event} e
     */
    _handleClick(e) {
        // 編集ボタン
        const editBtn = e.target.closest('.timeline-edit-btn');
        if (editBtn) {
            e.preventDefault();
            e.stopPropagation();
            const eventId = editBtn.dataset.editId;
            if (eventId && this.onEditRequest) {
                this.onEditRequest(eventId);
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
        this._renderGoogleCalendarControls();
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
        let html = '<div class="timeline">';

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
            const googleClass = event.source === 'google-calendar' ? ' is-google-calendar' : '';

            // Google Calendarイベントは読み取り専用
            const isInteractive = event.id && event.source !== 'google-calendar';
            const eventIdAttr = isInteractive ? ` data-event-id="${escapeHtml(event.id)}"` : '';

            const timeLabel = event.allDay ? '終日' : (event.start + (event.end ? '-' + event.end : ''));
            const title = escapeHtml(event.title || event.task || '');
            const sourceBadge = event.source === 'google-calendar'
                ? '<span class="timeline-source-badge google-calendar">Google</span>'
                : '';

            const editBtn = isInteractive ? `
                <button class="timeline-edit-btn" title="編集" data-edit-id="${escapeHtml(event.id)}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                </button>
            ` : '';

            html += `
                <div class="timeline-item is-event${currentClass}${workTimeClass}${completedClass}${googleClass}"${eventIdAttr}>
                    <div class="timeline-marker"></div>
                    <span class="timeline-time">${timeLabel}</span>
                    <span class="timeline-content">${title}${sourceBadge}</span>
                    ${editBtn}
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
            if (a.allDay && !b.allDay) return -1;
            if (!a.allDay && b.allDay) return 1;
            const timeA = a.start || '00:00';
            const timeB = b.start || '00:00';
            return timeA.localeCompare(timeB);
        });
    }

    async _refreshGoogleCalendarAuthStatus(force = false) {
        try {
            this.googleCalendarAuthStatus = await this.scheduleService.getGoogleCalendarAuthStatus({ force });
        } catch (error) {
            console.warn('Failed to get Google Calendar auth status:', error);
            this.googleCalendarAuthStatus = {
                provider: 'gog',
                configured: true,
                installed: false,
                connected: false,
                defaultAccount: null,
                calendarIds: [],
                reason: 'auth_failed',
                setupCommands: []
            };
        }
        this._renderGoogleCalendarControls();
    }

    _renderGoogleCalendarControls() {
        const googleBtn = document.getElementById('google-calendar-connect-btn');
        const diagnostics = document.getElementById('google-calendar-diagnostics');
        if (!googleBtn) return;

        const status = this.googleCalendarAuthStatus || {
            provider: 'gog',
            configured: true,
            installed: false,
            connected: false,
            calendarIds: [],
            reason: 'unknown',
            setupCommands: []
        };
        const connected = Boolean(status.connected);

        googleBtn.hidden = false;
        googleBtn.disabled = this._googleCalendarBusy;
        googleBtn.classList.toggle('is-connected', connected);
        googleBtn.title = connected ? 'Google Calendar 診断を表示' : 'Google Calendar 設定を表示';
        googleBtn.setAttribute('aria-label', connected ? 'Google Calendar 診断を表示' : 'Google Calendar 設定を表示');
        googleBtn.innerHTML = '<i data-lucide="calendar"></i>';

        if (diagnostics) {
            diagnostics.hidden = !this._showGoogleCalendarDiagnostics;
            diagnostics.innerHTML = this._showGoogleCalendarDiagnostics
                ? this._formatGoogleCalendarDiagnosticsHTML(status)
                : '';
        }
        refreshIcons();
    }

    async _handleGoogleCalendarButtonClick(e) {
        e.preventDefault();
        if (!this.googleCalendarAuthStatus) {
            await this._refreshGoogleCalendarAuthStatus(true);
        }
        this._showGoogleCalendarDiagnostics = !this._showGoogleCalendarDiagnostics;
        this._renderGoogleCalendarControls();
    }

    async _handleGoogleCalendarDiagnosticsClick(e) {
        const refreshBtn = e.target.closest('#google-calendar-refresh-btn');
        if (!refreshBtn) return;

        e.preventDefault();
        this._googleCalendarBusy = true;
        this._renderGoogleCalendarControls();
        try {
            await this._refreshGoogleCalendarAuthStatus(true);
            if (this.googleCalendarAuthStatus?.connected) {
                await this.scheduleService.loadSchedule();
            }
        } catch (error) {
            console.error('Failed to refresh Google Calendar diagnostics:', error);
        } finally {
            this._googleCalendarBusy = false;
            await this._refreshGoogleCalendarAuthStatus(true);
        }
    }

    _formatGoogleCalendarDiagnosticsHTML(status) {
        const accountLine = status.connected && status.defaultAccount
            ? `<div class="timeline-google-diagnostics-row"><strong>接続中:</strong> ${escapeHtml(status.defaultAccount)}</div>`
            : '';
        const calendarsLine = Array.isArray(status.calendarIds) && status.calendarIds.length > 0
            ? `<div class="timeline-google-diagnostics-row"><strong>Calendar:</strong> ${escapeHtml(status.calendarIds.join(', '))}</div>`
            : '';
        const commandList = Array.isArray(status.setupCommands) && status.setupCommands.length > 0
            ? `
                <div class="timeline-google-diagnostics-commands">
                    ${status.setupCommands.map(command => `<code>${escapeHtml(command)}</code>`).join('')}
                </div>
            `
            : '';

        const messageMap = {
            ready: 'gog の default account で Google Calendar を読み込んでる。',
            missing_binary: 'gog が見つからない。まず CLI を入れて。',
            no_credentials: 'gog の OAuth credentials が未設定。',
            no_default_account: 'gog の default account が未設定。',
            auth_failed: 'gog の認証確認に失敗した。設定を見直して。',
            unknown: 'Google Calendar の状態を確認してね。'
        };
        const message = messageMap[status.reason] || messageMap.unknown;

        return `
            <div class="timeline-google-diagnostics-card ${status.connected ? 'is-ready' : 'is-warning'}">
                <div class="timeline-google-diagnostics-header">
                    <span class="timeline-google-diagnostics-title">Google Calendar 診断</span>
                    <button id="google-calendar-refresh-btn" class="icon-btn" title="再診断" aria-label="Google Calendar を再診断">
                        <i data-lucide="refresh-cw"></i>
                    </button>
                </div>
                <div class="timeline-google-diagnostics-message">${escapeHtml(message)}</div>
                ${accountLine}
                ${calendarsLine}
                ${!status.connected ? commandList : ''}
            </div>
        `;
    }

    /**
     * クリーンアップ
     */
    unmount() {
        if (this.container) {
            this.container.removeEventListener('click', this._handleClick);
            this.container.removeEventListener('dblclick', this._handleDoubleClick);
        }

        const googleBtn = document.getElementById('google-calendar-connect-btn');
        if (googleBtn) {
            googleBtn.removeEventListener('click', this._handleGoogleCalendarButtonClick);
        }

        const diagnostics = document.getElementById('google-calendar-diagnostics');
        if (diagnostics) {
            diagnostics.removeEventListener('click', this._handleGoogleCalendarDiagnosticsClick);
        }

        super.unmount();
    }
}
