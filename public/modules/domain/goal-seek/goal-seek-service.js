/**
 * GoalSeekService
 *
 * Goal Seek機能のフロントエンドService層
 * WebSocket接続管理とリアルタイム通信を提供
 *
 * 機能:
 * - WebSocket接続管理
 * - 計算リクエスト送信 (type: 'calculate')
 * - 進捗通知受信 (type: 'progress')
 * - 介入リクエスト処理 (type: 'intervention_required')
 * - 介入回答送信 (type: 'intervention_response')
 * - EventBus統合 (GOAL_SEEK_* イベント)
 *
 * 設計書参照: /tmp/dev-ops/spec.md § 3
 */

import { eventBus, EVENTS } from '../../core/event-bus.js';

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

// WebSocket readyState
const WS_STATE = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3
};

export class GoalSeekService {
    /**
     * @param {Object} options
     * @param {string} options.wsUrl - WebSocket URL
     * @param {string} options.token - Bearer token
     */
    constructor(options = {}) {
        this.wsUrl = options.wsUrl || 'ws://localhost:31013/api/goal-seek/calculate';
        this.token = options.token || null;
        this.ws = null;
        this.eventBus = eventBus;

        // コールバック管理
        this._progressCallbacks = new Set();
        this._interventionCallbacks = new Set();
        this._errorCallbacks = new Set();

        // 保留中のリクエスト: correlationId → { resolve, reject }
        this._pendingRequests = new Map();

        // 現在のcorrelationId（キャンセル用）
        this._currentCorrelationId = null;
    }

    /**
     * WebSocket接続を確立
     * @returns {Promise<void>}
     */
    async connect() {
        // 既存接続がある場合は再接続しない
        if (this.ws && this.ws.readyState === WS_STATE.OPEN) {
            return;
        }

        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.wsUrl);

                this.ws.onopen = () => {
                    this._setupMessageHandler();
                    this.eventBus.emit(EVENTS.GOAL_SEEK_CONNECTED, {
                        url: this.wsUrl,
                        timestamp: Date.now()
                    });
                    resolve();
                };

                this.ws.onerror = (error) => {
                    this.eventBus.emit(EVENTS.GOAL_SEEK_ERROR, {
                        code: 'CONNECTION_ERROR',
                        message: 'WebSocket connection failed',
                        error
                    });
                    reject(error);
                };

                this.ws.onclose = (event) => {
                    this.eventBus.emit(EVENTS.GOAL_SEEK_DISCONNECTED, {
                        code: event.code,
                        reason: event.reason,
                        timestamp: Date.now()
                    });
                    this._cleanupPendingRequests('Connection closed');
                };

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * WebSocket接続を切断
     */
    disconnect() {
        if (this.ws) {
            this.ws.close(1000);
            this.ws = null;
        }
        this._cleanupPendingRequests('Disconnected');
    }

    /**
     * 接続状態を確認
     * @returns {boolean}
     */
    isConnected() {
        return this.ws && this.ws.readyState === WS_STATE.OPEN;
    }

    /**
     * 計算リクエストを送信
     * @param {Object} payload - 計算パラメータ
     * @param {number} payload.target - 目標値
     * @param {number} payload.period - 期間(日)
     * @param {number} payload.current - 現在値
     * @param {string} payload.unit - 単位
     * @returns {Promise<Object>} 計算結果
     */
    async calculate(payload) {
        // 接続がない場合は自動接続
        if (!this.isConnected()) {
            await this.connect();
        }

        const correlationId = this._generateCorrelationId();
        this._currentCorrelationId = correlationId;

        return new Promise((resolve, reject) => {
            // 保留中リクエストに追加
            this._pendingRequests.set(correlationId, { resolve, reject });

            // メッセージ送信
            this._send({
                type: MESSAGE_TYPES.CALCULATE,
                correlationId,
                payload
            });
        });
    }

    /**
     * 進捗コールバックを登録
     * @param {Function} callback - 進捗通知を受け取るコールバック
     * @returns {Function} 登録解除関数
     */
    onProgress(callback) {
        this._progressCallbacks.add(callback);
        return () => this._progressCallbacks.delete(callback);
    }

