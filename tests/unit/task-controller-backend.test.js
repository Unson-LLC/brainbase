import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskController } from '../../server/controllers/task-controller.js';
import { AppError } from '../../server/lib/errors.js';

function flushAsyncHandler() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('TaskController (Backend)', () => {
    let taskController;
    let mockTaskParser;
    let mockReq;
    let mockRes;
    let mockNext;

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
        mockNext = vi.fn();

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

            taskController.defer(mockReq, mockRes, mockNext);

            await flushAsyncHandler();

            expect(mockTaskParser.updateTask).toHaveBeenCalledWith('task-123', { priority: 'medium' });
            expect(mockRes.json).toHaveBeenCalledWith({ success: true });
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('defer呼び出し時_タスクが存在しない場合は404を返す', async () => {
            mockReq.params = { id: 'non-existent' };
            mockReq.body = { priority: 'low' };
            mockTaskParser.updateTask.mockResolvedValue(false);

            taskController.defer(mockReq, mockRes, mockNext);
            await flushAsyncHandler();

            expect(mockTaskParser.updateTask).toHaveBeenCalledWith('non-existent', { priority: 'low' });
            expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));

            const error = mockNext.mock.calls[0][0];
            expect(error).toBeInstanceOf(AppError);
            expect(error.statusCode).toBe(404);
            expect(error.code).toBe('TASK_NOT_FOUND');
            expect(error.message).toBe('Task not found or defer failed');
            expect(mockRes.status).not.toHaveBeenCalled();
            expect(mockRes.json).not.toHaveBeenCalled();
        });

        it('defer呼び出し時_エラーが発生した場合は500を返す', async () => {
            mockReq.params = { id: 'task-123' };
            mockReq.body = { priority: 'low' };
            mockTaskParser.updateTask.mockRejectedValue(new Error('Database error'));

            taskController.defer(mockReq, mockRes, mockNext);
            await flushAsyncHandler();

            expect(mockNext).toHaveBeenCalledWith(expect.any(Error));

            const error = mockNext.mock.calls[0][0];
            expect(error).toBeInstanceOf(Error);
            expect(error).not.toBeInstanceOf(AppError);
            expect(error.message).toBe('Database error');
            expect(mockRes.status).not.toHaveBeenCalled();
            expect(mockRes.json).not.toHaveBeenCalled();
        });

        it('defer呼び出し時_priorityが指定されていない場合はデフォルトでlowにする', async () => {
            mockReq.params = { id: 'task-123' };
            mockReq.body = {};
            mockTaskParser.updateTask.mockResolvedValue(true);

            taskController.defer(mockReq, mockRes, mockNext);
            await flushAsyncHandler();

            expect(mockTaskParser.updateTask).toHaveBeenCalledWith('task-123', { priority: 'low' });
            expect(mockRes.json).toHaveBeenCalledWith({ success: true });
            expect(mockNext).not.toHaveBeenCalled();
        });
    });
});
