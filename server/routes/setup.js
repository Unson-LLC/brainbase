import express from 'express';
import { SetupController } from '../controllers/setup-controller.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * Setup Router
 * ユーザーのセットアップ設定を提供
 */
export function createSetupRouter(authService, infoSsotService, configParser) {
    const router = express.Router();
    const controller = new SetupController(authService, infoSsotService, configParser);

    // GET /api/setup/config - ユーザーのセットアップ設定を取得
    router.get('/config', requireAuth(authService), controller.getSetupConfig);

    return router;
}
