// @ts-check
/**
 * ConfigController
 * 設定管理のHTTPリクエスト処理
 */
import { asyncHandler } from '../lib/async-handler.js';
import { AppError } from '../lib/errors.js';
import { filterProjectsForAccess } from '../services/project-access/project-code-matcher.js';

/** @typedef {any} Request */
/** @typedef {any} Response */

export class ConfigController {
    /**
     * @param {any} configParser
     * @param {any} configService
     */
    constructor(configParser, configService, runtimePaths = null, projectCatalogParser = configParser) {
        this.configParser = configParser;
        this.projectCatalogParser = projectCatalogParser;
        this.configService = configService;
        this.runtimePaths = runtimePaths;
    }

    _projectAccess(req) {
        return req.access || {};
    }

    /**
     * GET /api/config
     * すべての設定を取得
     * OSS版対応: Mana拡張（Slack/GitHub/NocoDB）が未定義の場合は null を返す
     */
    /** @param {Request} req @param {Response} res */
    getAll = asyncHandler(async (req, res) => {
        const config = await this.configParser.getAll();

        res.json({
            projects: config.projects || { root: '', projects_root: '', projects: [] },
            slack: config.slack || null,
            github: config.github || null,
            nocodb: config.nocodb || null,
            airtable: config.airtable || null,
            plugins: config.plugins || { enabled: [], disabled: [] }
        });
    });

    /** GET /api/config/slack/workspaces */
    /** @param {Request} req @param {Response} res */
    getWorkspaces = asyncHandler(async (req, res) => {
        const workspaces = await this.configParser.getWorkspaces();
        res.json(workspaces);
    });

    /** GET /api/config/slack/channels */
    /** @param {Request} req @param {Response} res */
    getChannels = asyncHandler(async (req, res) => {
        const channels = await this.configParser.getChannels();
        res.json(channels);
    });

    /** GET /api/config/slack/members */
    /** @param {Request} req @param {Response} res */
    getMembers = asyncHandler(async (req, res) => {
        const members = await this.configParser.getMembers();
        res.json(members);
    });

    /** GET /api/config/projects */
    /** @param {Request} req @param {Response} res */
    getProjects = asyncHandler(async (req, res) => {
        const organizationId = req.access?.organizationId || req.access?.tenantId || null;
        const isRuntimeCatalog = typeof this.projectCatalogParser?.runForOrganization === 'function';
        if (isRuntimeCatalog && !organizationId) {
            return res.json({
                projects: [],
                source: { status: 'organization_context_required', mode: 'registry_scope_required' }
            });
        }
        const catalog = organizationId && this.projectCatalogParser?.runForOrganization
            ? await this.projectCatalogParser.runForOrganization(
                organizationId,
                () => this.projectCatalogParser.getProjects()
            )
            : await this.projectCatalogParser.getProjects();
        const source = catalog?.source || (isRuntimeCatalog
            ? { status: 'runtime_catalog_source_required', mode: 'runtime_catalog_source_required' }
            : null);
        const projects = isRuntimeCatalog && source?.status !== 'loaded'
            ? []
            : filterProjectsForAccess(catalog.projects || [], req.access || {});
        res.json({
            ...catalog,
            ...(source ? { source } : {}),
            projects
        });
    });

    /** POST /api/config/project-profiles */
    /** @param {Request} req @param {Response} res */
    createProjectProfile = asyncHandler(async (req, res) => {
        this._requireConfigService();
        const access = this._projectAccess(req);
        const project = await this.configService.createProjectProfile(req.body || {}, access);
        const inspection = this.configService.inspectProjectRecord(project);
        res.status(201).json({ ok: true, project, inspection });
    });

    /** PUT /api/config/project-profiles/:projectCode */
    /** @param {Request} req @param {Response} res */
    configureProjectProfile = asyncHandler(async (req, res) => {
        this._requireConfigService();
        const project = await this.configService.configureProjectProfile(
            req.params.projectCode,
            req.body || {},
            this._projectAccess(req)
        );
        const inspection = await this.configService.inspectProjectProfile(
            req.params.projectCode,
            this._projectAccess(req)
        );
        res.json({ ok: true, project, inspection });
    });

