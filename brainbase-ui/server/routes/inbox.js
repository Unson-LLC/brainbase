/**
 * Inbox Routes
 * インボックス管理のルーティング定義
 */
import express from 'express';
import { InboxController } from '../controllers/inbox-controller.js';

export function createInboxRouter(inboxParser) {
    const router = express.Router();
    const controller = new InboxController(inboxParser);

    // GET /api/inbox/pending - すべての保留中アイテムを取得
    router.get('/pending', controller.getPending);

    // GET /api/inbox/count - 保留中アイテム数を取得
    router.get('/count', controller.getCount);

    // POST /api/inbox/:id/done - 単一アイテムを完了としてマーク
    router.post('/:id/done', controller.markAsDone);

    // POST /api/inbox/mark-all-done - すべてのアイテムを完了としてマーク
    router.post('/mark-all-done', controller.markAllAsDone);

    return router;
}
