/**
 * Config Parser - brainbaseの設定ファイル（YAML）を読み取り、統合ビューを提供
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

export class ConfigParser {
    constructor(codexPath, configPath, brainbaseRoot = process.env.WORKSPACE_ROOT || '/path/to/workspace', projectsRoot = null) {
        this.codexPath = codexPath;
        this.configPath = configPath;
        this.brainbaseRoot = brainbaseRoot;
        this.projectsRoot = projectsRoot || path.join(brainbaseRoot, 'projects');
        // workspaceRoot = parent directory of brainbaseRoot (where 'general' project resides)
        this.workspaceRoot = path.dirname(brainbaseRoot);
        this.slackDir = path.join(codexPath, 'common/meta/slack');
        this._configCache = null;
        this._configLoadFailed = false;
    }

    /**
     * Slackワークスペース一覧を取得
     */
    async getWorkspaces() {
        const data = await this._getSlackData('workspaces.yml');
        return data?.workspaces || {};
    }

    /**
     * Slackチャンネル一覧を取得
     */
    async getChannels() {
        const data = await this._getSlackData('channels.yml');
        return data?.channels || [];
    }

    /**
     * Slackメンバー一覧を取得
     */
    async getMembers() {
        const data = await this._getSlackData('members.yml');
        return data?.members || [];
    }

    /**
     * プロジェクト設定（config.yml）を取得
     */
    async getProjects() {
        const data = await this._getConfigData();

        // 環境変数を展開
        const projects = (data?.projects || []).map(project => {
            if (project.local && project.local.path) {
                // ${PROJECTS_ROOT:-/path/to/projects} を実際のprojectsRootに置き換え
                const expandedPath = project.local.path.replace(
                    /\$\{PROJECTS_ROOT:-[^}]+\}/g,
                    this.projectsRoot
                );
                return {
                    ...project,
                    local: {
                        ...project.local,
                        path: expandedPath
                    }
                };
            }
            return project;
        });

        return {
            root: this.workspaceRoot, // Workspace root directory (where 'general' project resides)
            projects
        };
    }

    /**
     * GitHubマッピングを取得（config.ymlから抽出）
     */
    async getGitHubMappings() {
        const data = await this._getConfigData();
        const projects = data?.projects || [];

        // githubセクションを持つプロジェクトのみ抽出
        return projects
            .filter(p => p.github)
            .map(p => ({
                project_id: p.id,
                owner: p.github.owner,
                repo: p.github.repo,
                branch: p.github.branch || 'main',
                url: `https://github.com/${p.github.owner}/${p.github.repo}`
            }));
    }

    /**
     * Airtableマッピングを取得（config.ymlから抽出）
     */
    async getAirtableMappings() {
        const data = await this._getConfigData();
        const projects = data?.projects || [];

        // airtableセクションを持つプロジェクトのみ抽出
        return projects
            .filter(p => p.airtable)
            .map(p => ({
                project_id: p.id,
                base_id: p.airtable.base_id,
                base_name: p.airtable.base_name,
                url: `https://airtable.com/${p.airtable.base_id}`
            }));
    }

    /**
     * NocoDBマッピングを取得（config.ymlから抽出）
     * 注意: NocoDB v2 APIでは nocodb.project_id がベースIDとして使われる
     *       nocodb.base_id は旧Airtable IDの場合がある
     */
    async getNocoDBMappings() {
        const data = await this._getConfigData();
        const projects = data?.projects || [];

        // nocodbセクションを持つプロジェクトのみ抽出
        // base_id: NocoDB v2 API用のベースID（project_idを優先、なければbase_id）
        return projects
            .filter(p => p.nocodb)
            .map(p => ({
                project_id: p.id,
                // NocoDB v2 APIではnocodb.project_idが実際のベースID
                // base_idはレガシーAirtable IDの可能性があるため、project_idを優先
                base_id: p.nocodb.project_id || p.nocodb.base_id,
                legacy_base_id: p.nocodb.base_id, // 旧Airtable ID（参照用）
                nocodb_project_id: p.nocodb.project_id || '', // NocoDB project/base ID
                base_name: p.nocodb.base_name,
                url: p.nocodb.url
            }));
    }

    /**
     * UI Plugins設定を取得（config.ymlから抽出）
     * @returns {Object} { enabled: string[] } - 有効なプラグインID一覧
     */
    async getPlugins() {
        const data = await this._getConfigData();
        const plugins = data?.plugins || {};

        const normalized = {
            enabled: Array.isArray(plugins.enabled) ? plugins.enabled : [],
            disabled: Array.isArray(plugins.disabled) ? plugins.disabled : []
        };

        if (this._configLoadFailed) {
            // OSSの初期状態: 必要最小限のプラグインのみ有効化
            return {
                enabled: ['bb-inbox'],
                disabled: []
            };
        }

        return normalized;
    }

    /**
     * 統合ビュー: Workspace → Project → Slack/GitHub/Airtable の関係を一覧
     */
    async getUnifiedView() {
        const [workspaces, channels, projectConfig, githubMappings, nocodbMappings] = await Promise.all([
            this.getWorkspaces(),
            this.getChannels(),
            this.getProjects(),
            this.getGitHubMappings(),
            this.getNocoDBMappings()
        ]);

        // プロジェクト情報をIDでインデックス化
        const projectsById = {};
        for (const p of projectConfig.projects) {
            projectsById[p.id] = p;
        }

        // チャンネルをproject_idでグループ化
        const channelsByProjectId = {};
        for (const ch of channels) {
            // proj_xxx → xxx に正規化
            const normalizedId = ch.project_id?.replace(/^proj_/, '') || '';
            if (!channelsByProjectId[normalizedId]) {
                channelsByProjectId[normalizedId] = [];
            }
            channelsByProjectId[normalizedId].push({
                id: ch.channel_id,
                name: ch.channel_name,
                type: ch.type || 'general',
                workspace: ch.workspace
            });
        }

        // GitHubマッピングをproject_idでインデックス化
        const githubByProjectId = {};
        for (const g of githubMappings) {
            githubByProjectId[g.project_id] = g;
        }

        // NocoDBマッピングをインデックス化
        const nocodbByProjectId = {};
        for (const n of nocodbMappings) {
            nocodbByProjectId[n.project_id] = n;
        }

        // ワークスペースごとにプロジェクトを整理
        const result = {
            workspaces: [],
            orphanedChannels: [],
            orphanedProjects: []
        };

        // 使用済みプロジェクトを追跡（正規化後のID）
        const usedProjectIds = new Set();

        // ID正規化ヘルパー: proj_zeims → zeims
        const normalizeId = (id) => id?.replace(/^proj_/, '') || '';

        for (const [wsKey, ws] of Object.entries(workspaces)) {
            const wsProjects = [];

            // ワークスペースに紐づくプロジェクトを処理
            const projectIds = ws.projects || [];
            for (const projId of projectIds) {
                // proj_zeims → zeims に正規化してマッチング
                const normalizedProjId = normalizeId(projId);
                usedProjectIds.add(normalizedProjId);

                const project = projectsById[normalizedProjId] || {};
                const github = githubByProjectId[normalizedProjId];
                const nocodb = nocodbByProjectId[normalizedProjId];
                const projectChannels = channelsByProjectId[normalizedProjId] || [];

                // glob_include からパスを抽出
                let paths = null;
                if (project.local?.glob_include) {
                    paths = project.local.glob_include.map(g => {
                        const match = g.match(/^([^*]+)/);
                        return match ? match[1].replace(/\/$/, '') + '/' : null;
                    }).filter(p => p);
                }

                wsProjects.push({
                    id: projId,
                    emoji: project.emoji || null,
                    archived: project.archived || false,
                    channels: projectChannels.filter(ch => ch.workspace === wsKey),
                    github: github ? {
                        owner: github.owner,
                        repo: github.repo,
                        branch: github.branch,
                        url: github.url,
                        paths: paths
                    } : null,
                    nocodb: nocodb ? {
                        base_id: nocodb.base_id,
                        base_name: nocodb.base_name,
                        url: nocodb.url
                    } : null
                });
            }

            result.workspaces.push({
                key: wsKey,
                name: ws.name,
                id: ws.id,
                projects: wsProjects
            });
        }

        // 孤立プロジェクト（どのワークスペースにも属していない）
        for (const p of projectConfig.projects) {
            if (!usedProjectIds.has(p.id)) {
                result.orphanedProjects.push({
                    id: p.id,
                    hasGithub: !!githubByProjectId[p.id],
                    hasNocodb: !!nocodbByProjectId[p.id],
                    channelCount: (channelsByProjectId[p.id] || []).length
                });
            }
        }

        // 孤立チャンネル（proj_otherや未マッピング）
        const allMappedProjectIds = new Set([
            ...Object.keys(projectsById),
            ...Object.values(workspaces).flatMap(ws => ws.projects || [])
        ]);

        for (const ch of channels) {
            const normalizedId = ch.project_id?.replace(/^proj_/, '') || '';
            if (!allMappedProjectIds.has(normalizedId) && normalizedId !== 'other') {
                result.orphanedChannels.push({
                    id: ch.channel_id,
                    name: ch.channel_name,
                    workspace: ch.workspace,
                    project_id: ch.project_id
                });
            }
        }

        return result;
    }

    /**
     * Organizations（法人）設定を取得
     * @returns {Array} 法人一覧
     */
    async getOrganizations() {
        const data = await this._getConfigData();
        return data?.organizations || [];
    }

    /**
     * Dependencies（依存関係）設定を取得
     * @returns {Object} 依存関係マッピング
     */
    async getDependencies() {
        const data = await this._getConfigData();
        return data?.dependencies || {};
    }

    /**
     * Notifications（通知）設定を取得
     * @returns {Object} 通知設定
     */
    async getNotifications() {
        const data = await this._getConfigData();
        return data?.notifications || {
            channels: {},
            dnd: {}
        };
    }

    /**
     * 全設定を統合して取得
     */
    async getAll() {
        const [workspaces, channels, members, projectConfig, githubMappings, airtableMappings, nocodbMappings, plugins] = await Promise.all([
            this.getWorkspaces(),
            this.getChannels(),
            this.getMembers(),
            this.getProjects(),
            this.getGitHubMappings(),
            this.getAirtableMappings(),
            this.getNocoDBMappings(),
            this.getPlugins()
        ]);

        return {
            slack: {
                workspaces,
                channels,
                members
            },
            projects: projectConfig,
            github: githubMappings,
            airtable: airtableMappings,
            nocodb: nocodbMappings,
            plugins
        };
    }

    /**
     * 整合性チェック
     * - チャンネルに定義されているが、プロジェクトに存在しないproject_id
     * - ワークスペースに定義されているが、チャンネルがないワークスペース
     * - 重複したSlack ID
     * - GitHubマッピングの検証
     */
    async checkIntegrity() {
        const [workspaces, channels, members, projectConfig, githubMappings, airtableMappings, nocodbMappings] = await Promise.all([
            this.getWorkspaces(),
            this.getChannels(),
            this.getMembers(),
            this.getProjects(),
            this.getGitHubMappings(),
            this.getAirtableMappings(),
            this.getNocoDBMappings()
        ]);

        const issues = [];

        // プロジェクトIDのセットを作成
        const configProjectIds = new Set(
            projectConfig.projects.map(p => p.id)
        );

        // ワークスペースで定義されているプロジェクトIDのセット
        const workspaceProjectIds = new Set();
        Object.values(workspaces).forEach(ws => {
            (ws.projects || []).forEach(pid => workspaceProjectIds.add(pid));
        });

        // チャンネルで使われているプロジェクトIDのセット
        const channelProjectIds = new Set(
            channels.map(ch => ch.project_id)
        );

        // 1. チャンネルのproject_idがconfig.ymlに存在するか
        // proj_otherは意図的な「その他」カテゴリなので除外
        const ignoredProjectIds = new Set(['proj_other', 'other']);

        channelProjectIds.forEach(pid => {
            // 除外リストにあるプロジェクトはスキップ
            if (ignoredProjectIds.has(pid)) return;

            // proj_xxx → xxxに変換してチェック
            const shortId = pid.replace(/^proj_/, '');
            if (!configProjectIds.has(shortId) && !configProjectIds.has(pid)) {
                issues.push({
                    type: 'missing_project',
                    severity: 'warning',
                    message: `Channel uses project_id "${pid}" but not found in config.yml`,
                    source: 'channels.yml'
                });
            }
        });

        // 2. ワークスペースごとのチャンネル数をカウント
        const workspaceChannelCount = {};
        channels.forEach(ch => {
            workspaceChannelCount[ch.workspace] = (workspaceChannelCount[ch.workspace] || 0) + 1;
        });

        Object.keys(workspaces).forEach(wsKey => {
            if (!workspaceChannelCount[wsKey]) {
                issues.push({
                    type: 'empty_workspace',
                    severity: 'info',
                    message: `Workspace "${wsKey}" has no mapped channels`,
                    source: 'workspaces.yml'
                });
            }
        });

        // 3. メンバーの重複チェック（同じslack_idが複数ある場合）
        const slackIdCount = {};
        members.forEach(m => {
            slackIdCount[m.slack_id] = (slackIdCount[m.slack_id] || 0) + 1;
        });

        Object.entries(slackIdCount).forEach(([slackId, count]) => {
            if (count > 1) {
                const memberNames = members
                    .filter(m => m.slack_id === slackId)
                    .map(m => m.brainbase_name);
                // 同一人物のサブアカウントの場合は問題なし
                const uniqueNames = [...new Set(memberNames)];
                if (uniqueNames.length > 1) {
                    issues.push({
                        type: 'duplicate_slack_id',
                        severity: 'error',
                        message: `Slack ID "${slackId}" is mapped to multiple people: ${uniqueNames.join(', ')}`,
                        source: 'members.yml'
                    });
                }
            }
        });

        // 4. チャンネルの重複チェック
        const channelIdCount = {};
        channels.forEach(ch => {
            channelIdCount[ch.channel_id] = (channelIdCount[ch.channel_id] || 0) + 1;
        });

        Object.entries(channelIdCount).forEach(([channelId, count]) => {
            if (count > 1) {
                issues.push({
                    type: 'duplicate_channel_id',
                    severity: 'warning',
                    message: `Channel ID "${channelId}" appears ${count} times`,
                    source: 'channels.yml'
                });
            }
        });

        // 5. GitHubマッピングの検証
        // 5a. ローカルパスがあるがGitHubがないプロジェクト
        const projectsWithLocal = projectConfig.projects.filter(p => p.local?.path);
        const githubProjectIds = new Set(githubMappings.map(g => g.project_id));

        projectsWithLocal.forEach(p => {
            if (!githubProjectIds.has(p.id)) {
                issues.push({
                    type: 'missing_github',
                    severity: 'info',
                    message: `Project "${p.id}" has local path but no GitHub mapping`,
                    source: 'config.yml'
                });
            }
        });

        // 5b. GitHubマッピングの重複チェック
        const repoCount = {};
        githubMappings.forEach(g => {
            const key = `${g.owner}/${g.repo}`;
            if (!repoCount[key]) repoCount[key] = [];
            repoCount[key].push(g.project_id);
        });

        Object.entries(repoCount).forEach(([repo, projectIds]) => {
            if (projectIds.length > 1) {
                issues.push({
                    type: 'shared_github_repo',
                    severity: 'info',
                    message: `GitHub repo "${repo}" is shared by projects: ${projectIds.join(', ')}`,
                    source: 'config.yml'
                });
            }
        });

        // 6. Airtableマッピングの検証
        // 注意: brainbaseはNocoDBに移行済みのため、Airtable検証は無効化
        // （2026-01-17）

        // 7. NocoDBマッピングの検証
        const nocodbProjectIds = new Set(nocodbMappings.map(n => n.project_id));

        projectsWithLocal.forEach(p => {
            if (!nocodbProjectIds.has(p.id)) {
                issues.push({
                    type: 'missing_nocodb',
                    severity: 'info',
                    message: `Project "${p.id}" has local path but no NocoDB mapping`,
                    source: 'config.yml'
                });
            }
        });

        return {
            issues,
            summary: {
                total: issues.length,
                errors: issues.filter(i => i.severity === 'error').length,
                warnings: issues.filter(i => i.severity === 'warning').length,
                info: issues.filter(i => i.severity === 'info').length
            },
            stats: {
                workspaces: Object.keys(workspaces).length,
                channels: channels.length,
                members: members.length,
                projects: projectConfig.projects.length,
                github: githubMappings.length,
                airtable: airtableMappings.length,
                nocodb: nocodbMappings.length
            }
        };
    }

    async _getSlackData(fileName) {
        return this._loadYamlFile(path.join(this.slackDir, fileName), fileName);
    }

    async _getConfigData() {
        if (this._configCache) {
            return this._configCache;
        }

        const data = await this._loadYamlFile(this.configPath, 'config.yml');
        this._configLoadFailed = data === null;
        this._configCache = data || {};
        return this._configCache;
    }

    async _loadYamlFile(filePath, contextLabel) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return yaml.load(content) || {};
        } catch (err) {
            console.error(`Failed to load ${contextLabel}:`, err.message);
            return null;
        }
    }
}
