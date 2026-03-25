/**
 * セッションヘルスモニタリング（CommandMate移植）
 *
 * activeSessionsの各セッションについてtmux has-sessionで
 * 生死を定期チェックし、死んだセッションを検出・通知する。
 *
 * CommandMateのsession health monitoring pattern:
 * - 各セッションの存在を定期チェック
 * - 死亡検出時にcallbackで通知
 * - PTY Watchdogと組み合わせて使用
 */
import { logger } from '../utils/logger.js';

export class SessionHealthMonitor {
    /**
     * @param {Object} sessionManager - SessionManagerインスタンス
     * @param {Object} [options]
     * @param {Function} [options.onDeadSession] - 死亡セッション検出時のcallback(sessionId)
     */
    constructor(sessionManager, options = {}) {
        this.sessionManager = sessionManager;
        this.onDeadSession = options.onDeadSession || null;
        this._timer = null;
    }

    /**
     * 全activeSessionsのヘルスチェックを実行
     * @returns {Promise<{ alive: string[], dead: string[] }>}
     */
    async checkHealth() {
        const alive = [];
        const dead = [];

        const sessionIds = [...this.sessionManager.activeSessions.keys()];

        for (const sessionId of sessionIds) {
            try {
                const running = await this.sessionManager.isTmuxSessionRunning(sessionId);
                if (running) {
                    alive.push(sessionId);
                } else {
                    dead.push(sessionId);
                    if (typeof this.onDeadSession === 'function') {
                        this.onDeadSession(sessionId);
                    }
                }
            } catch {
                dead.push(sessionId);
                if (typeof this.onDeadSession === 'function') {
                    this.onDeadSession(sessionId);
                }
            }
        }

        return { alive, dead };
    }

    /**
     * 定期ヘルスチェックを開始
     * @param {number} intervalMs - チェック間隔（デフォルト: 60000ms = 1分）
     */
    start(intervalMs = 60000) {
        if (this._timer) return;
        logger.info(`[SessionHealthMonitor] Starting (interval: ${intervalMs / 1000}s)`);

        this._timer = setInterval(async () => {
            try {
                const { dead } = await this.checkHealth();
                if (dead.length > 0) {
                    logger.warn(`[SessionHealthMonitor] Dead sessions detected: ${dead.join(', ')}`);
                }
            } catch (err) {
                logger.error('[SessionHealthMonitor] Error:', err.message);
            }
        }, intervalMs);
    }

    /**
     * 定期ヘルスチェックを停止
     */
    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
            logger.info('[SessionHealthMonitor] Stopped');
        }
    }
}
