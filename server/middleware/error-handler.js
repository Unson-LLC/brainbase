/**
 * 集中エラーハンドリングミドルウェア
 * CommandMateパターン: AppErrorは構造化レスポンス、通常Errorは汎用500
 */
import { AppError } from '../lib/errors.js';

/**
 * Express error-handling middleware
 * 全ルートの最後に app.use(errorHandler) で登録
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
    const statusCode = err.status || err.statusCode || 500;
    const isClientError = statusCode >= 400 && statusCode < 500;

    console.error(
        `[INTERNAL_ERROR] ${req.method} ${req.url}: ${err.message}`,
        { stack: err.stack }
    );

    res.status(statusCode).json({
        error: {
            code: 'INTERNAL_ERROR',
            message: isClientError ? err.message : 'Internal server error',
            timestamp: new Date().toISOString()
        }
    });
}
