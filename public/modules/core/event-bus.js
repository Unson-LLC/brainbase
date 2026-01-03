/**
 * アプリケーション全体のイベント通信基盤
 * Native EventTargetを活用したシンプルな実装
 */
export class EventBus extends EventTarget {
    constructor() {
        super();
        // 非同期ハンドラー管理用Map: eventName -> Set<Function>
        this._asyncHandlers = new Map();
    }

    /**
     * イベント発火（同期リスナー + 非同期リスナー対応）
     * @param {string} eventName - イベント名（例: 'task:completed'）
     * @param {any} detail - イベントデータ
     * @returns {Promise<{success: number, errors: Error[]}>} - 非同期ハンドラーの実行結果
     */
    async emit(eventName, detail) {
        // 1. 同期リスナー発火（Native EventTarget）
        this.dispatchEvent(new CustomEvent(eventName, { detail }));

        // 2. 非同期リスナー実行
        const handlers = this._asyncHandlers.get(eventName);
        if (!handlers || handlers.size === 0) {
            return { success: 0, errors: [] };
        }

        const event = { detail };
        const results = await Promise.allSettled(
            Array.from(handlers).map(handler => handler(event))
        );

        const errors = results
            .filter(r => r.status === 'rejected')
            .map(r => r.reason);

        // エラーログ出力（Observability）
        if (errors.length > 0) {
            console.error(`EventBus[${eventName}]: ${errors.length} handler(s) failed`, {
                event: eventName,
                detail,
                errors: errors.map(e => ({
                    message: e.message,
                    stack: e.stack
                }))
            });
        }

        return {
            success: handlers.size - errors.length,
            errors
        };
    }

    /**
     * イベント購読（同期ハンドラー）
     * @param {string} eventName - イベント名
     * @param {Function} callback - コールバック関数
     * @returns {Function} - 購読解除関数
     */
    on(eventName, callback) {
        this.addEventListener(eventName, callback);
        return () => this.off(eventName, callback);
    }

    /**
     * イベント購読解除（同期ハンドラー）
     * @param {string} eventName - イベント名
     * @param {Function} callback - コールバック関数
     */
    off(eventName, callback) {
        this.removeEventListener(eventName, callback);
    }

    /**
     * イベント購読（非同期ハンドラー）
     * @param {string} eventName - イベント名
     * @param {Function} asyncCallback - 非同期コールバック関数
     * @returns {Function} - 購読解除関数
     */
    onAsync(eventName, asyncCallback) {
        if (!this._asyncHandlers.has(eventName)) {
            this._asyncHandlers.set(eventName, new Set());
        }
        this._asyncHandlers.get(eventName).add(asyncCallback);
        return () => this.offAsync(eventName, asyncCallback);
    }

    /**
     * イベント購読解除（非同期ハンドラー）
     * @param {string} eventName - イベント名
     * @param {Function} asyncCallback - 非同期コールバック関数
     */
    offAsync(eventName, asyncCallback) {
        const handlers = this._asyncHandlers.get(eventName);
        if (handlers) {
            handlers.delete(asyncCallback);
        }
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
