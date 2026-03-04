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
});
