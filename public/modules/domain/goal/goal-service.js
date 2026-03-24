/**
 * GoalSeekService
 *
 * セッション単位のゴール追求エージェント機能のビジネスロジック。
 * 3フェーズ（Setup → Seek → Self-Improve）を管理。
 *
 * 設計書参照: /Users/ksato/workspace/shared/_codex/projects/brainbase/goal-seek-story.md
 */

import { EVENTS } from '../../core/event-bus.js';

/**
 * ゴールタイプ
 * @readonly
 * @enum {string}
 */
export const GOAL_TYPES = {
    COUNT: 'count',       // 数値目標（例: 100件達成）
    STATE: 'state',       // 状態目標（例: デプロイ完了）
    MILESTONE: 'milestone', // マイルストーン達成
    CUSTOM: 'custom'      // カスタム目標
};

/**
 * ゴールステータス
 * @readonly
 * @enum {string}
 */
export const GOAL_STATUS = {
    SETUP: 'setup',
    SEEKING: 'seeking',
    INTERVENTION: 'intervention',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
};

/**
 * ゴールフェーズ
 * @readonly
 * @enum {string}
 */
export const GOAL_PHASE = {
    SETUP: 'setup',
    SEEK: 'seek',
    SELF_IMPROVE: 'self_improve'
};

/**
 * 介入タイプ
 * @readonly
 * @enum {string}
 */
export const INTERVENTION_TYPES = {
    BLOCKER: 'blocker',
    STUCK: 'stuck',
    DECISION: 'decision',
    CONFIRM: 'confirm'
};

/**
 * GoalSeekService
 * セッション単位のゴール追求エージェントのビジネスロジック
 */
export class GoalSeekService {
    /**
     * @param {Object} options
     * @param {Object} options.httpClient - HTTPクライアント
     * @param {Object} options.repository - ゴールリポジトリ
     * @param {import('../../core/event-bus.js').EventBus} options.eventBus - イベントバス
     * @param {Store} options.store - ストア
     */
    constructor(options = {}) {
        this.httpClient = options.httpClient || null;
        this.repository = options.repository || null;
        this.eventBus = options.eventBus || null;
        this.store = options.store || null;
    }

    /**
     * ゴール作成
     * @param {Object} goalData - ゴールデータ
     * @param {string} goalData.sessionId - セッションID
     * @param {string} goalData.goalType - ゴールタイプ
     * @param {Object} goalData.target - 目標値
     * @param {string} goalData.deadline - 期限
     * @param {string[]} goalData.successCriteria - 成功条件
     * @returns {Promise<Object>} 作成されたゴール
     */
    async createGoal(goalData) {
        // バリデーション
        this._validateGoalData(goalData);

        const timestamp = this._getTimestamp();

        const goal = await this.repository.createGoal({
            ...goalData,
            current: { value: 0, last_updated: timestamp },
            status: GOAL_STATUS.SEEKING,
            phase: GOAL_PHASE.SEEK,
            createdAt: timestamp
        });

        // Store更新
        this._updateStoreGoals(goal);

        // イベント発火
        await this.eventBus.emit(EVENTS.GOAL_SEEK_STARTED, {
            goalId: goal.id,
            sessionId: goal.sessionId,
            goalType: goal.goalType,
            target: goal.target
        });

        // ログ記録
        await this._createLog(goal.id, 'setup', 'goal_created', { goalData });

        return goal;
    }

    /**
     * ゴール取得
     * @param {string} goalId - ゴールID
     * @returns {Promise<Object>} ゴール
     */
    async getGoal(goalId) {
        return await this.repository.getGoal(goalId);
    }

    /**
     * 進捗更新
     * @param {string} goalId - ゴールID
     * @param {Object} progress - 進捗データ
     * @returns {Promise<Object>} 更新されたゴール
     */
    async updateProgress(goalId, progress) {
        const goal = await this.repository.getGoal(goalId);

        const updatedGoal = await this.repository.updateGoal(goalId, {
            current: {
                ...goal.current,
                ...progress,
                last_updated: this._getTimestamp()
            }
        });

        // Store更新
        this._updateStoreGoals(updatedGoal);

        // イベント発火
        await this.eventBus.emit(EVENTS.GOAL_SEEK_PROGRESS, {
            goalId,
            progress,
            current: updatedGoal.current
        });

        // 目標達成チェック
        if (this._isGoalAchieved(updatedGoal)) {
            await this.completeGoal(goalId, { reason: '目標達成', goal: updatedGoal });
        }

        return updatedGoal;
    }

