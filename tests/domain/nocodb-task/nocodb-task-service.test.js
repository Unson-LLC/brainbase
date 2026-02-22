import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NocoDBTaskService } from '../../../public/modules/domain/nocodb-task/nocodb-task-service.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { appStore } from '../../../public/modules/core/store.js';

const createHttpClientMock = () => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn()
});

describe('NocoDBTaskService mutations', () => {
    let service;
    let repositoryMock;
    let adapterMock;
    let setStateSpy;
    let emitSpy;

    beforeEach(() => {
        service = new NocoDBTaskService({ httpClient: createHttpClientMock() });
        repositoryMock = {
            updateTask: vi.fn().mockResolvedValue({})
        };
        adapterMock = {
            toNocoDBFields: vi.fn(),
            toNocoDBStatus: vi.fn().mockReturnValue('In Progress')
        };

        service.repository = repositoryMock;
        service.adapter = adapterMock;
        setStateSpy = vi.spyOn(appStore, 'setState').mockImplementation(() => {});
        emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue({});
    });

    afterEach(() => {
        setStateSpy.mockRestore();
        emitSpy.mockRestore();
    });

    it('updateTask ignores undefined fields and preserves existing values', async () => {
        const task = {
            id: 'nocodb:proj:task',
            nocodbRecordId: 'rec-1',
            nocodbBaseId: 'base-1',
            title: 'Original title',
            name: 'Original title',
            priority: 'high',
            due: '2026-02-22',
            deadline: '2026-02-22',
            description: 'Original description',
            assignee: 'alice',
            status: 'pending'
        };
        service.tasks = [task];

        adapterMock.toNocoDBFields.mockReturnValue({ Title: 'Updated title' });

        await service.updateTask(task.id, {
            name: 'Updated title',
            due: undefined,
            description: undefined
        });

        expect(repositoryMock.updateTask).toHaveBeenCalledWith(
            task.nocodbRecordId,
            task.nocodbBaseId,
            { Title: 'Updated title' }
        );
        expect(task.title).toBe('Updated title');
        expect(task.due).toBe('2026-02-22');
        expect(task.deadline).toBe('2026-02-22');
        expect(setStateSpy).toHaveBeenCalledWith(expect.objectContaining({
            nocodbTasks: [task]
        }));
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.NOCODB_TASK_UPDATED, { task });
    });

    it('updateStatus updates local state, store, and emits event', async () => {
        const task = {
            id: 'nocodb:proj:task',
            nocodbRecordId: 'rec-1',
            nocodbBaseId: 'base-1',
            status: 'pending'
        };
        service.tasks = [task];

        adapterMock.toNocoDBStatus.mockReturnValue('完了');

        await service.updateStatus(task.id, 'completed');

        expect(repositoryMock.updateTask).toHaveBeenCalledWith(
            task.nocodbRecordId,
            task.nocodbBaseId,
            { 'ステータス': '完了' }
        );
        expect(task.status).toBe('completed');
        expect(setStateSpy).toHaveBeenCalledWith(expect.objectContaining({
            nocodbTasks: [task]
        }));
        expect(emitSpy).toHaveBeenCalledWith(EVENTS.NOCODB_TASK_UPDATED, { task });
    });
});

describe('NocoDBTaskService helpers', () => {
    let service;

    beforeEach(() => {
        service = new NocoDBTaskService({ httpClient: createHttpClientMock() });
    });

    describe('_applyTaskUpdates', () => {
        it('preserves nullable fields when null is provided', () => {
            const task = {
                id: 'nocodb:proj:1',
                title: 'Task',
                name: 'Task',
                description: 'original description',
                assignee: 'alice',
                priority: 'high',
                due: '2026-02-22',
                deadline: '2026-02-22',
                status: 'pending'
            };

            service._applyTaskUpdates(task, {
                description: null,
                assignee: null,
                due: '2026-03-10'
            });

            expect(task.description).toBeNull();
            expect(task.assignee).toBeNull();
            expect(task.due).toBe('2026-03-10');
            expect(task.deadline).toBe('2026-03-10');
        });
    });

    describe('_handleMutationError', () => {
        let emitSpy;
        let consoleSpy;

        beforeEach(() => {
            emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue({});
            consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        });

        afterEach(() => {
            emitSpy.mockRestore();
            consoleSpy.mockRestore();
        });

        it('rethrows original error and emits normalized payload', () => {
            const error = new Error('Failed to update task');

            expect(() => {
                service._handleMutationError('updateTask', error, 'fallback');
            }).toThrow('Failed to update task');

            expect(emitSpy).toHaveBeenCalledWith(EVENTS.NOCODB_TASK_ERROR, {
                error: 'Failed to update task'
            });
        });

        it('falls back to provided message when error has no message', () => {
            const error = new Error('');

            expect(() => {
                service._handleMutationError('deleteTask', error, 'Fallback message');
            }).toThrow();

            expect(emitSpy).toHaveBeenCalledWith(EVENTS.NOCODB_TASK_ERROR, {
                error: 'Fallback message'
            });
        });
    });
});
