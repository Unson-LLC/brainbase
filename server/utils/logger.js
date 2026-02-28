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

const JWT_TOKEN_REGEX = /^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/;
const HEX_KEY_REGEX = /^[a-fA-F0-9]{32,}$/;
const CONSOLE_METHODS = {
    info: 'log',
    warn: 'warn',
    error: 'error',
    debug: 'log'
};

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
}

function redactString(value) {
    if (JWT_TOKEN_REGEX.test(value)) {
        return '[JWT_REDACTED]';
    }

    if (HEX_KEY_REGEX.test(value)) {
        return '[HEX_KEY_REDACTED]';
    }

    for (const pattern of SENSITIVE_PATH_PATTERNS) {
        if (pattern.test(value)) {
            return '[SENSITIVE_PATH_REDACTED]';
        }
    }

    return value;
}

function serializeError(error) {
    return {
        error: error.message,
        stack: error.stack
    };
}

function sanitizeLogData(data = {}) {
    if (data instanceof Error) {
        return serializeError(data);
    }

    if (data && typeof data === 'object' && data.error instanceof Error) {
        return {
            ...data,
            error: data.error.message,
            stack: data.error.stack
        };
    }

    return data;
}

function logAtLevel(level, msg, data = {}) {
    if (level === 'debug' && !process.env.DEBUG) {
        return;
    }

    const methodName = CONSOLE_METHODS[level] || 'log';
    const logMethod = console[methodName];
    logMethod.call(console, formatLog(level, msg, sanitizeLogData(data)));
}

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
        return typeof obj === 'string' ? redactString(obj) : obj;
    }

    // 配列の場合
    if (Array.isArray(obj)) {
        return obj.map(item => redact(item, depth + 1));
    }

    // プレーンオブジェクト以外はそのまま返す
    if (!isPlainObject(obj)) {
        return obj;
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
        msg
    };

    const redactedData = redact(data);
    if (isPlainObject(redactedData)) {
        Object.assign(entry, redactedData);
    } else if (redactedData !== undefined) {
        entry.data = redactedData;
    }

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
        logAtLevel('info', msg, data);
    },

    /**
     * WARNレベルログ
     * @param {string} msg - メッセージ
     * @param {Object} data - 追加データ
     */
    warn(msg, data = {}) {
        logAtLevel('warn', msg, data);
    },

    /**
     * ERRORレベルログ
     * @param {string} msg - メッセージ
     * @param {Object} data - 追加データ
     */
    error(msg, data = {}) {
        logAtLevel('error', msg, data);
    },

    /**
     * DEBUGレベルログ（DEBUG環境変数が設定されている場合のみ出力）
     * @param {string} msg - メッセージ
     * @param {Object} data - 追加データ
     */
    debug(msg, data = {}) {
        logAtLevel('debug', msg, data);
    }
};

export default logger;
