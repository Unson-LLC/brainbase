// @ts-check
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

/**
 * @typedef {object} ProjectConfig
 * @property {string} id
 * @property {string} [emoji]
 * @property {boolean} [archived]
 * @property {{ path?: string, glob_include?: string[] }} [local]
 * @property {{ owner?: string, repo?: string, branch?: string }} [github]
 * @property {{ base_id?: string, project_id?: string, base_name?: string, url?: string }} [nocodb]
 */

/**
 * @typedef {object} OrganizationConfig
 * @property {string} id
 * @property {string} [name]
 * @property {string} [ceo]
 * @property {string[]} [projects]
 */

/**
 * @typedef {object} NotificationsConfig
 * @property {Record<string, unknown>} [channels]
 * @property {{ enabled?: boolean, start?: number|string|null, end?: number|string|null }} [dnd]
 */

/**
 * @typedef {object} BrainbaseConfig
 * @property {string} [projects_root]
 * @property {ProjectConfig[]} [projects]
 * @property {OrganizationConfig[]} [organizations]
 * @property {NotificationsConfig} [notifications]
 */

/**
 * ConfigService
 * config.yml の更新を安全に行うサービス
 */
export class ConfigService {
    /**
     * @param {string} configPath
     * @param {string|null} [projectsRoot]
     */
    constructor(configPath, projectsRoot = null) {
        this.configPath = configPath;
        this.projectsRoot = projectsRoot;
    }

    /**
     * @returns {Promise<{ data: BrainbaseConfig, content: string }>}
     */
    async _loadConfig() {
        const content = await fs.readFile(this.configPath, 'utf-8');
        const data = /** @type {BrainbaseConfig} */ (yaml.load(content) || {});
        return { data, content };
    }