    /**
     * 介入コールバックを登録
     * @param {Function} callback - 介入リクエストを受け取るコールバック
     * @returns {Function} 登録解除関数
     */
    onIntervention(callback) {
        this._interventionCallbacks.add(callback);
        return () => this._interventionCallbacks.delete(callback);
    }

    /**
     * エラーコールバックを登録
     * @param {Function} callback - エラーを受け取るコールバック
     * @returns {Function} 登録解除関数
     */
    onError(callback) {
        this._errorCallbacks.add(callback);
        return () => this._errorCallbacks.delete(callback);
    }

    /**
     * 介入回答を送信
     * @param {Object} response - 介入回答
     * @param {string} response.interventionId - 介入ID
     * @param {string} response.choice - 選択 (proceed, abort, modify)
     * @param {string} response.reason - 理由（任意）
     * @returns {Promise<Object>} 確認結果
     */
    async sendInterventionResponse(response) {
        if (!this.isConnected()) {
            throw new Error('WebSocket is not connected');
        }

        const correlationId = this._generateCorrelationId();

        return new Promise((resolve, reject) => {
            // 保留中リクエストに追加
            this._pendingRequests.set(correlationId, { resolve, reject });

            // メッセージ送信
            this._send({
                type: MESSAGE_TYPES.INTERVENTION_RESPONSE,
                correlationId,
                payload: {
                    interventionId: response.interventionId,
                    choice: response.choice,
                    reason: response.reason
                }
            });
        });
    }

    /**
     * キャンセルリクエストを送信
     * @returns {Promise<Object>} キャンセル結果
     */
    async cancel() {
        if (!this.isConnected()) {
            throw new Error('WebSocket is not connected');
        }

        const correlationId = this._currentCorrelationId || this._generateCorrelationId();

        return new Promise((resolve, reject) => {
            // 保留中リクエストに追加
            this._pendingRequests.set(correlationId, { resolve, reject });

            // メッセージ送信
            this._send({
                type: MESSAGE_TYPES.CANCEL,
                correlationId
            });
        });
    }

    // ===== Private Methods =====

