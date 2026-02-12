/**
 * アプリケーション全体のイベント通信基盤
 * Native EventTargetを活用したシンプルな実装
 *
 * トレーサビリティ機能:
 * - eventId: 各イベント固有のID
 * - correlationId: 操作全体を追跡するID（チェーン内で共通）
 * - causationId: 直前のイベントIDを参照（因果関係追跡）
 */
export class EventBus extends EventTarget {
    constructor() {
        super();
        // 非同期ハンドラー管理用Map: eventName -> Set<Function>
        this._asyncHandlers = new Map();
        // トレーサビリティ用
        this._currentCorrelationId = null;
        this._lastEventId = null;
    }

    /**
     * 新しいcorrelationIdを開始（ユーザー操作の起点で呼び出し）
     * @returns {string} 生成されたcorrelationId
     */
    startCorrelation() {
        this._currentCorrelationId = `corr_${crypto.randomUUID().slice(0, 8)}`;
        this._lastEventId = null;
        return this._currentCorrelationId;
    }

    /**
     * 現在のcorrelationIdを取得
     * @returns {string|null} 現在のcorrelationId
     */
    getCurrentCorrelationId() {
        return this._currentCorrelationId;
    }

    /**
     * イベントメタデータを生成
     * @param {string} [causationId] - 明示的な因果関係ID
     * @returns {Object} イベントメタデータ
     * @private
     */
    _createEventMeta(causationId) {
        // Fallback for browsers without crypto.randomUUID (e.g., Safari < 15.4)
        const getRandomId = () => {
            if (crypto.randomUUID) {
                return crypto.randomUUID();
            }
            // Fallback: generate random hex string
            return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        };
        const eventId = `evt_${getRandomId().slice(0, 8)}`;
        return {
            eventId,
            correlationId: this._currentCorrelationId || `corr_${getRandomId().slice(0, 8)}`,
            causationId: causationId || this._lastEventId,
            timestamp: Date.now()
        };
    }

