import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskController } from '../../server/controllers/task-controller.js';

describe('TaskController (Backend)', () => {
    let taskController;
    let mockTaskParser;
    let mockReq;
    let mockRes;

    beforeEach(() => {
        // Mock TaskParser
        mockTaskParser = {
            getAllTasks: vi.fn(),
            getCompletedTasks: vi.fn(),
            updateTask: vi.fn(),
            deleteTask: vi.fn(),
            createTask: vi.fn()
        };

        // Mock Request/Response
        mockReq = {
            params: {},
            body: {}
        };
        mockRes = {
            json: vi.fn(),
            status: vi.fn().mockReturnThis()
        };

        // Create controller instance
        taskController = new TaskController(mockTaskParser);

        // Clear mocks
        vi.clearAllMocks();
    });

    describe('defer', () => {
        it('defer呼び出し時_TaskParserのupdateTaskを呼び出して優先度を更新する', async () => {
            mockReq.params = { id: 'task-123' };
            mockReq.body = { priority: 'medium' };
            mockTaskParser.updateTask.mockResolvedValue(true);

            await taskController.defer(mockReq, mockRes);

            expect(mockTaskParser.updateTask).toHaveBeenCalledWith('task-123', { priority: 'medium' });
            expect(mockRes.json).toHaveBeenCalledWith({ success: true });
        });

        it('defer呼び出し時_タスクが存在しない場合は404を返す', async () => {
            mockReq.params = { id: 'non-existent' };
            mockReq.body = { priority: 'low' };
            mockTaskParser.updateTask.mockResolvedValue(false);

            await taskController.defer(mockReq, mockRes);

            expect(mockTaskParser.updateTask).toHaveBeenCalledWith('non-existent', { priority: 'low' });
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Task not found or defer failed' });
        });

        it('defer呼び出し時_エラーが発生した場合は500を返す', async () => {
            mockReq.params = { id: 'task-123' };
            mockReq.body = { priority: 'low' };
            mockTaskParser.updateTask.mockRejectedValue(new Error('Database error'));

            await taskController.defer(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Failed to defer task' });
        });

        it('defer呼び出し時_priorityが指定されていない場合はデフォルトでlowにする', async () => {
            mockReq.params = { id: 'task-123' };
            mockReq.body = {};
            mockTaskParser.updateTask.mockResolvedValue(true);

            await taskController.defer(mockReq, mockRes);

            expect(mockTaskParser.updateTask).toHaveBeenCalledWith('task-123', { priority: 'low' });
            expect(mockRes.json).toHaveBeenCalledWith({ success: true });
        });
    });

    describe('create', () => {
        it('create呼び出し時_有効なデータでタスクが作成される', async () => {
            const newTask = { id: 'task-new', name: 'New Task', status: 'todo' };
            mockReq.body = {
                title: 'New Task',
                project: 'general',
                priority: 'medium',
                due: '2025-12-31',
                description: 'Test description'
            };
            mockTaskParser.createTask.mockResolvedValue(newTask);

            await taskController.create(mockReq, mockRes);

            expect(mockTaskParser.createTask).toHaveBeenCalledWith({
                title: 'New Task',
                project: 'general',
                priority: 'medium',
                due: '2025-12-31',
                description: 'Test description'
            });
            expect(mockRes.status).toHaveBeenCalledWith(201);
            expect(mockRes.json).toHaveBeenCalledWith(newTask);
        });

        it('create呼び出し時_titleが未指定の場合は400エラーを返す', async () => {
            mockReq.body = {};

            await taskController.create(mockReq, mockRes);

            expect(mockTaskParser.createTask).not.toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Title is required' });
        });

        it('create呼び出し時_titleが空文字の場合は400エラーを返す', async () => {
            mockReq.body = { title: '   ' };

            await taskController.create(mockReq, mockRes);

            expect(mockTaskParser.createTask).not.toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Title is required' });
        });

        it('create呼び出し時_無効なpriorityの場合は400エラーを返す', async () => {
            mockReq.body = { title: 'Task', priority: 'invalid' };

            await taskController.create(mockReq, mockRes);

            expect(mockTaskParser.createTask).not.toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid priority value' });
        });

        it('create呼び出し時_必須項目のみでタスクが作成される', async () => {
            const newTask = { id: 'task-new', name: 'Task Title', status: 'todo' };
            mockReq.body = { title: 'Task Title' };
            mockTaskParser.createTask.mockResolvedValue(newTask);

            await taskController.create(mockReq, mockRes);

            expect(mockTaskParser.createTask).toHaveBeenCalledWith({
                title: 'Task Title',
                project: 'general',
                priority: 'medium',
                due: null,
                description: ''
            });
            expect(mockRes.status).toHaveBeenCalledWith(201);
        });

        it('create呼び出し時_エラーが発生した場合は500を返す', async () => {
            mockReq.body = { title: 'Task' };
            mockTaskParser.createTask.mockRejectedValue(new Error('Database error'));

            await taskController.create(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Failed to create task' });
        });

        it('create呼び出し時_titleの前後空白がトリムされる', async () => {
            const newTask = { id: 'task-new', name: 'Trimmed Task', status: 'todo' };
            mockReq.body = { title: '  Trimmed Task  ' };
            mockTaskParser.createTask.mockResolvedValue(newTask);

            await taskController.create(mockReq, mockRes);

            expect(mockTaskParser.createTask).toHaveBeenCalledWith(expect.objectContaining({
                title: 'Trimmed Task'
            }));
        });
    });

    describe('listCompleted', () => {
        it('listCompleted呼び出し時_完了タスク一覧が返される', async () => {
            const completedTasks = [
                { id: 'task-1', name: 'Task 1', status: 'done' },
                { id: 'task-2', name: 'Task 2', status: 'done' }
            ];
            mockTaskParser.getCompletedTasks.mockResolvedValue(completedTasks);

            await taskController.listCompleted(mockReq, mockRes);

            expect(mockTaskParser.getCompletedTasks).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith(completedTasks);
        });

        it('listCompleted呼び出し時_完了タスクがない場合は空配列が返される', async () => {
            mockTaskParser.getCompletedTasks.mockResolvedValue([]);

            await taskController.listCompleted(mockReq, mockRes);

            expect(mockTaskParser.getCompletedTasks).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith([]);
        });

        it('listCompleted呼び出し時_エラーが発生した場合は500を返す', async () => {
            mockTaskParser.getCompletedTasks.mockRejectedValue(new Error('Database error'));

            await taskController.listCompleted(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Failed to get completed tasks' });
        });
    });
});
