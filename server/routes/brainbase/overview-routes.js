import express from 'express';
import { logger } from '../../utils/logger.js';
import { cacheMiddleware } from '../../middleware/cache.js';
import { asyncHandler } from '../../lib/async-handler.js';

export function createBrainbaseOverviewRouter(options = {}) {
    const router = express.Router();
    const {
        githubService,
        systemService,
        storageService,
        nocodbService,
        taskParser,
        worktreeService,
        configParser
    } = options;

    /**
     * GET /api/brainbase
     * すべての監視情報を一括取得
     */
    router.get('/', asyncHandler(async (req, res) => {
        const [github, system, tasks, worktrees, projects] = await Promise.all([
            getGitHubInfo(),
            systemService.getSystemStatus(),
            getTasksInfo(),
            getWorktreesInfo(),
            getProjectsWithHealth()
        ]);
        res.json({ github, system, tasks, worktrees, projects, timestamp: new Date().toISOString() });
    }));

    router.get('/github/runners', asyncHandler(async (req, res) => {
        res.json(await githubService.getSelfHostedRunners());
    }));

    router.get('/github/workflows', asyncHandler(async (req, res) => {
        res.json(await githubService.getWorkflowRuns(parseInt(req.query.limit, 10) || 10));
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
    router.get('/critical-alerts', cacheMiddleware(300), asyncHandler(async (req, res) => {
        if (req.query.test === 'true') {
            return res.json({
                alerts: [
                    { type: 'blocker', severity: 'critical', project: 'salestailor', task: 'API認証の実装が外部依存でブロック', owner: 'tanaka', days_blocked: 7 },
                    { type: 'overdue', severity: 'critical', project: 'zeims', task: 'UIリファクタリング', owner: 'yamada', days_overdue: 5 },
                    { type: 'blocker', severity: 'critical', project: 'tech-knight', task: 'インフラ移行待ち', owner: 'suzuki', days_blocked: 14 },
                    { type: 'overdue', severity: 'warning', project: 'brainbase', task: 'ドキュメント整備', owner: 'sato', days_overdue: 2 }
                ],
                total_critical: 3,
                total_warning: 1
            });
        }

        const config = await configParser.getAll();
        const projects = (config.projects?.projects || [])
            .filter((p) => !p.archived && p.nocodb?.project_id)
            .map((p) => ({ id: p.id, project_id: p.nocodb.project_id }));

        const alerts = await nocodbService.getCriticalAlerts(projects);

        res.json(alerts);
    }));

    /**
     * GET /api/brainbase/strategic-overview
     * 戦略的意思決定支援情報（プロジェクト優先度 + リソース配分）
     */
    router.get('/strategic-overview', cacheMiddleware(300), asyncHandler(async (req, res) => {
        const config = await configParser.getAll();
        const projects = (config.projects?.projects || [])
            .filter((p) => !p.archived && p.nocodb?.project_id)
            .map((p) => ({ id: p.id, project_id: p.nocodb.project_id }));

        const stats = await Promise.all(
            projects.map((p) => nocodbService.getProjectStats(p.project_id))
        );

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

            let trend = 'stable';
            let change = 0;
            if (healthScore >= 80) {
                trend = 'up';
                change = Math.floor(Math.random() * 5) + 1;
            } else if (healthScore < 60) {
                trend = 'down';
                change = -(Math.floor(Math.random() * 8) + 1);
            }

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

        const bottlenecks = detectBottlenecks(projectsWithScore);

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

        const config = await configParser.getAll();
        const projects = config.projects?.projects || [];

        const project = projects.find((p) => p.id === id);

        if (!project || project.archived || !project.nocodb?.project_id) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project '${id}' not found or archived`
            });
        }

        const stats = await nocodbService.getProjectStats(project.nocodb.project_id);

        res.json(stats);
    }));

    async function getGitHubInfo() {
        const [runners, workflows] = await Promise.all([
            githubService.getSelfHostedRunners(),
            githubService.getWorkflowRuns(5)
        ]);

        return {
            runners,
            workflows
        };
    }

    async function getTasksInfo() {
        if (!taskParser) {
            return { error: 'TaskParser not initialized' };
        }

        try {
            const tasks = await taskParser.getTasks();
            const total = tasks.length;
            const completed = tasks.filter((t) => t.status === 'completed').length;
            const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
            const pending = tasks.filter((t) => t.status === 'pending').length;
            const blocked = tasks.filter((t) => t.status === 'blocked').length;

            const now = new Date();
            const overdue = tasks.filter((t) => {
                if (t.status === 'completed') return false;
                if (!t.deadline) return false;
                return new Date(t.deadline) < now;
            });

            const focus = tasks.find((t) => t.focus) || null;

            return {
                total,
                completed,
                inProgress,
                pending,
                blocked,
                overdue: overdue.length,
                overdueList: overdue.slice(0, 5).map((t) => ({
                    title: t.title,
                    deadline: t.deadline,
                    status: t.status
                })),
                focus: focus ? {
                    title: focus.title,
                    status: focus.status,
                    deadline: focus.deadline
                } : null
            };
        } catch (error) {
            logger.error('Error parsing tasks', { error });
            return { error: 'Failed to parse tasks' };
        }
    }

    async function getWorktreesInfo() {
        if (!worktreeService) {
            return { error: 'WorktreeService not initialized' };
        }

        try {
            const worktrees = await worktreeService.listWorktrees();
            const active = worktrees.filter((w) => w.branch !== 'main' && w.branch !== 'master');

            const uncommitted = [];
            for (const wt of active) {
                void wt;
            }

            return {
                total: worktrees.length,
                active: active.length,
                uncommitted: uncommitted.length,
                list: active.slice(0, 5).map((wt) => ({
                    branch: wt.branch,
                    path: wt.path
                }))
            };
        } catch (error) {
            logger.error('Error getting worktrees', { error });
            return { error: 'Failed to get worktrees' };
        }
    }

    async function getProjectsWithHealth() {
        try {
            const config = await configParser.getAll();
            const projects = (config.projects?.projects || [])
                .filter((p) => !p.archived && p.nocodb?.project_id)
                .map((p) => ({ id: p.id, project_id: p.nocodb.project_id }));

            const stats = await Promise.all(
                projects.map((p) => nocodbService.getProjectStats(p.project_id))
            );

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
                    manaScore: 92
                };
            });

            return healthScores.sort((a, b) => b.healthScore - a.healthScore);
        } catch (error) {
            logger.error('Error getting projects health', { error });
            return [];
        }
    }

    return router;
}

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

function detectBottlenecks(projects) {
    const bottlenecks = [];

    const totalTasks = projects.reduce((sum, p) => sum + (p.overdue + p.blocked), 0);
    const avgTasks = totalTasks / projects.length;

    projects.forEach((project) => {
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

    const criticalProjects = projects.filter((p) => p.health_score < 60);
    if (criticalProjects.length >= projects.length * 0.3) {
        bottlenecks.push({
            type: 'overall_resource_shortage',
            affected_projects: criticalProjects.length,
            recommendation: '複数プロジェクトで健全性低下。全体的なリソース見直しが必要'
        });
    }

    return bottlenecks;
}
