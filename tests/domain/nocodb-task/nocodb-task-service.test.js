import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NocoDBTaskService } from '../../../public/modules/domain/nocodb-task/nocodb-task-service.js';

describe('NocoDBTaskService', () => {
    let service;
    let repository;

    beforeEach(() => {
        service = new NocoDBTaskService({ httpClient: {} });
        repository = {
            updateTask: vi.fn().mockResolvedValue({})
        };
        service.repository = repository;
        service.adapter = {
            toNocoDBStatus: vi.fn(status => `mapped:${status}`),
            toNocoDBFields: vi.fn()
        };
        service.tasks = [{
            id: 'nocodb:project-1:record-1',
            status: 'pending',
            nocodbRecordId: 'record-1',
            nocodbBaseId: 'base-1'
        }];
        service._updateStore = vi.fn();
        service._applyLocalUpdates = vi.fn();
    });

    it('updateStatus呼び出し時_NocoDBステータスが変換されて更新される', async () => {
        await service.updateStatus('nocodb:project-1:record-1', 'in_progress');

        expect(service.adapter.toNocoDBStatus).toHaveBeenCalledWith('in_progress');
        expect(repository.updateTask).toHaveBeenCalledWith(
            'record-1',
            'base-1',
            { 'ステータス': 'mapped:in_progress' }
        );
        expect(service._applyLocalUpdates).toHaveBeenCalledWith(
            service.tasks[0],
            { status: 'in_progress' }
        );
    });
});
