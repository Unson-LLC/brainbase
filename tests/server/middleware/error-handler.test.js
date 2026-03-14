import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError, ErrorCodes } from '../../../server/lib/errors.js';
import { errorHandler } from '../../../server/middleware/error-handler.js';

function createMockRes() {
    const res = {
        statusCode: 200,
        _headers: {},
        _body: null,
        status(code) {
            res.statusCode = code;
            return res;
        },
        json(body) {
            res._body = body;
            return res;
        },
        headersSent: false,
        setHeader(key, value) {
            res._headers[key] = value;
        }
    };
    return res;
}

describe('errorHandler middleware', () => {
    let consoleErrorSpy;

    beforeEach(() => {
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('AppError_構造化レスポンスを返す', () => {
        const error = new AppError('Session not found', ErrorCodes.SESSION_NOT_FOUND);
        const req = { method: 'GET', url: '/api/sessions/abc' };
        const res = createMockRes();
        const next = vi.fn();

        errorHandler(error, req, res, next);

        expect(res.statusCode).toBe(404);
        expect(res._body).toEqual({
            error: {
                code: 'SESSION_NOT_FOUND',
                message: 'Session not found',
                timestamp: expect.any(String)
            }
        });
    });

    it('AppError_ログにdetailsを出力する', () => {
        consoleErrorSpy.mockClear();

        const error = new AppError('DB failed', ErrorCodes.DATABASE_ERROR, {
            details: { query: 'SELECT *' }
        });
        const req = { method: 'POST', url: '/api/tasks' };
        const res = createMockRes();
        const next = vi.fn();

        errorHandler(error, req, res, next);

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const logArgs = consoleErrorSpy.mock.calls[0];
        expect(logArgs[0]).toContain('DATABASE_ERROR');
    });

    it('通常のError_500で汎用メッセージを返す', () => {
        const error = new Error('unexpected crash');
        const req = { method: 'GET', url: '/api/tasks' };
        const res = createMockRes();
        const next = vi.fn();

        errorHandler(error, req, res, next);

        expect(res.statusCode).toBe(500);
        expect(res._body.error.code).toBe('INTERNAL_ERROR');
        expect(res._body.error.message).toBe('Internal server error');
    });

    it('statusプロパティ付きError_そのstatusを使う', () => {
        const error = new Error('Bad request');
        error.status = 400;
        const req = { method: 'POST', url: '/api/schedule' };
        const res = createMockRes();
        const next = vi.fn();

        errorHandler(error, req, res, next);

        expect(res.statusCode).toBe(400);
        expect(res._body.error.message).toBe('Bad request');
    });

    it('headersSent済み_nextに委譲する', () => {
        const error = new Error('test');
        const req = { method: 'GET', url: '/api/test' };
        const res = createMockRes();
        res.headersSent = true;
        const next = vi.fn();

        errorHandler(error, req, res, next);

        expect(next).toHaveBeenCalledWith(error);
        expect(res._body).toBeNull();
    });
});
