import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';

/**
 * ブラウザ通知サービス
 * Notification APIをラップし、EventBus統合とフォールバック機能を提供
 */
export class BrowserNotificationService {
    constructor() {
        this.eventBus = eventBus;
        this.store = appStore;

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
        // Notification APIが利用可能な場合、現在の権限を取得してStoreに反映
        if (this._isNotificationSupported()) {
            const apiPermission = Notification.permission;
            this.store.setState({ browserNotificationPermission: apiPermission });
        }
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
        const unsubRequest = this.eventBus.on(EVENTS.NOTIFICATION_REQUEST, async () => {
            await this.requestPermission();
        });
        this._unsubscribeFunctions.push(unsubRequest);

        // NOTIFICATION_SEND イベントで通知送信
        const unsubSend = this.eventBus.on(EVENTS.NOTIFICATION_SEND, async (event) => {
            const { title, options } = event.detail;
            this.notify(title, options);
        });
        this._unsubscribeFunctions.push(unsubSend);
    }

    /**
     * 通知許可をリクエスト
     * @returns {Promise<string>} 権限状態 ('granted' | 'denied' | 'default')
     */
    async requestPermission() {
        // Notification APIがサポートされていない場合
        if (!this._isNotificationSupported()) {
            const error = new Error('Notification API is not supported');
            await this.eventBus.emit(EVENTS.NOTIFICATION_ERROR, { error });
            return 'denied';
        }

        try {
            const permission = await Notification.requestPermission();

            // Storeを更新
            this.store.setState({ browserNotificationPermission: permission });

            // イベント発火
            await this.eventBus.emit(EVENTS.NOTIFICATION_PERMISSION_CHANGED, { permission });

            return permission;
        } catch (error) {
            await this.eventBus.emit(EVENTS.NOTIFICATION_ERROR, { error });
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
        // Notification APIがサポートされていない場合はフォールバック
        if (!this._isNotificationSupported()) {
            return this._fallbackNotification(title, options);
        }

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
            this.eventBus.emit(EVENTS.NOTIFICATION_ERROR, { error, title, options });
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
        // Storeから取得
        const { browserNotificationPermission } = this.store.getState();
        return browserNotificationPermission || 'default';
    }

    /**
     * 通知権限があるか確認
     * @returns {boolean}
     */
    hasPermission() {
        if (!this._isNotificationSupported()) {
            return false;
        }
        return Notification.permission === 'granted';
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
