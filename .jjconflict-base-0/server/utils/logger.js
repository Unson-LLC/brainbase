/**
 * Structured Logger with Sensitive Data Redaction
 *
 * 機密情報を自動的にマスクし、構造化ログを出力。
 * - password, token, secret, key, credential などを含むキーを自動redact
 * - JSON形式で出力（監視ツールとの互換性確保）
 * - 環境変数DEBUGでデバッグログを制御
 */

// 機密情報を含む可能性のあるキーのパターン
const SENSITIVE_KEYS = [
    'password',
    'token',
    'secret',
    'key',
    'credential',
    'auth',
    'apikey',
    'api_key',
    'access_token',
    'refresh_token',
    'private',
    'cookie',
    'session'
];

// パス内の機密情報パターン
const SENSITIVE_PATH_PATTERNS = [
    /\/\.env/,
    /\/credentials/,
    /\/secrets/,
    /\/\.ssh/,
    /\/\.gnupg/
];

/**
 * オブジェクト内の機密情報をマスク
 * @param {*} obj - マスク対象のオブジェクト
 * @param {number} depth - 再帰の深さ（無限ループ防止）
 * @returns {*} マスク済みオブジェクト
 */
function redact(obj, depth = 0) {
    // 再帰の深さ制限
    if (depth > 10) return '[MAX_DEPTH]';

    // null/undefinedはそのまま
    if (obj === null || obj === undefined) return obj;

    // プリミティブはそのまま
    if (typeof obj !== 'object') {
        // 文字列の場合、トークンっぽいパターンをマスク
        if (typeof obj === 'string') {
            // JWTトークンパターン
            if (/^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(obj)) {
                return '[JWT_REDACTED]';
            }
            // 長い16進数文字列（APIキーなど）
            if (/^[a-fA-F0-9]{32,}$/.test(obj)) {
                return '[HEX_KEY_REDACTED]';
            }
            // 機密パスパターン
            for (const pattern of SENSITIVE_PATH_PATTERNS) {
                if (pattern.test(obj)) {
                    return '[SENSITIVE_PATH_REDACTED]';
                }
            }
        }
        return obj;
    }

    // 配列の場合
    if (Array.isArray(obj)) {
        return obj.map(item => redact(item, depth + 1));
    }

    // オブジェクトの場合
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();

        // 機密キーの場合はマスク
        if (SENSITIVE_KEYS.some(s => lowerKey.includes(s))) {
            result[key] = '[REDACTED]';
        } else {
            result[key] = redact(value, depth + 1);
        }
    }
    return result;
}

/**
 * ログエントリをフォーマット
 * @param {string} level - ログレベル
 * @param {string} msg - メッセージ
 * @param {Object} data - 追加データ
 * @returns {string} フォーマット済みログ
 */
function formatLog(level, msg, data = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        msg,
        ...redact(data)
    };
    return JSON.stringify(entry);
}

/**
 * 構造化ロガー
 */
export const logger = {
    /**
     * INFOレベルログ
     * @param {string} msg - メッセージ
     * @param {Object} data - 追加データ
     */
    info(msg, data = {}) {
        console.log(formatLog('info', msg, data));
    },

    /**
     * WARNレベルログ
     * @param {string} msg - メッセージ
     * @param {Object} data - 追加データ
     */
    warn(msg, data = {}) {
        console.warn(formatLog('warn', msg, data));
    },

    /**
     * ERRORレベルログ
     * @param {string} msg - メッセージ
     * @param {Object} data - 追加データ
     */
    error(msg, data = {}) {
        // エラーオブジェクトの場合、スタックトレースを含める
        if (data instanceof Error) {
            data = {
                error: data.message,
                stack: data.stack
            };
        } else if (data.error instanceof Error) {
            data = {
                ...data,
                error: data.error.message,
                stack: data.error.stack
            };
        }
        console.error(formatLog('error', msg, data));
    },

    /**
     * DEBUGレベルログ（DEBUG環境変数が設定されている場合のみ出力）
     * @param {string} msg - メッセージ
     * @param {Object} data - 追加データ
     */
    debug(msg, data = {}) {
        if (process.env.DEBUG) {
            console.log(formatLog('debug', msg, data));
        }
    }
};

export default logger;
