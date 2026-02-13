/**
 * GoalSeekAgent
 *
 * 自律的にゴールを追求するエージェント。
 * 3フェーズ（Setup → Seek → Self-Improve）を管理。
 *
 * 設計書参照: /Users/ksato/workspace/shared/_codex/projects/brainbase/goal-seek-story.md
 */

import { EVENTS } from '../../core/event-bus.js';

/**
 * エージェントステータス
 * @readonly
 * @enum {string}
 */
export const AGENT_STATUS = {
    IDLE: 'idle',
    SEEKING: 'seeking',
    INTERVENTION: 'intervention',
    STOPPED: 'stopped',
    COMPLETED: 'completed',
    FAILED: 'failed'
};

/**
 * デフォルト設定
 */
const DEFAULT_CONFIG = {
    stuckThreshold: 2 * 24 * 60 * 60 * 1000, // 2日間更新なしでスタック判定
    checkInterval: 60 * 60 * 1000,           // 1時間ごとにチェック
    maxRetries: 3
};

/**
 * GoalSeekAgent
 * ゴール追求エージェント
 */
export class GoalSeekAgent {
    /**
     * @param {Object} options
     * @param {Object} options.goalService - GoalSeekService
     * @param {Object} options.repository - GoalSeekRepository
     * @param {EventBus} options.eventBus - イベントバス
     * @param {Object} options.config - 設定
     */
    constructor(options = {}) {
        this.goalService = options.goalService;
        this.repository = options.repository;
        this.eventBus = options.eventBus;
        this.config = { ...DEFAULT_CONFIG, ...options.config };
        this.status = AGENT_STATUS.IDLE;
        this.currentGoalId = null;
        this.checkTimer = null;
    }

    /**
     * Seek Phase開始
     * @param {string} goalId - ゴールID
     * @returns {Promise<Object>} 開始結果（アクションプランを含む）
     */
    async start(goalId) {
        this.currentGoalId = goalId;
        this.status = AGENT_STATUS.SEEKING;

        const goal = await this.repository.getGoal(goalId);

        // 既存のアクションプランがある場合は再利用
        let actionPlan = goal.actionPlan;
        if (!actionPlan || actionPlan.length === 0) {
            actionPlan = this._generateActionPlan(goal);
        }

        // ゴールのフェーズを更新
        await this.repository.updateGoal(goalId, {
            phase: 'seek',
            actionPlan
        });

        // ログ記録
        await this.repository.createLog({
            goalId,
            phase: 'seek',
            action: 'agent_started',
            result: { actionPlan }
        });

        return {
            goalId,
            actionPlan,
            status: this.status
        };
    }

    /**
     * 定期進捗チェック
     * @param {string} goalId - ゴールID
     * @returns {Promise<Object>} チェック結果
     */
    async checkProgress(goalId) {
        const goal = await this.repository.getGoal(goalId);

        const current = goal.current?.value || 0;
        const target = goal.target?.value || 100;
        const deadline = new Date(goal.deadline);
        const now = new Date();

        const progressPercentage = Math.round((current / target) * 100);
        const daysRemaining = Math.max(0, Math.ceil((deadline - now) / (24 * 60 * 60 * 1000)));

        // 期限切れチェック
        if (now > deadline && progressPercentage < 100) {
            await this.goalService.failGoal(goalId, {
                reason: '期限切れ',
                current,
                target
            });
            this.status = AGENT_STATUS.FAILED;
            return { progressPercentage, daysRemaining, failed: true };
        }

        // 進捗ログ記録
        await this.repository.createLog({
            goalId,
            phase: 'seek',
            action: 'progress_check',
            result: { progressPercentage, daysRemaining, current, target }
        });

        return {
            progressPercentage,
            daysRemaining,
            current,
            target,
            failed: false
        };
    }

    /**
     * スタック検知
     * @param {string} goalId - ゴールID
     * @param {Object} options - オプション
     * @returns {Promise<Object>} 検知結果
     */
    async detectStuck(goalId, options = {}) {
        const threshold = options.stuckThreshold || this.config.stuckThreshold;
        const goal = await this.repository.getGoal(goalId);

        const lastUpdated = goal.current?.last_updated
            ? new Date(goal.current.last_updated)
            : new Date(0);

        const timeSinceUpdate = Date.now() - lastUpdated.getTime();
        const isStuck = timeSinceUpdate > threshold;

        if (isStuck) {
            await this.goalService.detectIntervention(goalId, {
                type: 'stuck',
                reason: `${Math.round(timeSinceUpdate / (24 * 60 * 60 * 1000))}日間進捗がありません`,
                choices: [
                    { value: 'proceed', label: '継続' },
                    { value: 'modify', label: '目標修正' },
                    { value: 'abort', label: '中止' }
                ]
            });

            this.status = AGENT_STATUS.INTERVENTION;
        }

        return {
            isStuck,
            timeSinceUpdate,
            threshold
        };
    }

