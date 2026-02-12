/**
 * GoalSeekWebSocketManager
 *
 * WebSocket接続を管理し、Goal Seek計算のリアルタイム通信を提供。
 *
 * 機能:
 * - JWT認証
 * - 計算リクエスト処理
 * - 進捗通知
 * - 介入フロー（intervention_required → intervention_response）
 * - 接続数制限
 *
 * 設計書参照: /tmp/dev-ops/spec.md § 2.2
 */

import { randomUUID } from 'crypto';

// WebSocket close codes
const CLOSE_CODES = {
    NORMAL: 1000,
    AUTH_ERROR: 4001,
    MAX_CONNECTIONS: 4002,
    INVALID_MESSAGE: 4003,
    INTERNAL_ERROR: 4004
};

// メッセージタイプ
const MESSAGE_TYPES = {
    CALCULATE: 'calculate',
    PROGRESS: 'progress',
    COMPLETED: 'completed',
    INTERVENTION_REQUIRED: 'intervention_required',
    INTERVENTION_RESPONSE: 'intervention_response',
    INTERVENTION_ACKNOWLEDGED: 'intervention_acknowledged',
    CANCEL: 'cancel',
    CANCELLED: 'cancelled',
    ERROR: 'error'
};

export class GoalSeekWebSocketManager {
    /**
     * @param {Object} options
     * @param {Object} options.authService - 認証サービス
     * @param {Object} options.calculationService - 計算サービス
     * @param {number} options.maxConnections - 最大接続数
     * @param {number} options.calculationTimeout - 計算タイムアウト(ms)
     * @param {number} options.interventionTimeout - 介入有効期限(ms)
     */
    constructor(options = {}) {
        this.authService = options.authService;
        this.calculationService = options.calculationService;
        this.maxConnections = options.maxConnections || 3;
        this.calculationTimeout = options.calculationTimeout || 10000;
        this.interventionTimeout = options.interventionTimeout || 3600000;

        // 接続管理: WebSocket → { userId, role, connectedAt }
        this.connections = new Map();

        // 介入管理: interventionId → { ws, correlationId, payload, expiresAt }
        this.pendingInterventions = new Map();
    }

    /**
     * WebSocket接続を処理
     *
     * @param {WebSocket} ws - WebSocketインスタンス
     * @param {Object} request - HTTPリクエスト
     */
    async handleConnection(ws, request) {
        // 接続数チェック
        if (this.connections.size >= this.maxConnections) {
            this._sendError(ws, null, 'Max connections reached', CLOSE_CODES.MAX_CONNECTIONS);
            ws.close(CLOSE_CODES.MAX_CONNECTIONS);
            return;
        }

        // 認証
        const authHeader = request.headers?.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

        if (!token) {
            this._sendError(ws, null, 'Authorization required', CLOSE_CODES.AUTH_ERROR);
            ws.close(CLOSE_CODES.AUTH_ERROR);
            return;
        }

        try {
            const user = await this.authService.verifyToken(token);

            // 接続を登録
            this.connections.set(ws, {
                userId: user.userId,
                role: user.role,
                connectedAt: new Date().toISOString()
            });

            // メッセージハンドラを設定
            ws.on('message', (data) => this.handleMessage(ws, data.toString()));

            // 接続成功メッセージ
            this._send(ws, {
                type: 'connected',
                correlationId: randomUUID(),
                userId: user.userId
            });

        } catch (error) {
            this._sendError(ws, null, 'Authentication failed', CLOSE_CODES.AUTH_ERROR);
            ws.close(CLOSE_CODES.AUTH_ERROR);
        }
    }

    /**
     * WebSocketメッセージを処理
     *
     * @param {WebSocket} ws - WebSocketインスタンス
     * @param {string} data - メッセージデータ
     */
    async handleMessage(ws, data) {
        let message;
        let correlationId = null;

        // JSONパース
        try {
            message = JSON.parse(data);
            correlationId = message.correlationId;
        } catch {
            this._sendError(ws, null, 'Invalid JSON', null, 'INVALID_MESSAGE');
            return;
        }

        const { type, payload } = message;

        try {
            switch (type) {
                case MESSAGE_TYPES.CALCULATE:
                    await this._handleCalculate(ws, correlationId, payload);
                    break;

                case MESSAGE_TYPES.INTERVENTION_RESPONSE:
                    await this._handleInterventionResponse(ws, correlationId, payload);
                    break;

                case MESSAGE_TYPES.CANCEL:
                    await this._handleCancel(ws, correlationId);
                    break;

                default:
                    this._sendError(ws, correlationId, `Unknown message type: ${type}`, null, 'UNKNOWN_MESSAGE_TYPE');
            }
        } catch (error) {
            this._sendError(ws, correlationId, error.message, null, 'INTERNAL_ERROR');
        }
    }

    /**
     * 接続切断を処理
     *
     * @param {WebSocket} ws - WebSocketインスタンス
     */
    handleDisconnect(ws) {
        this.connections.delete(ws);
    }

    /**
     * アクティブ接続数を取得
     *
     * @returns {number}
     */
    getActiveConnectionCount() {
        return this.connections.size;
    }

