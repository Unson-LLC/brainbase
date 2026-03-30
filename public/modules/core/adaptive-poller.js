// @ts-check
/**
 * アダプティブポーリング（CommandMate移植）
 *
 * セッション状態に応じてポーリング間隔を動的に変更:
 * - Active（AI処理中）: 高頻度（デフォルト2秒）
 * - Idle（待機中）: 低頻度（デフォルト5秒）
 *
 * サーバー負荷削減とレスポンシブ性の両立。
 */

const DEFAULT_ACTIVE_INTERVAL = 2000;
const DEFAULT_IDLE_INTERVAL = 5000;

export class AdaptivePoller {
    /**
     * @param {Function} pollFn - ポーリング実行関数
     * @param {Object} [options]
     * @param {number} [options.activeIntervalMs=2000]
     * @param {number} [options.idleIntervalMs=5000]
     */
    constructor(pollFn, options = {}) {
        this._pollFn = pollFn;
        this._activeInterval = options.activeIntervalMs || DEFAULT_ACTIVE_INTERVAL;
        this._idleInterval = options.idleIntervalMs || DEFAULT_IDLE_INTERVAL;
        this._isActive = false;
        this._timer = null;
        this._running = false;
    }

    /**
     * ポーリング開始（初回即時実行）
     */
    start() {
        if (this._running) return;
        this._running = true;
        this._pollFn();
        this._scheduleNext();
    }

    /**
     * ポーリング停止
     */
    stop() {
        this._running = false;
        if (this._timer !== null) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    /**
     * アクティブ/アイドル状態を切り替え
     * 状態が変わった場合のみタイマーをリセット
     */
    setActive(active) {
        const wasActive = this._isActive;
        this._isActive = Boolean(active);
        if (wasActive !== this._isActive && this._running) {
            this._scheduleNext();
        }
    }

    /**
     * 現在のポーリング間隔を返す
     */
    getCurrentInterval() {
        return this._isActive ? this._activeInterval : this._idleInterval;
    }

    _scheduleNext() {
        if (this._timer !== null) {
            clearInterval(this._timer);
        }
        this._timer = setInterval(() => {
            this._pollFn();
        }, this.getCurrentInterval());
    }
}
