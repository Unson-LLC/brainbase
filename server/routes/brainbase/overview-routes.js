import express from 'express';
import { logger } from '../../utils/logger.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { filterProjectsForAccess } from '../../services/project-access/project-code-matcher.js';
import { createRetiredCapabilityRouter } from '../retired-capability.js';

const NOCODB_AUXILIARY_RETIREMENT = {
    capability: 'brainbase.nocodb-auxiliary',
    owner: 'Canonical Graph and Task APIs',
    replacement: 'Use the Graph project catalog and Canonical Task APIs'
};

export function createBrainbaseOverviewRouter(options = {}) {
    const router = express.Router();
    const {
        githubService,
        systemService,
        storageService,
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

    // These endpoints only exposed NocoDB projections. Keep the paths explicit
    // so callers do not mistake an empty projection for a healthy response.
    router.use('/critical-alerts', createRetiredCapabilityRouter(NOCODB_AUXILIARY_RETIREMENT));
    router.use('/strategic-overview', createRetiredCapabilityRouter(NOCODB_AUXILIARY_RETIREMENT));
    router.use('/projects/:id/stats', createRetiredCapabilityRouter(NOCODB_AUXILIARY_RETIREMENT));

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

            const healthyProjects = projects
                .map((project) => project.project_id
                    ? {
                        id: project.id,
                        name: project.name,
                        hasNocodb: true,
                        healthStatus: 'unavailable',
                        healthSource: 'nocodb_retired',
                        healthScore: null,
                        overdue: null,
                        blocked: null,
                        completionRate: null,
                        manaScore: null
                    }
                    : {
                        id: project.id,
                        name: project.name,
                        hasNocodb: false,
                        healthStatus: 'unmapped',
                        healthSource: 'nocodb_retired',
                        healthScore: null,
                        overdue: null,
                        blocked: null,
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
