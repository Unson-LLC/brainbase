// @ts-check
/**
 * 構造化エラーハンドリング
 * CommandMateのAppErrorパターンをbrainbaseに移植
 *
 * クライアントに安全なメッセージを返しつつ、
 * ログには詳細情報を出力する二層構造
 */

/**
 * 標準エラーコード定義
 * code: エラー識別子（クライアントに露出して安全）
 * statusCode: HTTPステータスコード
 */
export const ErrorCodes = {
    // 入力バリデーション (400)
    VALIDATION_ERROR: { code: 'VALIDATION_ERROR', statusCode: 400 },
    INVALID_DATE_FORMAT: { code: 'INVALID_DATE_FORMAT', statusCode: 400 },
    MISSING_REQUIRED_FIELD: { code: 'MISSING_REQUIRED_FIELD', statusCode: 400 },
    UNSUPPORTED_FORMAT: { code: 'UNSUPPORTED_FORMAT', statusCode: 400 },

    // 認証・認可 (401/403)
    UNAUTHORIZED: { code: 'UNAUTHORIZED', statusCode: 401 },
    FORBIDDEN: { code: 'FORBIDDEN', statusCode: 403 },

    // リソース不在 (404)
    SESSION_NOT_FOUND: { code: 'SESSION_NOT_FOUND', statusCode: 404 },
    TASK_NOT_FOUND: { code: 'TASK_NOT_FOUND', statusCode: 404 },
    SCHEDULE_NOT_FOUND: { code: 'SCHEDULE_NOT_FOUND', statusCode: 404 },
    WORKTREE_NOT_FOUND: { code: 'WORKTREE_NOT_FOUND', statusCode: 404 },
    EVENT_NOT_FOUND: { code: 'EVENT_NOT_FOUND', statusCode: 404 },

    // 競合 (409)
    CONFLICT: { code: 'CONFLICT', statusCode: 409 },
    PORT_IN_USE: { code: 'PORT_IN_USE', statusCode: 409 },

    // サーバーエラー (500)
    INTERNAL_ERROR: { code: 'INTERNAL_ERROR', statusCode: 500 },
    DATABASE_ERROR: { code: 'DATABASE_ERROR', statusCode: 500 },

    // タイムアウト (504)
    TIMEOUT: { code: 'TIMEOUT', statusCode: 504 },
};

/** @typedef {{ code: string, statusCode: number }} ErrorCodeEntry */
/** @typedef {Record<string, unknown>} UnknownRecord */
/** @typedef {{ details?: UnknownRecord | null, cause?: Error }} AppErrorOptions */
/** @typedef {{ code: string, message: string, statusCode: number, timestamp: string, details?: UnknownRecord | null, cause?: string }} AppErrorLog */

/**
 * 構造化アプリケーションエラー
 */
export class AppError extends Error {
    /**
     * @param {string} message - エラーメッセージ（クライアントに表示）
     * @param {ErrorCodeEntry} errorCode - ErrorCodesのエントリ
     * @param {AppErrorOptions} [options] - ログ専用の詳細情報と原因エラー
     */
    constructor(message, errorCode, options = {}) {
        super(message);
        this.name = 'AppError';
        this.code = errorCode.code;
        this.statusCode = errorCode.statusCode;
        this.timestamp = new Date().toISOString();
        this.details = options.details || null;
        if (options.cause) {
            this.cause = options.cause;
        }
    }

    /**
     * クライアント安全なJSON（APIレスポンス用）
     * detailsは含めない
     */
    toJSON() {
        return {
            error: {
                code: this.code,
                message: this.message,
                timestamp: this.timestamp
            }
        };
    }

    /**
     * ログ用オブジェクト（details含む）
     * @returns {AppErrorLog}
     */
    toLog() {
        /** @type {AppErrorLog} */
        const log = {
            code: this.code,
            message: this.message,
            statusCode: this.statusCode,
            timestamp: this.timestamp
        };
        if (this.details) {
            log.details = this.details;
        }
        if (this.cause) {
            log.cause = this.cause instanceof Error ? this.cause.message : String(this.cause);
        }
        return log;
    }

    /**
     * AppErrorインスタンスかどうか判定
     * @param {unknown} error
     * @returns {error is AppError}
     */
    static isAppError(error) {
        return error instanceof AppError;
    }

    // ---- Factory Methods ----

    /**
     * @param {string} resource
     * @param {string} id
     */
    static notFound(resource, id) {
        const dynamicCode = /** @type {Record<string, ErrorCodeEntry>} */ (ErrorCodes)[`${resource.toUpperCase()}_NOT_FOUND`];
        return new AppError(
            `${resource} '${id}' not found`,
            /** @type {ErrorCodeEntry | undefined} */ (dynamicCode) || ErrorCodes.SESSION_NOT_FOUND
        );
    }

    /**
     * @param {string} message
     * @param {UnknownRecord} [details]
     */
    static validation(message, details) {
        return new AppError(message, ErrorCodes.VALIDATION_ERROR, { details });
    }

    static unauthorized(message = 'Unauthorized') {
        return new AppError(message, ErrorCodes.UNAUTHORIZED);
    }

    /**
     * @param {string} message
     * @param {UnknownRecord} [details]
     */
    static conflict(message, details) {
        return new AppError(message, ErrorCodes.CONFLICT, { details });
    }

    /**
     * @param {string} [message]
     * @param {Error} [cause]
     */
    static internal(message = 'Internal server error', cause) {
        return new AppError(message, ErrorCodes.INTERNAL_ERROR, { cause });
    }
}
