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
     */
    getAll = async (req, res) => {
        try {
            const config = await this.configParser.getAll();
            res.json(config);
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
     * GET /api/config/integrity
     * 整合性チェック
     */
    checkIntegrity = async (req, res) => {
        try {
            const result = await this.configParser.checkIntegrity();
            res.json(result);
        } catch (error) {
            console.error('Failed to check integrity:', error);
            res.status(500).json({ error: 'Failed to check integrity' });
        }
    };

    /**
     * GET /api/config/unified
     * 統合ビューを取得
     */
    getUnified = async (req, res) => {
        try {
            const unified = await this.configParser.getUnifiedView();
            res.json(unified);
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
}
