import { logger } from '../utils/logger.js';

/**
 * TaskController
 * タスク関連のHTTPリクエスト処理
 */

// タスク更新の許可フィールド
const ALLOWED_UPDATE_FIELDS = [
    'title', 'status', 'priority', 'deadline', 'tags', 'description', 'focus', 'project', 'owner'
];

const DEFAULT_ASSIGNEE = '自分';
const DEFAULT_PRIORITY = 'medium';

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getDefaultDueDate() {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return formatDate(date);
}

/**
 * タスク更新オブジェクトの検証
 * @param {Object} updates - 更新対象フィールド
 * @returns {Object|null} 検証済みオブジェクト（不正な場合はnull）
 */
function validateTaskUpdates(updates) {
    if (!updates || typeof updates !== 'object') {
        return null;
    }

    // 許可されたフィールドのみ残す
    const validated = {};
    for (const key of ALLOWED_UPDATE_FIELDS) {
        if (key in updates) {
            validated[key] = updates[key];
        }
    }

    // 少なくとも1つのフィールドが必要
    if (Object.keys(validated).length === 0) {
        return null;
    }

    return validated;
}

export class TaskController {
    constructor(taskParser) {
        this.taskParser = taskParser;
    }

    /**
     * GET /api/tasks
     * すべてのタスクを取得
     */
    list = async (req, res) => {
        try {
            const tasks = await this.taskParser.getAllTasks();
            res.json(tasks);
        } catch (error) {
            logger.error('Failed to get tasks', { error });
            res.status(500).json({ error: 'Failed to get tasks' });
        }
    };

    /**
     * GET /api/tasks/completed
     * 完了済みタスクを取得
     */
    listCompleted = async (req, res) => {
        try {
            const tasks = await this.taskParser.getCompletedTasks();
            res.json(tasks);
        } catch (error) {
            logger.error('Failed to get completed tasks', { error });
            res.status(500).json({ error: 'Failed to get completed tasks' });
        }
    };

    /**
     * POST/PUT /api/tasks/:id
     * タスクを更新
     */
    update = async (req, res) => {
        try {
            const { id } = req.params;
            console.log('[TaskController] update called, id:', id, 'body:', req.body);

            // 入力検証: id は文字列
            if (!id || typeof id !== 'string') {
                console.log('[TaskController] Invalid task ID');
                return res.status(400).json({ error: 'Invalid task ID' });
            }

            // 入力検証: updates オブジェクト
            const validatedUpdates = validateTaskUpdates(req.body);
            console.log('[TaskController] validatedUpdates:', validatedUpdates);
            if (!validatedUpdates) {
                console.log('[TaskController] Invalid update fields');
                return res.status(400).json({ error: 'Invalid update fields' });
            }

            const success = await this.taskParser.updateTask(id, validatedUpdates);
            console.log('[TaskController] updateTask result:', success);
            if (success) {
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'Task not found or update failed' });
            }
        } catch (error) {
            logger.error('Failed to update task', { error, taskId: req.params.id });
            res.status(500).json({ error: 'Failed to update task' });
        }
    };

    /**
     * DELETE /api/tasks/:id
     * タスクを削除
     */
    delete = async (req, res) => {
        try {
            const { id } = req.params;

            // 入力検証: id は文字列
            if (!id || typeof id !== 'string') {
                return res.status(400).json({ error: 'Invalid task ID' });
            }

            const success = await this.taskParser.deleteTask(id);
            if (success) {
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'Task not found or delete failed' });
            }
        } catch (error) {
            logger.error('Failed to delete task', { error, taskId: req.params.id });
            res.status(500).json({ error: 'Failed to delete task' });
        }
    };

    /**
     * POST /api/tasks
     * 新しいタスクを作成
     */
    create = async (req, res) => {
        try {
            const { title, project, priority, due, description, owner, assignee } = req.body;

            // 入力検証: title は必須
            if (!title || typeof title !== 'string' || title.trim() === '') {
                return res.status(400).json({ error: 'Title is required' });
            }

            // 入力検証: priority は許可値のみ
            const allowedPriorities = ['low', 'medium', 'high'];
            const normalizedPriority = typeof priority === 'string' ? priority.trim().toLowerCase() : '';
            if (normalizedPriority && !allowedPriorities.includes(normalizedPriority)) {
                return res.status(400).json({ error: 'Invalid priority value' });
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
        } catch (error) {
            logger.error('Failed to create task', { error });
            res.status(500).json({ error: 'Failed to create task' });
        }
    };

    /**
     * POST /api/tasks/:id/defer
     * タスクを延期（優先度を下げる）
     */
    defer = async (req, res) => {
        try {
            const { id } = req.params;

            // 入力検証: id は文字列
            if (!id || typeof id !== 'string') {
                return res.status(400).json({ error: 'Invalid task ID' });
            }

            // 入力検証: priority は許可値のみ
            const { priority = 'low' } = req.body;
            const allowedPriorities = ['low', 'medium', 'high'];
            if (!allowedPriorities.includes(priority)) {
                return res.status(400).json({ error: 'Invalid priority value' });
            }

            const success = await this.taskParser.updateTask(id, { priority });
            if (success) {
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'Task not found or defer failed' });
            }
        } catch (error) {
            logger.error('Failed to defer task', { error, taskId: req.params.id });
            res.status(500).json({ error: 'Failed to defer task' });
        }
    };
}
