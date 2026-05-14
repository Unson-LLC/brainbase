/**
 * Misc Routes
 * その他のルーティング定義（version, restart, upload, open-file）
 */
import express from 'express';
import { MiscController } from '../controllers/misc-controller.js';

export function createMiscRouter(appVersion, uploadMiddleware, workspaceRoot, uploadsDir, runtimeInfo = null, paths = {}) {
    const router = express.Router();
    const controller = new MiscController(appVersion, uploadMiddleware, workspaceRoot, uploadsDir, runtimeInfo, paths);

    // GET /api/version - アプリケーションバージョンを取得
    router.get('/version', controller.getVersion);

    // POST /api/restart - サーバーを再起動
    router.post('/restart', controller.restart);

    // POST /api/upload - ファイルをアップロード
    router.post('/upload', uploadMiddleware, controller.upload);

    // POST /api/open-file - エディタでファイルを開く
    router.post('/open-file', controller.openFile);

    // POST /api/client-diagnostics/session-menu - セッションメニュー操作診断ログ
    router.post('/client-diagnostics/session-menu', controller.recordSessionMenuDiagnostic);

    return router;
}
