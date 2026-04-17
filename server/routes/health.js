/**
 * Health Routes
 * システムヘルスチェックのルーティング定義
 */
import express from 'express';
import { HealthController } from '../controllers/health-controller.js';

export function createHealthRouter({ readiness, configParser, terminalRuntimeReconciler = null }) {
    const router = express.Router();
    const controller = new HealthController({ readiness, configParser, terminalRuntimeReconciler });

    // GET /api/health - システムヘルスチェック
    router.get('/', controller.getHealth);
    router.get('/terminal', controller.getTerminalHealth);

    return router;
}
