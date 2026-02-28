/**
 * Recovery Service - Auto-Claude RecoveryManager pattern implementation
 *
 * 機能:
 * - セッション開始時に前回の失敗情報を自動参照
 * - 失敗情報の記録（recovery_hints）
 * - スタック検出（3回失敗でisStuck=true）
 * - エスカレーション通知
 */

import { EVENTS } from '../../core/event-bus.js';

/**
 * Recovery設定値
 */
export const RECOVERY_CONFIG = {
    MAX_ATTEMPTS: 3,
    STORAGE_KEY_PREFIX: 'recovery_hints_'
};

/**
 * Recoveryサービスクラス
 */
export class RecoveryService {
    constructor({ eventBus, store, httpClient }) {
        this.eventBus = eventBus;
        this.store = store;
        this.httpClient = httpClient;
    }

    /**
     * 前回の失敗情報を確認
     * @param {string} sessionId - セッションID
     * @returns {Promise<Object|null>} recovery_hints
     */
    async checkPreviousFailures(sessionId) {
        try {
            // ローカルストレージから取得
            const localHints = this._getLocalHints(sessionId);

            // APIから取得（存在する場合）
            let apiHints = null;
            try {
                const response = await this.httpClient.get(`/api/recovery/${sessionId}/hints`);
                apiHints = response;
            } catch {
                // APIが存在しない場合は無視
            }

            // マージ（API優先）
            const hints = apiHints || localHints;

            if (hints) {
                // Store更新
                this.store.setState({
                    recovery: {
                        hints,
                        attemptCount: hints.attemptCount || 0,
                        isStuck: hints.isStuck || false,
                        maxAttempts: RECOVERY_CONFIG.MAX_ATTEMPTS
                    }
                });

                await this.eventBus.emit(EVENTS.RECOVERY_HINTS_LOADED, {
                    sessionId,
                    hints
                });

                // スタック検出
                if (hints.isStuck) {
                    await this.eventBus.emit(EVENTS.STUCK_DETECTED, {
                        sessionId,
                        hints
                    });
                }
            }

            return hints;
        } catch (error) {
            console.error('Failed to check previous failures:', error);
            return null;
        }
    }

    /**
     * 失敗を記録
     * @param {string} sessionId - セッションID
     * @param {Object} error - エラー情報
     * @returns {Promise<Object>} 更新されたhints
     */
    async recordFailure(sessionId, error) {
        const { recovery } = this.store.getState();
        const currentCount = recovery.attemptCount || 0;
        const newCount = currentCount + 1;
        const isStuck = newCount >= RECOVERY_CONFIG.MAX_ATTEMPTS;

        const hints = {
            sessionId,
            lastError: {
                type: error.type || 'unknown',
                message: error.message || 'Unknown error',
                timestamp: new Date().toISOString(),
                context: error.context || {}
            },
            attemptCount: newCount,
            maxAttempts: RECOVERY_CONFIG.MAX_ATTEMPTS,
            isStuck,
            previousAttempts: [
                ...(recovery.hints?.previousAttempts || []),
                {
                    timestamp: new Date().toISOString(),
                    error: error.message,
                    resolution: 'pending'
                }
            ]
        };

        // ローカルストレージに保存
        this._saveLocalHints(sessionId, hints);

        // APIに保存（存在する場合）
        try {
            await this.httpClient.post(`/api/recovery/${sessionId}/failure`, hints);
        } catch {
            // APIが存在しない場合は無視
        }

        // Store更新
        this.store.setState({
            recovery: {
                hints,
                attemptCount: newCount,
                isStuck,
                maxAttempts: RECOVERY_CONFIG.MAX_ATTEMPTS
            }
        });

        await this.eventBus.emit(EVENTS.FAILURE_RECORDED, {
            sessionId,
            hints
        });

        // スタック検出
        if (isStuck) {
            await this.eventBus.emit(EVENTS.STUCK_DETECTED, {
                sessionId,
                hints,
                reason: 'max_attempts_exceeded'
            });
        }

        return hints;
    }

    /**
     * スタック状態かどうかを確認
     * @param {string} sessionId - セッションID
     * @returns {boolean}
     */
    isStuck(sessionId) {
        const hints = this._getLocalHints(sessionId);
        return hints?.isStuck || false;
    }

    /**
     * recovery_hintsをクリア
     * @param {string} sessionId - セッションID
     */
    async clearHints(sessionId) {
        // ローカルストレージから削除
        this._removeLocalHints(sessionId);

        // APIから削除（存在する場合）
        try {
            await this.httpClient.delete(`/api/recovery/${sessionId}/hints`);
        } catch {
            // APIが存在しない場合は無視
        }

        // Store更新
        this.store.setState({
            recovery: {
                hints: null,
                attemptCount: 0,
                isStuck: false,
                maxAttempts: RECOVERY_CONFIG.MAX_ATTEMPTS
            }
        });
    }

    /**
     * 試行成功を記録（カウントリセット）
     * @param {string} sessionId - セッションID
     */
    async recordSuccess(sessionId) {
        const hints = this._getLocalHints(sessionId);

        if (hints && hints.previousAttempts.length > 0) {
            // 最後の試行を成功としてマーク
            const lastAttempt = hints.previousAttempts[hints.previousAttempts.length - 1];
            lastAttempt.resolution = 'success';

            // 保存
            this._saveLocalHints(sessionId, hints);
        }

        // カウントリセット
        await this.clearHints(sessionId);
    }

    /**
     * recovery_hintsを取得
     * @param {string} sessionId - セッションID
     * @returns {Object|null}
     */
    getHints(sessionId) {
        return this._getLocalHints(sessionId);
    }

    /**
     * 試行回数を取得
     * @param {string} sessionId - セッションID
     * @returns {number}
     */
    getAttemptCount(sessionId) {
        const hints = this._getLocalHints(sessionId);
        return hints?.attemptCount || 0;
    }

    // --- Private methods ---

    /**
     * ローカルストレージからhintsを取得
     * @private
     */
    _getLocalHints(sessionId) {
        try {
            const key = `${RECOVERY_CONFIG.STORAGE_KEY_PREFIX}${sessionId}`;
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch {
            return null;
        }
    }

    /**
     * ローカルストレージにhintsを保存
     * @private
     */
    _saveLocalHints(sessionId, hints) {
        try {
            const key = `${RECOVERY_CONFIG.STORAGE_KEY_PREFIX}${sessionId}`;
            localStorage.setItem(key, JSON.stringify(hints));
        } catch (error) {
            console.error('Failed to save recovery hints:', error);
        }
    }

    /**
     * ローカルストレージからhintsを削除
     * @private
     */
    _removeLocalHints(sessionId) {
        try {
            const key = `${RECOVERY_CONFIG.STORAGE_KEY_PREFIX}${sessionId}`;
            localStorage.removeItem(key);
        } catch {
            // 無視
        }
    }
}
