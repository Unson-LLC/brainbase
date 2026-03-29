import express from 'express';
import path from 'path';
import { GitHubService } from '../services/github-service.js';
import { SystemService } from '../services/system-service.js';
import { StorageService } from '../services/storage-service.js';
import { NocoDBService } from '../services/nocodb-service.js';
import { logger } from '../utils/logger.js';
import { cacheMiddleware } from '../middleware/cache.js';
import { asyncHandler } from '../lib/async-handler.js';
import { BrainbaseActionController, ACTION_TYPES, ACTION_STATUS } from '../controllers/brainbase-action-controller.js';
import { createBrainbaseManaRouter } from './brainbase/mana-routes.js';
import { createBrainbaseTrendsRouter } from './brainbase/trends-routes.js';

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

    router.use(createBrainbaseManaRouter({
        manaRepoPath
    }));

    router.use(createBrainbaseTrendsRouter({
        nocodbService,
        configParser
    }));

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
    router.get('/critical-alerts', cacheMiddleware(300), asyncHandler(async (req, res) => {
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
            }));

    /**
     * GET /api/brainbase/strategic-overview
     * 戦略的意思決定支援情報（プロジェクト優先度 + リソース配分）
     */
    // TTL: 5分（頻繁に変わらないデータ）
    router.get('/strategic-overview', cacheMiddleware(300), asyncHandler(async (req, res) => {
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
            }));

    /**
     * GET /api/brainbase/projects/:id/stats
     * 指定プロジェクトの統計を返す
     * @param {string} id - プロジェクトID（config.ymlのprojects[].id）
     */
    router.get('/projects/:id/stats', asyncHandler(async (req, res) => {
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
            }));

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
