/**
 * Config Parser - brainbaseの設定ファイル（YAML）を読み取り、統合ビューを提供
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { logger as defaultLogger } from './server-support.js';

export type CatalogMode = 'required' | 'disabled';

export interface ConfigParserLogger {
    debug(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Error | (Record<string, unknown> & { error?: unknown })): void;
}

export interface ConfigParserOptions {
    configPath: string;
    slackDir: string;
    brainbaseRoot: string;
    projectsRoot: string;
    catalogMode?: CatalogMode;
    logger?: ConfigParserLogger;
}

export interface ProjectLocalConfig {
    path?: string;
    glob_include?: string[];
    [key: string]: unknown;
}

export interface ProjectGitHubConfig {
    owner?: string;
    repo?: string;
    branch?: string;
    [key: string]: unknown;
}

export interface ProjectAirtableConfig {
    base_id?: string;
    base_name?: string;
    [key: string]: unknown;
}

export interface ProjectConfig {
    id?: string;
    name?: string;
    catalog_version?: number;
    emoji?: string;
    archived?: boolean;
    local?: ProjectLocalConfig;
    github?: ProjectGitHubConfig;
    airtable?: ProjectAirtableConfig;
    capabilities?: unknown;
    people?: unknown;
    organization?: unknown;
    created_by?: unknown;
    success_criteria?: unknown;
    project_code?: unknown;
    [key: string]: unknown;
}

export interface SlackWorkspace {
    name?: string;
    id?: string;
    projects?: string[];
    [key: string]: unknown;
}

export type SlackWorkspaces = Record<string, SlackWorkspace>;

export interface SlackChannel {
    project_id?: string;
    channel_id?: string;
    channel_name?: string;
    type?: string;
    workspace?: string;
    [key: string]: unknown;
}

export interface SlackMember {
    slack_id?: string;
    brainbase_name?: string;
    [key: string]: unknown;
}

export interface ProjectCatalog {
    root: string;
    projects: ProjectConfig[];
}

export interface GitHubMapping {
    project_id?: string;
    owner?: string;
    repo?: string;
    branch: string;
    url: string;
}

export interface AirtableMapping {
    project_id?: string;
    base_id?: string;
    base_name?: string;
    url: string;
}

export interface PluginSettings {
    enabled: string[];
    disabled: string[];
}

export interface OrganizationConfig {
    [key: string]: unknown;
}

export interface DependencyConfig {
    [key: string]: unknown;
}

export interface NotificationsConfig {
    channels?: Record<string, unknown>;
    dnd?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface ConfigSnapshot {
    slack: {
        workspaces: SlackWorkspaces;
        channels: SlackChannel[];
        members: SlackMember[];
    };
    projects: ProjectCatalog;
    github: GitHubMapping[];
    airtable: AirtableMapping[];
    plugins: PluginSettings;
}

export interface UnifiedChannel {
    id?: string;
    name?: string;
    type: string;
    workspace?: string;
}

export interface UnifiedGitHubMapping {
    owner?: string;
    repo?: string;
    branch: string;
    url: string;
    paths: string[] | null;
}

export interface UnifiedProject {
    id: string;
    emoji: string | null;
    archived: boolean;
    channels: UnifiedChannel[];
    github: UnifiedGitHubMapping | null;
}

export interface UnifiedWorkspace {
    key: string;
    name?: string;
    id?: string;
    projects: UnifiedProject[];
}

export interface UnifiedView {
    workspaces: UnifiedWorkspace[];
    orphanedChannels: Array<{
        id?: string;
        name?: string;
        workspace?: string;
        project_id?: string;
    }>;
    orphanedProjects: Array<{
        id?: string;
        hasGithub: boolean;
        channelCount: number;
    }>;
}

export type ConfigSourceStatus = 'not_applicable' | 'not_loaded' | 'loaded' | 'missing' | 'invalid';

export interface IntegrityIssue {
    type: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
    source: string;
}

export interface IntegrityReport {
    applicability: 'applicable' | 'not_applicable';
    source: {
        status: ConfigSourceStatus;
        path: string;
        mode: CatalogMode;
    };
    issues: IntegrityIssue[];
    summary: {
        total: number;
        errors: number;
        warnings: number;
        info: number;
    };
    stats: {
        workspaces: number;
        channels: number;
        members: number;
        projects: number;
        github: number;
        airtable: number;
    };
}

interface RootConfig {
    projects?: ProjectConfig[];
    plugins?: Partial<PluginSettings>;
    organizations?: OrganizationConfig[];
    dependencies?: DependencyConfig;
    notifications?: NotificationsConfig;
}

interface SlackWorkspacesFile {
    workspaces?: SlackWorkspaces;
}

interface SlackChannelsFile {
    channels?: SlackChannel[];
}

interface SlackMembersFile {
    members?: SlackMember[];
}

function requirePath(name: string, value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`ConfigParser requires an explicit ${name} path`);
    }
    return value;
}

export class ConfigParser {
    /**
     * Construct a parser with every filesystem boundary supplied by the host.
     *
     * The OSS package deliberately has no workspace or repository defaults. A
     * host that needs compatibility defaults must provide them in its adapter.
     *
     * @param paths filesystem boundaries and optional catalog mode supplied by the host
     */
    configPath: string;
    slackDir: string;
    brainbaseRoot: string;
    projectsRoot: string;
    workspaceRoot: string;
    catalogMode: CatalogMode;
    logger: ConfigParserLogger;
    private _configSourceStatus: ConfigSourceStatus;
    private _configCache: RootConfig | null;
    private _configPromise: Promise<RootConfig> | null;

    constructor(paths: ConfigParserOptions) {
        const { configPath, slackDir, brainbaseRoot, projectsRoot,
            catalogMode = 'required', logger = defaultLogger } = paths ?? {};
        this.configPath = requirePath('configPath', configPath);
        this.slackDir = requirePath('slackDir', slackDir);
        this.brainbaseRoot = requirePath('brainbaseRoot', brainbaseRoot);
        this.projectsRoot = requirePath('projectsRoot', projectsRoot);
        this.catalogMode = catalogMode;
        this.logger = logger;
        this._configSourceStatus = this.catalogMode === 'disabled' ? 'not_applicable' : 'not_loaded';
        // workspaceRoot = parent directory of brainbaseRoot (where 'general' project resides)
        this.workspaceRoot = path.dirname(this.brainbaseRoot);
        this._configCache = null;
        this._configPromise = null;
    }

    /**
     * @template T
     * @param {string} filePath
     * @param {T} defaultValue
     * @param {string} [label]
     * @returns {Promise<T>}
     */
    async _loadYamlFile<T>(filePath: string, defaultValue: T, label?: string): Promise<T> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const data = yaml.load(content) as T | undefined;
            return data ?? defaultValue;
        } catch (err) {
            const target = label || filePath;
            const error = err as NodeJS.ErrnoException;
            if (error?.code === 'ENOENT' && filePath.startsWith(this.slackDir)) {
                this.logger.debug(`Optional config missing: ${target}`, { filePath });
                return defaultValue;
            }
            this.logger.error(`Failed to load ${target}:`, { error: error.message || String(error) });
            return defaultValue;
        }
    }

    /**
     * @template T
     * @param {string} filename
     * @param {T} defaultValue
     * @returns {Promise<T>}
     */
    async _loadSlackYaml<T>(filename: string, defaultValue: T): Promise<T> {
        return this._loadYamlFile(
            path.join(this.slackDir, filename),
            defaultValue,
            filename
        );
    }

    async _loadConfig(): Promise<RootConfig> {
        if (this._configCache) {
            return this._configCache;
        }

        if (this.catalogMode === 'disabled') {
            this._configSourceStatus = 'not_applicable';
            this._configCache = {};
            this.logger.debug('Project catalog is disabled for this runtime', {
                mode: this.catalogMode
            });
            return this._configCache;
        }

        if (!this._configPromise) {
            this._configPromise = fs.readFile(this.configPath, 'utf-8')
                .then((content) => {
                    const data = yaml.load(content) as RootConfig | undefined;
                    this._configSourceStatus = 'loaded';
                    return data ?? {};
                })
                .catch((err) => {
                    const error = err as NodeJS.ErrnoException;
                    this._configSourceStatus = error?.code === 'ENOENT' ? 'missing' : 'invalid';
                    this.logger.error('Failed to load config.yml:', {
                        error: error.message || String(error),
                        configPath: this.configPath
                    });
                    return {};
                });
        }

        this._configCache = await this._configPromise;
        return this._configCache;
    }

    /**
     * SPEC-settings-phase0-guards INV-4: ConfigService.write 後に呼ぶことで stale cache を回避
     */
    invalidateCache(): void {
        this._configCache = null;
        this._configPromise = null;
    }

    /**
     * @param {ProjectConfig[]} [projects]
     * @returns {ProjectConfig[]}
     */
    _expandProjectPaths(projects: ProjectConfig[] = []): ProjectConfig[] {
        return projects.map(project => {
            if (project.local?.path) {
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
    }

    /**
     * Slackワークスペース一覧を取得
     */
    async getWorkspaces(): Promise<SlackWorkspaces> {
        const data = await this._loadSlackYaml<SlackWorkspacesFile>('workspaces.yml', { workspaces: {} });
        return data?.workspaces || {};
    }

    /**
     * Slackチャンネル一覧を取得
     */
    async getChannels(): Promise<SlackChannel[]> {
        const data = await this._loadSlackYaml<SlackChannelsFile>('channels.yml', { channels: [] });
        return data?.channels || [];
    }

    /**
     * Slackメンバー一覧を取得
     */
    async getMembers(): Promise<SlackMember[]> {
        const data = await this._loadSlackYaml<SlackMembersFile>('members.yml', { members: [] });
        return data?.members || [];
    }

    /**
     * プロジェクト設定（config.yml）を取得
     */
    async getProjects(): Promise<ProjectCatalog> {
        const data = await this._loadConfig();
        const projects = this._expandProjectPaths(data.projects || []).map(project => {
            // Legacyの未認証設定APIへProject Profileのtenant・人物・接続意図を露出させない。
            const {
                capabilities: _capabilities,
                people: _people,
                organization: _organization,
                created_by: _createdBy,
                success_criteria: _successCriteria,
                project_code: _projectCode,
                ...legacyProject
            } = project;
            return legacyProject;
        });

        return {
            root: this.workspaceRoot, // Workspace root directory (where 'general' project resides)
            projects
        };
    }

    /**
     * GitHubマッピングを取得（config.ymlから抽出）
     */
    async getGitHubMappings(): Promise<GitHubMapping[]> {
        const data = await this._loadConfig();
        const projects = data.projects || [];

        return projects
            .filter(p => p.github)
            .map(p => ({
                project_id: p.id,
                owner: p.github?.owner,
                repo: p.github?.repo,
                branch: p.github?.branch || 'main',
                url: `https://github.com/${p.github?.owner}/${p.github?.repo}`
            }));
    }

    /**
     * Airtableマッピングを取得（config.ymlから抽出）
     */
    async getAirtableMappings(): Promise<AirtableMapping[]> {
        const data = await this._loadConfig();
        const projects = data.projects || [];

        return projects
            .filter(p => p.airtable)
            .map(p => ({
                project_id: p.id,
                base_id: p.airtable?.base_id,
                base_name: p.airtable?.base_name,
                url: `https://airtable.com/${p.airtable?.base_id}`
            }));
    }

    /**
     * UI Plugins設定を取得（config.ymlから抽出）
     * @returns {Promise<any>} { enabled: string[] } - 有効なプラグインID一覧
     */
    async getPlugins(): Promise<PluginSettings> {
        const data = await this._loadConfig();
        const plugins = data.plugins || {};

        if (!plugins.enabled && !plugins.disabled) {
            // OSSの初期状態: 必要最小限のプラグインのみ有効化
            return {
                enabled: ['bb-inbox'],
                disabled: []
            };
        }

        return {
            enabled: Array.isArray(plugins.enabled) ? plugins.enabled : [],
            disabled: Array.isArray(plugins.disabled) ? plugins.disabled : []
        };
    }

    /**
     * 統合ビュー: Workspace → Project → Slack/GitHub/Airtable の関係を一覧
     */
    async getUnifiedView(): Promise<UnifiedView> {
        const [workspaces, channels, projectConfig, githubMappings] = await Promise.all([
            this.getWorkspaces(),
            this.getChannels(),
            this.getProjects(),
            this.getGitHubMappings()
        ]);

        // プロジェクト情報をIDでインデックス化
        const projectsById: Record<string, ProjectConfig> = {};
        for (const p of projectConfig.projects) {
            if (p.id) {
                projectsById[p.id] = p;
            }
        }

        // チャンネルをproject_idでグループ化
        const channelsByProjectId: Record<string, UnifiedChannel[]> = {};
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
        const githubByProjectId: Record<string, GitHubMapping> = {};
        for (const g of githubMappings) {
            if (g.project_id) {
                githubByProjectId[g.project_id] = g;
            }
        }

        // ワークスペースごとにプロジェクトを整理
        const result: UnifiedView = {
            workspaces: [],
            orphanedChannels: [],
            orphanedProjects: []
        };

        // 使用済みプロジェクトを追跡（正規化後のID）
        const usedProjectIds = new Set<string>();

        // ID正規化ヘルパー: proj_zeims → zeims
        const normalizeId = (id: string): string => id.replace(/^proj_/, '');

        for (const [wsKey, ws] of Object.entries(workspaces)) {
            const wsProjects: UnifiedProject[] = [];

            // ワークスペースに紐づくプロジェクトを処理
            const projectIds = ws.projects || [];
            for (const projId of projectIds) {
                // proj_zeims → zeims に正規化してマッチング
                const normalizedProjId = normalizeId(projId);
                usedProjectIds.add(normalizedProjId);

                const project = projectsById[normalizedProjId];
                const github = githubByProjectId[normalizedProjId];
                const projectChannels = channelsByProjectId[normalizedProjId] || [];

                // glob_include からパスを抽出
                let paths = null;
                if (project?.local?.glob_include) {
                    paths = project.local.glob_include.map(g => {
                        const match = g.match(/^([^*]+)/);
                        return match ? match[1].replace(/\/$/, '') + '/' : null;
                    }).filter((p): p is string => p !== null);
                }

                wsProjects.push({
                    id: projId,
                    emoji: project?.emoji || null,
                    archived: project?.archived || false,
                    channels: projectChannels.filter(ch => ch.workspace === wsKey),
                    github: github ? {
                        owner: github.owner,
                        repo: github.repo,
                        branch: github.branch,
                        url: github.url,
                        paths: paths
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
            const projectId = p.id;
            if (!projectId || !usedProjectIds.has(projectId)) {
                result.orphanedProjects.push({
                    id: projectId,
                    hasGithub: projectId ? !!githubByProjectId[projectId] : false,
                    channelCount: projectId ? (channelsByProjectId[projectId] || []).length : 0
                });
            }
        }

        // 孤立チャンネル（proj_otherや未マッピング）
        const allMappedProjectIds = new Set<string>([
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
     * @returns {Promise<any[]>} 法人一覧
     */
    async getOrganizations(): Promise<OrganizationConfig[]> {
        const data = await this._loadConfig();
        return data.organizations || [];
    }

    /**
     * Dependencies（依存関係）設定を取得
     * @returns {Promise<any>} 依存関係マッピング
     */
    async getDependencies(): Promise<DependencyConfig> {
        const data = await this._loadConfig();
        return data.dependencies || {};
    }

    /**
     * Notifications（通知）設定を取得
     * @returns {Promise<any>} 通知設定
     */
    async getNotifications(): Promise<NotificationsConfig> {
        const data = await this._loadConfig();
        return data.notifications || {
            channels: {},
            dnd: {}
        };
    }

    /**
     * 全設定を統合して取得
     */
    async getAll(): Promise<ConfigSnapshot> {
        const [workspaces, channels, members, projectConfig, githubMappings, airtableMappings, plugins] = await Promise.all([
            this.getWorkspaces(),
            this.getChannels(),
            this.getMembers(),
            this.getProjects(),
            this.getGitHubMappings(),
            this.getAirtableMappings(),
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
    async checkIntegrity(): Promise<IntegrityReport> {
        if (this.catalogMode === 'disabled') {
            return {
                applicability: 'not_applicable',
                source: {
                    status: 'not_applicable',
                    path: this.configPath,
                    mode: this.catalogMode
                },
                issues: [],
                summary: { total: 0, errors: 0, warnings: 0, info: 0 },
                stats: {
                    workspaces: 0,
                    channels: 0,
                    members: 0,
                    projects: 0,
                    github: 0,
                    airtable: 0
                }
            };
        }

        const [workspaces, channels, members, projectConfig, githubMappings, airtableMappings] = await Promise.all([
            this.getWorkspaces(),
            this.getChannels(),
            this.getMembers(),
            this.getProjects(),
            this.getGitHubMappings(),
            this.getAirtableMappings()
        ]);

        const issues: IntegrityIssue[] = [];
        if (this._configSourceStatus !== 'loaded') {
            issues.push({
                type: 'config_source_unavailable',
                severity: 'error',
                message: `Required project catalog is ${this._configSourceStatus}: ${this.configPath}`,
                source: 'config.yml'
            });
        }

        // プロジェクトIDのセットを作成
        const configProjectIds = new Set(
            projectConfig.projects
                .map(p => p.id)
                .filter((id): id is string => typeof id === 'string')
        );

        // ワークスペースで定義されているプロジェクトIDのセット
        const workspaceProjectIds = new Set<string>();
        Object.values(workspaces).forEach(ws => {
            (ws.projects || []).forEach(pid => workspaceProjectIds.add(pid));
        });

        // チャンネルで使われているプロジェクトIDのセット
        const channelProjectIds = new Set<string>();
        channels.forEach(ch => {
            if (ch.project_id) {
                channelProjectIds.add(ch.project_id);
            }
        });

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
        const workspaceChannelCount: Record<string, number> = {};
        channels.forEach(ch => {
            if (ch.workspace) {
                workspaceChannelCount[ch.workspace] = (workspaceChannelCount[ch.workspace] || 0) + 1;
            }
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
        const slackIdCount: Record<string, number> = {};
        members.forEach(m => {
            if (m.slack_id) {
                slackIdCount[m.slack_id] = (slackIdCount[m.slack_id] || 0) + 1;
            }
        });

        Object.entries(slackIdCount).forEach(([slackId, count]) => {
            if (count > 1) {
                const memberNames = members
                    .filter(m => m.slack_id === slackId)
                    .map(m => m.brainbase_name)
                    .filter((name): name is string => typeof name === 'string');
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
        const channelIdCount: Record<string, number> = {};
        channels.forEach(ch => {
            if (ch.channel_id) {
                channelIdCount[ch.channel_id] = (channelIdCount[ch.channel_id] || 0) + 1;
            }
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
        const githubProjectIds = new Set(
            githubMappings
                .map(g => g.project_id)
                .filter((id): id is string => typeof id === 'string')
        );

        projectsWithLocal.forEach(p => {
            if (!p.id || !githubProjectIds.has(p.id)) {
                issues.push({
                    type: 'missing_github',
                    severity: 'info',
                    message: `Project "${p.id}" has local path but no GitHub mapping`,
                    source: 'config.yml'
                });
            }
        });

        // 5b. GitHubマッピングの重複チェック
        const repoCount: Record<string, string[]> = {};
        githubMappings.forEach(g => {
            const key = `${g.owner}/${g.repo}`;
            if (!repoCount[key]) repoCount[key] = [];
            if (g.project_id) {
                repoCount[key].push(g.project_id);
            }
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

        // 6. Airtableマッピングの検証は無効化（2026-01-17）

        return {
            applicability: 'applicable',
            source: {
                status: this._configSourceStatus,
                path: this.configPath,
                mode: this.catalogMode
            },
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
