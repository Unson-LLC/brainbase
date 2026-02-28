/**
 * ConfigController
 * 設定管理のHTTPリクエスト処理
 */
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
    getAll = async (req, res) => {
        try {
            const config = await this.configParser.getAll();

            // OSS版対応: Slack/GitHub/NocoDB が undefined の場合は null を返す
            const sanitized = {
                projects: config.projects || { root: '', projects_root: '', projects: [] },
                slack: config.slack || null,
                github: config.github || null,
                nocodb: config.nocodb || null,
                airtable: config.airtable || null,  // 後方互換性
                plugins: config.plugins || { enabled: [], disabled: [] }
            };

            res.json(sanitized);
        } catch (error) {
            console.error('Failed to get config:', error);
            res.status(500).json({ error: 'Failed to get config' });
        }
    };

    /**
     * GET /api/config/slack/workspaces
     * Slackワークスペースを取得
     */
    getWorkspaces = async (req, res) => {
        try {
            const workspaces = await this.configParser.getWorkspaces();
            res.json(workspaces);
        } catch (error) {
            console.error('Failed to get workspaces:', error);
            res.status(500).json({ error: 'Failed to get workspaces' });
        }
    };

    /**
     * GET /api/config/slack/channels
     * Slackチャンネルを取得
     */
    getChannels = async (req, res) => {
        try {
            const channels = await this.configParser.getChannels();
            res.json(channels);
        } catch (error) {
            console.error('Failed to get channels:', error);
            res.status(500).json({ error: 'Failed to get channels' });
        }
    };

    /**
     * GET /api/config/slack/members
     * Slackメンバーを取得
     */
    getMembers = async (req, res) => {
        try {
            const members = await this.configParser.getMembers();
            res.json(members);
        } catch (error) {
            console.error('Failed to get members:', error);
            res.status(500).json({ error: 'Failed to get members' });
        }
    };

    /**
     * GET /api/config/projects
     * プロジェクトを取得
     */
    getProjects = async (req, res) => {
        try {
            const projects = await this.configParser.getProjects();
            res.json(projects);
        } catch (error) {
            console.error('Failed to get projects:', error);
            res.status(500).json({ error: 'Failed to get projects' });
        }
    };

    /**
     * POST /api/config/projects
     * PUT /api/config/projects/:projectId
     * プロジェクトを作成・更新
     */
    upsertProject = async (req, res) => {
        try {
            if (!this.configService) {
                throw new Error('Config service unavailable');
            }

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
        } catch (error) {
            console.error('Failed to upsert project:', error);
            res.status(400).json({ error: error.message || 'Failed to upsert project' });
        }
    };

    /**
     * DELETE /api/config/projects/:projectId
     * プロジェクトを削除
     */
    deleteProject = async (req, res) => {
        try {
            if (!this.configService) {
                throw new Error('Config service unavailable');
            }

            await this.configService.deleteProject(req.params.projectId);
            res.json({ ok: true });
        } catch (error) {
            console.error('Failed to delete project:', error);
            res.status(400).json({ error: error.message || 'Failed to delete project' });
        }
    };

    /**
     * GET /api/config/github
     * GitHub設定を取得
     */
    getGitHub = async (req, res) => {
        try {
            const github = await this.configParser.getGitHubMappings();
            res.json(github);
        } catch (error) {
            console.error('Failed to get GitHub config:', error);
            res.status(500).json({ error: 'Failed to get GitHub config' });
        }
    };

    /**
     * GET /api/config/integrity
     * 整合性チェック
     * OSS版対応: Mana拡張の統計が未定義の場合は 0 を返す
     */
    checkIntegrity = async (req, res) => {
        try {
            const integrity = await this.configParser.checkIntegrity();

            // OSS版対応: Slack/GitHub/NocoDBの統計を0にする
            const sanitized = {
                ...integrity,
                stats: {
                    workspaces: integrity.stats?.workspaces || 0,
                    channels: integrity.stats?.channels || 0,
                    members: integrity.stats?.members || 0,
                    projects: integrity.stats?.projects || 0,
                    github: integrity.stats?.github || 0,
                    nocodb: integrity.stats?.nocodb || 0
                }
            };

            res.json(sanitized);
        } catch (error) {
            console.error('Failed to check integrity:', error);
            res.status(500).json({ error: 'Failed to check integrity' });
        }
    };

    /**
     * GET /api/config/unified
     * 統合ビューを取得
     * OSS版対応: Mana拡張データが未定義の場合は null を返す
     */
    getUnified = async (req, res) => {
        try {
            const unified = await this.configParser.getUnifiedView();

            // OSS版対応: Mana拡張データが存在しない場合に備えて sanitize
            // unified view の構造を保持しつつ、undefined を null に変換
            res.json(unified || null);
        } catch (error) {
            console.error('Failed to get unified view:', error);
            res.status(500).json({ error: 'Failed to get unified view' });
        }
    };

    /**
     * GET /api/config/root
     * BRAINBASE_ROOT（ワークスペースルートディレクトリ）を取得
     */
    getRoot = async (req, res) => {
        try {
            const projectConfig = await this.configParser.getProjects();
            res.json({ root: projectConfig.root });
        } catch (error) {
            console.error('Error fetching root:', error);
            res.status(500).json({ error: 'Failed to fetch root directory' });
        }
    };

    /**
     * GET /api/config/plugins
     * UI Plugin設定を取得
     * @returns {{ enabled: string[] }} - 有効なプラグインID一覧
     */
    getPlugins = async (req, res) => {
        try {
            const plugins = await this.configParser.getPlugins();
            res.json(plugins);
        } catch (error) {
            console.error('Failed to get plugins config:', error);
            res.status(500).json({ error: 'Failed to get plugins config' });
        }
    };

    /**
     * GET /api/config/organizations
     * Organizations（法人）設定を取得
     */
    getOrganizations = async (req, res) => {
        try {
            const organizations = await this.configParser.getOrganizations();
            res.json(organizations);
        } catch (error) {
            console.error('Failed to get organizations:', error);
            res.status(500).json({ error: 'Failed to get organizations' });
        }
    };

    /**
     * GET /api/config/dependencies
     * Dependencies（依存関係）設定を取得
     */
    getDependencies = async (req, res) => {
        try {
            const dependencies = await this.configParser.getDependencies();
            res.json(dependencies);
        } catch (error) {
            console.error('Failed to get dependencies:', error);
            res.status(500).json({ error: 'Failed to get dependencies' });
        }
    };

    /**
     * GET /api/config/notifications
     * Notifications（通知）設定を取得
     */
    getNotifications = async (req, res) => {
        try {
            const notifications = await this.configParser.getNotifications();
            res.json(notifications);
        } catch (error) {
            console.error('Failed to get notifications:', error);
            res.status(500).json({ error: 'Failed to get notifications' });
        }
    };

    /**
     * POST /api/config/organizations
     * PUT /api/config/organizations/:orgId
     * Organizationsを作成・更新
     */
    upsertOrganization = async (req, res) => {
        try {
            if (!this.configService) {
                throw new Error('Config service unavailable');
            }

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
        } catch (error) {
            console.error('Failed to upsert organization:', error);
            res.status(400).json({ error: error.message || 'Failed to upsert organization' });
        }
    };

    /**
     * DELETE /api/config/organizations/:orgId
     * Organizationを削除
     */
    deleteOrganization = async (req, res) => {
        try {
            if (!this.configService) {
                throw new Error('Config service unavailable');
            }

            await this.configService.deleteOrganization(req.params.orgId);
            res.json({ ok: true });
        } catch (error) {
            console.error('Failed to delete organization:', error);
            res.status(400).json({ error: error.message || 'Failed to delete organization' });
        }
    };

    /**
     * PUT /api/config/notifications
     * Notificationsを更新
     */
    updateNotifications = async (req, res) => {
        try {
            if (!this.configService) {
                throw new Error('Config service unavailable');
            }

            const payload = req.body || {};
            const notifications = await this.configService.updateNotifications({
                channels: payload.channels,
                dnd: payload.dnd
            });

            res.json({ ok: true, notifications });
        } catch (error) {
            console.error('Failed to update notifications:', error);
            res.status(400).json({ error: error.message || 'Failed to update notifications' });
        }
    };

    /**
     * POST /api/config/github
     * PUT /api/config/github/:projectId
     * GitHubマッピングを作成・更新
     */
    upsertGitHub = async (req, res) => {
        try {
            const payload = req.body || {};
            const projectId = req.params.projectId || payload.project_id;
            const mapping = await this.configService.upsertGitHubMapping({
                project_id: projectId,
                owner: payload.owner,
                repo: payload.repo,
                branch: payload.branch
            });
            res.json({ ok: true, github: mapping });
        } catch (error) {
            console.error('Failed to upsert GitHub mapping:', error);
            res.status(400).json({ error: error.message || 'Failed to upsert GitHub mapping' });
        }
    };

    /**
     * DELETE /api/config/github/:projectId
     * GitHubマッピングを削除
     */
    deleteGitHub = async (req, res) => {
        try {
            await this.configService.deleteGitHubMapping(req.params.projectId);
            res.json({ ok: true });
        } catch (error) {
            console.error('Failed to delete GitHub mapping:', error);
            res.status(400).json({ error: error.message || 'Failed to delete GitHub mapping' });
        }
    };

    /**
     * POST /api/config/nocodb
     * PUT /api/config/nocodb/:projectId
     * NocoDBマッピングを作成・更新
     */
    upsertNocoDB = async (req, res) => {
        try {
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
        } catch (error) {
            console.error('Failed to upsert NocoDB mapping:', error);
            res.status(400).json({ error: error.message || 'Failed to upsert NocoDB mapping' });
        }
    };

    /**
     * DELETE /api/config/nocodb/:projectId
     * NocoDBマッピングを削除
     */
    deleteNocoDB = async (req, res) => {
        try {
            await this.configService.deleteNocoDBMapping(req.params.projectId);
            res.json({ ok: true });
        } catch (error) {
            console.error('Failed to delete NocoDB mapping:', error);
            res.status(400).json({ error: error.message || 'Failed to delete NocoDB mapping' });
        }
    };
}
