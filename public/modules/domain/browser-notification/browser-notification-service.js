import { eventBus as defaultEventBus, EVENTS } from '../../core/event-bus.js';
import { appStore as defaultStore } from '../../core/store.js';

/**
 * ブラウザ通知サービス
 * Notification APIをラップし、EventBus統合とフォールバック機能を提供
 */
export class BrowserNotificationService {
    constructor({
        eventBus: injectedEventBus = defaultEventBus,
        store: injectedStore = defaultStore
    } = {}) {
        this.eventBus = injectedEventBus;
        this.store = injectedStore;

        // 購読解除関数を保持（先に初期化）
        this._unsubscribeFunctions = [];

        // 権限状態を同期
        this._syncPermissionState();

        // イベント購読を設定
        this._setupEventListeners();
    }

    /**
     * 権限状態をNotification APIと同期
     * @private
     */
    _syncPermissionState() {
        this._updatePermissionState(this._getPermissionFromApi());
    }

    /**
     * 権限状態をStoreに保存
     * @param {string|null} permission
     * @returns {string|null}
     * @private
     */
    _updatePermissionState(permission) {
        if (!permission) {
            return null;
        }

        this.store.setState({ browserNotificationPermission: permission });
        return permission;
    }

    /**
     * Notification APIがサポートされているか確認
     * @returns {boolean}
     * @private
     */
    _isNotificationSupported() {
        return typeof Notification !== 'undefined';
    }

    /**
     * EventBusイベントリスナーを設定
     * @private
     */
    _setupEventListeners() {
        // NOTIFICATION_REQUEST イベントで権限リクエスト
        this._subscribe(EVENTS.NOTIFICATION_REQUEST, async () => {
            await this.requestPermission();
        });

        // NOTIFICATION_SEND イベントで通知送信
        this._subscribe(EVENTS.NOTIFICATION_SEND, async (event) => {
            const { title, options } = event.detail;
            this.notify(title, options);
        });
    }

    /**
     * 通知許可をリクエスト
     * @returns {Promise<string>} 権限状態 ('granted' | 'denied' | 'default')
     */
    async requestPermission() {
        // Notification APIがサポートされていない場合
        if (!this._isNotificationSupported()) {
            await this._emitError(new Error('Notification API is not supported'));
            return 'denied';
        }

        try {
            const permission = this._updatePermissionState(
                await Notification.requestPermission()
            );

            // イベント発火
            await this.eventBus.emit(EVENTS.NOTIFICATION_PERMISSION_CHANGED, { permission });

            return permission;
        } catch (error) {
            await this._emitError(error);
            return 'denied';
        }
    }

    /**
     * 通知を送信
     * @param {string} title - 通知タイトル
     * @param {Object} options - 通知オプション (body, icon, tag, data等)
     * @returns {Object} 通知結果 ({ sent: boolean, fallback?: boolean, type?: string })
     */
    notify(title, options = {}) {
        // 権限がない場合はフォールバック
        if (!this.hasPermission()) {
            return this._fallbackNotification(title, options);
        }

        try {
            // 通知を作成
            const notification = new Notification(title, options);

            // クリックハンドラーを設定
            notification.onclick = () => {
                // ウィンドウにフォーカス
                if (typeof window !== 'undefined') {
                    window.focus();
                }

                // イベント発火
                this.eventBus.emit(EVENTS.NOTIFICATION_CLICKED, {
                    title,
                    data: options.data || {}
                });

                // 通知を閉じる
                notification.close();
            };

            // 通知送信イベントを発火
            this.eventBus.emit(EVENTS.NOTIFICATION_SENT, { title, options });

            return { sent: true };
        } catch (error) {
            // エラー時はフォールバック
            this._emitError(error, { title, options });
            return this._fallbackNotification(title, options);
        }
    }

    /**
     * フォールバック通知（Inbox通知）
     * @param {string} title - 通知タイトル
     * @param {Object} options - 通知オプション
     * @returns {Object} フォールバック結果
     * @private
     */
    _fallbackNotification(title, options = {}) {
        // フォールバックイベントを発火
        this.eventBus.emit(EVENTS.NOTIFICATION_FALLBACK, {
            title,
            body: options.body || '',
            data: options.data || {}
        });

        return {
            sent: false,
            fallback: true,
            type: 'inbox'
        };
    }

    /**
     * 現在の権限状態を取得
     * @returns {string} 権限状態 ('granted' | 'denied' | 'default')
     */
    getPermissionState() {
        const { browserNotificationPermission } = this.store.getState();
        if (browserNotificationPermission) {
            return browserNotificationPermission;
        }

        const apiPermission = this._getPermissionFromApi();
        return apiPermission || 'default';
    }

    /**
     * 通知権限があるか確認
     * @returns {boolean}
     */
    hasPermission() {
        return this.getPermissionState() === 'granted';
    }

    /**
     * Notification APIから権限を取得
     * @returns {string|null}
     * @private
     */
    _getPermissionFromApi() {
        if (!this._isNotificationSupported()) {
            return null;
        }
        return Notification.permission;
    }

    /**
     * Notification Errorイベントを発火
     * @param {Error} error
     * @param {Object} context
     * @returns {Promise<{success: boolean}>}
     * @private
     */
    _emitError(error, context = {}) {
        return this.eventBus.emit(EVENTS.NOTIFICATION_ERROR, {
            error,
            ...context
        });
    }

    /**
     * EventBus購読を登録し解除関数を保持
     * @param {string} eventName
     * @param {Function} handler
     * @private
     */
    _subscribe(eventName, handler) {
        const unsubscribe = this.eventBus.on(eventName, handler);
        this._unsubscribeFunctions.push(unsubscribe);
        return unsubscribe;
    }

    /**
     * サービスを破棄（イベントリスナーを解除）
     */
    destroy() {
        // すべてのイベント購読を解除
        for (const unsubscribe of this._unsubscribeFunctions) {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        }
        this._unsubscribeFunctions = [];
    }
}
