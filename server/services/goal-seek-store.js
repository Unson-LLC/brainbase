/**
 * GoalSeekStore
 *
 * Goal Seekデータの永続化ストア。
 * まずはインメモリ実装、後でPostgreSQLに移行可能。
 */

import { randomUUID } from 'crypto';

/**
 * GoalSeekStore
 * インメモリストア（PostgreSQL移行可能）
 */
export class GoalSeekStore {
    /**
     * @param {Object} options
     * @param {string} options.type - ストレージタイプ ('memory' | 'postgres')
     */
    constructor(options = {}) {
        this.type = options.type || 'memory';

        // インメモリストレージ
        this.goals = new Map();
        this.interventions = new Map();
        this.logs = [];
    }

    // ========================================
    // Goals
    // ========================================

    /**
     * ゴール作成
     * @param {Object} data - ゴールデータ
     * @returns {Promise<Object>} 作成されたゴール
     */
    async createGoal(data) {
        const id = `goal-${randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();

        const goal = {
            id,
            ...data,
            current: data.current || { value: 0 },
            status: data.status || 'seeking',
            phase: data.phase || 'seek',
            actionPlan: data.actionPlan || [],
            createdAt: now,
            updatedAt: now
        };

        this.goals.set(id, goal);
        return goal;
    }

    /**
     * ゴール取得
     * @param {string} id - ゴールID
     * @returns {Promise<Object|null>} ゴール
     */
    async getGoal(id) {
        return this.goals.get(id) || null;
    }

    /**
     * ゴール更新
     * @param {string} id - ゴールID
     * @param {Object} updates - 更新内容
     * @returns {Promise<Object|null>} 更新されたゴール
     */
    async updateGoal(id, updates) {
        const goal = this.goals.get(id);
        if (!goal) return null;

        const updated = {
            ...goal,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        this.goals.set(id, updated);
        return updated;
    }

    /**
     * ゴール削除
     * @param {string} id - ゴールID
     * @returns {Promise<boolean>} 削除結果
     */
    async deleteGoal(id) {
        return this.goals.delete(id);
    }

    /**
     * セッションIDでゴール一覧取得
     * @param {string} sessionId - セッションID
     * @returns {Promise<Array>} ゴール一覧
     */
    async getGoalsBySession(sessionId) {
        return Array.from(this.goals.values()).filter(g => g.sessionId === sessionId);
    }

    /**
     * 全ゴール取得
     * @returns {Promise<Array>} ゴール一覧
     */
    async getAllGoals() {
        return Array.from(this.goals.values());
    }

    // ========================================
    // Interventions
    // ========================================

    /**
     * 介入作成
     * @param {Object} data - 介入データ
     * @returns {Promise<Object>} 作成された介入
     */
    async createIntervention(data) {
        const id = `intervention-${randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();

        const intervention = {
            id,
            ...data,
            status: data.status || 'pending',
            createdAt: now
        };

        this.interventions.set(id, intervention);
        return intervention;
    }

    /**
     * 介入取得
     * @param {string} id - 介入ID
     * @returns {Promise<Object|null>} 介入
     */
    async getIntervention(id) {
        return this.interventions.get(id) || null;
    }

    /**
     * 介入更新
     * @param {string} id - 介入ID
     * @param {Object} updates - 更新内容
     * @returns {Promise<Object|null>} 更新された介入
     */
    async updateIntervention(id, updates) {
        const intervention = this.interventions.get(id);
        if (!intervention) return null;

        const updated = {
            ...intervention,
            ...updates
        };

        this.interventions.set(id, updated);
        return updated;
    }

    /**
     * 未処理の介入一覧取得
     * @returns {Promise<Array>} 未処理の介入一覧
     */
    async getPendingInterventions() {
        return Array.from(this.interventions.values()).filter(i => i.status === 'pending');
    }

    // ========================================
    // Logs
    // ========================================

    /**
     * ログ作成
     * @param {Object} data - ログデータ
     * @returns {Promise<Object>} 作成されたログ
     */
    async createLog(data) {
        const id = `log-${randomUUID().slice(0, 8)}`;

        const log = {
            id,
            ...data,
            createdAt: new Date().toISOString()
        };

        this.logs.push(log);
        return log;
    }

    /**
     * ゴールIDでログ一覧取得
     * @param {string} goalId - ゴールID
     * @returns {Promise<Array>} ログ一覧
     */
    async getLogsByGoal(goalId) {
        return this.logs.filter(l => l.goalId === goalId);
    }

    // ========================================
    // Utility
    // ========================================

    /**
     * 全データクリア（テスト用）
     */
    clear() {
        this.goals.clear();
        this.interventions.clear();
        this.logs = [];
    }
}

// シングルトンインスタンス
export const goalSeekStore = new GoalSeekStore();

export default GoalSeekStore;
