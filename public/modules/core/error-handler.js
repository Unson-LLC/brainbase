/**
 * 共通エラーハンドリングラッパー
 * QAレビュー改善: 一元的なエラー分類・リトライ・ロギング機能
 */

// エラー分類
export const ErrorType = {
    NETWORK: 'network',      // オフライン、タイムアウト
    CLIENT: 'client',        // 4xx
    SERVER: 'server',        // 5xx
    VALIDATION: 'validation', // クライアント検証エラー
    UNKNOWN: 'unknown'
};

/**
 * エラー分類関数
 * @param {Error} error - 分類するエラー
 * @returns {string} ErrorType値
 */
export function classifyError(error) {
    // ネットワークエラー（オフライン、タイムアウト、fetch失敗）
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return ErrorType.NETWORK;
    }
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
        return ErrorType.NETWORK;
    }
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
        return ErrorType.NETWORK;
    }

    // HTTPステータスコードベースの分類
    const status = error.status || error.statusCode;
    if (status) {
        if (status >= 400 && status < 500) {
            return ErrorType.CLIENT;
        }
        if (status >= 500) {
            return ErrorType.SERVER;
        }
    }

    // バリデーションエラー
    if (error.name === 'ValidationError' || error.type === 'validation') {
        return ErrorType.VALIDATION;
    }

    return ErrorType.UNKNOWN;
}

/**
 * リトライ可能判定
 * @param {Error} error - 判定するエラー
 * @returns {boolean} リトライ可能かどうか
 */
export function isRetryable(error) {
    const type = classifyError(error);
    return type === ErrorType.NETWORK || type === ErrorType.SERVER;
}

/**
 * 指数バックオフ付きリトライ
 * @param {Function} fn - リトライ対象の非同期関数
 * @param {Object} options - オプション
 * @param {number} options.maxRetries - 最大リトライ回数（デフォルト: 3）
 * @param {number} options.baseDelay - 基本遅延時間ms（デフォルト: 1000）
 * @param {number} options.maxDelay - 最大遅延時間ms（デフォルト: 10000）
 * @param {Function} options.onRetry - リトライ時コールバック
 * @returns {Promise<*>} fn()の戻り値
 */
export async function withRetry(fn, options = {}) {
    const {
        maxRetries = 3,
        baseDelay = 1000,
        maxDelay = 10000,
        onRetry = null
    } = options;

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // 最終試行またはリトライ不可の場合は即座にthrow
            if (attempt === maxRetries || !isRetryable(error)) {
                throw error;
            }

            // 指数バックオフ + ジッター
            const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
            const jitter = delay * 0.1 * Math.random();
            const totalDelay = delay + jitter;

            // リトライコールバック
            if (onRetry) {
                onRetry({ attempt, error, nextDelay: totalDelay });
            }

            await new Promise(resolve => setTimeout(resolve, totalDelay));
        }
    }
    throw lastError;
}

/**
 * サービスエラーラッパー
 * @param {string} serviceName - サービス名
 * @param {string} methodName - メソッド名
 * @param {Function} fn - 実行する非同期関数
 * @returns {Promise<*>} fn()の戻り値
 */
export async function handleServiceCall(serviceName, methodName, fn) {
    try {
        return await fn();
    } catch (error) {
        const type = classifyError(error);
        console.error(`[${serviceName}.${methodName}] ${type}: ${error.message}`, {
            type,
            error,
            serviceName,
            methodName,
            timestamp: Date.now()
        });
        throw error;
    }
}
