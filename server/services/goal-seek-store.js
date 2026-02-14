/**
 * GoalSeekStore
 *
 * Goal Seekデータの永続化ストア。
 * ファイルベース（JSON）で永続化。インメモリキャッシュ付き。
 */

import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

/**
 * GoalSeekStore
 * ファイルベースストア（JSON永続化）
 */
export class GoalSeekStore {
    /**
     * @param {Object} options
     * @param {string} options.dataFile - データファイルパス（デフォルト: var/goal-seek.json）
     */
    constructor(options = {}) {
        this.dataFile = options.dataFile || path.join(process.cwd(), 'var', 'goal-seek.json');
        this.initialized = false;

        // インメモリキャッシュ
        this.goals = new Map();
        this.interventions = new Map();
        this.logs = [];
    }

    /**
     * 初期化（ファイルからロード）
     */
    async init() {
        if (this.initialized) return;

        try {
            await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
            const data = await fs.readFile(this.dataFile, 'utf-8');
            const parsed = JSON.parse(data);

            if (parsed.goals) {
                parsed.goals.forEach(g => this.goals.set(g.id, g));
            }
            if (parsed.interventions) {
                parsed.interventions.forEach(i => this.interventions.set(i.id, i));
            }
            if (parsed.logs) {
                this.logs = parsed.logs;
            }

            console.log(`[GoalSeekStore] Loaded ${this.goals.size} goals from ${this.dataFile}`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('[GoalSeekStore] Load error:', error.message);
            }
            // ファイルがない場合は空で開始
        }

        this.initialized = true;
    }

    /**
     * ファイルに保存
     * @private
     */
    async _save() {
        try {
            const data = {
                goals: Array.from(this.goals.values()),
                interventions: Array.from(this.interventions.values()),
                logs: this.logs,
                savedAt: new Date().toISOString()
            };
            await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
            await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('[GoalSeekStore] Save error:', error.message);
        }
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
        await this._save();
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
        await this._save();
        return updated;
    }

    /**
     * ゴール削除
     * @param {string} id - ゴールID
     * @returns {Promise<boolean>} 削除結果
     */
    async deleteGoal(id) {
        const deleted = this.goals.delete(id);
        if (deleted) await this._save();
        return deleted;
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
        await this._save();
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
        await this._save();
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
        await this._save();
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
    async clear() {
        this.goals.clear();
        this.interventions.clear();
        this.logs = [];
        await this._save();
    }
}

// シングルトンインスタンス（VAR_DIRを使用）
import { existsSync } from 'fs';
const VAR_DIR = process.env.BRAINBASE_VAR_DIR || path.join(process.cwd(), 'var');
const dataFile = path.join(VAR_DIR, 'goal-seek.json');

export const goalSeekStore = new GoalSeekStore({ dataFile });

export default GoalSeekStore;
