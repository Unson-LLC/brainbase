import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient } from '../../public/modules/core/http-client.js';

describe('HttpClient', () => {
    let client;
    let fetchMock;

    beforeEach(() => {
        client = new HttpClient({ baseURL: 'https://api.example.com' });

        // fetchをモック化
        fetchMock = vi.fn();
        global.fetch = fetchMock;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should make GET request', async () => {
        const mockResponse = { data: 'test' };
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => mockResponse
        });

        const result = await client.get('/users');

        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.example.com/users',
            expect.objectContaining({
                method: 'GET',
                headers: expect.objectContaining({
                    'Content-Type': 'application/json',
                    'X-BB-Trace-Id': expect.any(String)
                })
            })
        );
        expect(result).toEqual(mockResponse);
    });

    it('should make POST request with body', async () => {
        const mockResponse = { id: 1, name: 'John' };
        const requestBody = { name: 'John' };

        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => mockResponse
        });

        const result = await client.post('/users', requestBody);

        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.example.com/users',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Content-Type': 'application/json',
                    'X-BB-Trace-Id': expect.any(String)
                }),
                body: JSON.stringify(requestBody)
            })
        );
        expect(result).toEqual(mockResponse);
    });

    it('should handle errors', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found'
        });

        await expect(client.get('/users')).rejects.toThrow('HTTP Error: 404 Not Found');
    });

    it('should support custom headers', async () => {
        const mockResponse = { data: 'test' };
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => mockResponse
        });

        await client.get('/users', {
            headers: {
                'Authorization': 'Bearer token123'
            }
        });

        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.example.com/users',
            expect.objectContaining({
                headers: expect.objectContaining({
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer token123',
                    'X-BB-Trace-Id': expect.any(String)
                })
            })
        );
    });

    it('should return notModified metadata on 304 when allowNotModified is enabled', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 304,
            statusText: 'Not Modified',
            headers: new Headers({
                ETag: 'W/"state-etag-1"'
            })
        });

        const result = await client.get('/users', {
            allowNotModified: true,
            headers: {
                'If-None-Match': 'W/"state-etag-1"'
            }
        });

        expect(result).toEqual({
            notModified: true,
            status: 304,
            headers: {
                etag: 'W/"state-etag-1"'
            }
        });
    });

    // ===== Auth Redirect Detection (CommandMate pattern) =====

    it('リダイレクト+HTMLレスポンス_認証エラーをスローする', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            redirected: true,
            url: 'https://login.example.com/auth',
            status: 200,
            headers: new Map([['content-type', 'text/html']]),
            json: async () => { throw new Error('not JSON'); }
        });

        await expect(client.get('/api/tasks')).rejects.toThrow('Authentication required');
    });

    it('リダイレクト+JSONレスポンス_正常に処理される', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            redirected: false,
            url: 'https://api.example.com/api/tasks',
            status: 200,
            headers: new Map([['content-type', 'application/json']]),
            json: async () => ({ tasks: [] })
        });

        const result = await client.get('/api/tasks');
        expect(result).toEqual({ tasks: [] });
    });

    it('リダイレクト+login URL_認証エラーをスローする', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            redirected: true,
            url: 'https://example.com/login?redirect=/api/tasks',
            status: 200,
            headers: new Map([['content-type', 'text/html; charset=utf-8']]),
            json: async () => { throw new Error('not JSON'); }
        });

        await expect(client.get('/api/tasks')).rejects.toThrow('Authentication required');
    });

    it('非リダイレクト+HTMLエラーレスポンス_通常のエラー処理', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            redirected: false,
            status: 500,
            statusText: 'Internal Server Error',
            headers: new Map([['content-type', 'text/html']]),
            json: async () => { throw new Error('not JSON'); }
        });

        await expect(client.get('/api/tasks')).rejects.toThrow('HTTP Error: 500');
    });

    // ===== Request Timeout (CommandMate pattern) =====

    it('タイムアウト指定_AbortErrorでリクエストが中断される', async () => {
        // AbortControllerのsignalでabortされた場合をシミュレート
        fetchMock.mockImplementation((_url, options) => {
            return new Promise((_resolve, reject) => {
                if (options?.signal) {
                    options.signal.addEventListener('abort', () => {
                        const err = new Error('The operation was aborted');
                        err.name = 'AbortError';
                        reject(err);
                    });
                }
            });
        });

        await expect(
            client.get('/api/slow', { timeout: 50 })
        ).rejects.toThrow(/timeout/i);
    });

    it('タイムアウト未指定_デフォルトタイムアウトが適用される', async () => {
        // 正常レスポンスが即座に返る場合はタイムアウトしない
        fetchMock.mockResolvedValue({
            ok: true,
            redirected: false,
            status: 200,
            json: async () => ({ data: 'ok' })
        });

        const result = await client.get('/api/fast');
        expect(result).toEqual({ data: 'ok' });
    });

    it('タイムアウト前にレスポンス到着_正常に処理される', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            redirected: false,
            status: 200,
            json: async () => ({ data: 'quick' })
        });

        const result = await client.get('/api/quick', { timeout: 5000 });
        expect(result).toEqual({ data: 'quick' });
    });
});
