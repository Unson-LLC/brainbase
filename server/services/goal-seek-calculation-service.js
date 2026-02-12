/**
 * GoalSeekCalculationService
 *
 * 目標達成逆算計算を実行するサービス。
 * 以下を提供:
 * - 逆算計算（target, period, currentから日次目標を算出）
 * - 人介入判定（極端な目標、ブロッカー検知など）
 * - 進捗通知（EventBus経由）
 *
 * 設計書参照: /tmp/dev-ops/spec.md § 2.1
 */

import { randomUUID } from 'crypto';

// 介入判定の閾値
const DAILY_TARGET_INTERVENTION_THRESHOLD = 1000;

export class GoalSeekCalculationService {
    /**
     * @param {Object} options
     * @param {Object} options.eventBus - EventBusインスタンス
     * @param {number} options.calculationTimeout - 計算タイムアウト(ms)
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus || null;
        this.calculationTimeout = options.calculationTimeout || 10000;
    }

    /**
     * 逆算計算を実行
     *
     * @param {Object} params - 計算パラメータ
     * @param {number} params.target - 目標値
     * @param {number} params.period - 期間（日数）
     * @param {number} [params.current=0] - 現在の進捗
     * @param {string} [params.unit='件'] - 単位
     * @param {Object} options - 実行オプション
     * @param {string} [options.correlationId] - 相関ID
     * @param {boolean} [options.emitProgress=true] - 進捗イベントを発行するか
     * @returns {Promise<Object>} 計算結果
     */
    async calculate(params, options = {}) {
        const {
            target,
            period,
            current = 0,
            unit = '件'
        } = params;

        const {
            correlationId = randomUUID(),
            emitProgress = false
        } = options;

        // パラメータ検証
        this._validateParams({ target, period, current });

        // 逆算計算
        const remaining = Math.max(0, target - current);
        const remainingDays = period;
        const dailyTarget = remaining > 0 ? remaining / remainingDays : 0;
        const isCompleted = current >= target;

        const result = {
            correlationId,
            target,
            period,
            completed: current,
            remaining,
            totalDays: period,
            remainingDays,
            dailyTarget: Math.round(dailyTarget * 100) / 100, // 小数点2桁
            unit,
            isCompleted,
            calculatedAt: new Date().toISOString()
        };

        // 進捗イベント発行
        if (emitProgress && this.eventBus) {
            this.eventBus.emit('goal-seek:progress', {
                correlationId,
                progress: isCompleted ? 100 : Math.round((current / target) * 100),
                dailyTarget: result.dailyTarget,
                remaining
            });
        }

        return result;
    }

    /**
     * 人介入が必要か判定
     *
     * @param {Object} calculationResult - calculate()の結果
     * @returns {Object} { needed: boolean, type?: string, reason?: string }
     */
    checkInterventionNeeded(calculationResult) {
        const { dailyTarget, isCompleted, hasBlocker, blockerReason } = calculationResult;

        // 完了済みなら介入不要
        if (isCompleted) {
            return { needed: false };
        }

        // ブロッカー検知
        if (hasBlocker) {
            return {
                needed: true,
                type: 'blocker',
                reason: blockerReason || 'Unknown blocker detected'
            };
        }

        // 日次目標が極端に高い場合
        if (dailyTarget > DAILY_TARGET_INTERVENTION_THRESHOLD) {
            return {
                needed: true,
                type: 'decision',
                reason: `dailyTarget (${dailyTarget}) exceeds threshold (${DAILY_TARGET_INTERVENTION_THRESHOLD})`
            };
        }

        return { needed: false };
    }

    /**
     * パラメータ検証
     * @private
     */
    _validateParams({ target, period, current }) {
        if (typeof period !== 'number' || period < 1 || period > 365) {
            throw new Error('period must be between 1 and 365');
        }

        if (typeof target !== 'number' || target < 0) {
            throw new Error('target must be >= 0');
        }

        if (typeof current !== 'number' || current < 0) {
            throw new Error('current must be >= 0');
        }
    }
}

export default GoalSeekCalculationService;
