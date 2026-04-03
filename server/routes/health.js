/**
 * Health Routes
 * システムヘルスチェックのルーティング定義
 */
import express from 'express';
import { HealthController } from '../controllers/health-controller.js';

export function createHealthRouter({ readiness, configParser }) {
    const router = express.Router();
    const controller = new HealthController({ readiness, configParser });

    // GET /api/health - システムヘルスチェック
    router.get('/', controller.getHealth);

    return router;
}