    /**
     * 介入検知
     * @param {string} goalId - ゴールID
     * @param {Object} interventionData - 介入データ
     * @returns {Promise<Object>} 作成された介入
     */
    async detectIntervention(goalId, interventionData) {
        const intervention = await this.repository.createIntervention({
            goalId,
            ...interventionData,
            status: 'pending',
            createdAt: this._getTimestamp()
        });

        // ゴールステータスを介入中に変更
        await this.repository.updateGoal(goalId, {
            status: GOAL_STATUS.INTERVENTION
        });

        // Store更新
        this._updateStoreInterventions(intervention);

        // イベント発火
        await this.eventBus.emit(EVENTS.GOAL_SEEK_INTERVENTION_REQUIRED, {
            goalId,
            interventionId: intervention.id,
            type: interventionData.type,
            reason: interventionData.reason,
            choices: interventionData.choices
        });

        // ログ記録
        await this._createLog(goalId, 'self_improve', 'intervention_detected', interventionData);

        return intervention;
    }

    /**
     * 介入回答
     * @param {string} interventionId - 介入ID
     * @param {Object} response - 回答データ
     * @param {string} response.choice - 選択（proceed/abort/modify）
     * @param {string} response.reason - 理由
     * @returns {Promise<Object>} 更新された介入
     */
    async respondToIntervention(interventionId, response) {
        const intervention = await this.repository.getIntervention(interventionId);

        // 選択肢のバリデーション
        const validChoices = intervention.choices.map(c => c.value);
        if (!validChoices.includes(response.choice)) {
            throw new Error(`Invalid choice: ${response.choice}. Valid choices are: ${validChoices.join(', ')}`);
        }

        // 介入更新
        const updatedIntervention = await this.repository.updateIntervention(interventionId, {
            status: 'responded',
            userChoice: response.choice,
            userReason: response.reason,
            respondedAt: this._getTimestamp()
        });

        // 選択に応じた処理
        let newStatus = GOAL_STATUS.SEEKING;
        if (response.choice === 'abort') {
            await this.failGoal(intervention.goalId, { reason: response.reason });
            return updatedIntervention;
        } else if (response.choice === 'modify') {
            // 目標修正は介入状態を維持
            newStatus = GOAL_STATUS.INTERVENTION;
        }

        await this.repository.updateGoal(intervention.goalId, {
            status: newStatus,
            phase: GOAL_PHASE.SEEK
        });

        // Store更新
        this._updateStoreInterventions(updatedIntervention);

        // イベント発火
        await this.eventBus.emit(EVENTS.GOAL_SEEK_INTERVENTION_RESPONDED, {
            interventionId,
            goalId: intervention.goalId,
            choice: response.choice,
            reason: response.reason
        });

        // ログ記録
        await this._createLog(intervention.goalId, 'self_improve', 'intervention_responded', response);

        return updatedIntervention;
    }

    /**
     * ゴール完了
     * @param {string} goalId - ゴールID
     * @param {Object} options - オプション
     * @param {Object} options.goal - 既存のゴールオブジェクト（省略時は取得）
     * @returns {Promise<Object>} 更新されたゴール
     */
    async completeGoal(goalId, options = {}) {
        return await this._transitionGoal(goalId, {
            goal: options.goal,
            status: GOAL_STATUS.COMPLETED,
            timestampField: 'completedAt',
            eventName: EVENTS.GOAL_SEEK_COMPLETED,
            eventDetail: { reason: options.reason },
            logPhase: 'seek',
            logAction: 'goal_completed',
            logData: options
        });
    }

    /**
     * ゴール失敗
     * @param {string} goalId - ゴールID
     * @param {Object} options - オプション
     * @returns {Promise<Object>} 更新されたゴール
     */
    async failGoal(goalId, options = {}) {
        return await this._transitionGoal(goalId, {
            status: GOAL_STATUS.FAILED,
            timestampField: 'failedAt',
            eventName: EVENTS.GOAL_SEEK_FAILED,
            eventDetail: {
                reason: options.reason,
                error: options.error
            },
            logPhase: 'self_improve',
            logAction: 'goal_failed',
            logData: options
        });
    }

