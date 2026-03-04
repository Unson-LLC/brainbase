/**
 * セッションデータのクライアント側キャッシュ
 * Map-based TTL管理
 */
export class SessionDataCache {
    constructor() {
        this._cache = new Map(); // key -> { value, expiresAt }
        this._ttls = {
            tasks: 5 * 60 * 1000,      // 5分
            schedule: 60 * 60 * 1000   // 1時間
        };
        this._debugMode = false;
    }

    /**
     * デバッグモード設定
     * @param {boolean} enabled - デバッグモード有効化
     */
    setDebugMode(enabled) {
        this._debugMode = enabled;
    }

    /**
     * キャッシュキー生成
     * @param {string} type - データ種別（tasks, schedule）
     * @param {string} sessionId - セッションID
     * @returns {string} キャッシュキー
     * @private
     */
    _getKey(type, sessionId) {
        return `${sessionId}:${type}`;
    }

    /**
     * キャッシュから値を取得
     * @param {string} type - データ種別（tasks, schedule）
     * @param {string} sessionId - セッションID
     * @returns {*|null} キャッシュヒット時は値、ミス時はnull
     */
    get(type, sessionId) {
        const key = this._getKey(type, sessionId);
        const entry = this._cache.get(key);

        if (!entry) {
            this._log('Cache miss', { key });
            return null;
        }

        // TTLチェック
        if (Date.now() > entry.expiresAt) {
            this._log('Cache expired', { key });
            this._cache.delete(key);
            return null;
        }

        this._log('Cache hit', { key, ttl: entry.expiresAt - Date.now() });
        return entry.value;
    }

    /**
     * キャッシュに値を保存
     * @param {string} type - データ種別（tasks, schedule）
     * @param {string} sessionId - セッションID
     * @param {*} value - 保存する値
     */
    set(type, sessionId, value) {
        const key = this._getKey(type, sessionId);
        const ttl = this._ttls[type];
        const expiresAt = Date.now() + ttl;

        this._cache.set(key, { value, expiresAt });
        this._log('Cache set', { key, ttl });
    }

    /**
     * 対象セッションのキャッシュを無効化
     * @param {string} sessionId - セッションID
     */
    invalidate(sessionId) {
        const keysToDelete = [];
        for (const key of this._cache.keys()) {
            if (key.startsWith(`${sessionId}:`)) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => this._cache.delete(key));
        this._log('Cache invalidated', { sessionId, count: keysToDelete.length });
    }

    /**
     * 全キャッシュをクリア
     */
    clear() {
        this._cache.clear();
        this._log('Cache cleared');
    }

    /**
     * キャッシュ統計を取得
     * @returns {Object} 統計情報
     */
    getStats() {
        return {
            size: this._cache.size,
            keys: Array.from(this._cache.keys())
        };
    }

    /**
     * デバッグログ出力
     * @param {string} message - メッセージ
     * @param {Object} data - 追加データ
     * @private
     */
    _log(message, data = {}) {
        if (this._debugMode) {
            console.log(`[SessionDataCache] ${message}`, data);
        }
    }
}

// シングルトンインスタンス
export const sessionDataCache = new SessionDataCache();

// デバッグモードフラグ（グローバル変数で制御）
if (typeof window !== 'undefined' && window.__SESSION_CACHE_DEBUG__) {
    sessionDataCache.setDebugMode(true);
}
