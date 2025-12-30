/**
 * アプリケーション全体のイベント通信基盤
 * Native EventTargetを活用したシンプルな実装
 */
export class EventBus extends EventTarget {
    /**
     * イベント発火
     * @param {string} eventName - イベント名（例: 'task:completed'）
     * @param {any} detail - イベントデータ
     */
    emit(eventName, detail) {
        this.dispatchEvent(new CustomEvent(eventName, { detail }));
    }

    /**
     * イベント購読
     * @param {string} eventName - イベント名
     * @param {Function} callback - コールバック関数
     * @returns {Function} - 購読解除関数
     */
    on(eventName, callback) {
        this.addEventListener(eventName, callback);
        return () => this.off(eventName, callback);
    }

    /**
     * イベント購読解除
     * @param {string} eventName - イベント名
     * @param {Function} callback - コールバック関数
     */
    off(eventName, callback) {
        this.removeEventListener(eventName, callback);
    }
}

// グローバルインスタンス（シングルトン）
export const eventBus = new EventBus();

/**
 * アプリケーション全体で使用するイベント名定数
 */
export const EVENTS = {
    // Task関連
    TASK_LOADED: 'task:loaded',
    TASK_COMPLETED: 'task:completed',
    TASK_UPDATED: 'task:updated',
    TASK_DELETED: 'task:deleted',
    TASK_DEFERRED: 'task:deferred',
    START_TASK: 'task:start',
    EDIT_TASK: 'task:edit',
    TASK_FILTER_CHANGED: 'task:filter-changed',

    // Session関連
    SESSION_LOADED: 'session:loaded',
    SESSION_CHANGED: 'session:changed',
    SESSION_CREATED: 'session:created',
    SESSION_UPDATED: 'session:updated',
    SESSION_ARCHIVED: 'session:archived',
    SESSION_DELETED: 'session:deleted',
    SESSION_PAUSED: 'session:paused',
    SESSION_RESUMED: 'session:resumed',
    RESTART_SESSION: 'session:restart',
    STOP_SESSION: 'session:stop',
    MERGE_SESSION: 'session:merge',
    RENAME_SESSION: 'session:rename',
    CREATE_SESSION: 'session:create',

    // Schedule関連
    SCHEDULE_LOADED: 'schedule:loaded',
    SCHEDULE_UPDATED: 'schedule:updated',

    // Inbox関連
    INBOX_LOADED: 'inbox:loaded',
    INBOX_ITEM_COMPLETED: 'inbox:item-completed',

    // UI関連
    INBOX_TOGGLED: 'inbox:toggled',
    MODAL_OPENED: 'modal:opened',
    MODAL_CLOSED: 'modal:closed'
};