    /**
     * 接続情報を取得
     *
     * @param {WebSocket} ws
     * @returns {Object|null}
     */
    getConnectionInfo(ws) {
        return this.connections.get(ws) || null;
    }

    /**
     * HTTP経由で介入回答を処理
     *
     * @param {Object} params
     * @param {string} params.interventionId - 介入ID
     * @param {string} params.goalId - ゴールID
     * @param {string} params.choice - 選択（proceed, abort, modify）
     * @param {string} params.reason - 理由（任意）
     * @param {string} params.userId - ユーザーID
     * @returns {Promise<Object>} 処理結果
     */
    async handleInterventionResponseHTTP({ interventionId, goalId, choice, reason, userId }) {
        const pending = this.pendingInterventions.get(interventionId);

        if (!pending) {
            throw new Error('Intervention not found or expired');
        }

        // 期限チェック
        if (Date.now() > pending.expiresAt) {
            this.pendingInterventions.delete(interventionId);
            throw new Error('Intervention expired');
        }

        // 所有者チェック
        const connectionInfo = this.connections.get(pending.ws);
        if (connectionInfo?.userId !== userId) {
            throw new Error('Unauthorized: intervention belongs to another user');
        }

        // 介入を削除
        this.pendingInterventions.delete(interventionId);

        // WebSocket経由で通知
        this._send(pending.ws, {
            type: MESSAGE_TYPES.INTERVENTION_ACKNOWLEDGED,
            correlationId: pending.correlationId,
            interventionId,
            choice,
            reason,
            source: 'http'
        });

        // 選択に応じて処理を継続
        if (choice === 'proceed') {
            this._send(pending.ws, {
                type: MESSAGE_TYPES.COMPLETED,
                correlationId: pending.correlationId,
                result: pending.result
            });
        }

        return {
            interventionId,
            goalId,
            choice,
            acknowledged: true
        };
    }

    /**
     * すべての接続を閉じてクリーンアップ
     */
    cleanup() {
        for (const ws of this.connections.keys()) {
            try {
                ws.close(CLOSE_CODES.NORMAL);
            } catch {
                // ignore
            }
        }
        this.connections.clear();
        this.pendingInterventions.clear();
    }

    // ===== Private Methods =====

    /**
     * 計算リクエストを処理
     * @private
     */
    async _handleCalculate(ws, correlationId, payload) {
        const result = await this.calculationService.calculate(payload, {
            correlationId,
            emitProgress: true
        });

        // 介入判定
        const intervention = this.calculationService.checkInterventionNeeded(result);

        if (intervention.needed) {
            const interventionId = randomUUID();
            this.pendingInterventions.set(interventionId, {
                ws,
                correlationId,
                payload,
                result,
                expiresAt: Date.now() + this.interventionTimeout
            });

            this._send(ws, {
                type: MESSAGE_TYPES.INTERVENTION_REQUIRED,
                correlationId,
                intervention: {
                    id: interventionId,
                    type: intervention.type,
                    reason: intervention.reason,
                    calculation: result
                }
            });
        } else {
            this._send(ws, {
                type: MESSAGE_TYPES.COMPLETED,
                correlationId,
                result
            });
        }
    }

    /**
     * 介入回答を処理
     * @private
     */
    async _handleInterventionResponse(ws, correlationId, payload) {
        const { interventionId, choice } = payload;

        const pending = this.pendingInterventions.get(interventionId);
        if (!pending) {
            this._sendError(ws, correlationId, 'Intervention not found or expired', null, 'INTERVENTION_EXPIRED');
            return;
        }

        // 期限チェック
        if (Date.now() > pending.expiresAt) {
            this.pendingInterventions.delete(interventionId);
            this._sendError(ws, correlationId, 'Intervention expired', null, 'INTERVENTION_EXPIRED');
            return;
        }

        this.pendingInterventions.delete(interventionId);

        // 回答を確認
        this._send(ws, {
            type: MESSAGE_TYPES.INTERVENTION_ACKNOWLEDGED,
            correlationId,
            interventionId,
            choice
        });

        // 選択に応じて処理を継続（実装は要件に応じて拡張）
        if (choice === 'proceed') {
            this._send(ws, {
                type: MESSAGE_TYPES.COMPLETED,
                correlationId,
                result: pending.result
            });
        }
    }

    /**
     * キャンセルリクエストを処理
     * @private
     */
    async _handleCancel(ws, correlationId) {
        // 関連する介入があれば削除
        for (const [id, pending] of this.pendingInterventions) {
            if (pending.correlationId === correlationId) {
                this.pendingInterventions.delete(id);
                break;
            }
        }

        this._send(ws, {
            type: MESSAGE_TYPES.CANCELLED,
            correlationId
        });
    }

    /**
     * メッセージを送信
     * @private
     */
    _send(ws, data) {
        if (ws.readyState === 1) { // OPEN
            ws.send(JSON.stringify(data));
        }
    }

    /**
     * エラーメッセージを送信
     * @private
     */
    _sendError(ws, correlationId, message, closeCode, code = 'ERROR') {
        this._send(ws, {
            type: MESSAGE_TYPES.ERROR,
            correlationId,
            code,
            message
        });

        if (closeCode) {
            ws.close(closeCode);
        }
    }
}

export default GoalSeekWebSocketManager;
