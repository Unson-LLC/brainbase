/**
 * Goal Seek Routes
 *
 * 目標達成逆算計算のルーティング定義
 *
 * エンドポイント:
 * - GET /api/goal-seek/status - サービスステータス確認
 * - POST /api/goal-seek/calculate - 計算リクエスト（HTTPフォールバック）
 * - WebSocket upgrade /api/goal-seek/calculate - WebSocket接続
 */
import express from 'express';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/auth.js';

export function createGoalSeekRouter({ authService, calculationService, wsManager }) {
    const router = express.Router();

    /**
     * GET /api/goal-seek/status
     * サービスステータスを返す
     */
    router.get('/status', (req, res) => {
        const activeConnections = wsManager?.getActiveConnectionCount() || 0;

        res.json({
            status: 'available',
            activeConnections,
            timestamp: new Date().toISOString()
        });
    });

    /**
     * POST /api/goal-seek/calculate
     * HTTP経由で計算リクエストを処理（WebSocketのフォールバック）
     */
    router.post('/calculate', requireAuth(authService), async (req, res, next) => {
        try {
            const { target, period, current = 0, unit = '件', correlationId: clientCorrelationId } = req.body;

            // バリデーション
            if (target === undefined || target === null) {
                return res.status(400).json({
                    error: 'Validation failed: target is required'
                });
            }

            if (period === undefined || period === null) {
                return res.status(400).json({
                    error: 'Validation failed: period is required'
                });
            }

            // 基本型チェック
            if (typeof target !== 'number' || target < 0) {
                return res.status(400).json({
                    error: 'Validation failed: target must be a non-negative number'
                });
            }

            if (typeof period !== 'number' || period < 1 || period > 365) {
                return res.status(400).json({
                    error: 'Validation failed: period must be between 1 and 365'
                });
            }

            // 計算実行
            const correlationId = clientCorrelationId || randomUUID();
            const result = await calculationService.calculate(
                { target, period, current, unit },
                { correlationId, emitProgress: false }
            );

            // 介入判定
            const intervention = calculationService.checkInterventionNeeded(result);

            res.json({
                result,
                intervention,
                correlationId
            });
        } catch (error) {
            // バリデーションエラーは400
            if (error.message.includes('must be') || error.message.includes('between')) {
                return res.status(400).json({
                    error: `Validation failed: ${error.message}`
                });
            }
            // その他のエラーは500
            next(error);
        }
    });

    /**
     * WebSocket upgrade handling
     * WebSocket接続はserver.jsでWebSocket Server経由で処理されるため、
     * ここではルーターエクスポートのみ行う
     */
    router.ws = null; // Placeholder for WebSocket upgrade handler

    return router;
}

export default createGoalSeekRouter;
