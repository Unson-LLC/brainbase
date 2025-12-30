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
                headers: {
                    'Content-Type': 'application/json'
                }
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
                headers: {
                    'Content-Type': 'application/json'
                },
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
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer token123'
                }
            })
        );
    });
});