    /**
     * @param {BrainbaseConfig} data
     * @returns {Promise<void>}
     */
    async _saveConfig(data) {
        // backup
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${this.configPath}.bak-${timestamp}`;
        await fs.copyFile(this.configPath, backupPath);

        const nextYaml = yaml.dump(data, { lineWidth: -1, noRefs: true });
        await fs.writeFile(this.configPath, nextYaml, 'utf-8');
    }

    /**
     * @param {BrainbaseConfig} data
     * @returns {ProjectConfig[]}
     */
    _getProjects(data) {
        if (!Array.isArray(data.projects)) {
            data.projects = [];
        }
        return data.projects;
    }

    /**
     * @param {ProjectConfig[]} projects
     * @param {string} projectId
     * @returns {ProjectConfig|undefined}
     */
    _findProject(projects, projectId) {
        return projects.find(p => p.id === projectId);
    }

    /**
     * プロジェクトを取得→変更→保存する共通パターン
     * @param {string} projectId
     * @param {(project: ProjectConfig, data: BrainbaseConfig) => any} fn - project を変更する関数
     */
    async _withProject(projectId, fn) {
        const { data } = await this._loadConfig();
        const projects = this._getProjects(data);
        const project = this._findProject(projects, projectId);
        if (!project) throw new Error(`Project not found: ${projectId}`);
        const result = fn(project, data);
        await this._saveConfig(data);
        return result;
    }

    /**
     * @param {string} localPath
     * @param {BrainbaseConfig} data
     * @returns {string}
     */
    _normalizeProjectPath(localPath, data) {
        if (!localPath) return localPath;
        if (!this.projectsRoot) return localPath;
        const projectsRootConfig = data.projects_root || '';
        if (!projectsRootConfig.includes('${PROJECTS_ROOT')) {
            return localPath;
        }
        if (localPath.startsWith(this.projectsRoot)) {
            const suffix = localPath.slice(this.projectsRoot.length).replace(/^\/+/, '');
            return `${projectsRootConfig}/${suffix}`.replace(/\/+$/, '');
        }
        return localPath;
    }

    /**
     * @param {{ project_id: string, owner: string, repo: string, branch?: string }} param0
     * @returns {Promise<{ owner?: string, repo?: string, branch?: string }>}
     */
    async upsertGitHubMapping({ project_id, owner, repo, branch }) {
        if (!project_id || !owner || !repo) {
            throw new Error('project_id, owner, repo are required');
        }
        return this._withProject(project_id, (project) => {
            project.github = { owner, repo, branch: branch || 'main' };
            return project.github;
        });
    }

    async deleteGitHubMapping(projectId) {
        if (!projectId) throw new Error('project_id is required');
        return this._withProject(projectId, (project) => {
            delete project.github;
            return true;
        });
    }

    /**
     * @param {{ project_id: string, base_id?: string, nocodb_project_id: string, base_name?: string, url?: string }} param0
     * @returns {Promise<{ base_id?: string, project_id?: string, base_name?: string, url?: string }>}
     */
    async upsertNocoDBMapping({ project_id, base_id, nocodb_project_id, base_name, url }) {
        if (!project_id || !nocodb_project_id) {
            throw new Error('project_id, nocodb_project_id are required');
        }
        return this._withProject(project_id, (project) => {
            project.nocodb = {
                base_id: base_id || '',
                project_id: nocodb_project_id,
                base_name: base_name || '',
                url: url || ''
            };
            return project.nocodb;
        });
    }

    async deleteNocoDBMapping(projectId) {
        if (!projectId) throw new Error('project_id is required');
        return this._withProject(projectId, (project) => {
            delete project.nocodb;
            return true;
        });
    }

    /**
     * @param {{ id: string, emoji?: string, local_path: string, glob_include?: string[], archived?: boolean }} param0
     * @returns {Promise<{ id: string }>}
     */
    async upsertProject({ id, emoji, local_path, glob_include, archived }) {
        if (!id || !local_path) {
            throw new Error('id and local_path are required');
        }

        const { data } = await this._loadConfig();
        const projects = this._getProjects(data);
        const existing = this._findProject(projects, id);
        const normalizedPath = this._normalizeProjectPath(local_path, data);
        const nextGlob = Array.isArray(glob_include) ? glob_include : [];

        if (existing) {
            existing.emoji = emoji || existing.emoji || '';
            existing.archived = Boolean(archived);
            existing.local = {
                ...(existing.local || {}),
                path: normalizedPath,
                glob_include: nextGlob
            };
        } else {
            projects.push({
                id,
                emoji: emoji || '',
                archived: Boolean(archived),
                local: {
                    path: normalizedPath,
                    glob_include: nextGlob
                }
            });
        }

        await this._saveConfig(data);
        return { id };
    }

    async deleteProject(projectId) {
        if (!projectId) {
            throw new Error('id is required');
        }

        const { data } = await this._loadConfig();
        const projects = this._getProjects(data);
        const next = projects.filter(p => p.id !== projectId);
        if (next.length === projects.length) {
            throw new Error(`Project not found: ${projectId}`);
        }
        data.projects = next;
        await this._saveConfig(data);
        return true;
    }

    /**
     * @param {{ id: string, name?: string, ceo?: string, projects?: string[] }} param0
     * @returns {Promise<{ id: string, name: string, ceo: string, projects: string[] }>}
     */
    async upsertOrganization({ id, name, ceo, projects }) {
        if (!id) {
            throw new Error('id is required');
        }

        const { data } = await this._loadConfig();
        if (!Array.isArray(data.organizations)) {
            data.organizations = [];
        }

        const org = data.organizations.find(o => o.id === id);
        const normalizedProjects = Array.isArray(projects) ? projects.filter(Boolean) : [];
        const payload = {
            id,
            name: name || id,
            ceo: ceo || '',
            projects: normalizedProjects
        };

        if (org) {
            Object.assign(org, payload);
        } else {
            data.organizations.push(payload);
        }

        await this._saveConfig(data);
        return payload;
    }

    async deleteOrganization(id) {
        if (!id) {
            throw new Error('id is required');
        }

        const { data } = await this._loadConfig();
        if (!Array.isArray(data.organizations)) {
            data.organizations = [];
        }

        const next = data.organizations.filter(o => o.id !== id);
        if (next.length === data.organizations.length) {
            throw new Error(`Organization not found: ${id}`);
        }

        data.organizations = next;
        await this._saveConfig(data);
        return true;
    }

    /**
     * @param {{ channels?: Record<string, unknown>, dnd?: { enabled?: boolean, start?: number|string|null, end?: number|string|null } }} param0
     * @returns {Promise<NotificationsConfig>}
     */
    async updateNotifications({ channels = {}, dnd = {} }) {
        const { data } = await this._loadConfig();
        const current = data.notifications || {
            channels: {},
            dnd: {}
        };

        const nextChannels = {
            ...current.channels,
            ...channels
        };

        const nextDnd = {
            ...current.dnd,
            ...dnd
        };

        const normalizedStart = Number.isFinite(Number(nextDnd.start))
            ? Number(nextDnd.start)
            : (Number.isFinite(Number(current.dnd?.start)) ? Number(current.dnd.start) : null);
        const normalizedEnd = Number.isFinite(Number(nextDnd.end))
            ? Number(nextDnd.end)
            : (Number.isFinite(Number(current.dnd?.end)) ? Number(current.dnd.end) : null);

        data.notifications = {
            channels: nextChannels,
            dnd: {
                enabled: Boolean(nextDnd.enabled),
                start: normalizedStart,
                end: normalizedEnd
            }
        };

        await this._saveConfig(data);
        return data.notifications;
    }
}
