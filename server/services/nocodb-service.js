import { logger } from '../utils/logger.js';

/**
 * NocoDB Service
 * 各プロジェクトのNocoDB Base からタスク・マイルストーンを取得
 */
export class NocoDBService {
    constructor() {
        this.baseUrl = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
        this.apiToken = process.env.NOCODB_API_TOKEN;
        this.timeout = 10000; // 10秒
    }

    /**
     * 指定プロジェクトの統計を取得（タスク + マイルストーン）
     * @param {string} projectId - NocoDB Project ID
     * @returns {Promise<Object>} プロジェクト統計
     */
    async getProjectStats(projectId) {
        try {
            // タスクとマイルストーンを並列取得
            const [tasks, milestones] = await Promise.all([
                this._fetchRecords(projectId, 'タスク'),
                this._fetchRecords(projectId, 'マイルストーン')
            ]);

            // タスク統計
            const taskStats = this._calculateTaskStats(tasks);

            // マイルストーン統計
            const milestoneStats = this._calculateMilestoneStats(milestones);

            return {
                ...taskStats,
                ...milestoneStats
            };
        } catch (error) {
            logger.error(`Failed to get project stats for project ${projectId}`, { error });
            return this._getDefaultStats();
        }
    }

    /**
     * NocoDBからレコード取得（v1 API使用）
     * @param {string} projectId - NocoDB Project ID
     * @param {string} tableName - テーブル名
     * @returns {Promise<Array>} レコード一覧
     */
    async _fetchRecords(projectId, tableName) {
        // NocoDB v1 API: /api/v1/db/data/noco/{projectId}/{tableName}
        const url = `${this.baseUrl}/api/v1/db/data/noco/${projectId}/${encodeURIComponent(tableName)}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                headers: {
                    'xc-token': this.apiToken
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`NocoDB API failed: ${response.status}`);
            }

            const data = await response.json();
            return data.list || [];
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    /**
     * タスク統計計算
     * @param {Array} tasks - タスク一覧
     * @returns {Object} タスク統計（フラット構造）
     */
    _calculateTaskStats(tasks) {
        const total = tasks.length;
        const completed = tasks.filter(t => t.ステータス === '完了').length;
        const inProgress = tasks.filter(t => t.ステータス === '進行中').length;
        const pending = tasks.filter(t => t.ステータス === '未着手').length;
        const blocked = tasks.filter(t => t.ステータス === 'ブロック').length;

        // 期限超過タスク
        const now = new Date();
        const overdue = tasks.filter(t => {
            if (t.ステータス === '完了') return false;
            if (!t.期限) return false;
            return new Date(t.期限) < now;
        }).length;

        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 100;

        return {
            total,
            completed,
            inProgress,
            pending,
            blocked,
            overdue,
            completionRate
        };
    }

    /**
     * マイルストーン統計計算
     * @param {Array} milestones - マイルストーン一覧
     * @returns {Object} マイルストーン統計（フラット構造）
     */
    _calculateMilestoneStats(milestones) {
        if (milestones.length === 0) {
            return {
                averageProgress: 0
            };
        }

        // 進捗率の平均（nullを除外）
        const progressValues = milestones
            .map(m => m.進捗率)
            .filter(p => p !== null && p !== undefined);

        const averageProgress = progressValues.length > 0
            ? Math.round(progressValues.reduce((sum, p) => sum + p, 0) / progressValues.length)
            : 0;

        return {
            averageProgress
        };
    }

    /**
     * 複数プロジェクトの統計を並列取得
     * @param {Array} projects - プロジェクト一覧（{ id, project_id }）
     * @returns {Promise<Array>} プロジェクト統計一覧
     */
    async getAllProjectStats(projects) {
        const results = await Promise.all(
            projects.map(async (project) => {
                const stats = await this.getProjectStats(project.project_id);
                return {
                    projectId: project.id,
                    ...stats
                };
            })
        );

        return results;
    }

    /**
     * デフォルト統計値（エラー時のフォールバック）
     * @returns {Object} デフォルト統計（フラット構造）
     */
    _getDefaultStats() {
        return {
            total: 0,
            completed: 0,
            inProgress: 0,
            pending: 0,
            blocked: 0,
            overdue: 0,
            completionRate: 0,
            averageProgress: 0
        };
    }
}
