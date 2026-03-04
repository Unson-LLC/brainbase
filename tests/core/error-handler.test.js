import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    ErrorType,
    classifyError,
    isRetryable,
    withRetry,
    handleServiceCall
} from '../../public/modules/core/error-handler.js';

describe('error-handler', () => {
    // ===== classifyError =====

    describe('classifyError()', () => {
        it('オフライン時_NETWORKが返される', () => {
            // navigator.onLine をモック
            const originalNavigator = global.navigator;
            global.navigator = { onLine: false };

            const error = new Error('Some error');
            expect(classifyError(error)).toBe(ErrorType.NETWORK);

            global.navigator = originalNavigator;
        });

        it('fetchエラー時_NETWORKが返される', () => {
            const error = new TypeError('Failed to fetch');
            expect(classifyError(error)).toBe(ErrorType.NETWORK);
        });

        it('AbortError時_NETWORKが返される', () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            expect(classifyError(error)).toBe(ErrorType.NETWORK);
        });

        it('タイムアウトエラー時_NETWORKが返される', () => {
            const error = new Error('Request timeout');
            expect(classifyError(error)).toBe(ErrorType.NETWORK);
        });

        it('status 400-499時_CLIENTが返される', () => {
            const error = new Error('Not Found');
            error.status = 404;
            expect(classifyError(error)).toBe(ErrorType.CLIENT);

            error.status = 400;
            expect(classifyError(error)).toBe(ErrorType.CLIENT);

            error.status = 499;
            expect(classifyError(error)).toBe(ErrorType.CLIENT);
        });

        it('status 500以上時_SERVERが返される', () => {
            const error = new Error('Internal Server Error');
            error.status = 500;
            expect(classifyError(error)).toBe(ErrorType.SERVER);

            error.status = 503;
            expect(classifyError(error)).toBe(ErrorType.SERVER);
        });

        it('ValidationError時_VALIDATIONが返される', () => {
            const error = new Error('Invalid input');
            error.name = 'ValidationError';
            expect(classifyError(error)).toBe(ErrorType.VALIDATION);
        });

        it('type=validation時_VALIDATIONが返される', () => {
            const error = new Error('Invalid input');
            error.type = 'validation';
            expect(classifyError(error)).toBe(ErrorType.VALIDATION);
        });

        it('不明なエラー時_UNKNOWNが返される', () => {
            const error = new Error('Unknown error');
            expect(classifyError(error)).toBe(ErrorType.UNKNOWN);
        });
    });

    // ===== isRetryable =====

    describe('isRetryable()', () => {
        it('NETWORKエラー_trueが返される', () => {
            const error = new TypeError('Failed to fetch');
            expect(isRetryable(error)).toBe(true);
        });

        it('SERVERエラー_trueが返される', () => {
            const error = new Error('Server Error');
            error.status = 500;
            expect(isRetryable(error)).toBe(true);
        });

        it('CLIENTエラー_falseが返される', () => {
            const error = new Error('Bad Request');
            error.status = 400;
            expect(isRetryable(error)).toBe(false);
        });

        it('VALIDATIONエラー_falseが返される', () => {
            const error = new Error('Invalid');
            error.name = 'ValidationError';
            expect(isRetryable(error)).toBe(false);
        });

        it('UNKNOWNエラー_falseが返される', () => {
            const error = new Error('Unknown');
            expect(isRetryable(error)).toBe(false);
        });
    });

    // ===== withRetry =====

    describe('withRetry()', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('成功時_即座に結果が返される', async () => {
            const fn = vi.fn().mockResolvedValue('success');

            const resultPromise = withRetry(fn);
            await vi.runAllTimersAsync();
            const result = await resultPromise;

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('リトライ後成功_結果が返される', async () => {
            const networkError = new TypeError('Failed to fetch');
            const fn = vi.fn()
                .mockRejectedValueOnce(networkError)
                .mockRejectedValueOnce(networkError)
                .mockResolvedValue('success');

            const resultPromise = withRetry(fn, { baseDelay: 100 });
            await vi.runAllTimersAsync();
            const result = await resultPromise;

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(3);
        });

        it('最大リトライ超過_エラーがスローされる', async () => {
            const networkError = new TypeError('Failed to fetch');
            const fn = vi.fn().mockRejectedValue(networkError);

            const resultPromise = withRetry(fn, { maxRetries: 2, baseDelay: 100 });

            // 先にrejects.toThrowを設定してからタイマーを進める
            const expectation = expect(resultPromise).rejects.toThrow('Failed to fetch');
            await vi.runAllTimersAsync();
            await expectation;

            expect(fn).toHaveBeenCalledTimes(3); // 初回 + 2回リトライ
        });

        it('リトライ不可エラー_即座にスローされる', async () => {
            const clientError = new Error('Bad Request');
            clientError.status = 400;
            const fn = vi.fn().mockRejectedValue(clientError);

            const resultPromise = withRetry(fn);

            // 先にrejects.toThrowを設定してからタイマーを進める
            const expectation = expect(resultPromise).rejects.toThrow('Bad Request');
            await vi.runAllTimersAsync();
            await expectation;

            expect(fn).toHaveBeenCalledTimes(1); // リトライなし
        });

        it('onRetryコールバック_各リトライで呼ばれる', async () => {
            const networkError = new TypeError('Failed to fetch');
            const fn = vi.fn()
                .mockRejectedValueOnce(networkError)
                .mockRejectedValueOnce(networkError)
                .mockResolvedValue('success');

            const onRetry = vi.fn();
            const resultPromise = withRetry(fn, { baseDelay: 100, onRetry });
            await vi.runAllTimersAsync();
            await resultPromise;

            expect(onRetry).toHaveBeenCalledTimes(2);
            expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
                attempt: 0,
                error: networkError
            }));
            expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
                attempt: 1,
                error: networkError
            }));
        });

        it('指数バックオフ_遅延が指数的に増加する', async () => {
            const networkError = new TypeError('Failed to fetch');
            const fn = vi.fn().mockRejectedValue(networkError);
            const onRetry = vi.fn();

            const resultPromise = withRetry(fn, {
                maxRetries: 3,
                baseDelay: 1000,
                maxDelay: 10000,
                onRetry
            });

            // 先にrejects設定してからタイマーを進める
            const expectation = expect(resultPromise).rejects.toThrow();
            await vi.runAllTimersAsync();
            await expectation;

            // 遅延時間を確認（ジッターがあるので範囲でチェック）
            const delays = onRetry.mock.calls.map(call => call[0].nextDelay);
            expect(delays[0]).toBeGreaterThanOrEqual(1000);
            expect(delays[0]).toBeLessThan(1200);
            expect(delays[1]).toBeGreaterThanOrEqual(2000);
            expect(delays[1]).toBeLessThan(2400);
            expect(delays[2]).toBeGreaterThanOrEqual(4000);
            expect(delays[2]).toBeLessThan(4800);
        });

        it('maxDelay_上限を超えない', async () => {
            const networkError = new TypeError('Failed to fetch');
            const fn = vi.fn().mockRejectedValue(networkError);
            const onRetry = vi.fn();

            const resultPromise = withRetry(fn, {
                maxRetries: 5,
                baseDelay: 5000,
                maxDelay: 8000,
                onRetry
            });

            // 先にrejects設定してからタイマーを進める
            const expectation = expect(resultPromise).rejects.toThrow();
            await vi.runAllTimersAsync();
            await expectation;

            // 全ての遅延がmaxDelay以下
            const delays = onRetry.mock.calls.map(call => call[0].nextDelay);
            delays.forEach(delay => {
                expect(delay).toBeLessThanOrEqual(8800); // maxDelay + 10% jitter
            });
        });
    });

    // ===== handleServiceCall =====

    describe('handleServiceCall()', () => {
        let consoleErrorSpy;

        beforeEach(() => {
            consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        });

        afterEach(() => {
            consoleErrorSpy.mockRestore();
        });

        it('成功時_結果が返される', async () => {
            const result = await handleServiceCall('TestService', 'testMethod', async () => {
                return { data: 'test' };
            });

            expect(result).toEqual({ data: 'test' });
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });

        it('エラー時_ログ出力されエラーが再スローされる', async () => {
            const error = new Error('Test error');
            error.status = 500;

            await expect(
                handleServiceCall('TestService', 'testMethod', async () => {
                    throw error;
                })
            ).rejects.toThrow('Test error');

            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[TestService.testMethod] server: Test error',
                expect.objectContaining({
                    type: 'server',
                    serviceName: 'TestService',
                    methodName: 'testMethod'
                })
            );
        });

        it('クライアントエラー時_CLIENTタイプでログ出力', async () => {
            const error = new Error('Not found');
            error.status = 404;

            await expect(
                handleServiceCall('UserService', 'getUser', async () => {
                    throw error;
                })
            ).rejects.toThrow('Not found');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[UserService.getUser] client: Not found',
                expect.objectContaining({ type: 'client' })
            );
        });

        it('ネットワークエラー時_NETWORKタイプでログ出力', async () => {
            const error = new TypeError('Failed to fetch');

            await expect(
                handleServiceCall('ApiService', 'fetchData', async () => {
                    throw error;
                })
            ).rejects.toThrow('Failed to fetch');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[ApiService.fetchData] network: Failed to fetch',
                expect.objectContaining({ type: 'network' })
            );
        });
    });
});
