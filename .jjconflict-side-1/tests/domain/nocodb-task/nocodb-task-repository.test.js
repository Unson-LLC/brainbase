import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NocoDBTaskRepository } from '../../../public/modules/domain/nocodb-task/nocodb-task-repository.js';

describe('NocoDBTaskRepository', () => {
    let repository;
    let httpClient;

    beforeEach(() => {
        httpClient = {
            get: vi.fn(),
            put: vi.fn(),
            delete: vi.fn()
        };
        repository = new NocoDBTaskRepository({ httpClient });
        vi.clearAllMocks();
    });

    it('deleteTask呼び出し時_baseIdをボディに含めて送信する', async () => {
        httpClient.delete.mockResolvedValue({});

        await repository.deleteTask('record-1', 'base-1');

        expect(httpClient.delete).toHaveBeenCalledWith('/api/nocodb/tasks/record-1', {
            body: JSON.stringify({ baseId: 'base-1' })
        });
    });
});