    /** GET /api/config/project-profiles/:projectCode/inspect */
    /** @param {Request} req @param {Response} res */
    inspectProjectProfile = asyncHandler(async (req, res) => {
        this._requireConfigService();
        res.json(await this.configService.inspectProjectProfile(
            req.params.projectCode,
            this._projectAccess(req)
        ));
    });

    /** POST /api/config/project-profiles/:projectCode/reconcile */
    /** @param {Request} req @param {Response} res */
    reconcileProjectProfile = asyncHandler(async (req, res) => {
        this._requireConfigService();
        const result = await this.configService.reconcileProjectProfile(
            req.params.projectCode,
            req.body?.people_candidates,
            this._projectAccess(req)
        );
        res.json(result);
    });

    /** POST /api/config/projects, PUT /api/config/projects/:projectId */
    /** @param {Request} req @param {Response} res */
    upsertProject = asyncHandler(async (req, res) => {
        this._requireConfigService();

        const payload = req.body || {};
        const projectId = req.params.projectId || payload.id;
        const glob = Array.isArray(payload.glob_include)
            ? payload.glob_include
            : String(payload.glob_include || '')
                .split(/\r?\n|,/)
                .map(entry => entry.trim())
                .filter(Boolean);

        await this.configService.upsertProject({
            id: projectId,
            emoji: payload.emoji,
            local_path: payload.local_path,
            glob_include: glob,
            archived: payload.archived
        }, this._projectAccess(req));

        res.json({ ok: true });
    });

    /** DELETE /api/config/projects/:projectId */
    /** @param {Request} req @param {Response} res */
    deleteProject = asyncHandler(async (req, res) => {
        this._requireConfigService();
        await this.configService.deleteProject(req.params.projectId, this._projectAccess(req));
        res.json({ ok: true });
    });

    /** GET /api/config/github */
    /** @param {Request} req @param {Response} res */
    getGitHub = asyncHandler(async (req, res) => {
        const github = await this.configParser.getGitHubMappings();
        res.json(github);
    });

    /**
     * GET /api/config/integrity
     * OSS版対応: Mana拡張の統計が未定義の場合は 0 を返す
     */
    /** @param {Request} req @param {Response} res */
    checkIntegrity = asyncHandler(async (req, res) => {
        const organizationId = req.access?.organizationId || req.access?.tenantId || null;
        const integrity = organizationId && this.projectCatalogParser?.runForOrganization
            ? await this.projectCatalogParser.runForOrganization(
                organizationId,
                () => this.projectCatalogParser.checkIntegrity()
            )
            : await this.projectCatalogParser.checkIntegrity();

        res.json({
            ...integrity,
            stats: {
                workspaces: integrity.stats?.workspaces || 0,
                channels: integrity.stats?.channels || 0,
                members: integrity.stats?.members || 0,
                projects: integrity.stats?.projects || 0,
                github: integrity.stats?.github || 0,
                nocodb: integrity.stats?.nocodb || 0
            }
        });
    });

    /**
     * GET /api/config/unified
     * OSS版対応: Mana拡張データが未定義の場合は null を返す
     */
    /** @param {Request} req @param {Response} res */
    getUnified = asyncHandler(async (req, res) => {
        const unified = await this.configParser.getUnifiedView();
        res.json(unified || null);
    });

    /** GET /api/config/root */
    /** @param {Request} req @param {Response} res */
    getRoot = asyncHandler(async (req, res) => {
        const projectConfig = await this.configParser.getProjects();
        res.json({
            root: projectConfig.root,
            brainbaseVarDir: this.runtimePaths?.varDir || process.env.BRAINBASE_VAR_DIR || null,
            stateFile: this.runtimePaths?.stateFile || process.env.BRAINBASE_STATE_PATH || null
        });
    });