    /**
     * メッセージハンドラを設定
     * @private
     */
    _setupMessageHandler() {
        if (!this.ws) return;

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this._handleMessage(message);
            } catch (error) {
                console.error('[GoalSeekService] Failed to parse message:', error);
            }
        };
    }

    /**
     * メッセージを処理
     * @param {Object} message - 受信メッセージ
     * @private
     */
    _handleMessage(message) {
        const { type, correlationId } = message;

        switch (type) {
            case MESSAGE_TYPES.PROGRESS:
                this._handleProgress(message);
                break;

            case MESSAGE_TYPES.COMPLETED:
                this._handleCompleted(message);
                break;

            case MESSAGE_TYPES.INTERVENTION_REQUIRED:
                this._handleInterventionRequired(message);
                break;

            case MESSAGE_TYPES.INTERVENTION_ACKNOWLEDGED:
                this._handleInterventionAcknowledged(message);
                break;

            case MESSAGE_TYPES.CANCELLED:
                this._handleCancelled(message);
                break;

            case MESSAGE_TYPES.ERROR:
                this._handleError(message);
                break;

            default:
                console.warn('[GoalSeekService] Unknown message type:', type);
        }
    }

    /**
     * 進捗メッセージを処理
     * @private
     */
    _handleProgress(message) {
        const { progress } = message;

        // コールバックに通知
        for (const callback of this._progressCallbacks) {
            try {
                callback(progress);
            } catch (error) {
                console.error('[GoalSeekService] Progress callback error:', error);
            }
        }

        // EventBusに通知
        this.eventBus.emit(EVENTS.GOAL_SEEK_PROGRESS, {
            progress,
            timestamp: Date.now()
        });
    }

    /**
     * 完了メッセージを処理
     * @private
     */
    _handleCompleted(message) {
        const { correlationId, result } = message;

        // 保留中のリクエストを解決
        const pending = this._pendingRequests.get(correlationId);
        if (pending) {
            this._pendingRequests.delete(correlationId);
            pending.resolve(result);
        }

        // EventBusに通知
        this.eventBus.emit(EVENTS.GOAL_SEEK_COMPLETED, {
            correlationId,
            result,
            timestamp: Date.now()
        });

        // 現在のcorrelationIdをクリア
        if (this._currentCorrelationId === correlationId) {
            this._currentCorrelationId = null;
        }
    }

    /**
     * 介入リクエストメッセージを処理
     * @private
     */
    _handleInterventionRequired(message) {
        const { correlationId, intervention } = message;

        // コールバックに通知
        for (const callback of this._interventionCallbacks) {
            try {
                callback(intervention);
            } catch (error) {
                console.error('[GoalSeekService] Intervention callback error:', error);
            }
        }

        // EventBusに通知
        this.eventBus.emit(EVENTS.GOAL_SEEK_INTERVENTION, {
            correlationId,
            intervention,
            timestamp: Date.now()
        });
    }

    /**
     * 介入確認メッセージを処理
     * @private
     */
    _handleInterventionAcknowledged(message) {
        const { correlationId, interventionId, choice } = message;

        // 保留中のリクエストを解決
        const pending = this._pendingRequests.get(correlationId);
        if (pending) {
            this._pendingRequests.delete(correlationId);
            pending.resolve({
                interventionId,
                choice,
                acknowledged: true
            });
        }
    }

    /**
     * キャンセル確認メッセージを処理
     * @private
     */
    _handleCancelled(message) {
        const { correlationId } = message;

        // 保留中のリクエストを解決
        const pending = this._pendingRequests.get(correlationId);
        if (pending) {
            this._pendingRequests.delete(correlationId);
            pending.resolve({ cancelled: true, correlationId });
        }

        // 関連する他のリクエストもキャンセル
        if (this._currentCorrelationId === correlationId) {
            this._currentCorrelationId = null;
        }
    }

    /**
     * エラーメッセージを処理
     * @private
     */
    _handleError(message) {
        const { correlationId, code, message: errorMessage } = message;

        // エラーオブジェクト作成
        const error = new Error(errorMessage);
        error.code = code;

        // correlationIdに関連する保留中のリクエストをreject
        if (correlationId) {
            const pending = this._pendingRequests.get(correlationId);
            if (pending) {
                this._pendingRequests.delete(correlationId);
                pending.reject(error);
                return;
            }
        }

        // 特定のcorrelationIdがない場合は全コールバックに通知
        for (const callback of this._errorCallbacks) {
            try {
                callback({ code, message: errorMessage });
            } catch (err) {
                console.error('[GoalSeekService] Error callback error:', err);
            }
        }

        // EventBusに通知
        this.eventBus.emit(EVENTS.GOAL_SEEK_ERROR, {
            correlationId,
            code,
            message: errorMessage,
            timestamp: Date.now()
        });
    }

    /**
     * メッセージを送信
     * @param {Object} data - 送信データ
     * @private
     */
    _send(data) {
        if (!this.ws || this.ws.readyState !== WS_STATE.OPEN) {
            throw new Error('WebSocket is not connected');
        }

        this.ws.send(JSON.stringify(data));
    }

    /**
     * correlationIdを生成
     * @returns {string}
     * @private
     */
    _generateCorrelationId() {
        const randomPart = crypto.randomUUID
            ? crypto.randomUUID().slice(0, 8)
            : Math.random().toString(36).substring(2, 10);
        return `gs_${Date.now()}_${randomPart}`;
    }

    /**
     * 保留中のリクエストをクリーンアップ
     * @param {string} reason - クリーンアップ理由
     * @private
     */
    _cleanupPendingRequests(reason) {
        for (const [correlationId, { reject }] of this._pendingRequests) {
            reject(new Error(reason));
        }
        this._pendingRequests.clear();
        this._currentCorrelationId = null;
    }
}

export default GoalSeekService;