    /**
     * イベント発火（同期リスナー + 非同期リスナー対応）
     * @param {string} eventName - イベント名（例: 'task:completed'）
     * @param {any} detail - イベントデータ
     * @returns {Promise<{success: number, errors: Error[], meta: Object}>} - 非同期ハンドラーの実行結果
     */
    async emit(eventName, detail) {
        // トレーサビリティ: メタデータ生成
        const meta = this._createEventMeta();
        const enrichedDetail = { ...detail, _meta: meta };

        // 最後のイベントIDを記録（次のイベントのcausationIdになる）
        this._lastEventId = meta.eventId;

        // デバッグモード時のログ出力
        if (typeof window !== 'undefined' && window.__EVENTBUS_DEBUG__) {
            console.log(`[EventBus] ${eventName}`, {
                eventId: meta.eventId,
                correlationId: meta.correlationId,
                causationId: meta.causationId
            });
        }

        // 1. 同期リスナー発火（Native EventTarget）
        this.dispatchEvent(new CustomEvent(eventName, { detail: enrichedDetail }));

        // 2. 非同期リスナー実行
        const handlers = this._asyncHandlers.get(eventName);
        if (!handlers || handlers.size === 0) {
            return { success: 0, errors: [], meta };
        }

        const event = { detail: enrichedDetail };
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
                meta,
                errors: errors.map(e => ({
                    message: e.message,
                    stack: e.stack
                }))
            });
        }

        return {
            success: handlers.size - errors.length,
            errors,
            meta
        };
    }

    /**
     * チェーン継続emit（親イベントのcorrelationIdを継承）
     * @param {string} eventName - イベント名
     * @param {any} detail - イベントデータ
     * @param {Object} parentEvent - 親イベント（event.detail._meta を参照）
     * @returns {Promise<{success: number, errors: Error[], meta: Object}>}
     */
    async emitChained(eventName, detail, parentEvent) {
        const parentMeta = parentEvent?.detail?._meta;
        if (parentMeta?.correlationId) {
            this._currentCorrelationId = parentMeta.correlationId;
        }
        return this.emit(eventName, detail);
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
    TASK_CREATED: 'task:created',
    TASK_COMPLETED: 'task:completed',
    TASK_UPDATED: 'task:updated',
    TASK_DELETED: 'task:deleted',
    TASK_DEFERRED: 'task:deferred',
    TASK_RESTORED: 'task:restored',
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
    SESSION_WORKTREE_FALLBACK: 'session:worktree-fallback',
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

    // NocoDB Task関連
    NOCODB_TASKS_LOADED: 'nocodb:tasks-loaded',
    NOCODB_TASK_CREATED: 'nocodb:task-created',
    NOCODB_TASK_UPDATED: 'nocodb:task-updated',
    NOCODB_TASK_DELETED: 'nocodb:task-deleted',
    NOCODB_TASK_ERROR: 'nocodb:task-error',
    TASK_TAB_CHANGED: 'task:tab-changed',

    // UI関連
    INBOX_TOGGLED: 'inbox:toggled',
    MODAL_OPENED: 'modal:opened',
    MODAL_CLOSED: 'modal:closed',
    MOBILE_INPUT_OPENED: 'mobile-input:opened',
    MOBILE_INPUT_CLOSED: 'mobile-input:closed',
    MOBILE_INPUT_SENT: 'mobile-input:sent',
    MOBILE_INPUT_DRAFT_SAVED: 'mobile-input:draft-saved',

    // Recovery関連 (Auto-Claude RecoveryManager pattern)
    RECOVERY_HINTS_LOADED: 'recovery:hints-loaded',
    FAILURE_RECORDED: 'recovery:failure-recorded',
    STUCK_DETECTED: 'recovery:stuck-detected',

    // QA関連 (Auto-Claude QA Loop pattern)
    QA_REVIEW_STARTED: 'qa:review-started',
    QA_REVIEW_COMPLETED: 'qa:review-completed',
    QA_REPLAN_STARTED: 'qa:replan-started',
    QA_FIXES_APPLIED: 'qa:fixes-applied',
    QA_ESCALATED: 'qa:escalated',

    // Plugin関連
    PLUGIN_CONFIG_LOADED: 'plugin:config-loaded',
    PLUGIN_REGISTERED: 'plugin:registered',
    PLUGIN_ENABLED: 'plugin:enabled',
    PLUGIN_DISABLED: 'plugin:disabled',
    PLUGIN_REQUIREMENTS_FAILED: 'plugin:requirements-failed',
    PLUGIN_SLOT_MISSING: 'plugin:slot-missing',

    // Goal Seek関連
    GOAL_SEEK_STARTED: 'goal-seek:started',
    GOAL_SEEK_PROGRESS: 'goal-seek:progress',
    GOAL_SEEK_COMPLETED: 'goal-seek:completed',
    GOAL_SEEK_FAILED: 'goal-seek:failed',
    GOAL_SEEK_CANCELLED: 'goal-seek:cancelled',
    GOAL_SEEK_CONNECTED: 'goal-seek:connected',
    GOAL_SEEK_DISCONNECTED: 'goal-seek:disconnected',
    GOAL_SEEK_ERROR: 'goal-seek:error',
    GOAL_SEEK_INTERVENTION_REQUIRED: 'goal-seek:intervention-required',
    GOAL_SEEK_INTERVENTION_RESPONDED: 'goal-seek:intervention-responded',

    // Browser Notification関連
    NOTIFICATION_PERMISSION_CHANGED: 'notification:permission-changed',
    NOTIFICATION_SENT: 'notification:sent',
    NOTIFICATION_CLICKED: 'notification:clicked',
    NOTIFICATION_FALLBACK: 'notification:fallback',
    NOTIFICATION_REQUEST: 'notification:request',
    NOTIFICATION_SEND: 'notification:send'
};
