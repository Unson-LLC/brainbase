// @ts-check
/**
 * 集中エラーハンドリングミドルウェア
 * CommandMateパターン: AppErrorは構造化レスポンス、通常Errorは汎用500
 */
import { AppError } from '../lib/errors.js';

/** @typedef {{ method?: string, url?: string }} RequestLike */
/** @typedef {{ headersSent?: boolean, status: (code: number) => { json: (body: unknown) => unknown } }} ResponseLike */
/** @typedef {(error?: unknown) => unknown} NextLike */
/** @typedef {{ status?: number, statusCode?: number, message?: string, stack?: string }} BasicError */

/**
 * Express error-handling middleware
 * 全ルートの最後に app.use(errorHandler) で登録
 */
/**
 * @param {unknown} err
 * @param {RequestLike} req
 * @param {ResponseLike} res
 * @param {NextLike} next
 */
export function errorHandler(err, req, res, next) {
    // レスポンスが既に送信済みならExpressのデフォルトに委譲
    if (res.headersSent) {
        return next(err);
    }

    if (AppError.isAppError(err)) {
        // 構造化エラー: コード付きレスポンス + 詳細ログ
        console.error(
            `[${err.code}] ${req.method} ${req.url}: ${err.message}`,
            err.toLog()
        );
        return res.status(err.statusCode).json(err.toJSON());
    }

    // 通常のError: 内部情報を隠して汎用メッセージ
    const normalizedError = /** @type {BasicError} */ (err ?? {});
    const statusCode = normalizedError.status || normalizedError.statusCode || 500;
    const isClientError = statusCode >= 400 && statusCode < 500;

    console.error(
        `[INTERNAL_ERROR] ${req.method} ${req.url}: ${normalizedError.message || 'Unknown error'}`,
        { stack: normalizedError.stack }
    );

    res.status(statusCode).json({
        error: {
            code: 'INTERNAL_ERROR',
            message: isClientError ? (normalizedError.message || 'Request failed') : 'Internal server error',
            timestamp: new Date().toISOString()
        }
    });
}
