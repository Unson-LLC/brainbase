/**
 * Config Parser - brainbaseの設定ファイル（YAML）を読み取り、統合ビューを提供
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

export class ConfigParser {
    constructor(codexPath, configPath, brainbaseRoot = process.env.WORKSPACE_ROOT || '/path/to/workspace') {
        this.codexPath = codexPath;
        this.configPath = configPath;
        this.brainbaseRoot = brainbaseRoot;
        this.slackDir = path.join(codexPath, 'common/meta/slack');
    }

    /**
     * Slackワークスペース一覧を取得
     */
    async getWorkspaces() {
        try {
            const content = await fs.readFile(
                path.join(this.slackDir, 'workspaces.yml'),
                'utf-8'
            );
            const data = yaml.load(content);
            return data.workspaces || {};
        } catch (err) {
            console.error('Failed to load workspaces.yml:', err.message);
            return {};
        }
    }

    /**
     * Slackチャンネル一覧を取得
     */
    async getChannels() {
        try {
            const content = await fs.readFile(
                path.join(this.slackDir, 'channels.yml'),
                'utf-8'
            );
            const data = yaml.load(content);
            return data.channels || [];
        } catch (err) {
            console.error('Failed to load channels.yml:', err.message);
            return [];
        }
    }

    /**
     * Slackメンバー一覧を取得
     */
    async getMembers() {
        try {
            const content = await fs.readFile(
                path.join(this.slackDir, 'members.yml'),
                'utf-8'
            );
            const data = yaml.load(content);
            return data.members || [];
        } catch (err) {
            console.error('Failed to load members.yml:', err.message);
            return [];
        }
    }

    /**
     * プロジェクト設定（config.yml）を取得
     */
    async getProjects() {
        try {
            const content = await fs.readFile(this.configPath, 'utf-8');
            const data = yaml.load(content);
            return {
                root: this.brainbaseRoot, // Environment variable takes priority
                projects: data.projects || []
            };
        } catch (err) {
            console.error('Failed to load config.yml:', err.message);
            return { root: this.brainbaseRoot, projects: [] };
        }
    }

    /**
     * GitHubマッピングを取得（config.ymlから抽出）
     */
    async getGitHubMappings() {
        try {
            const content = await fs.readFile(this.configPath, 'utf-8');
            const data = yaml.load(content);
            const projects = data.projects || [];

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
        } catch (err) {
            console.error('Failed to load GitHub mappings:', err.message);
            return [];
        }
    }

    /**
     * Airtableマッピングを取得（config.ymlから抽出）
     */
    async getAirtableMappings() {
        try {
            const content = await fs.readFile(this.configPath, 'utf-8');
            const data = yaml.load(content);
            const projects = data.projects || [];

            // airtableセクションを持つプロジェクトのみ抽出
            return projects
                .filter(p => p.airtable)
                .map(p => ({
                    project_id: p.id,
                    base_id: p.airtable.base_id,
                    base_name: p.airtable.base_name,
                    url: `https://airtable.com/${p.airtable.base_id}`
                }));
        } catch (err) {
            console.error('Failed to load Airtable mappings:', err.message);
            return [];
        }
    }

    /**
     * 統合ビュー: Workspace → Project → Slack/GitHub/Airtable の関係を一覧
     */
    async getUnifiedView() {
        const [workspaces, channels, projectConfig, githubMappings, airtableMappings] = await Promise.all([
            this.getWorkspaces(),
            this.getChannels(),
            this.getProjects(),
            this.getGitHubMappings(),
            this.getAirtableMappings()
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

        // AirtableマッピングをインデックID化
        const airtableByProjectId = {};
        for (const a of airtableMappings) {
            airtableByProjectId[a.project_id] = a;
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
                const airtable = airtableByProjectId[normalizedProjId];
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
                    airtable: airtable ? {
                        base_id: airtable.base_id,
                        base_name: airtable.base_name,
                        url: airtable.url
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
                    hasAirtable: !!airtableByProjectId[p.id],
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
     * 全設定を統合して取得
     */
    async getAll() {
        const [workspaces, channels, members, projectConfig, githubMappings, airtableMappings] = await Promise.all([
            this.getWorkspaces(),
            this.getChannels(),
            this.getMembers(),
            this.getProjects(),
            this.getGitHubMappings(),
            this.getAirtableMappings()
        ]);

        return {
            slack: {
                workspaces,
                channels,
                members
            },
            projects: projectConfig,
            github: githubMappings,
            airtable: airtableMappings
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
        const [workspaces, channels, members, projectConfig, githubMappings, airtableMappings] = await Promise.all([
            this.getWorkspaces(),
            this.getChannels(),
            this.getMembers(),
            this.getProjects(),
            this.getGitHubMappings(),
            this.getAirtableMappings()
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
        // 6a. ローカルパスがあるがAirtableがないプロジェクト
        const airtableProjectIds = new Set(airtableMappings.map(a => a.project_id));

        projectsWithLocal.forEach(p => {
            if (!airtableProjectIds.has(p.id)) {
                issues.push({
                    type: 'missing_airtable',
                    severity: 'info',
                    message: `Project "${p.id}" has local path but no Airtable mapping`,
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
                airtable: airtableMappings.length
            }
        };
    }
}
