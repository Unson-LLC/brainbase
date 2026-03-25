/**
 * ConfigController
 * 設定管理のHTTPリクエスト処理
 */
import { asyncHandler } from '../lib/async-handler.js';
import { AppError } from '../lib/errors.js';

export class ConfigController {
    constructor(configParser, configService) {
        this.configParser = configParser;
        this.configService = configService;
    }

    /**
     * GET /api/config
     * すべての設定を取得
     * OSS版対応: Mana拡張（Slack/GitHub/NocoDB）が未定義の場合は null を返す
     */
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
    getWorkspaces = asyncHandler(async (req, res) => {
        const workspaces = await this.configParser.getWorkspaces();
        res.json(workspaces);
    });

    /** GET /api/config/slack/channels */
    getChannels = asyncHandler(async (req, res) => {
        const channels = await this.configParser.getChannels();
        res.json(channels);
    });

    /** GET /api/config/slack/members */
    getMembers = asyncHandler(async (req, res) => {
        const members = await this.configParser.getMembers();
        res.json(members);
    });

    /** GET /api/config/projects */
    getProjects = asyncHandler(async (req, res) => {
        const projects = await this.configParser.getProjects();
        res.json(projects);
    });

    /** POST /api/config/projects, PUT /api/config/projects/:projectId */
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
        });

        res.json({ ok: true });
    });

    /** DELETE /api/config/projects/:projectId */
    deleteProject = asyncHandler(async (req, res) => {
        this._requireConfigService();
        await this.configService.deleteProject(req.params.projectId);
        res.json({ ok: true });
    });

    /** GET /api/config/github */
    getGitHub = asyncHandler(async (req, res) => {
        const github = await this.configParser.getGitHubMappings();
        res.json(github);
    });

    /**
     * GET /api/config/integrity
     * OSS版対応: Mana拡張の統計が未定義の場合は 0 を返す
     */
    checkIntegrity = asyncHandler(async (req, res) => {
        const integrity = await this.configParser.checkIntegrity();

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
    getUnified = asyncHandler(async (req, res) => {
        const unified = await this.configParser.getUnifiedView();
        res.json(unified || null);
    });

    /** GET /api/config/root */
    getRoot = asyncHandler(async (req, res) => {
        const projectConfig = await this.configParser.getProjects();
        res.json({ root: projectConfig.root });
    });

    /** GET /api/config/plugins */
    getPlugins = asyncHandler(async (req, res) => {
        const plugins = await this.configParser.getPlugins();
        res.json(plugins);
    });

    /** GET /api/config/organizations */
    getOrganizations = asyncHandler(async (req, res) => {
        const organizations = await this.configParser.getOrganizations();
        res.json(organizations);
    });

    /** GET /api/config/dependencies */
    getDependencies = asyncHandler(async (req, res) => {
        const dependencies = await this.configParser.getDependencies();
        res.json(dependencies);
    });

    /** GET /api/config/notifications */
    getNotifications = asyncHandler(async (req, res) => {
        const notifications = await this.configParser.getNotifications();
        res.json(notifications);
    });

    /** POST /api/config/organizations, PUT /api/config/organizations/:orgId */
    upsertOrganization = asyncHandler(async (req, res) => {
        this._requireConfigService();

        const payload = req.body || {};
        const orgId = req.params.orgId || payload.id;
        const projects = Array.isArray(payload.projects)
            ? payload.projects
            : String(payload.projects || '')
                .split(',')
                .map(p => p.trim())
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
    deleteOrganization = asyncHandler(async (req, res) => {
        this._requireConfigService();
        await this.configService.deleteOrganization(req.params.orgId);
        res.json({ ok: true });
    });

    /** PUT /api/config/notifications */
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
    upsertGitHub = asyncHandler(async (req, res) => {
        const payload = req.body || {};
        const projectId = req.params.projectId || payload.project_id;
        const mapping = await this.configService.upsertGitHubMapping({
            project_id: projectId,
            owner: payload.owner,
            repo: payload.repo,
            branch: payload.branch
        });
        res.json({ ok: true, github: mapping });
    });

    /** DELETE /api/config/github/:projectId */
    deleteGitHub = asyncHandler(async (req, res) => {
        await this.configService.deleteGitHubMapping(req.params.projectId);
        res.json({ ok: true });
    });

    /** POST /api/config/nocodb, PUT /api/config/nocodb/:projectId */
    upsertNocoDB = asyncHandler(async (req, res) => {
        const payload = req.body || {};
        const projectId = req.params.projectId || payload.project_id;
        const mapping = await this.configService.upsertNocoDBMapping({
            project_id: projectId,
            base_id: payload.base_id,
            nocodb_project_id: payload.nocodb_project_id,
            base_name: payload.base_name,
            url: payload.url
        });
        res.json({ ok: true, nocodb: mapping });
    });

    /** DELETE /api/config/nocodb/:projectId */
    deleteNocoDB = asyncHandler(async (req, res) => {
        await this.configService.deleteNocoDBMapping(req.params.projectId);
        res.json({ ok: true });
    });

    _requireConfigService() {
        if (!this.configService) {
            throw AppError.internal('Config service unavailable');
        }
    }
}
