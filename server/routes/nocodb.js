/**
 * NocoDB Routes
 * NocoDB連携タスクのルーティング定義
 */
import express from 'express';
import { NocoDBController } from '../controllers/nocodb-controller.js';

export function createNocoDBRouter(configParser) {
    const router = express.Router();
    const controller = new NocoDBController(configParser);

    // GET /api/nocodb/tasks - 全プロジェクトのタスク取得
    router.get('/tasks', controller.list);

    // POST /api/nocodb/tasks - タスク作成
    router.post('/tasks', controller.create);

    // PUT /api/nocodb/tasks/:id - タスク更新
    router.put('/tasks/:id', controller.update);

    // DELETE /api/nocodb/tasks/:id - タスク削除
    router.delete('/tasks/:id', controller.delete);

    return router;
}
