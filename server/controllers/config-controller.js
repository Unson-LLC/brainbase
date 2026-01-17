/**
 * ConfigController
 * 設定管理のHTTPリクエスト処理
 */
export class ConfigController {
    constructor(configParser) {
        this.configParser = configParser;
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
     * GET /api/config/plugins
     * Plugin設定を取得
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
     * GET /api/config/env
     * 環境変数の存在チェック（値は返さない）
     */
    getEnvStatus = async (req, res) => {
        try {
            const keysParam = req.query.keys || '';
            const keys = String(keysParam)
                .split(',')
                .map(key => key.trim())
                .filter(Boolean);

            const status = {};
            keys.forEach(key => {
                status[key] = Boolean(process.env[key]);
            });

            res.json({ keys: status });
        } catch (error) {
            console.error('Failed to get env status:', error);
            res.status(500).json({ error: 'Failed to get env status' });
        }
    };
}
