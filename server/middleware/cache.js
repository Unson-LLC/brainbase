import NodeCache from 'node-cache';
import logger from '../utils/logger.js';

/**
 * In-process Cache Middleware
 *
 * Purpose:
 * - APIレスポンスをメモリキャッシュして、NocoDBへの不要なリクエストを削減
 * - パフォーマンス向上とAPI負荷軽減
 *
 * Configuration:
 * - stdTTL: 300秒（5分）- デフォルトのキャッシュ有効期間
 * - checkperiod: 10秒 - 期限切れキャッシュの削除チェック頻度
 *
 * Usage:
 * ```javascript
 * import { cacheMiddleware, clearCache } from './middleware/cache.js';
 *
 * // TTL: 5分（頻繁に変わらないデータ）
 * router.get('/critical-alerts', cacheMiddleware(300), handler);
 *
 * // TTL: 1分（リアルタイム性が必要）
 * router.get('/mana-workflow-stats', cacheMiddleware(60), handler);
 *
 * // POST/PUT/DELETE時にキャッシュクリア
 * router.post('/projects', (req, res) => {
 *   clearCache('projects');
 *   // ...
 * });
 * ```
 */

// TTL: 5分（300秒）、定期チェック: 10秒
const cache = new NodeCache({
    stdTTL: 300,
    checkperiod: 10,
    useClones: false // パフォーマンス向上のため、オブジェクトのクローンを無効化
});

// キャッシュイベントのロギング
cache.on('set', (key, value) => {
    logger.debug('Cache set', { key, valueSize: JSON.stringify(value).length });
});

cache.on('del', (key, value) => {
    logger.debug('Cache deleted', { key });
});

cache.on('expired', (key, value) => {
    logger.debug('Cache expired', { key });
});

/**
 * キャッシュミドルウェア（GET専用）
 *
 * @param {number} ttl - Time to Live（秒）デフォルト: 300秒（5分）
 * @returns {Function} Express middleware
 *
 * Example:
 * ```javascript
 * // TTL: 5分
 * router.get('/api/data', cacheMiddleware(300), handler);
 *
 * // TTL: 1分
 * router.get('/api/realtime', cacheMiddleware(60), handler);
 * ```
 */
export function cacheMiddleware(ttl = 300) {
    return (req, res, next) => {
        // GETリクエストのみキャッシュ
        if (req.method !== 'GET') {
            return next();
        }

        // キャッシュキー生成（URL + クエリパラメータ）
        const key = `${req.originalUrl}`;

        // キャッシュヒット確認
        const cachedResponse = cache.get(key);

        if (cachedResponse) {
            logger.debug('Cache hit', { key });
            return res.json(cachedResponse);
        }

        logger.debug('Cache miss', { key });

        // res.json()をオーバーライドしてキャッシュ保存
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            // 成功レスポンスのみキャッシュ（200-299）
            if (res.statusCode >= 200 && res.statusCode < 300) {
                cache.set(key, body, ttl);
                logger.debug('Cache stored', { key, ttl, bodySize: JSON.stringify(body).length });
            }
            return originalJson(body);
        };

        next();
    };
}

/**
 * キャッシュクリア（POST/PUT/DELETE時に使用）
 *
 * @param {string} pattern - クリアするキャッシュキーのパターン（部分一致）
 *
 * Example:
 * ```javascript
 * // '/api/brainbase/projects'を含む全キャッシュをクリア
 * clearCache('projects');
 *
 * // 特定のIDを含むキャッシュをクリア
 * clearCache('projects/123');
 *
 * // 全キャッシュをクリア
 * clearCache('');
 * ```
 */
export function clearCache(pattern) {
    const keys = cache.keys();
    const matchedKeys = keys.filter(key => key.includes(pattern));

    matchedKeys.forEach(key => cache.del(key));

    logger.info('Cache cleared', { pattern, clearedCount: matchedKeys.length });

    return matchedKeys.length;
}

/**
 * キャッシュ統計情報取得
 *
 * @returns {Object} キャッシュ統計
 *   - keys: 現在のキャッシュキー数
 *   - hits: ヒット数
 *   - misses: ミス数
 *   - ksize: キーサイズ
 *   - vsize: 値サイズ
 *
 * Example:
 * ```javascript
 * const stats = getCacheStats();
 * console.log('Cache hit rate:', stats.hits / (stats.hits + stats.misses));
 * ```
 */
export function getCacheStats() {
    return cache.getStats();
}

/**
 * 全キャッシュクリア（管理・テスト用）
 *
 * Example:
 * ```javascript
 * // テストのbeforeEach
 * beforeEach(() => {
 *   flushCache();
 * });
 * ```
 */
export function flushCache() {
    cache.flushAll();
    logger.info('All cache flushed');
}

// デフォルトエクスポート（テスト用）
export default cache;
