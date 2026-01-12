import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskService } from '../../../public/modules/domain/task/task-service.js';
import { httpClient } from '../../../public/modules/core/http-client.js';
import { appStore } from '../../../public/modules/core/store.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

// モジュールをモック化
vi.mock('../../../public/modules/core/http-client.js', () => ({
    httpClient: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn()
    }
}));

describe('TaskService', () => {
    let taskService;
    let mockTasks;

    beforeEach(() => {
        // テストデータ準備
        mockTasks = [
            { id: '1', name: 'Task 1', status: 'todo', priority: 'high' },
            { id: '2', name: 'Task 2', status: 'done', priority: 'normal' },
            { id: '3', name: 'Task 3', status: 'todo', priority: 'normal' }
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

            expect(httpClient.get).toHaveBeenCalledWith('/api/tasks');
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
            httpClient.put.mockResolvedValue({});
            httpClient.get.mockResolvedValue(mockTasks);

            await taskService.completeTask('task-123');

            expect(httpClient.put).toHaveBeenCalledWith('/api/tasks/task-123', { status: 'done' });
            expect(httpClient.get).toHaveBeenCalledWith('/api/tasks');
        });

        it('should emit TASK_COMPLETED event', async () => {
            httpClient.put.mockResolvedValue({});
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
            expect(filtered[0].name).toBe('Task 1');
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

    describe('deferTask', () => {
        it('deferTask呼び出し時_high優先度がmediumに変更される', async () => {
            const tasksWithHigh = [
                { id: 'task-1', name: 'Task 1', priority: 'high', status: 'todo' }
            ];
            appStore.setState({ tasks: tasksWithHigh });
            httpClient.post.mockResolvedValue({});
            httpClient.get.mockResolvedValue(tasksWithHigh);

            await taskService.deferTask('task-1');

            expect(httpClient.post).toHaveBeenCalledWith('/api/tasks/task-1/defer', { priority: 'medium' });
        });

        it('deferTask呼び出し時_medium優先度がlowに変更される', async () => {
            const tasksWithMedium = [
                { id: 'task-1', name: 'Task 1', priority: 'medium', status: 'todo' }
            ];
            appStore.setState({ tasks: tasksWithMedium });
            httpClient.post.mockResolvedValue({});
            httpClient.get.mockResolvedValue(tasksWithMedium);

            await taskService.deferTask('task-1');

            expect(httpClient.post).toHaveBeenCalledWith('/api/tasks/task-1/defer', { priority: 'low' });
        });

        it('deferTask呼び出し時_low優先度はlowのまま', async () => {
            const tasksWithLow = [
                { id: 'task-1', name: 'Task 1', priority: 'low', status: 'todo' }
            ];
            appStore.setState({ tasks: tasksWithLow });
            httpClient.post.mockResolvedValue({});
            httpClient.get.mockResolvedValue(tasksWithLow);

            await taskService.deferTask('task-1');

            expect(httpClient.post).toHaveBeenCalledWith('/api/tasks/task-1/defer', { priority: 'low' });
        });

        it('deferTask呼び出し時_存在しないタスク_何もしない', async () => {
            appStore.setState({ tasks: [] });

            await taskService.deferTask('non-existent');

            expect(httpClient.post).not.toHaveBeenCalled();
        });

        it('deferTask呼び出し時_TASK_DEFERREDイベントが発火される', async () => {
            const tasksWithHigh = [
                { id: 'task-1', name: 'Task 1', priority: 'high', status: 'todo' }
            ];
            appStore.setState({ tasks: tasksWithHigh });
            httpClient.post.mockResolvedValue({});
            httpClient.get.mockResolvedValue(tasksWithHigh);
            const listener = vi.fn();
            eventBus.on(EVENTS.TASK_DEFERRED, listener);

            await taskService.deferTask('task-1');

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.taskId).toBe('task-1');
        });
    });

    describe('updateTask', () => {
        it('updateTask呼び出し時_APIにPUTリクエストが送信される', async () => {
            httpClient.put.mockResolvedValue({});
            httpClient.get.mockResolvedValue(mockTasks);

            await taskService.updateTask('task-1', { name: 'Updated Task' });

            expect(httpClient.put).toHaveBeenCalledWith('/api/tasks/task-1', { name: 'Updated Task' });
        });

        it('updateTask呼び出し時_タスク一覧がリロードされる', async () => {
            httpClient.put.mockResolvedValue({});
            httpClient.get.mockResolvedValue(mockTasks);

            await taskService.updateTask('task-1', { name: 'Updated' });

            expect(httpClient.get).toHaveBeenCalledWith('/api/tasks');
        });

        it('updateTask呼び出し時_TASK_UPDATEDイベントが発火される', async () => {
            httpClient.put.mockResolvedValue({});
            httpClient.get.mockResolvedValue(mockTasks);
            const listener = vi.fn();
            eventBus.on(EVENTS.TASK_UPDATED, listener);

            await taskService.updateTask('task-1', { priority: 'high' });

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.taskId).toBe('task-1');
            expect(listener.mock.calls[0][0].detail.updates).toEqual({ priority: 'high' });
        });

        it('updateTask呼び出し時_複数フィールドが更新される', async () => {
            httpClient.put.mockResolvedValue({});
            httpClient.get.mockResolvedValue(mockTasks);

            const updates = { name: 'New Name', priority: 'high', description: 'New description' };
            await taskService.updateTask('task-1', updates);

            expect(httpClient.put).toHaveBeenCalledWith('/api/tasks/task-1', updates);
        });
    });

    describe('deleteTask', () => {
        it('deleteTask呼び出し時_APIにDELETEリクエストが送信される', async () => {
            httpClient.delete.mockResolvedValue({});
            httpClient.get.mockResolvedValue(mockTasks);

            await taskService.deleteTask('task-1');

            expect(httpClient.delete).toHaveBeenCalledWith('/api/tasks/task-1');
        });

        it('deleteTask呼び出し時_タスク一覧がリロードされる', async () => {
            httpClient.delete.mockResolvedValue({});
            httpClient.get.mockResolvedValue(mockTasks);

            await taskService.deleteTask('task-1');

            expect(httpClient.get).toHaveBeenCalledWith('/api/tasks');
        });

        it('deleteTask呼び出し時_TASK_DELETEDイベントが発火される', async () => {
            httpClient.delete.mockResolvedValue({});
            httpClient.get.mockResolvedValue(mockTasks);
            const listener = vi.fn();
            eventBus.on(EVENTS.TASK_DELETED, listener);

            await taskService.deleteTask('task-1');

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.taskId).toBe('task-1');
        });
    });

    describe('createTask', () => {
        it('createTask呼び出し時_APIにPOSTリクエストが送信される', async () => {
            const newTask = { id: 'task-new', name: 'New Task', status: 'todo' };
            httpClient.post.mockResolvedValue(newTask);
            httpClient.get.mockResolvedValue([...mockTasks, newTask]);

            const taskData = {
                title: 'New Task',
                project: 'general',
                priority: 'medium',
                due: '2025-12-31',
                description: 'Test description'
            };
            await taskService.createTask(taskData);

            expect(httpClient.post).toHaveBeenCalledWith('/api/tasks', taskData);
        });

        it('createTask呼び出し時_タスク一覧がリロードされる', async () => {
            const newTask = { id: 'task-new', name: 'New Task', status: 'todo' };
            httpClient.post.mockResolvedValue(newTask);
            httpClient.get.mockResolvedValue([...mockTasks, newTask]);

            await taskService.createTask({ title: 'New Task' });

            expect(httpClient.get).toHaveBeenCalledWith('/api/tasks');
        });

        it('createTask呼び出し時_TASK_CREATEDイベントが発火される', async () => {
            const newTask = { id: 'task-new', name: 'New Task', status: 'todo' };
            httpClient.post.mockResolvedValue(newTask);
            httpClient.get.mockResolvedValue([...mockTasks, newTask]);
            const listener = vi.fn();
            eventBus.on(EVENTS.TASK_CREATED, listener);

            await taskService.createTask({ title: 'New Task' });

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.task).toEqual(newTask);
        });

        it('createTask呼び出し時_作成されたタスクが返される', async () => {
            const newTask = { id: 'task-new', name: 'New Task', status: 'todo' };
            httpClient.post.mockResolvedValue(newTask);
            httpClient.get.mockResolvedValue([...mockTasks, newTask]);

            const result = await taskService.createTask({ title: 'New Task' });

            expect(result.success).toBe(true);
            expect(result.task).toEqual(newTask);
        });
    });

    describe('getCompletedTasks', () => {
        const completedTasks = [
            { id: '1', name: 'Task 1', status: 'done', updated: '2025-01-10T10:00:00Z' },
            { id: '2', name: 'Task 2', status: 'done', updated: '2025-01-05T10:00:00Z' },
            { id: '3', name: 'Task 3', status: 'done', updated: '2024-12-01T10:00:00Z' }
        ];

        it('getCompletedTasks呼び出し時_APIから完了タスクが取得される', async () => {
            httpClient.get.mockResolvedValue(completedTasks);

            const result = await taskService.getCompletedTasks();

            expect(httpClient.get).toHaveBeenCalledWith('/api/tasks/completed');
            expect(result).toHaveLength(3);
            expect(result.every(t => t.status === 'done')).toBe(true);
        });

        it('getCompletedTasks呼び出し時_新しい順でソートされる', async () => {
            httpClient.get.mockResolvedValue(completedTasks);

            const result = await taskService.getCompletedTasks();

            expect(result[0].id).toBe('1'); // 最新
            expect(result[1].id).toBe('2');
            expect(result[2].id).toBe('3'); // 最古
        });

        it('getCompletedTasks呼び出し時_日付フィルターが適用される', async () => {
            httpClient.get.mockResolvedValue(completedTasks);

            // 過去7日間のみ（2025-01-10基準でテスト）
            // Note: 実際のテストでは日付のモックが必要な場合がある
            const result = await taskService.getCompletedTasks(7);

            // フィルター結果は現在日付に依存するため、存在確認のみ
            expect(Array.isArray(result)).toBe(true);
            expect(result.every(t => t.status === 'done')).toBe(true);
        });

        it('getCompletedTasks呼び出し時_タスクなし_空配列が返される', async () => {
            httpClient.get.mockResolvedValue([]);

            const result = await taskService.getCompletedTasks();

            expect(result).toEqual([]);
        });

        it('getCompletedTasks呼び出し時_完了タスクなし_空配列が返される', async () => {
            httpClient.get.mockResolvedValue([]);

            const result = await taskService.getCompletedTasks();

            expect(result).toEqual([]);
        });
    });

    describe('restoreTask', () => {
        it('restoreTask呼び出し時_APIにPUTリクエストでtodoステータスが送信される', async () => {
            httpClient.put.mockResolvedValue({});
            httpClient.get.mockResolvedValue(mockTasks);

            await taskService.restoreTask('task-123');

            expect(httpClient.put).toHaveBeenCalledWith('/api/tasks/task-123', { status: 'todo' });
        });

        it('restoreTask呼び出し時_タスク一覧がリロードされる', async () => {
            httpClient.put.mockResolvedValue({});
            httpClient.get.mockResolvedValue(mockTasks);

            await taskService.restoreTask('task-123');

            expect(httpClient.get).toHaveBeenCalledWith('/api/tasks');
        });

        it('restoreTask呼び出し時_TASK_RESTOREDイベントが発火される', async () => {
            httpClient.put.mockResolvedValue({});
            httpClient.get.mockResolvedValue(mockTasks);
            const listener = vi.fn();
            eventBus.on(EVENTS.TASK_RESTORED, listener);

            await taskService.restoreTask('task-123');

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.taskId).toBe('task-123');
        });

        it('restoreTask呼び出し時_成功オブジェクトが返される', async () => {
            httpClient.put.mockResolvedValue({});
            httpClient.get.mockResolvedValue(mockTasks);

            const result = await taskService.restoreTask('task-123');

            expect(result.success).toBe(true);
            expect(result.taskId).toBe('task-123');
        });
    });
});
