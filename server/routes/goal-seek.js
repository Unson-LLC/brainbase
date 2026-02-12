/**
 * Goal Seek Routes
 *
 * Goal Seek機能のルーティング定義
 *
 * エンドポイント:
 * - WS /api/goal-seek/calculate - WebSocket計算エンドポイント
 * - POST /api/goal-seek/intervention/:goalId/respond - 介入回答API
 *
 * 設計書参照: /tmp/dev-ops/spec.md § 3
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { GoalSeekWebSocketManager } from '../services/goal-seek-websocket-manager.js';
import { GoalSeekCalculationService } from '../services/goal-seek-calculation-service.js';

export function createGoalSeekRouter({ authService, eventBus }) {
    const router = express.Router();
    const calculationService = new GoalSeekCalculationService({ eventBus });
    const wsManager = new GoalSeekWebSocketManager({
        authService,
        calculationService,
        maxConnections: Number(process.env.GOAL_SEEK_MAX_CONNECTIONS) || 3,
        calculationTimeout: Number(process.env.GOAL_SEEK_CALCULATION_TIMEOUT) || 10000,
        interventionTimeout: Number(process.env.GOAL_SEEK_INTERVENTION_TIMEOUT) || 3600000
    });

    // WebSocketサーバー参照（server.jsで設定）
    router.wsManager = wsManager;

    // POST /api/goal-seek/intervention/:goalId/respond - 介入回答API
    router.post('/intervention/:goalId/respond', async (req, res) => {
        try {
            const { goalId } = req.params;
            const { interventionId, choice, reason } = req.body;
            const userId = req.user?.userId;

            if (!userId) {
                return res.status(401).json({
                    error: 'Unauthorized',
                    code: 'AUTH_REQUIRED'
                });
            }

            if (!interventionId || !choice) {
                return res.status(400).json({
                    error: 'Bad Request',
                    code: 'MISSING_PARAMETERS',
                    message: 'interventionId and choice are required'
                });
            }

            // 介入回答を処理（WebSocketManager経由）
            const result = await wsManager.handleInterventionResponseHTTP({
                interventionId,
                goalId,
                choice,
                reason,
                userId
            });

            res.json({
                success: true,
                interventionId,
                choice,
                result
            });
        } catch (error) {
            console.error('[GoalSeek] Intervention response error:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                code: 'INTERNAL_ERROR',
                message: error.message
            });
        }
    });

    // GET /api/goal-seek/status - ステータス取得
    router.get('/status', (req, res) => {
        res.json({
            activeConnections: wsManager.getActiveConnectionCount(),
            pendingInterventions: wsManager.pendingInterventions?.size || 0
        });
    });

    return router;
}

/**
 * WebSocketサーバーを初期化してルーターにアタッチ
 */
export function attachWebSocketServer(router, server, path = '/api/goal-seek/calculate') {
    const wsManager = router.wsManager;
    if (!wsManager) {
        throw new Error('WebSocketManager not found in router');
    }

    const wss = new WebSocketServer({ server, path });

    wss.on('connection', async (ws, request) => {
        await wsManager.handleConnection(ws, request);
    });

    wss.on('error', (error) => {
        console.error('[GoalSeek] WebSocket server error:', error);
    });

    return wss;
}

export default createGoalSeekRouter;
