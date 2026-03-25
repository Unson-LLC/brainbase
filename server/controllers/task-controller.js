import { asyncHandler } from '../lib/async-handler.js';
import { pickAllowedFields, getDefaultDueDate } from '../lib/validation.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

/**
 * TaskController
 * タスク関連のHTTPリクエスト処理
 */

const ALLOWED_UPDATE_FIELDS = [
    'title', 'status', 'priority', 'deadline', 'tags', 'description', 'focus', 'project', 'owner'
];

const ALLOWED_PRIORITIES = ['low', 'medium', 'high'];
const DEFAULT_ASSIGNEE = '自分';
const DEFAULT_PRIORITY = 'medium';

export class TaskController {
    constructor(taskParser) {
        this.taskParser = taskParser;
    }

    /** GET /api/tasks */
    list = asyncHandler(async (req, res) => {
        const tasks = await this.taskParser.getAllTasks();
        res.json(tasks);
    });

    /** GET /api/tasks/completed */
    listCompleted = asyncHandler(async (req, res) => {
        const tasks = await this.taskParser.getCompletedTasks();
        res.json(tasks);
    });

    /** POST/PUT /api/tasks/:id */
    update = asyncHandler(async (req, res) => {
        const { id } = req.params;

        if (!id || typeof id !== 'string') {
            throw AppError.validation('Invalid task ID');
        }

        const validatedUpdates = pickAllowedFields(req.body, ALLOWED_UPDATE_FIELDS);
        if (!validatedUpdates) {
            throw AppError.validation('Invalid update fields');
        }

        const success = await this.taskParser.updateTask(id, validatedUpdates);
        if (!success) {
            throw new AppError('Task not found or update failed', ErrorCodes.TASK_NOT_FOUND);
        }

        res.json({ success: true });
    });

    /** DELETE /api/tasks/:id */
    delete = asyncHandler(async (req, res) => {
        const { id } = req.params;

        if (!id || typeof id !== 'string') {
            throw AppError.validation('Invalid task ID');
        }

        const success = await this.taskParser.deleteTask(id);
        if (!success) {
            throw new AppError('Task not found or delete failed', ErrorCodes.TASK_NOT_FOUND);
        }

        res.json({ success: true });
    });

    /** POST /api/tasks */
    create = asyncHandler(async (req, res) => {
        const { title, project, priority, due, description, owner, assignee } = req.body;

        if (!title || typeof title !== 'string' || title.trim() === '') {
            throw AppError.validation('Title is required');
        }

        const normalizedPriority = typeof priority === 'string' ? priority.trim().toLowerCase() : '';
        if (normalizedPriority && !ALLOWED_PRIORITIES.includes(normalizedPriority)) {
            throw AppError.validation('Invalid priority value');
        }

        const normalizedOwner = typeof owner === 'string' && owner.trim()
            ? owner.trim()
            : (typeof assignee === 'string' && assignee.trim() ? assignee.trim() : DEFAULT_ASSIGNEE);
        const normalizedDue = typeof due === 'string' && due.trim()
            ? due.trim()
            : getDefaultDueDate();

        const task = await this.taskParser.createTask({
            title: title.trim(),
            project: project || 'general',
            priority: normalizedPriority || DEFAULT_PRIORITY,
            due: normalizedDue,
            description: description || '',
            owner: normalizedOwner
        });

        res.status(201).json(task);
    });

    /** POST /api/tasks/:id/defer */
    defer = asyncHandler(async (req, res) => {
        const { id } = req.params;

        if (!id || typeof id !== 'string') {
            throw AppError.validation('Invalid task ID');
        }

        const { priority = 'low' } = req.body;
        if (!ALLOWED_PRIORITIES.includes(priority)) {
            throw AppError.validation('Invalid priority value');
        }

        const success = await this.taskParser.updateTask(id, { priority });
        if (!success) {
            throw new AppError('Task not found or defer failed', ErrorCodes.TASK_NOT_FOUND);
        }

        res.json({ success: true });
    });
}
