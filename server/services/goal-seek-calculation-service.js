/**
 * GoalSeekCalculationService
 *
 * 目標達成逆算計算サービス
 * 機能:
 * - calculate() - 目標達成に必要な日次アクションを逆算
 * - checkInterventionNeeded() - 人介入が必要かどうか判定
 * - EventBus連携 (GOAL_SEEK_STARTED, GOAL_SEEK_PROGRESS, GOAL_SEEK_COMPLETED)
 */

import { logger } from '../utils/logger.js';

// 介入判定の閾値
const INTERVENTION_THRESHOLDS = {
    DAILY_TARGET_MAX: 100,      // 日次アクションの上限
    MIN_PERIOD_DAYS: 7,          // 最小期間（日）
    HIGH_VARIATION_RATE: 0.5     // 高変動率の閾値（50%）
};

// イベント名
const EVENTS = {
    GOAL_SEEK_STARTED: 'goal-seek:started',
    GOAL_SEEK_PROGRESS: 'goal-seek:progress',
    GOAL_SEEK_COMPLETED: 'goal-seek:completed'
};

/**
 * @typedef {Object} CalculationParams
 * @property {number} target - 目標値
 * @property {number} period - 期間（日）
 * @property {number} [current=0] - 現在値
 * @property {string} [unit='件'] - 単位
 * @property {string} [variable] - 変数名
 */

/**
 * @typedef {Object} CalculationResult
 * @property {number} dailyTarget - 日次目標
 * @property {number} totalDays - 総日数
 * @property {number} remainingDays - 残日数
 * @property {number} completed - 達成済み
 * @property {number} remaining - 残り
 * @property {string} unit - 単位
 * @property {boolean} isCompleted - 完了フラグ
 * @property {string} [correlationId] - 相関ID
 * @property {number} [achievableProbability] - 達成確率
 * @property {Object} [gap] - ギャップ情報
 * @property {Object} [projection] - 投影情報
 */

/**
 * @typedef {Object} InterventionResult
 * @property {boolean} needed - 介入が必要か
 * @property {string} [type] - 介入タイプ (decision, blocker, confirmation)
 * @property {string} [reason] - 介入理由
 * @property {Object} [details] - 詳細情報
 */

export class GoalSeekCalculationService {
    /**
     * @param {Object} options
     * @param {Object} [options.eventBus] - EventBusインスタンス
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus || null;
        this.thresholds = { ...INTERVENTION_THRESHOLDS };
    }

    /**
     * 目標達成逆算計算を実行
     * @param {CalculationParams} params - 計算パラメータ
     * @param {Object} [options={}] - オプション
     * @param {string} [options.correlationId] - 相関ID
     * @param {boolean} [options.emitProgress=false] - 進捗イベントを発行するか
     * @returns {Promise<CalculationResult>} 計算結果
     */
    async calculate(params, options = {}) {
        const {
            target,
            period,
            current = 0,
            unit = '件',
            variable
        } = params;

        const { correlationId, emitProgress = false } = options;

        // パラメータバリデーション
        this._validateParams({ target, period, current });

        // 開始イベント発行
        if (this.eventBus) {
            this.eventBus.emit(EVENTS.GOAL_SEEK_STARTED, {
                target,
                period,
                current,
                unit,
                correlationId
            });
        }

        // 進捗イベント発行（オプション）
        if (emitProgress && this.eventBus) {
            this.eventBus.emit(EVENTS.GOAL_SEEK_PROGRESS, {
                correlationId,
                progress: 0,
                step: 'validating'
            });
        }

        // 計算実行
        const result = this._performCalculation({
            target,
            period,
            current,
            unit,
            variable,
            correlationId
        });

        // 進捗イベント発行（オプション）
        if (emitProgress && this.eventBus) {
            this.eventBus.emit(EVENTS.GOAL_SEEK_PROGRESS, {
                correlationId,
                progress: 100,
                step: 'completed'
            });
        }

        // 完了イベント発行
        if (this.eventBus) {
            this.eventBus.emit(EVENTS.GOAL_SEEK_COMPLETED, {
                correlationId,
                result
            });
        }

        logger.info('GoalSeek calculation completed', {
            target,
            period,
            current,
            dailyTarget: result.dailyTarget,
            correlationId
        });

        return result;
    }

