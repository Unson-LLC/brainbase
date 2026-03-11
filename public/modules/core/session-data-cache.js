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
     * @param {string} scope - キャッシュスコープ
     * @returns {string} キャッシュキー
     * @private
     */
    _getKey(type, scope = 'global') {
        return `${scope}:${type}`;
    }

    /**
     * キャッシュから値を取得
     * @param {string} type - データ種別（tasks, schedule）
     * @param {string} scope - キャッシュスコープ
     * @returns {*|null} キャッシュヒット時は値、ミス時はnull
     */
    get(type, scope = 'global') {
        const key = this._getKey(type, scope);
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
     * @param {string} scope - キャッシュスコープ
     * @param {*} value - 保存する値
     */
    set(type, scope = 'global', value) {
        const key = this._getKey(type, scope);
        const ttl = this._ttls[type];
        const expiresAt = Date.now() + ttl;

        this._cache.set(key, { value, expiresAt });
        this._log('Cache set', { key, ttl });
    }

    /**
     * 対象スコープのキャッシュを無効化
     * @param {string} scope - キャッシュスコープ
     */
    invalidateScope(scope) {
        const keysToDelete = [];
        for (const key of this._cache.keys()) {
            if (key.startsWith(`${scope}:`)) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => this._cache.delete(key));
        this._log('Cache scope invalidated', { scope, count: keysToDelete.length });
    }

    /**
     * 対象データ種別のキャッシュを無効化
     * @param {string} type - データ種別（tasks, schedule）
     * @param {string} scope - キャッシュスコープ
     */
    invalidateType(type, scope = 'global') {
        const key = this._getKey(type, scope);
        const deleted = this._cache.delete(key);
        this._log('Cache type invalidated', { key, deleted });
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
