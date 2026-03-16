import { describe, it, expect } from 'vitest';
import { AppError, ErrorCodes } from '../../../server/lib/errors.js';

describe('AppError', () => {
    describe('constructor', () => {
        it('メッセージとコードで生成_プロパティが正しく設定される', () => {
            const error = new AppError('Session not found', ErrorCodes.SESSION_NOT_FOUND);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error.message).toBe('Session not found');
            expect(error.code).toBe('SESSION_NOT_FOUND');
            expect(error.statusCode).toBe(404);
            expect(error.timestamp).toBeDefined();
            expect(error.name).toBe('AppError');
        });

        it('detailsオプション付きで生成_detailsが設定される', () => {
            const error = new AppError('Validation failed', ErrorCodes.VALIDATION_ERROR, {
                details: { field: 'name', reason: 'too long' }
            });

            expect(error.details).toEqual({ field: 'name', reason: 'too long' });
        });

        it('causeオプション付きで生成_causeが設定される', () => {
            const originalError = new Error('DB connection failed');
            const error = new AppError('Database error', ErrorCodes.DATABASE_ERROR, {
                cause: originalError
            });

            expect(error.cause).toBe(originalError);
        });

        it('timestampがISO文字列である', () => {
            const error = new AppError('test', ErrorCodes.INTERNAL_ERROR);
            expect(() => new Date(error.timestamp)).not.toThrow();
            expect(new Date(error.timestamp).toISOString()).toBe(error.timestamp);
        });
    });

    describe('toJSON()', () => {
        it('クライアント安全なJSONを返す_detailsは含まない', () => {
            const error = new AppError('Not found', ErrorCodes.SESSION_NOT_FOUND, {
                details: { internalInfo: 'secret' }
            });

            const json = error.toJSON();

            expect(json).toEqual({
                error: {
                    code: 'SESSION_NOT_FOUND',
                    message: 'Not found',
                    timestamp: expect.any(String)
                }
            });
            expect(json.error.internalInfo).toBeUndefined();
        });
    });

    describe('toLog()', () => {
        it('ログ用オブジェクトを返す_detailsを含む', () => {
            const cause = new Error('original');
            const error = new AppError('Database error', ErrorCodes.DATABASE_ERROR, {
                details: { query: 'SELECT *' },
                cause
            });

            const log = error.toLog();

            expect(log.code).toBe('DATABASE_ERROR');
            expect(log.message).toBe('Database error');
            expect(log.statusCode).toBe(500);
            expect(log.details).toEqual({ query: 'SELECT *' });
            expect(log.cause).toBe('original');
            expect(log.timestamp).toBeDefined();
        });

        it('causeがない場合_causeフィールドがない', () => {
            const error = new AppError('test', ErrorCodes.INTERNAL_ERROR);
            const log = error.toLog();
            expect(log.cause).toBeUndefined();
        });
    });

    describe('static factory methods', () => {
        it('notFound_404エラーを生成する', () => {
            const error = AppError.notFound('Session', 'abc-123');

            expect(error.message).toBe("Session 'abc-123' not found");
            expect(error.code).toBe('SESSION_NOT_FOUND');
            expect(error.statusCode).toBe(404);
        });

        it('validation_400エラーを生成する', () => {
            const error = AppError.validation('Invalid date format');

            expect(error.message).toBe('Invalid date format');
            expect(error.code).toBe('VALIDATION_ERROR');
            expect(error.statusCode).toBe(400);
        });

        it('unauthorized_401エラーを生成する', () => {
            const error = AppError.unauthorized('Token expired');

            expect(error.message).toBe('Token expired');
            expect(error.code).toBe('UNAUTHORIZED');
            expect(error.statusCode).toBe(401);
        });

        it('conflict_409エラーを生成する', () => {
            const error = AppError.conflict('Event already exists');

            expect(error.message).toBe('Event already exists');
            expect(error.code).toBe('CONFLICT');
            expect(error.statusCode).toBe(409);
        });

        it('internal_500エラーを生成する', () => {
            const cause = new Error('disk full');
            const error = AppError.internal('Failed to save', cause);

            expect(error.message).toBe('Failed to save');
            expect(error.code).toBe('INTERNAL_ERROR');
            expect(error.statusCode).toBe(500);
            expect(error.cause).toBe(cause);
        });
    });

    describe('isAppError()', () => {
        it('AppErrorインスタンス_trueを返す', () => {
            const error = new AppError('test', ErrorCodes.INTERNAL_ERROR);
            expect(AppError.isAppError(error)).toBe(true);
        });

        it('通常のError_falseを返す', () => {
            const error = new Error('test');
            expect(AppError.isAppError(error)).toBe(false);
        });

        it('null_falseを返す', () => {
            expect(AppError.isAppError(null)).toBe(false);
        });
    });
});

describe('ErrorCodes', () => {
    it('必須エラーコードが定義されている', () => {
        expect(ErrorCodes.VALIDATION_ERROR).toBeDefined();
        expect(ErrorCodes.SESSION_NOT_FOUND).toBeDefined();
        expect(ErrorCodes.TASK_NOT_FOUND).toBeDefined();
        expect(ErrorCodes.UNAUTHORIZED).toBeDefined();
        expect(ErrorCodes.CONFLICT).toBeDefined();
        expect(ErrorCodes.DATABASE_ERROR).toBeDefined();
        expect(ErrorCodes.INTERNAL_ERROR).toBeDefined();
        expect(ErrorCodes.TIMEOUT).toBeDefined();
        expect(ErrorCodes.PORT_IN_USE).toBeDefined();
    });

    it('各コードにcodeとstatusCodeがある', () => {
        for (const [key, value] of Object.entries(ErrorCodes)) {
            expect(value.code).toBe(key);
            expect(typeof value.statusCode).toBe('number');
        }
    });
});