    /**
     * ゴールキャンセル
     * @param {string} goalId - ゴールID
     * @param {Object} options - オプション
     * @returns {Promise<Object>} 更新されたゴール
     */
    async cancelGoal(goalId, options = {}) {
        return await this._transitionGoal(goalId, {
            status: GOAL_STATUS.CANCELLED,
            timestampField: 'cancelledAt',
            eventName: EVENTS.GOAL_SEEK_CANCELLED,
            eventDetail: { reason: options.reason },
            logPhase: 'seek',
            logAction: 'goal_cancelled',
            logData: options
        });
    }

    /**
     * セッションIDでゴール一覧を取得
     * @param {string} sessionId - セッションID
     * @returns {Array} ゴール一覧
     */
    getGoalsBySession(sessionId) {
        const { goalSeek } = this.store.getState();
        const goals = goalSeek?.goals || [];
        return goals.filter(g => g.sessionId === sessionId);
    }

    /**
     * アクティブなゴールを取得
     * @returns {Object|null} アクティブなゴール
     */
    getActiveGoal() {
        const { goalSeek } = this.store.getState();
        const { goals, currentGoalId } = goalSeek || { goals: [], currentGoalId: null };

        if (!currentGoalId) return null;
        return goals.find(g => g.id === currentGoalId) || null;
    }

    // ===== Private Methods =====

    /**
     * ゴールデータのバリデーション
     * @private
     */
    _validateGoalData(goalData) {
        if (!goalData.sessionId) {
            throw new Error('sessionId is required');
        }
        if (!goalData.goalType) {
            throw new Error('goalType is required');
        }
        if (!goalData.target) {
            throw new Error('target is required');
        }
    }

    /**
     * 目標達成チェック
     * @private
     */
    _isGoalAchieved(goal) {
        if (goal.goalType === GOAL_TYPES.COUNT) {
            return goal.current?.value >= goal.target?.value;
        }
        // 他のタイプは状況に応じて拡張
        return false;
    }

    /**
     * ゴール状態遷移の共通処理
     * @private
     */
    async _transitionGoal(goalId, {
        goal = null,
        status,
        timestampField,
        eventName,
        eventDetail = {},
        logPhase,
        logAction,
        logData = eventDetail
    }) {
        const targetGoal = goal || await this.repository.getGoal(goalId);

        const updatedGoal = await this.repository.updateGoal(goalId, {
            status,
            ...(timestampField ? { [timestampField]: this._getTimestamp() } : {})
        });

        this._updateStoreGoals(updatedGoal);

        if (this.eventBus) {
            await this.eventBus.emit(eventName, {
                goalId,
                sessionId: targetGoal.sessionId,
                ...eventDetail
            });
        }

        await this._createLog(goalId, logPhase, logAction, logData);

        return updatedGoal;
    }

    /**
     * Storeのゴールを更新
     * @private
     */
    _updateStoreGoals(updatedGoal) {
        this._updateGoalSeekCollection('goals', updatedGoal);
    }

    /**
     * Storeの介入を更新
     * @private
     */
    _updateStoreInterventions(updatedIntervention) {
        this._updateGoalSeekCollection('interventions', updatedIntervention);
    }

    /**
     * goalSeek配下のコレクション更新
     * @private
     */
    _updateGoalSeekCollection(collectionName, updatedItem) {
        if (!this.store) return;

        const { goalSeek } = this.store.getState();
        const collection = goalSeek?.[collectionName] || [];
        const index = collection.findIndex(item => item.id === updatedItem.id);

        let newCollection;
        if (index >= 0) {
            newCollection = [...collection];
            newCollection[index] = updatedItem;
        } else {
            newCollection = [...collection, updatedItem];
        }

        this.store.setState({
            goalSeek: {
                ...(goalSeek || {}),
                [collectionName]: newCollection
            }
        });
    }

    /**
     * ログ作成
     * @private
     */
    async _createLog(goalId, phase, action, result) {
        if (!this.repository) return;

        await this.repository.createLog({
            goalId,
            phase,
            action,
            result,
            createdAt: this._getTimestamp()
        });
    }

    /**
     * タイムスタンプ取得
     * @private
     */
    _getTimestamp() {
        return new Date().toISOString();
    }
}

export default GoalSeekService;
