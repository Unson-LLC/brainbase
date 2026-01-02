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
            updateTask: vi.fn(),
            deleteTask: vi.fn()
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
});