    /** GET /api/config/plugins */
    /** @param {Request} req @param {Response} res */
    getPlugins = asyncHandler(async (req, res) => {
        const plugins = await this.configParser.getPlugins();
        res.json(plugins);
    });

    /** GET /api/config/organizations */
    /** @param {Request} req @param {Response} res */
    getOrganizations = asyncHandler(async (req, res) => {
        const organizations = await this.configParser.getOrganizations();
        res.json(organizations);
    });

    /** GET /api/config/dependencies */
    /** @param {Request} req @param {Response} res */
    getDependencies = asyncHandler(async (req, res) => {
        const dependencies = await this.configParser.getDependencies();
        res.json(dependencies);
    });

    /** GET /api/config/notifications */
    /** @param {Request} req @param {Response} res */
    getNotifications = asyncHandler(async (req, res) => {
        const notifications = await this.configParser.getNotifications();
        res.json(notifications);
    });

    /** POST /api/config/organizations, PUT /api/config/organizations/:orgId */
    /** @param {Request} req @param {Response} res */
    upsertOrganization = asyncHandler(async (req, res) => {
        this._requireConfigService();

        const payload = req.body || {};
        const orgId = req.params.orgId || payload.id;
        const projects = Array.isArray(payload.projects)
            ? payload.projects
            : String(payload.projects || '')
                .split(',')
                .map((p) => p.trim())
                .filter(Boolean);

        const organization = await this.configService.upsertOrganization({
            id: orgId,
            name: payload.name,
            ceo: payload.ceo,
            projects
        });

        res.json({ ok: true, organization });
    });

    /** DELETE /api/config/organizations/:orgId */
    /** @param {Request} req @param {Response} res */
    deleteOrganization = asyncHandler(async (req, res) => {
        this._requireConfigService();
        await this.configService.deleteOrganization(req.params.orgId);
        res.json({ ok: true });
    });

    /** PUT /api/config/notifications */
    /** @param {Request} req @param {Response} res */
    updateNotifications = asyncHandler(async (req, res) => {
        this._requireConfigService();

        const payload = req.body || {};
        const notifications = await this.configService.updateNotifications({
            channels: payload.channels,
            dnd: payload.dnd
        });

        res.json({ ok: true, notifications });
    });

    /** POST /api/config/github, PUT /api/config/github/:projectId */
    /** @param {Request} req @param {Response} res */
    upsertGitHub = asyncHandler(async (req, res) => {
        const payload = req.body || {};
        const projectId = req.params.projectId || payload.project_id;
        const mapping = await this.configService.upsertGitHubMapping({
            project_id: projectId,
            owner: payload.owner,
            repo: payload.repo,
            branch: payload.branch
        }, this._projectAccess(req));
        res.json({ ok: true, github: mapping });
    });

    /** DELETE /api/config/github/:projectId */
    /** @param {Request} req @param {Response} res */
    deleteGitHub = asyncHandler(async (req, res) => {
        await this.configService.deleteGitHubMapping(req.params.projectId, this._projectAccess(req));
        res.json({ ok: true });
    });

    /** POST /api/config/nocodb, PUT /api/config/nocodb/:projectId */
    /** @param {Request} req @param {Response} res */
    upsertNocoDB = asyncHandler(async (req, res) => {
        const payload = req.body || {};
        const projectId = req.params.projectId || payload.project_id;
        const mapping = await this.configService.upsertNocoDBMapping({
            project_id: projectId,
            base_id: payload.base_id,
            nocodb_project_id: payload.nocodb_project_id,
            base_name: payload.base_name,
            url: payload.url
        }, this._projectAccess(req));
        res.json({ ok: true, nocodb: mapping });
    });

    /** DELETE /api/config/nocodb/:projectId */
    /** @param {Request} req @param {Response} res */
    deleteNocoDB = asyncHandler(async (req, res) => {
        await this.configService.deleteNocoDBMapping(req.params.projectId, this._projectAccess(req));
        res.json({ ok: true });
    });

    _requireConfigService() {
        if (!this.configService) {
            throw AppError.internal('Config service unavailable');
        }
    }
}
