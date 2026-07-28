/**
 * Health Routes
 * システムヘルスチェックのルーティング定義
 */
import express from 'express';
import { HealthController } from '../controllers/health-controller.js';

export function createHealthRouter({ configParser }) {
    const router = express.Router();
    const controller = new HealthController({ configParser });

    // GET /api/health - システムヘルスチェック
    router.get('/', controller.getHealth);
    router.get('/terminal', controller.getTerminalHealth);

    return router;
}