    /**
     * 人介入が必要かどうか判定
     * @param {Object} calculationResult - 計算結果
     * @returns {InterventionResult} 介入判定結果
     */
    checkInterventionNeeded(calculationResult) {
        const { dailyTarget, totalDays, isCompleted, hasBlocker, blockerReason } = calculationResult;

        // 完了済みの場合は介入不要
        if (isCompleted) {
            return { needed: false };
        }

        // ブロッカーがある場合
        if (hasBlocker) {
            return {
                needed: true,
                type: 'blocker',
                reason: blockerReason || 'Blocker detected',
                details: { blockerReason }
            };
        }

        // 日次目標が閾値を超える場合
        if (dailyTarget > this.thresholds.DAILY_TARGET_MAX) {
            return {
                needed: true,
                type: 'decision',
                reason: `dailyTarget (${dailyTarget.toFixed(2)}) exceeds threshold (${this.thresholds.DAILY_TARGET_MAX})`,
                details: {
                    dailyTarget,
                    threshold: this.thresholds.DAILY_TARGET_MAX
                }
            };
        }

        // 期間が極端に短い場合
        if (totalDays && totalDays < this.thresholds.MIN_PERIOD_DAYS) {
            return {
                needed: true,
                type: 'confirmation',
                reason: `period (${totalDays} days) is shorter than minimum (${this.thresholds.MIN_PERIOD_DAYS} days)`,
                details: {
                    totalDays,
                    minPeriod: this.thresholds.MIN_PERIOD_DAYS
                }
            };
        }

        return { needed: false };
    }

    /**
     * パラメータをバリデーション
     * @param {Object} params - パラメータ
     * @throws {Error} バリデーションエラー
     * @private
     */
    _validateParams({ target, period, current }) {
        // target検証
        if (typeof target !== 'number' || target < 0) {
            throw new Error('target must be >= 0');
        }

        // period検証
        if (typeof period !== 'number' || period < 1 || period > 365) {
            throw new Error('period must be between 1 and 365');
        }

        // current検証
        if (typeof current !== 'number' || current < 0) {
            throw new Error('current must be >= 0');
        }
    }

    /**
     * 計算を実行
     * @param {Object} params - 計算パラメータ
     * @returns {CalculationResult} 計算結果
     * @private
     */
    _performCalculation({ target, period, current, unit, variable, correlationId }) {
        const remaining = Math.max(0, target - current);
        const isCompleted = current >= target;
        const dailyTarget = isCompleted ? 0 : remaining / period;

        // 達成確率の計算（簡易版：日次目標に基づく）
        const achievableProbability = this._calculateProbability(dailyTarget, period);

        // ギャップ情報
        const gap = {
            value: remaining,
            percentage: target > 0 ? Math.round((remaining / target) * 100) : 0
        };

        // 投影情報（将来予測）
        const projection = this._createProjection(dailyTarget, period, current, target);

        return {
            dailyTarget: Math.round(dailyTarget * 100) / 100, // 小数点2桁に丸める
            totalDays: period,
            remainingDays: period,
            completed: current,
            remaining,
            unit,
            isCompleted,
            correlationId,
            achievableProbability,
            gap,
            projection,
            variable
        };
    }

    /**
     * 達成確率を計算
     * @param {number} dailyTarget - 日次目標
     * @param {number} period - 期間
     * @returns {number} 達成確率（0-100）
     * @private
     */
    _calculateProbability(dailyTarget, period) {
        // 日次目標が高いほど確率が低くなる簡易モデル
        if (dailyTarget === 0) return 100;
        if (dailyTarget <= 10) return 95;
        if (dailyTarget <= 30) return 80;
        if (dailyTarget <= 50) return 60;
        if (dailyTarget <= 100) return 40;
        return Math.max(5, 100 - dailyTarget);
    }

    /**
     * 投影情報を作成
     * @param {number} dailyTarget - 日次目標
     * @param {number} period - 期間
     * @param {number} current - 現在値
     * @param {number} target - 目標値
     * @returns {Object} 投影情報
     * @private
     */
    _createProjection(dailyTarget, period, current, target) {
        const milestones = [];
        const step = Math.max(1, Math.floor(period / 4)); // 4段階のマイルストーン

        for (let i = 1; i <= 4; i++) {
            const day = step * i;
            const projected = Math.min(target, current + (dailyTarget * day));
            milestones.push({
                day,
                projected: Math.round(projected * 100) / 100,
                percentage: target > 0 ? Math.round((projected / target) * 100) : 0
            });
        }

        return {
            milestones,
            estimatedCompletion: period,
            confidenceLevel: dailyTarget <= 50 ? 'high' : dailyTarget <= 100 ? 'medium' : 'low'
        };
    }
}

export default GoalSeekCalculationService;
