import express from 'express';
import { logger } from '../../utils/logger.js';
import { cacheMiddleware } from '../../middleware/cache.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { filterProjectsForAccess } from '../../services/project-access/project-code-matcher.js';

export function createBrainbaseOverviewRouter(options = {}) {
    const router = express.Router();
    const {
        githubService,
        systemService,
        storageService,
        nocodbService,
        configParser,
        projectCatalogParser = configParser,
        projectCatalogAuthGuard = (_req, res) => res.status(503).json({
            error: 'Project catalog authentication is not configured'
        })
    } = options;
    const isRuntimeCatalog = typeof projectCatalogParser?.runForOrganization === 'function';

    /**
     * GET /api/brainbase
     * すべての監視情報を一括取得
     */
    router.get('/', projectCatalogAuthGuard, asyncHandler(async (req, res) => {
        const access = req.access || null;
        const organizationId = access?.organizationId || access?.tenantId || null;
        const [github, system, projects] = await Promise.all([
            getGitHubInfo(),
            systemService.getSystemStatus(),
            getProjectsWithHealth(access, organizationId, { requireLoadedSource: isRuntimeCatalog })
        ]);
        res.json({
            github,
            system,
            projects: projects.projects,
            ...(projects.source ? { source: projects.source } : {}),
            timestamp: new Date().toISOString()
        });
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

    router.get('/worktrees', (req, res) => {
        res.status(410).json({
            error: 'capability_retired',
            capability: 'brainbase.worktree-status',
            owner: 'Codex app and CLI',
            replacement: 'Use Codex task and worktree status directly'
        });
    });

    router.get('/projects', projectCatalogAuthGuard, asyncHandler(async (req, res) => {
        const access = req.access || {};
        const organizationId = access.organizationId || access.tenantId || null;
        const catalog = await getProjectsWithHealth(access, organizationId, {
            requireLoadedSource: isRuntimeCatalog
        });

        // Keep the legacy bare-array response for parsers that do not expose a
        // catalog source. Registry-backed catalogs use the envelope so source
        // status (including an unavailable fallback) is not lost at this API
        // boundary.
        res.json(catalog.source ? catalog : catalog.projects);
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

    async function getProjectsWithHealth(access = null, organizationId = null, { requireLoadedSource = false } = {}) {
        try {
            if (requireLoadedSource && !organizationId) {
                return {
                    projects: [],
                    source: { status: 'organization_context_required', mode: 'registry_scope_required' }
                };
            }
            const loadCatalog = async () => {
                if (typeof projectCatalogParser.getProjects === 'function') {
                    return projectCatalogParser.getProjects();
                }
                const legacyConfig = await projectCatalogParser.getAll();
                return legacyConfig.projects || { projects: [] };
            };
            const config = organizationId && projectCatalogParser?.runForOrganization
                ? await projectCatalogParser.runForOrganization(organizationId, loadCatalog)
                : await loadCatalog();
            const source = config?.source || (requireLoadedSource
                ? { status: 'runtime_catalog_source_required', mode: 'runtime_catalog_source_required' }
                : null);
            if (requireLoadedSource && source.status !== 'loaded') {
                return { projects: [], source };
            }
            const activeProjects = (config.projects || []).filter((p) => !p.archived);
            const accessibleProjects = access && typeof access === 'object'
                ? filterProjectsForAccess(activeProjects, access)
                : activeProjects;
            const projects = accessibleProjects
                .map((p) => ({
                    id: p.id,
                    name: p.name || p.id,
                    project_id: p.nocodb?.project_id || null
                }));

            const mappedProjects = projects.filter((p) => p.project_id);

            const statsResults = await Promise.allSettled(
                mappedProjects.map((p) => nocodbService.getProjectStats(p.project_id))
            );

            const healthById = new Map(statsResults.map((result, i) => {
                const project = mappedProjects[i];
                if (result.status === 'rejected') {
                    logger.warn('Failed to get project stats', {
                        project: project.id,
                        project_id: project.project_id,
                        error: result.reason?.message || String(result.reason)
                    });
                    return [project.id, {
                        id: project.id,
                        name: project.name,
                        hasNocodb: true,
                        healthStatus: 'unavailable',
                        healthScore: null,
                        overdue: 0,
                        blocked: 0,
                        completionRate: null,
                        manaScore: null
                    }];
                }

                const stat = result.value;
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

                return [project.id, {
                    id: project.id,
                    name: project.name,
                    hasNocodb: true,
                    healthStatus: 'mapped',
                    healthScore,
                    overdue: stat.overdue,
                    blocked: stat.blocked,
                    completionRate: taskCompletion,
                    manaScore: 92
                }];
            }));

            const healthyProjects = projects
                .map((project) => healthById.get(project.id) || {
                    id: project.id,
                    name: project.name,
                    hasNocodb: false,
                    healthStatus: 'unmapped',
                    healthScore: null,
                    overdue: 0,
                    blocked: 0,
                    completionRate: null,
                    manaScore: null
                })
                .sort((a, b) => {
                    if (a.hasNocodb !== b.hasNocodb) return a.hasNocodb ? -1 : 1;
                    const aHasScore = Number.isFinite(a.healthScore);
                    const bHasScore = Number.isFinite(b.healthScore);
                    if (aHasScore !== bHasScore) return aHasScore ? -1 : 1;
                    if (aHasScore) return b.healthScore - a.healthScore;
                    return a.name.localeCompare(b.name);
                });

            return {
                projects: healthyProjects,
                ...(source ? { source } : {})
            };
        } catch (error) {
            logger.error('Error getting projects health', { error });
            throw error;
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
