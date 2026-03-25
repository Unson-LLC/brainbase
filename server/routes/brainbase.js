import express from 'express';
import { execSync } from 'child_process';
import path from 'path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { fromIni } from '@aws-sdk/credential-providers';
import { GitHubService } from '../services/github-service.js';
import { SystemService } from '../services/system-service.js';
import { StorageService } from '../services/storage-service.js';
import { NocoDBService } from '../services/nocodb-service.js';
import { logger } from '../utils/logger.js';
import { cacheMiddleware } from '../middleware/cache.js';
import { asyncHandler } from '../lib/async-handler.js';
import { BrainbaseActionController, ACTION_TYPES, ACTION_STATUS } from '../controllers/brainbase-action-controller.js';

// Re-export for backward compatibility
export { ACTION_TYPES, ACTION_STATUS };

/**
 * brainbaseダッシュボードAPIルーター
 * システム全体の監視情報を提供
 */
export function createBrainbaseRouter(options = {}) {
    const router = express.Router();
    const { taskParser, worktreeService, configParser, projectsRoot } = options;
    const resolvedProjectsRoot = projectsRoot || process.env.PROJECTS_ROOT || null;
    const manaRepoPath = process.env.MANA_REPO_PATH
        || (resolvedProjectsRoot ? path.join(resolvedProjectsRoot, 'mana') : null);

    const githubService = new GitHubService();
    const systemService = new SystemService();
    const storageService = new StorageService();
    const nocodbService = new NocoDBService();
    const manaHistoryConfig = {
        tableName: process.env.MANA_MESSAGE_HISTORY_TABLE || process.env.MESSAGE_HISTORY_TABLE_NAME || 'mana-message-history',
        region: process.env.MANA_AWS_REGION || process.env.AWS_REGION || 'us-east-1',
        profile: process.env.MANA_AWS_PROFILE || process.env.AWS_PROFILE || null
    };
    let manaHistoryClient = null;

    const getManaHistoryClient = () => {
        if (manaHistoryClient) return manaHistoryClient;
        const clientConfig = { region: manaHistoryConfig.region };
        if (manaHistoryConfig.profile) {
            clientConfig.credentials = fromIni({ profile: manaHistoryConfig.profile });
        }
        const dynamoClient = new DynamoDBClient(clientConfig);
        manaHistoryClient = DynamoDBDocumentClient.from(dynamoClient);
        return manaHistoryClient;
    };

    /**
     * GET /api/brainbase
     * すべての監視情報を一括取得
     */
    router.get('/', asyncHandler(async (req, res) => {
        const [github, system, tasks, worktrees, projects] = await Promise.all([
            getGitHubInfo(), systemService.getSystemStatus(),
            getTasksInfo(), getWorktreesInfo(), getProjectsWithHealth(),
        ]);
        res.json({ github, system, tasks, worktrees, projects, timestamp: new Date().toISOString() });
    }));

    router.get('/github/runners', asyncHandler(async (req, res) => {
        res.json(await githubService.getSelfHostedRunners());
    }));

    router.get('/github/workflows', asyncHandler(async (req, res) => {
        res.json(await githubService.getWorkflowRuns(parseInt(req.query.limit) || 10));
    }));

    router.get('/system', asyncHandler(async (req, res) => {
        res.json(await systemService.getSystemStatus());
    }));

    router.get('/system-health', asyncHandler(async (req, res) => {
        res.json({ success: true, data: await githubService.getHealthcheckStatus() });
    }));

    router.get('/storage', asyncHandler(async (req, res) => {
        res.json(await storageService.getStorageSummary());
    }));

    router.get('/tasks', asyncHandler(async (req, res) => {
        res.json(await getTasksInfo());
    }));

    router.get('/worktrees', asyncHandler(async (req, res) => {
        res.json(await getWorktreesInfo());
    }));

    router.get('/projects', asyncHandler(async (req, res) => {
        res.json(await getProjectsWithHealth());
    }));

    /**
     * GET /api/brainbase/critical-alerts
     * Critical Alerts取得（ブロッカー + 期限超過タスク）
     * クエリパラメータ: ?test=true でテストデータを返す
     */
    // TTL: 5分（頻繁に変わらないデータ）
    router.get('/critical-alerts', cacheMiddleware(300), async (req, res) => {
        try {
            // テストモード: モックデータを返す
            if (req.query.test === 'true') {
                return res.json({
                    alerts: [
                        { type: 'blocker', severity: 'critical', project: 'salestailor', task: 'API認証の実装が外部依存でブロック', owner: 'tanaka', days_blocked: 7 },
                        { type: 'overdue', severity: 'critical', project: 'zeims', task: 'UIリファクタリング', owner: 'yamada', days_overdue: 5 },
                        { type: 'blocker', severity: 'critical', project: 'tech-knight', task: 'インフラ移行待ち', owner: 'suzuki', days_blocked: 14 },
                        { type: 'overdue', severity: 'warning', project: 'brainbase', task: 'ドキュメント整備', owner: 'sato', days_overdue: 2 },
                    ],
                    total_critical: 3,
                    total_warning: 1
                });
            }

            // 1. config.ymlからプロジェクト一覧（project_id必須）
            const config = await configParser.getAll();
            const projects = (config.projects?.projects || [])
                .filter(p => !p.archived && p.nocodb?.project_id)
                .map(p => ({ id: p.id, project_id: p.nocodb.project_id }));

            // 2. NocoDBからCritical Alerts取得
            const alerts = await nocodbService.getCriticalAlerts(projects);

            res.json(alerts);
        } catch (error) {
            logger.error('Failed to fetch critical alerts', { error });
            res.status(500).json({ error: 'Failed to fetch critical alerts' });
        }
    });

    /**
     * GET /api/brainbase/strategic-overview
     * 戦略的意思決定支援情報（プロジェクト優先度 + リソース配分）
     */
    // TTL: 5分（頻繁に変わらないデータ）
    router.get('/strategic-overview', cacheMiddleware(300), async (req, res) => {
        try {
            // 1. config.ymlからプロジェクト一覧
            const config = await configParser.getAll();
            const projects = (config.projects?.projects || [])
                .filter(p => !p.archived && p.nocodb?.project_id)
                .map(p => ({ id: p.id, project_id: p.nocodb.project_id }));

            // 2. NocoDBから統計取得
            const stats = await Promise.all(
                projects.map(p => nocodbService.getProjectStats(p.project_id))
            );

            // 3. 健全性スコア計算 + トレンド分析（暫定: モックデータ）
            const projectsWithScore = stats.map((stat, i) => {
                const taskCompletion = stat.completionRate || 0;
                const overdueScore = Math.max(0, 100 - (stat.overdue * 10));
                const blockedScore = Math.max(0, 100 - (stat.blocked * 20));
                const milestoneProgress = stat.averageProgress || 0;

                const healthScore = Math.round(
                    (taskCompletion * 0.3) +
                    (overdueScore * 0.2) +
                    (blockedScore * 0.2) +
                    (milestoneProgress * 0.3)
                );

                // トレンド判定（Week 5-6で履歴データから算出予定）
                // 暫定: health scoreに基づく簡易判定
                let trend = 'stable';
                let change = 0;
                if (healthScore >= 80) {
                    trend = 'up';
                    change = Math.floor(Math.random() * 5) + 1;
                } else if (healthScore < 60) {
                    trend = 'down';
                    change = -(Math.floor(Math.random() * 8) + 1);
                }

                // 推奨アクション生成
                const recommendations = generateRecommendations(healthScore, stat);

                return {
                    name: projects[i].id,
                    health_score: healthScore,
                    trend,
                    change,
                    overdue: stat.overdue,
                    blocked: stat.blocked,
                    completion_rate: taskCompletion,
                    milestone_progress: milestoneProgress,
                    recommendations
                };
            });

            // 4. ボトルネック検出（タスク数でのリソース配分分析）
            const bottlenecks = detectBottlenecks(projectsWithScore);

            // 5. 優先度順にソート
            projectsWithScore.sort((a, b) => b.health_score - a.health_score);

            res.json({
                projects: projectsWithScore,
                bottlenecks
            });
        } catch (error) {
            logger.error('Failed to fetch strategic overview', { error });
            res.status(500).json({ error: 'Failed to fetch strategic overview' });
        }
    });

    /**
     * GET /api/brainbase/trends
     * プロジェクトの健全性トレンド取得（過去N日間の履歴データ）
     *
     * @query {string} project_id - プロジェクトID（必須）
     * @query {number} days - 取得日数（デフォルト: 30日）
     *
     * @returns {Object} トレンドデータ
     *   - project_id: プロジェクトID
     *   - snapshots: 過去N日間のスナップショット一覧
     *   - trend_analysis: トレンド分析結果（up/down/stable, health_score変化量, alert_level）
     */
    router.get('/trends', async (req, res) => {
        try {
            const projectId = req.query.project_id;
            const days = parseInt(req.query.days) || 30;

            // バリデーション
            if (!projectId) {
                return res.status(400).json({
                    error: 'project_id is required',
                    message: 'Please provide a project_id query parameter'
                });
            }

            // NocoDBからトレンドデータ取得
            const trends = await nocodbService.getTrends(projectId, days);

            res.json(trends);
        } catch (error) {
            logger.error('Failed to fetch trends', { error, projectId: req.query.project_id });
            res.status(500).json({ error: 'Failed to fetch trends' });
        }
    });

    /**
     * GET /api/brainbase/trends/heatmap
     * 全プロジェクトの8週分トレンドをヒートマップ形式で返す
     * Story 4: 構造的な問題を見抜く
     *
     * @query {number} weeks - 取得週数（デフォルト: 8週）
     * @query {string} test - 'true'でテストデータを返す
     *
     * @returns {Object} ヒートマップデータ
     *   - heatmap: 各プロジェクトの週次データ配列
     *   - chronic_alerts: 慢性的止まりプロジェクトのアラート配列
     */
    // TTL: 10分（週次データなので頻繁に変わらない）
    router.get('/trends/heatmap', cacheMiddleware(600), async (req, res) => {
        try {
            const weeks = parseInt(req.query.weeks) || 8;

            // テストモード: モックデータを返す
            if (req.query.test === 'true') {
                const generateTestHeatmap = (projectId, baseHealth, trend) => {
                    const weekData = [];
                    let health = baseHealth;
                    for (let i = 1; i <= weeks; i++) {
                        health += trend === 'up' ? Math.floor(Math.random() * 5) :
                                  trend === 'down' ? -Math.floor(Math.random() * 8) :
                                  (Math.random() > 0.5 ? 2 : -2);
                        health = Math.max(20, Math.min(100, health));
                        weekData.push({
                            week: `W${i}`,
                            health_score: health,
                            status: health >= 80 ? 'healthy' : health >= 60 ? 'warning' : 'critical',
                            data_points: 7
                        });
                    }
                    return {
                        project_id: projectId,
                        weeks: weekData,
                        trend_analysis: {
                            trend,
                            health_score_change: weekData[weeks-1].health_score - weekData[0].health_score,
                            alert_level: trend === 'down' && health < 60 ? 'chronic' : 'none',
                            chronic_stall: trend === 'down' && health < 60 ? { days: 18, threshold: 60 } : null
                        }
                    };
                };

                const testHeatmap = [
                    generateTestHeatmap('salestailor', 75, 'up'),
                    generateTestHeatmap('zeims', 65, 'stable'),
                    generateTestHeatmap('tech-knight', 55, 'down'),
                    generateTestHeatmap('baao', 80, 'up'),
                    generateTestHeatmap('brainbase', 70, 'stable'),
                    generateTestHeatmap('dialogai', 45, 'down'),
                ];

                const chronicAlerts = testHeatmap
                    .filter(p => p.trend_analysis.chronic_stall)
                    .map(p => ({ project_id: p.project_id, stall_info: p.trend_analysis.chronic_stall }));

                return res.json({
                    heatmap: testHeatmap,
                    chronic_alerts: chronicAlerts,
                    weeks_requested: weeks,
                    generated_at: new Date().toISOString()
                });
            }

            const days = weeks * 7;

            // 1. config.ymlからプロジェクト一覧（project_id必須）
            const config = await configParser.getAll();
            const projects = (config.projects?.projects || [])
                .filter(p => !p.archived && p.nocodb?.project_id)
                .map(p => ({ id: p.id, project_id: p.nocodb.project_id }));

            // 2. 各プロジェクトのトレンドを並列取得
            const heatmapData = await Promise.all(
                projects.map(async (project) => {
                    try {
                        const trends = await nocodbService.getTrends(project.project_id, days);
                        const weeklyData = aggregateToWeekly(trends.snapshots, weeks);
                        return {
                            project_id: project.id,
                            weeks: weeklyData,
                            trend_analysis: trends.trend_analysis
                        };
                    } catch (error) {
                        logger.error(`Failed to get trends for project ${project.id}`, { error });
                        return {
                            project_id: project.id,
                            weeks: [],
                            trend_analysis: {
                                trend: 'unknown',
                                health_score_change: 0,
                                alert_level: 'none',
                                chronic_stall: null
                            }
                        };
                    }
                })
            );

            // 3. 慢性的止まりプロジェクト抽出
            const chronicAlerts = heatmapData
                .filter(p => p.trend_analysis.chronic_stall)
                .map(p => ({
                    project_id: p.project_id,
                    stall_info: p.trend_analysis.chronic_stall
                }));

            res.json({
                heatmap: heatmapData,
                chronic_alerts: chronicAlerts,
                weeks_requested: weeks,
                generated_at: new Date().toISOString()
            });
        } catch (error) {
            logger.error('Failed to fetch trends heatmap', { error });
            res.status(500).json({ error: 'Failed to fetch trends heatmap' });
        }
    });

    /**
     * 日次データを週次に集約
     * @param {Array} snapshots - 日次スナップショット（降順）
     * @param {number} numWeeks - 週数
     * @returns {Array} 週次集約データ
     */
    function aggregateToWeekly(snapshots, numWeeks) {
        const weeks = [];

        for (let w = 0; w < numWeeks; w++) {
            // 各週の開始・終了インデックス（降順なので逆順）
            const startIdx = w * 7;
            const endIdx = startIdx + 7;
            const weekSnapshots = snapshots.slice(startIdx, endIdx);

            if (weekSnapshots.length === 0) {
                weeks.push({
                    week: `W${w + 1}`,
                    health_score: null,
                    status: 'no_data',
                    data_points: 0
                });
                continue;
            }

            // 週の平均health_scoreを計算
            const scores = weekSnapshots.map(s => s.health_score || 0);
            const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

            // ステータス判定
            let status = 'healthy';
            if (avgScore < 60) {
                status = 'critical';
            } else if (avgScore < 80) {
                status = 'warning';
            }

            weeks.push({
                week: `W${w + 1}`,
                health_score: avgScore,
                status,
                data_points: weekSnapshots.length
            });
        }

        return weeks;
    }

    /**
     * GET /api/brainbase/mana-workflow-stats
     * Manaワークフロー統計を取得（GitHub Actions履歴から）
     * @query {string} workflow_id - ワークフローID（オプション: 指定なしで全体統計）
     */
    // TTL: 5分（GitHub API rate limit対策）
    router.get('/mana-workflow-stats', cacheMiddleware(300), async (req, res) => {
        try {
            const { workflow_id } = req.query;

            // workflow_id → GitHub Actionsファイル名のマッピング
            const WORKFLOW_MAPPING = {
                'm1': { file: 'mana-m1-morning.yml', name: 'M1: 朝のブリーフィング' },
                'm2': { file: 'mana-m2-blocker.yml', name: 'M2: ブロッカー早期発見' },
                'm3': { file: 'mana-m3-reminder.yml', name: 'M3: 期限前リマインド' },
                'm4': { file: 'mana-m4-overdue.yml', name: 'M4: 期限超過アラート' },
                'm5': { file: 'mana-m5-context.yml', name: 'M5: コンテキスト収集' },
                'm6': { file: 'mana-m6-progress.yml', name: 'M6: 進捗レポート' },
                'm7': { file: 'mana-m7-executive.yml', name: 'M7: エグゼクティブサマリー' },
                'm8': { file: 'mana-m8-gm.yml', name: 'M8: GM向けレポート' },
                'm9': { file: 'mana-m9-weekly.yml', name: 'M9: 週次レポート' },
                'm10': { file: 'mana-m10-reminder.yml', name: 'M10: リマインダー' },
                'm11': { file: 'mana-m11-followup.yml', name: 'M11: フォローアップ' },
                'm12': { file: 'mana-m12-onboarding.yml', name: 'M12: オンボーディング' }
            };

            // バリデーション: workflow_idが空文字列の場合はエラー
            if (workflow_id === '') {
                return res.status(400).json({
                    error: 'Invalid workflow_id',
                    message: 'workflow_id cannot be an empty string'
                });
            }

            // テストモード: モックデータを返す
            if (req.query.test === 'true') {
                const mapping = WORKFLOW_MAPPING[workflow_id];
                // テスト用: ランダムな成功率を生成
                const successRate = Math.floor(Math.random() * 40) + 60; // 60-100%
                const totalExecutions = Math.floor(Math.random() * 50) + 10; // 10-60
                const successCount = Math.floor(totalExecutions * successRate / 100);
                const failureCount = totalExecutions - successCount;

                return res.json({
                    workflow_id: workflow_id,
                    workflow_name: mapping?.name || workflow_id,
                    stats: {
                        success_rate: successRate,
                        total_executions: totalExecutions,
                        total_success: successCount,
                        total_failure: failureCount,
                        avg_duration_ms: Math.floor(Math.random() * 2000) + 500
                    }
                });
            }

            // GitHub Actions履歴を取得
            const mapping = WORKFLOW_MAPPING[workflow_id];
            if (!mapping) {
                return res.status(400).json({
                    error: 'Unknown workflow_id',
                    message: `workflow_id '${workflow_id}' is not recognized`
                });
            }

            const ghCommand = `gh run list --workflow=${mapping.file} --limit 30 --json conclusion,createdAt,status`;

            let runs = [];
            try {
                // manaリポジトリで実行（GitHub Actionsがある場所）
                const execOptions = {
                    encoding: 'utf-8',
                    timeout: 10000
                };
                if (manaRepoPath) {
                    execOptions.cwd = manaRepoPath;
                }
                const output = execSync(ghCommand, execOptions);
                runs = JSON.parse(output);
            } catch (ghError) {
                logger.warn('gh CLI failed, returning empty stats', { error: ghError.message, workflow_id });
                // gh CLIが失敗した場合は空のデータを返す
                return res.json({
                    workflow_id: workflow_id,
                    workflow_name: mapping.name,
                    stats: {
                        success_rate: 0,
                        total_executions: 0,
                        total_success: 0,
                        total_failure: 0,
                        avg_duration_ms: 0
                    }
                });
            }

            // 統計を計算
            const total = runs.length;
            const success = runs.filter(r => r.conclusion === 'success').length;
            const failure = runs.filter(r => r.conclusion === 'failure').length;
            const successRate = total > 0 ? Math.round((success / total) * 100) : 0;

            res.json({
                workflow_id: workflow_id,
                workflow_name: mapping.name,
                stats: {
                    success_rate: successRate,
                    total_executions: total,
                    total_success: success,
                    total_failure: failure,
                    avg_duration_ms: 0 // GitHub APIでは取得不可
                }
            });
        } catch (error) {
            logger.error('Failed to get Mana workflow stats', { error, workflow_id: req.query.workflow_id });
            res.status(500).json({ error: 'Failed to get Mana workflow stats' });
        }
    });

    /**
     * GET /api/brainbase/mana-message-history
     * Manaメッセージ送信履歴を取得（DynamoDB）
     * @query {string} workflow_id - ワークフローID（例: m1, m2）
     * @query {number} limit - 取得件数（デフォルト: 20, 最大: 200）
     * @query {string} target_id - 送信先ID（任意）
     * @query {string} status - statusフィルタ（任意）
     */
    router.get('/mana-message-history', cacheMiddleware(30), async (req, res) => {
        try {
            const workflowId = req.query.workflow_id || req.query.workflowId;
            if (!workflowId || typeof workflowId !== 'string') {
                return res.status(400).json({
                    error: 'Invalid workflow_id',
                    message: 'workflow_id is required'
                });
            }

            const limitRaw = parseInt(req.query.limit, 10);
            const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 20;
            const targetId = req.query.target_id || req.query.targetId || null;
            const status = req.query.status || null;

            const client = getManaHistoryClient();

            const expressionValues = { ':pk': workflowId };
            const expressionNames = {};
            const filters = [];

            if (targetId) {
                expressionValues[':target_id'] = targetId;
                filters.push('target_id = :target_id');
            }
            if (status) {
                expressionValues[':status'] = status;
                expressionNames['#status'] = 'status';
                filters.push('#status = :status');
            }

            const queryInput = {
                TableName: manaHistoryConfig.tableName,
                KeyConditionExpression: 'pk = :pk',
                ExpressionAttributeValues: expressionValues,
                ScanIndexForward: false,
                Limit: limit
            };

            if (filters.length > 0) {
                queryInput.FilterExpression = filters.join(' AND ');
                if (Object.keys(expressionNames).length > 0) {
                    queryInput.ExpressionAttributeNames = expressionNames;
                }
            }

            const result = await client.send(new QueryCommand(queryInput));
            const items = (result.Items || []).map((item) => ({
                workflow_id: item.mx_id || item.pk,
                sent_at: item.sent_at,
                target_type: item.target_type,
                target_id: item.target_id,
                status: item.status,
                text: item.text,
                excerpt: item.excerpt,
                error: item.error,
                project_id: item.project_id,
                message_ts: item.message_ts,
                channel_id: item.channel_id,
                thread_ts: item.thread_ts,
                workspace: item.workspace,
                run_id: item.run_id,
                task_ids: item.task_ids
            }));

            res.json({
                workflow_id: workflowId,
                count: items.length,
                items
            });
        } catch (error) {
            logger.error('Failed to fetch mana message history', { error });
            res.status(500).json({
                error: 'Failed to fetch mana message history',
                message: error?.message || 'Unknown error'
            });
        }
    });

    /**
     * GET /api/brainbase/projects/:id/stats
     * 指定プロジェクトの統計を返す
     * @param {string} id - プロジェクトID（config.ymlのprojects[].id）
     */
    router.get('/projects/:id/stats', async (req, res) => {
        try {
            const { id } = req.params;

            // 1. config.ymlからプロジェクト一覧を取得
            const config = await configParser.getAll();
            const projects = config.projects?.projects || [];

            // 2. 指定されたIDのプロジェクトを検索
            const project = projects.find(p => p.id === id);

            if (!project || project.archived || !project.nocodb?.project_id) {
                return res.status(404).json({
                    error: 'Project not found',
                    message: `Project '${id}' not found or archived`
                });
            }

            // 3. NocoDBから統計取得
            const stats = await nocodbService.getProjectStats(project.nocodb.project_id);

            res.json(stats);
        } catch (error) {
            logger.error('Failed to fetch project stats', { error, projectId: req.params.id });
            res.status(404).json({ error: 'Failed to fetch project stats' });
        }
    });

    // ==================== Helper Functions ====================

    /**
     * 健全性スコアに基づく推奨アクション生成
     */
    function generateRecommendations(healthScore, stat) {
        const recommendations = [];

        if (healthScore >= 80) {
            recommendations.push('健全。現状維持でOK');
        } else if (healthScore >= 60) {
            if (stat.overdue > 3) {
                recommendations.push('期限超過タスク多数。優先順位の見直しを検討');
            }
            if (stat.blocked > 2) {
                recommendations.push('ブロッカー解消に注力');
            }
        } else {
            recommendations.push('要注意。リソース追加またはスコープ見直しを検討');
            if (stat.overdue > 5) {
                recommendations.push('期限超過が多数。緊急対応が必要');
            }
            if (stat.blocked > 3) {
                recommendations.push('複数のブロッカーが存在。即座の解消が必要');
            }
        }

        return recommendations;
    }

    /**
     * ボトルネック検出（リソース配分分析）
     */
    function detectBottlenecks(projects) {
        const bottlenecks = [];

        // プロジェクト別タスク数の不均衡を検出
        const totalTasks = projects.reduce((sum, p) => sum + (p.overdue + p.blocked), 0);
        const avgTasks = totalTasks / projects.length;

        projects.forEach(project => {
            const projectTasks = project.overdue + project.blocked;
            if (projectTasks > avgTasks * 1.5) {
                bottlenecks.push({
                    type: 'project_overload',
                    project: project.name,
                    task_count: projectTasks,
                    recommendation: `${project.name}にタスクが集中。他プロジェクトとの調整を推奨`
                });
            }
        });

        // 全体的なリソース不足の検出
        const criticalProjects = projects.filter(p => p.health_score < 60);
        if (criticalProjects.length >= projects.length * 0.3) {
            bottlenecks.push({
                type: 'overall_resource_shortage',
                affected_projects: criticalProjects.length,
                recommendation: '複数プロジェクトで健全性低下。全体的なリソース見直しが必要'
            });
        }

        return bottlenecks;
    }

    /**
     * GitHub情報取得（ランナー + ワークフロー）
     */
    async function getGitHubInfo() {
        const [runners, workflows] = await Promise.all([
            githubService.getSelfHostedRunners(),
            githubService.getWorkflowRuns(5),
        ]);

        return {
            runners,
            workflows,
        };
    }

    /**
     * タスク管理ステータス取得
     */
    async function getTasksInfo() {
        if (!taskParser) {
            return { error: 'TaskParser not initialized' };
        }

        try {
            const tasks = await taskParser.getTasks();
            const total = tasks.length;
            const completed = tasks.filter(t => t.status === 'completed').length;
            const inProgress = tasks.filter(t => t.status === 'in_progress').length;
            const pending = tasks.filter(t => t.status === 'pending').length;
            const blocked = tasks.filter(t => t.status === 'blocked').length;

            // 期限切れタスク
            const now = new Date();
            const overdue = tasks.filter(t => {
                if (t.status === 'completed') return false;
                if (!t.deadline) return false;
                return new Date(t.deadline) < now;
            });

            // 今日のフォーカスタスク
            const focus = tasks.find(t => t.focus) || null;

            return {
                total,
                completed,
                inProgress,
                pending,
                blocked,
                overdue: overdue.length,
                overdueList: overdue.slice(0, 5).map(t => ({
                    title: t.title,
                    deadline: t.deadline,
                    status: t.status,
                })),
                focus: focus ? {
                    title: focus.title,
                    status: focus.status,
                    deadline: focus.deadline,
                } : null,
            };
        } catch (error) {
            logger.error('Error parsing tasks', { error });
            return { error: 'Failed to parse tasks' };
        }
    }

    /**
     * Worktree情報取得
     */
    async function getWorktreesInfo() {
        if (!worktreeService) {
            return { error: 'WorktreeService not initialized' };
        }

        try {
            const worktrees = await worktreeService.listWorktrees();
            const active = worktrees.filter(w => w.branch !== 'main' && w.branch !== 'master');

            // 未コミットの変更があるworktree
            const uncommitted = [];
            for (const wt of active) {
                // TODO: git statusコマンドで未コミット確認
                // 現時点では簡易実装
            }

            return {
                total: worktrees.length,
                active: active.length,
                uncommitted: uncommitted.length,
                list: active.slice(0, 5).map(wt => ({
                    branch: wt.branch,
                    path: wt.path,
                })),
            };
        } catch (error) {
            logger.error('Error getting worktrees', { error });
            return { error: 'Failed to get worktrees' };
        }
    }

    /**
     * プロジェクト健全性スコア取得
     * /api/brainbase/projects と同じロジックを使用
     */
    async function getProjectsWithHealth() {
        try {
            // 1. config.ymlからプロジェクト一覧（project_id必須）
            const config = await configParser.getAll();
            const projects = (config.projects?.projects || [])
                .filter(p => !p.archived && p.nocodb?.project_id)
                .map(p => ({ id: p.id, project_id: p.nocodb.project_id }));

            // 2. NocoDBから統計取得
            const stats = await Promise.all(
                projects.map(p => nocodbService.getProjectStats(p.project_id))
            );

            // 3. 健全性スコア計算
            const healthScores = stats.map((stat, i) => {
                const taskCompletion = stat.completionRate || 0;
                const overdueScore = Math.max(0, 100 - (stat.overdue * 10));
                const blockedScore = Math.max(0, 100 - (stat.blocked * 20));
                const milestoneProgress = stat.averageProgress || 0;

                const healthScore = Math.round(
                    (taskCompletion * 0.3) +
                    (overdueScore * 0.2) +
                    (blockedScore * 0.2) +
                    (milestoneProgress * 0.3)
                );

                return {
                    id: projects[i].id,
                    name: projects[i].id,
                    healthScore,
                    overdue: stat.overdue,
                    blocked: stat.blocked,
                    completionRate: taskCompletion,
                    manaScore: 92 // 固定値（Phase 3でmana統合）
                };
            });

            return healthScores.sort((a, b) => b.healthScore - a.healthScore);
        } catch (error) {
            logger.error('Error getting projects health', { error });
            return [];
        }
    }

    // ==================== Actions API (Story 3) ====================
    const actionController = new BrainbaseActionController(nocodbService);
    router.post('/actions', actionController.create);
    router.get('/actions', actionController.list);
    router.patch('/actions/:actionId/status', actionController.updateStatus);
    router.get('/action-types', actionController.getTypes);

    return router;
}
