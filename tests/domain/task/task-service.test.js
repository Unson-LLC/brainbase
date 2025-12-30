import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskService } from '../../../public/modules/domain/task/task-service.js';
import { httpClient } from '../../../public/modules/core/http-client.js';
import { appStore } from '../../../public/modules/core/store.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

// モジュールをモック化
vi.mock('../../../public/modules/core/http-client.js', () => ({
    httpClient: {
        get: vi.fn(),
        post: vi.fn()
    }
}));

describe('TaskService', () => {
    let taskService;
    let mockTasks;

    beforeEach(() => {
        // テストデータ準備
        mockTasks = [
            { id: '1', title: 'Task 1', status: 'todo', priority: 'high' },
            { id: '2', title: 'Task 2', status: 'done', priority: 'normal' },
            { id: '3', title: 'Task 3', status: 'todo', priority: 'normal' }
        ];

        // ストア初期化
        appStore.setState({
            tasks: [],
            filters: { taskFilter: '', showAllTasks: false }
        });

        // サービスインスタンス作成
        taskService = new TaskService();

        // モックリセット
        vi.clearAllMocks();
    });

    describe('loadTasks', () => {
        it('should fetch tasks from API and update store', async () => {
            httpClient.get.mockResolvedValue(mockTasks);

            const result = await taskService.loadTasks();

            expect(httpClient.get).toHaveBeenCalledWith('/tasks');
            expect(appStore.getState().tasks).toEqual(mockTasks);
            expect(result).toEqual(mockTasks);
        });

        it('should emit TASK_LOADED event', async () => {
            httpClient.get.mockResolvedValue(mockTasks);
            const listener = vi.fn();
            eventBus.on(EVENTS.TASK_LOADED, listener);

            await taskService.loadTasks();

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.tasks).toEqual(mockTasks);
        });
    });

    describe('completeTask', () => {
        it('should complete task via API and reload tasks', async () => {
            httpClient.post.mockResolvedValue({});
            httpClient.get.mockResolvedValue(mockTasks);

            await taskService.completeTask('task-123');

            expect(httpClient.post).toHaveBeenCalledWith('/tasks/task-123/complete');
            expect(httpClient.get).toHaveBeenCalledWith('/tasks');
        });

        it('should emit TASK_COMPLETED event', async () => {
            httpClient.post.mockResolvedValue({});
            httpClient.get.mockResolvedValue(mockTasks);
            const listener = vi.fn();
            eventBus.on(EVENTS.TASK_COMPLETED, listener);

            await taskService.completeTask('task-123');

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.taskId).toBe('task-123');
        });
    });

    describe('getFilteredTasks', () => {
        beforeEach(() => {
            appStore.setState({ tasks: mockTasks });
        });

        it('should return all tasks when no filter applied', () => {
            appStore.setState({ filters: { taskFilter: '', showAllTasks: true } });

            const filtered = taskService.getFilteredTasks();

            expect(filtered).toHaveLength(3);
        });

        it('should filter tasks by text', () => {
            appStore.setState({ filters: { taskFilter: 'Task 1', showAllTasks: true } });

            const filtered = taskService.getFilteredTasks();

            expect(filtered).toHaveLength(1);
            expect(filtered[0].title).toBe('Task 1');
        });

        it('should filter out done tasks when showAllTasks is false', () => {
            appStore.setState({ filters: { taskFilter: '', showAllTasks: false } });

            const filtered = taskService.getFilteredTasks();

            expect(filtered).toHaveLength(2);
            expect(filtered.every(t => t.status !== 'done')).toBe(true);
        });

        it('should filter tasks by priority when priorityFilter is set', () => {
            appStore.setState({
                tasks: [
                    { id: '1', title: 'Task 1', priority: 'high', status: 'todo' },
                    { id: '2', title: 'Task 2', priority: 'medium', status: 'todo' },
                    { id: '3', title: 'Task 3', priority: 'high', status: 'todo' }
                ],
                filters: { taskFilter: '', showAllTasks: true, priorityFilter: 'high' }
            });

            const filtered = taskService.getFilteredTasks();

            expect(filtered).toHaveLength(2);
            expect(filtered.every(t => t.priority === 'high')).toBe(true);
        });

        it('should combine priority filter with other filters', () => {
            appStore.setState({
                tasks: [
                    { id: '1', title: 'Task 1', priority: 'high', status: 'todo' },
                    { id: '2', title: 'Task 2', priority: 'high', status: 'done' },
                    { id: '3', title: 'Task 3', priority: 'medium', status: 'todo' }
                ],
                filters: { taskFilter: '', showAllTasks: false, priorityFilter: 'high' }
            });

            const filtered = taskService.getFilteredTasks();

            expect(filtered).toHaveLength(1);
            expect(filtered[0].id).toBe('1');
        });
    });

    describe('getFocusTask', () => {
        beforeEach(() => {
            appStore.setState({
                tasks: mockTasks,
                filters: { taskFilter: '', showAllTasks: false }
            });
        });

        it('should return high priority task first', () => {
            const focusTask = taskService.getFocusTask();

            expect(focusTask.priority).toBe('high');
            expect(focusTask.id).toBe('1');
        });

        it('should return first task if no high priority task exists', () => {
            const tasksWithoutHighPriority = [
                { id: '2', title: 'Task 2', status: 'todo', priority: 'normal' },
                { id: '3', title: 'Task 3', status: 'todo', priority: 'normal' }
            ];
            appStore.setState({ tasks: tasksWithoutHighPriority });

            const focusTask = taskService.getFocusTask();

            expect(focusTask.id).toBe('2');
        });
    });

    describe('getNextTasks', () => {
        beforeEach(() => {
            appStore.setState({
                tasks: [
                    { id: '1', name: 'Task 1', priority: 'HIGH', status: 'todo', owner: null },
                    { id: '2', name: 'Task 2', priority: 'MEDIUM', status: 'todo', owner: null },
                    { id: '3', name: 'Task 3', priority: 'MEDIUM', status: 'todo', owner: null },
                    { id: '4', name: 'Task 4', priority: 'LOW', status: 'todo', owner: null },
                    { id: '5', name: 'Task 5', priority: 'HIGH', status: 'done', owner: null }
                ],
                filters: { taskFilter: '', showAllTasks: false, priorityFilter: null }
            });
        });

        it('should return all non-done tasks when no priority filter', () => {
            const result = taskService.getNextTasks();

            // focusTask（HIGH優先度のid:'1'）が除外されるので3つ
            expect(result.tasks).toHaveLength(3);
            expect(result.tasks.every(t => t.id !== '1')).toBe(true); // focusTask除外確認
        });

        it('should filter by HIGH priority', () => {
            appStore.setState({
                tasks: appStore.getState().tasks,
                filters: { priorityFilter: 'HIGH' }
            });

            const result = taskService.getNextTasks();

            expect(result.tasks).toHaveLength(1);
            expect(result.tasks[0].priority).toBe('HIGH');
        });

        it('should filter by MEDIUM priority', () => {
            appStore.setState({
                tasks: appStore.getState().tasks,
                filters: { priorityFilter: 'MEDIUM' }
            });

            const result = taskService.getNextTasks();

            expect(result.tasks).toHaveLength(2);
            expect(result.tasks.every(t => t.priority === 'MEDIUM')).toBe(true);
        });

        it('should filter by LOW priority', () => {
            appStore.setState({
                tasks: appStore.getState().tasks,
                filters: { priorityFilter: 'LOW' }
            });

            const result = taskService.getNextTasks();

            expect(result.tasks).toHaveLength(1);
            expect(result.tasks[0].priority).toBe('LOW');
        });

        it('should not exclude focusTask when priority filter is set', () => {
            // HIGH優先度のタスクが1つだけの場合
            appStore.setState({
                tasks: [
                    { id: '1', name: 'Task 1', priority: 'HIGH', status: 'todo', owner: null }
                ],
                filters: { priorityFilter: 'HIGH' }
            });

            const result = taskService.getNextTasks();

            // priorityFilter設定時はfocusTaskを除外しないので、1つ表示される
            expect(result.tasks).toHaveLength(1);
        });
    });
});
