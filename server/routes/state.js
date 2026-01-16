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

    return router;
}
