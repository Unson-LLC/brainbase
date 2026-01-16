import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimelineRepository } from '../../../public/modules/domain/timeline/timeline-repository.js';

describe('TimelineRepository', () => {
    let repository;
    let mockHttpClient;

    beforeEach(() => {
        mockHttpClient = {
            get: vi.fn(),
            post: vi.fn(),
            put: vi.fn(),
            delete: vi.fn()
        };
        repository = new TimelineRepository({ httpClient: mockHttpClient });
    });

    describe('fetchToday', () => {
        it('fetchToday呼び出し時_APIから今日のタイムラインを取得', async () => {
            const mockData = {
                date: '2025-01-11',
                items: [{ id: 'tl_1', type: 'session', title: 'Test' }],
                version: '1.0.0'
            };
            mockHttpClient.get.mockResolvedValue(mockData);

            const result = await repository.fetchToday();

            expect(mockHttpClient.get).toHaveBeenCalledWith('/api/timeline/today');
            expect(result).toEqual(mockData);
        });
    });

    describe('fetchByDate', () => {
        it('fetchByDate呼び出し時_指定日のタイムラインを取得', async () => {
            const mockData = {
                date: '2025-01-10',
                items: [],
                version: '1.0.0'
            };
            mockHttpClient.get.mockResolvedValue(mockData);

            const result = await repository.fetchByDate('2025-01-10');

            expect(mockHttpClient.get).toHaveBeenCalledWith('/api/timeline?date=2025-01-10');
            expect(result).toEqual(mockData);
        });
    });

    describe('fetchItem', () => {
        it('fetchItem呼び出し時_存在する項目_項目が返される', async () => {
            const mockItem = { id: 'tl_1', type: 'session', title: 'Test' };
            mockHttpClient.get.mockResolvedValue(mockItem);

            const result = await repository.fetchItem('tl_1');

            expect(mockHttpClient.get).toHaveBeenCalledWith('/api/timeline/tl_1');
            expect(result).toEqual(mockItem);
        });

        it('fetchItem呼び出し時_存在しない項目_nullが返される', async () => {
            const error = new Error('Not found');
            error.status = 404;
            mockHttpClient.get.mockRejectedValue(error);

            const result = await repository.fetchItem('tl_non_existent');

            expect(result).toBeNull();
        });
    });

    describe('createItem', () => {
        it('createItem呼び出し時_成功_項目が返される', async () => {
            const newItem = { type: 'session', title: 'New session' };
            const createdItem = { id: 'tl_1', ...newItem };
            mockHttpClient.post.mockResolvedValue(createdItem);

            const result = await repository.createItem(newItem);

            expect(mockHttpClient.post).toHaveBeenCalledWith('/api/timeline', newItem);
            expect(result.success).toBe(true);
            expect(result.item).toEqual(createdItem);
        });

        it('createItem呼び出し時_重複_エラーが返される', async () => {
            const error = new Error('Conflict');
            error.status = 409;
            mockHttpClient.post.mockRejectedValue(error);

            const result = await repository.createItem({ type: 'session', title: 'Duplicate' });

            expect(result.success).toBe(false);
            expect(result.error).toBe('duplicate');
        });
    });

    describe('updateItem', () => {
        it('updateItem呼び出し時_成功_更新された項目が返される', async () => {
            const updates = { title: 'Updated title' };
            const updatedItem = { id: 'tl_1', type: 'session', title: 'Updated title' };
            mockHttpClient.put.mockResolvedValue(updatedItem);

            const result = await repository.updateItem('tl_1', updates);

            expect(mockHttpClient.put).toHaveBeenCalledWith('/api/timeline/tl_1', updates);
            expect(result.success).toBe(true);
            expect(result.item).toEqual(updatedItem);
        });

        it('updateItem呼び出し時_存在しない項目_エラーが返される', async () => {
            const error = new Error('Not found');
            error.status = 404;
            mockHttpClient.put.mockRejectedValue(error);

            const result = await repository.updateItem('tl_non_existent', { title: 'Updated' });

            expect(result.success).toBe(false);
            expect(result.error).toBe('not_found');
        });
    });

    describe('deleteItem', () => {
        it('deleteItem呼び出し時_成功_trueが返される', async () => {
            mockHttpClient.delete.mockResolvedValue(undefined);

            const result = await repository.deleteItem('tl_1');

            expect(mockHttpClient.delete).toHaveBeenCalledWith('/api/timeline/tl_1');
            expect(result.success).toBe(true);
        });

        it('deleteItem呼び出し時_存在しない項目_エラーが返される', async () => {
            const error = new Error('Not found');
            error.status = 404;
            mockHttpClient.delete.mockRejectedValue(error);

            const result = await repository.deleteItem('tl_non_existent');

            expect(result.success).toBe(false);
            expect(result.error).toBe('not_found');
        });
    });
});
