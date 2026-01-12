/**
 * Task Routes
 * タスク関連のルーティング定義
 */
import express from 'express';
import { TaskController } from '../controllers/task-controller.js';

export function createTaskRouter(taskParser) {
    const router = express.Router();
    const controller = new TaskController(taskParser);

    // GET /api/tasks - すべてのタスクを取得
    router.get('/', controller.list);

    // GET /api/tasks/completed - 完了済みタスクを取得
    router.get('/completed', controller.listCompleted);

    // POST /api/tasks - 新しいタスクを作成
    router.post('/', controller.create);

    // POST /api/tasks/:id - タスクを更新
    router.post('/:id', controller.update);

    // PUT /api/tasks/:id - タスクを更新
    router.put('/:id', controller.update);

    // DELETE /api/tasks/:id - タスクを削除
    router.delete('/:id', controller.delete);

    // POST /api/tasks/:id/defer - タスクを延期（優先度を下げる）
    router.post('/:id/defer', controller.defer);

    return router;
}