    /**
     * 自己改善（介入回答後の処理）
     * @param {string} goalId - ゴールID
     * @param {Object} intervention - 介入情報
     * @returns {Promise<Object>} 改善結果
     */
    async selfImprove(goalId, intervention) {
        const goal = await this.repository.getGoal(goalId);

        let newActionPlan = goal.actionPlan;

        // 修正選択時は新しいプランを生成
        if (intervention.userChoice === 'modify') {
            newActionPlan = this._generateActionPlan(goal, {
                modifyReason: intervention.userReason
            });
        }

        await this.repository.updateGoal(goalId, {
            phase: 'self_improve',
            actionPlan: newActionPlan
        });

        await this.repository.createLog({
            goalId,
            phase: 'self_improve',
            action: 'plan_modified',
            result: {
                interventionId: intervention.id,
                userChoice: intervention.userChoice,
                newActionPlan
            }
        });

        this.status = AGENT_STATUS.SEEKING;

        return {
            goalId,
            newActionPlan
        };
    }

    /**
     * 次のアクションを実行
     * @param {string} goalId - ゴールID
     * @returns {Promise<Object|null>} 実行結果（全アクション完了時はnull）
     */
    async executeNextAction(goalId) {
        const goal = await this.repository.getGoal(goalId);

        if (!goal.actionPlan || goal.actionPlan.length === 0) {
            return null;
        }

        // 次のpendingアクションを見つける
        const nextAction = goal.actionPlan.find(a => a.status === 'pending');
        if (!nextAction) {
            return null;
        }

        // アクションを実行（進捗を更新）
        const progressIncrement = this._calculateProgressIncrement(goal, nextAction);
        const newCurrent = (goal.current?.value || 0) + progressIncrement;

        await this.goalService.updateProgress(goalId, { value: newCurrent });

        // アクションを完了にマーク
        const updatedPlan = goal.actionPlan.map(a =>
            a.id === nextAction.id ? { ...a, status: 'completed' } : a
        );

        await this.repository.updateGoal(goalId, {
            actionPlan: updatedPlan
        });

        return {
            executedAction: { ...nextAction, status: 'completed' },
            progressIncrement
        };
    }

    /**
     * 1日あたりの目標を計算
     * @param {string} goalId - ゴールID
     * @returns {Promise<Object>} 計算結果
     */
    async calculateDailyTarget(goalId) {
        const goal = await this.repository.getGoal(goalId);

        const current = goal.current?.value || 0;
        const target = goal.target?.value || 100;
        const remaining = target - current;

        const deadline = new Date(goal.deadline);
        const now = new Date();
        const daysRemaining = Math.max(1, Math.ceil((deadline - now) / (24 * 60 * 60 * 1000)));

        const dailyTarget = remaining / daysRemaining;

        return {
            dailyTarget,
            remaining,
            daysRemaining,
            current,
            target
        };
    }

    /**
     * エージェントを停止
     * @param {string} goalId - ゴールID
     */
    async stop(goalId) {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }

        this.status = AGENT_STATUS.STOPPED;
        this.currentGoalId = null;

        await this.repository.createLog({
            goalId,
            phase: 'seek',
            action: 'agent_stopped'
        });
    }

    // ===== Private Methods =====

    /**
     * アクションプランを生成
     * @private
     */
    _generateActionPlan(goal, options = {}) {
        const target = goal.target?.value || 100;
        const current = goal.current?.value || 0;
        const remaining = target - current;

        const deadline = new Date(goal.deadline);
        const now = new Date();
        const daysRemaining = Math.max(1, Math.ceil((deadline - now) / (24 * 60 * 60 * 1000)));

        const dailyTarget = Math.ceil(remaining / daysRemaining);

        const plan = [];

        // 毎日のアクションを生成
        for (let i = 0; i < daysRemaining; i++) {
            plan.push({
                id: `action-${i + 1}`,
                type: 'daily',
                description: `${dailyTarget}件完了`,
                target: dailyTarget,
                status: 'pending',
                date: new Date(now.getTime() + i * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            });
        }

        return plan;
    }

    /**
     * アクションごとの進捗増分を計算
     * @private
     */
    _calculateProgressIncrement(goal, action) {
        if (action.type === 'daily' && action.target) {
            return action.target;
        }
        // デフォルトは1
        return 1;
    }
}

export default GoalSeekAgent;
