/**
 * TaskController
 * タスク関連のHTTPリクエスト処理
 */
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
            console.error('Failed to get tasks:', error);
            res.status(500).json({ error: 'Failed to get tasks' });
        }
    };

    /**
     * POST/PUT /api/tasks/:id
     * タスクを更新
     */
    update = async (req, res) => {
        try {
            const { id } = req.params;
            const updates = req.body;
            const success = await this.taskParser.updateTask(id, updates);
            if (success) {
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'Task not found or update failed' });
            }
        } catch (error) {
            console.error('Failed to update task:', error);
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
            const success = await this.taskParser.deleteTask(id);
            if (success) {
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'Task not found or delete failed' });
            }
        } catch (error) {
            console.error('Failed to delete task:', error);
            res.status(500).json({ error: 'Failed to delete task' });
        }
    };

    /**
     * POST /api/tasks/:id/defer
     * タスクを延期（優先度を下げる）
     */
    defer = async (req, res) => {
        try {
            const { id } = req.params;
            const { priority = 'low' } = req.body;
            const success = await this.taskParser.updateTask(id, { priority });
            if (success) {
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'Task not found or defer failed' });
            }
        } catch (error) {
            console.error('Failed to defer task:', error);
            res.status(500).json({ error: 'Failed to defer task' });
        }
    };
}
