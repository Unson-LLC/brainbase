/**
 * Live Feed Service
 * EventBusのイベントを収集してフィードとして提供
 */
import { eventBus, EVENTS } from '../../core/event-bus.js';

const MAX_ENTRIES = 200;

const EVENT_LABELS = {
    [EVENTS.SESSION_CREATED]: { label: 'セッション作成', icon: 'plus-circle' },
    [EVENTS.SESSION_CHANGED]: { label: 'セッション切替', icon: 'arrow-right' },
    [EVENTS.SESSION_ARCHIVED]: { label: 'セッションアーカイブ', icon: 'archive' },
    [EVENTS.SESSION_PAUSED]: { label: 'セッション一時停止', icon: 'pause' },
    [EVENTS.SESSION_RESUMED]: { label: 'セッション再開', icon: 'play' },
    [EVENTS.TASK_CREATED]: { label: 'タスク作成', icon: 'plus' },
    [EVENTS.TASK_COMPLETED]: { label: 'タスク完了', icon: 'check-circle' },
    [EVENTS.TASK_UPDATED]: { label: 'タスク更新', icon: 'edit' },
    [EVENTS.TASK_DELETED]: { label: 'タスク削除', icon: 'trash-2' },
    [EVENTS.COMMIT_LOG_LOADED]: { label: 'コミットログ更新', icon: 'git-commit' },
    [EVENTS.SCHEDULE_UPDATED]: { label: 'スケジュール更新', icon: 'calendar' },
    [EVENTS.NOCODB_TASK_CREATED]: { label: 'プロジェクトタスク作成', icon: 'database' },
    [EVENTS.NOCODB_TASK_UPDATED]: { label: 'プロジェクトタスク更新', icon: 'database' },
};

export class LiveFeedService {
    constructor() {
        this.entries = [];
        this._listeners = [];
        this._unsubscribers = [];
        this._started = false;
    }

    start() {
        if (this._started) return;
        this._started = true;

        for (const eventName of Object.keys(EVENT_LABELS)) {
            const unsub = eventBus.on(eventName, (e) => {
                this._addEntry(eventName, e.detail);
            });
            this._unsubscribers.push(unsub);
        }
    }

    stop() {
        this._unsubscribers.forEach(fn => fn());
        this._unsubscribers = [];
        this._started = false;
    }

    _addEntry(eventName, detail) {
        const meta = EVENT_LABELS[eventName];
        if (!meta) return;

        const entry = {
            id: Date.now() + Math.random(),
            timestamp: new Date(),
            event: eventName,
            label: meta.label,
            icon: meta.icon,
            detail: this._summarize(eventName, detail)
        };

        this.entries.unshift(entry);
        if (this.entries.length > MAX_ENTRIES) {
            this.entries.length = MAX_ENTRIES;
        }

        this._notify(entry);
    }

    _summarize(eventName, detail) {
        if (!detail) return '';
        if (detail.sessionId) return detail.sessionId.slice(0, 20);
        if (detail.taskId) return `task: ${detail.taskId}`;
        if (detail.name) return detail.name;
        return '';
    }

    onEntry(callback) {
        this._listeners.push(callback);
        return () => {
            this._listeners = this._listeners.filter(fn => fn !== callback);
        };
    }

    _notify(entry) {
        for (const fn of this._listeners) {
            try { fn(entry); } catch { /* ignore */ }
        }
    }

    getEntries() {
        return this.entries;
    }
}
