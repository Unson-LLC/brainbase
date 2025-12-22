/**
 * Misc Routes
 * その他のルーティング定義（version, restart, upload）
 */
import express from 'express';
import { MiscController } from '../controllers/misc-controller.js';

export function createMiscRouter(appVersion, uploadMiddleware) {
    const router = express.Router();
    const controller = new MiscController(appVersion, uploadMiddleware);

    // GET /api/version - アプリケーションバージョンを取得
    router.get('/version', controller.getVersion);

    // POST /api/restart - サーバーを再起動
    router.post('/restart', controller.restart);

    // POST /api/upload - ファイルをアップロード
    router.post('/upload', uploadMiddleware, controller.upload);

    return router;
}
