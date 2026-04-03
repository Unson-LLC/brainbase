/**
 * State Routes
 * 状態管理のルーティング定義
 */
import express from 'express';
import { StateController } from '../controllers/state-controller.js';

export function createStateRouter(stateStore, sessionManager, testMode = false) {
    const router = express.Router();
    const controller = new StateController(stateStore, sessionManager, testMode);

    // GET /api/state - アプリケーション状態を取得
    router.get('/', controller.get);

    // POST /api/state - アプリケーション状態を更新
    router.post('/', controller.update);

    // POST /api/state/sessions - 単一セッション追加
    router.post('/sessions', controller.createSession);

    // PATCH /api/state/sessions/:sessionId - 単一セッション部分更新
    router.patch('/sessions/:sessionId', controller.patch);

    // DELETE /api/state/sessions/:sessionId - 単一セッション削除
    router.delete('/sessions/:sessionId', controller.deleteSession);

    // POST /api/state/sessions/reorder - セッション並び順保存
    router.post('/sessions/reorder', controller.reorderSessions);

    return router;
}
