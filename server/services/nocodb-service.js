import { logger } from '../utils/logger.js';

/**
 * NocoDB Service
 * 各プロジェクトのNocoDB Base からタスク・マイルストーンを取得
 */
export class NocoDBService {
    constructor() {
        this.baseUrl = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
        this.apiToken = process.env.NOCODB_API_TOKEN;
        this.timeout = 15000; // 15秒
        this.maxRetries = 3;  // 最大リトライ回数
    }

    /**
     * fetch with retry logic (exponential backoff)
     * @private
     * @param {string} url - Request URL
     * @param {Object} options - Fetch options
     * @param {number} retries - Current retry count
     * @returns {Promise<Response>} Fetch response
     */
    async _fetchWithRetry(url, options, retries = 0) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);

            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            // Retry only for timeout errors (AbortError)
            if (retries < this.maxRetries && error.name === 'AbortError') {
                const delay = Math.pow(2, retries) * 1000; // 1s, 2s, 4s
                logger.warn(`Request timeout. Retrying in ${delay}ms... (${retries + 1}/${this.maxRetries})`, { url });
                await new Promise(resolve => setTimeout(resolve, delay));
                return this._fetchWithRetry(url, options, retries + 1);
            }
            throw error;
        }
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

        const response = await this._fetchWithRetry(url, {
            headers: {
                'xc-token': this.apiToken
            }
        });

        if (!response.ok) {
            throw new Error(`NocoDB API failed: ${response.status}`);
        }

        const data = await response.json();
        return data.list || [];
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
     * Critical Alerts取得（ブロッカー + 期限超過タスク）
     * @param {Array} projects - プロジェクト一覧（{ id, project_id }）
     * @returns {Promise<Object>} Critical Alerts（alerts, total_critical, total_warning）
     */
    async getCriticalAlerts(projects) {
        try {
            const alerts = [];

            // 全プロジェクトのタスクを並列取得
            const projectTasks = await Promise.all(
                projects.map(async (project) => {
                    try {
                        const tasks = await this._fetchRecords(project.project_id, 'タスク');
                        return { projectId: project.id, tasks };
                    } catch (error) {
                        logger.error(`Failed to fetch tasks for project ${project.id}`, { error });
                        return { projectId: project.id, tasks: [] };
                    }
                })
            );

            const now = new Date();

            // ブロッカータスクと期限超過タスクを抽出
            for (const { projectId, tasks } of projectTasks) {
                for (const task of tasks) {
                    // ブロッカータスク
                    if (task.ステータス === 'ブロック') {
                        const createdDate = task.作成日 ? new Date(task.作成日) : now;
                        const daysBlocked = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));

                        alerts.push({
                            type: 'blocker',
                            project: projectId,
                            task: task.タスク名 || 'Untitled',
                            owner: task.担当者 || 'Unassigned',
                            days_blocked: daysBlocked,
                            severity: 'critical'
                        });
                    }

                    // 期限超過タスク（完了以外）
                    if (task.ステータス !== '完了' && task.期限) {
                        const deadline = new Date(task.期限);
                        if (deadline < now) {
                            const daysOverdue = Math.floor((now - deadline) / (1000 * 60 * 60 * 24));

                            alerts.push({
                                type: 'overdue',
                                project: projectId,
                                task: task.タスク名 || 'Untitled',
                                owner: task.担当者 || 'Unassigned',
                                days_overdue: daysOverdue,
                                deadline: task.期限,
                                severity: 'warning'
                            });
                        }
                    }
                }
            }

            // Critical/Warning数を集計
            const total_critical = alerts.filter(a => a.severity === 'critical').length;
            const total_warning = alerts.filter(a => a.severity === 'warning').length;

            return {
                alerts,
                total_critical,
                total_warning
            };
        } catch (error) {
            logger.error('Failed to get critical alerts', { error });
            return {
                alerts: [],
                total_critical: 0,
                total_warning: 0
            };
        }
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

    /**
     * プロジェクト健全性スナップショットを履歴テーブルに挿入
     * @param {Object} data - スナップショットデータ
     * @param {string} data.project_id - プロジェクトID
     * @param {string} data.snapshot_date - スナップショット日付（YYYY-MM-DD）
     * @param {number} data.total_tasks - タスク総数
     * @param {number} data.completed_tasks - 完了タスク数
     * @param {number} data.overdue_tasks - 期限超過タスク数
     * @param {number} data.blocked_tasks - ブロックタスク数
     * @param {number} data.completion_rate - 完了率（%）
     * @param {number} data.milestone_progress - マイルストーン進捗率（%）
     * @param {number} data.health_score - 健全性スコア（0-100）
     * @returns {Promise<Object>} 挿入結果
     */
    async insertSnapshot(data) {
        try {
            // NocoDB v1 API: /api/v1/db/data/noco/{projectId}/{tableName}
            // Note: Table name must be created manually in NocoDB UI first
            // Table: プロジェクト健全性履歴
            // UNIQUE constraint: project_id + snapshot_date
            const tableName = 'プロジェクト健全性履歴';
            const url = `${this.baseUrl}/api/v1/db/data/noco/brainbase/${encodeURIComponent(tableName)}`;

            const response = await this._fetchWithRetry(url, {
                method: 'POST',
                headers: {
                    'xc-token': this.apiToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    project_id: data.project_id,
                    snapshot_date: data.snapshot_date,
                    total_tasks: data.total_tasks || 0,
                    completed_tasks: data.completed_tasks || 0,
                    overdue_tasks: data.overdue_tasks || 0,
                    blocked_tasks: data.blocked_tasks || 0,
                    completion_rate: data.completion_rate || 0,
                    milestone_progress: data.milestone_progress || 0,
                    health_score: data.health_score || 0
                })
            });

            if (!response.ok) {
                throw new Error(`NocoDB API failed: ${response.status}`);
            }

            const result = await response.json();
            logger.info(`Snapshot inserted for project ${data.project_id} on ${data.snapshot_date}`);
            return result;
        } catch (error) {
            logger.error(`Failed to insert snapshot for project ${data.project_id}`, { error });
            throw error;
        }
    }

    /**
     * プロジェクトの過去N日間のトレンドデータを取得
     * @param {string} projectId - プロジェクトID
     * @param {number} days - 取得日数（デフォルト: 30日）
     * @returns {Promise<Object>} トレンドデータ
     */
    async getTrends(projectId, days = 30) {
        try {
            // Calculate date range
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const startDateStr = startDate.toISOString().split('T')[0];
            const endDateStr = endDate.toISOString().split('T')[0];

            // NocoDB v1 API: Filter by project_id and date range
            const tableName = 'プロジェクト健全性履歴';
            const url = `${this.baseUrl}/api/v1/db/data/noco/brainbase/${encodeURIComponent(tableName)}`;

            // Build query with filters
            const where = `(project_id,eq,${projectId})~and(snapshot_date,gte,${startDateStr})~and(snapshot_date,lte,${endDateStr})`;
            const queryUrl = `${url}?where=${encodeURIComponent(where)}&sort=-snapshot_date`;

            const response = await this._fetchWithRetry(queryUrl, {
                headers: {
                    'xc-token': this.apiToken
                }
            });

            if (!response.ok) {
                throw new Error(`NocoDB API failed: ${response.status}`);
            }

            const data = await response.json();
            const snapshots = data.list || [];

            // Calculate trend analysis
            const trendAnalysis = this._calculateTrendAnalysis(snapshots);

            return {
                project_id: projectId,
                snapshots,
                trend_analysis: trendAnalysis
            };
        } catch (error) {
            logger.error(`Failed to get trends for project ${projectId}`, { error });
            return {
                project_id: projectId,
                snapshots: [],
                trend_analysis: {
                    trend: 'unknown',
                    health_score_change: 0,
                    alert_level: 'none'
                }
            };
        }
    }

    /**
     * スナップショットからトレンド分析を計算
     * @param {Array} snapshots - スナップショット一覧（降順）
     * @returns {Object} トレンド分析結果
     */
    _calculateTrendAnalysis(snapshots) {
        if (snapshots.length < 2) {
            return {
                trend: 'insufficient_data',
                health_score_change: 0,
                alert_level: 'none'
            };
        }

        // 最新と最古のhealth_scoreを比較
        const latest = snapshots[0];
        const oldest = snapshots[snapshots.length - 1];

        const latestScore = latest.health_score || 0;
        const oldestScore = oldest.health_score || 0;
        const change = latestScore - oldestScore;

        // トレンド判定
        let trend = 'stable';
        if (change > 5) {
            trend = 'up';
        } else if (change < -5) {
            trend = 'down';
        }

        // アラートレベル判定
        let alert_level = 'none';
        if (latestScore < 60 && change < -10) {
            alert_level = 'critical';
        } else if (latestScore < 70 && change < -5) {
            alert_level = 'warning';
        }

        return {
            trend,
            health_score_change: Math.round(change),
            alert_level
        };
    }

    /**
     * Manaワークフロー実行履歴を挿入
     * @param {Object} data - 実行履歴データ
     * @param {string} data.workflow_id - ワークフローID（m1, m2, m3, etc.）
     * @param {string} data.execution_date - 実行日（YYYY-MM-DD）
     * @param {number} data.success_count - 成功回数
     * @param {number} data.failure_count - 失敗回数
     * @param {number} data.success_rate - 成功率（%）
     * @param {string} data.error_details - エラー詳細（オプション）
     * @returns {Promise<Object>} 挿入結果
     */
    async insertWorkflowHistory(data) {
        try {
            const tableName = 'Manaワークフロー履歴';
            const url = `${this.baseUrl}/api/v1/db/data/noco/brainbase/${encodeURIComponent(tableName)}`;

            const response = await this._fetchWithRetry(url, {
                method: 'POST',
                headers: {
                    'xc-token': this.apiToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    workflow_id: data.workflow_id,
                    execution_date: data.execution_date,
                    success_count: data.success_count || 0,
                    failure_count: data.failure_count || 0,
                    success_rate: data.success_rate || 0,
                    error_details: data.error_details || null
                })
            });

            if (!response.ok) {
                throw new Error(`NocoDB API failed: ${response.status}`);
            }

            const result = await response.json();
            logger.info(`Workflow history inserted: ${data.workflow_id} on ${data.execution_date}`);
            return result;
        } catch (error) {
            logger.error(`Failed to insert workflow history for ${data.workflow_id}`, { error });
            throw error;
        }
    }

    /**
     * Manaワークフロー統計を取得
     * @param {string} workflowId - ワークフローID（オプション: 指定なしで全体統計）
     * @param {number} days - 取得日数（デフォルト: 30日）
     * @returns {Promise<Object>} ワークフロー統計
     */
    async getWorkflowStats(workflowId = null, days = 30) {
        try {
            const tableName = 'Manaワークフロー履歴';
            const url = `${this.baseUrl}/api/v1/db/data/noco/brainbase/${encodeURIComponent(tableName)}`;

            // 日付範囲計算
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const startDateStr = startDate.toISOString().split('T')[0];
            const endDateStr = endDate.toISOString().split('T')[0];

            // フィルタ構築
            let where = `(execution_date,gte,${startDateStr})~and(execution_date,lte,${endDateStr})`;
            if (workflowId) {
                where = `(workflow_id,eq,${workflowId})~and${where}`;
            }

            const queryUrl = `${url}?where=${encodeURIComponent(where)}&sort=-execution_date`;

            const response = await this._fetchWithRetry(queryUrl, {
                headers: {
                    'xc-token': this.apiToken
                }
            });

            if (!response.ok) {
                throw new Error(`NocoDB API failed: ${response.status}`);
            }

            const data = await response.json();
            const records = data.list || [];

            // 統計計算
            const stats = this._calculateWorkflowStats(records);

            return {
                workflow_id: workflowId,
                period: { start: startDateStr, end: endDateStr },
                stats,
                records
            };
        } catch (error) {
            logger.error(`Failed to get workflow stats for ${workflowId}`, { error });
            return {
                workflow_id: workflowId,
                stats: { success_rate: 0, total_executions: 0 }
            };
        }
    }

    /**
     * ワークフロー統計計算
     * @param {Array} records - 実行履歴レコード
     * @returns {Object} 統計データ
     */
    _calculateWorkflowStats(records) {
        if (records.length === 0) {
            return {
                success_rate: 0,
                total_executions: 0,
                total_success: 0,
                total_failure: 0
            };
        }

        const total_success = records.reduce((sum, r) => sum + (r.success_count || 0), 0);
        const total_failure = records.reduce((sum, r) => sum + (r.failure_count || 0), 0);
        const total_executions = total_success + total_failure;

        const success_rate = total_executions > 0
            ? Math.round((total_success / total_executions) * 100)
            : 0;

        return {
            success_rate,
            total_executions,
            total_success,
            total_failure
        };
    }
}
