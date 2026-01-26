import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

/**
 * ConfigService
 * config.yml の更新を安全に行うサービス
 */
export class ConfigService {
    constructor(configPath, projectsRoot = null) {
        this.configPath = configPath;
        this.projectsRoot = projectsRoot;
    }

    async _loadConfig() {
        const content = await fs.readFile(this.configPath, 'utf-8');
        const data = yaml.load(content) || {};
        return { data, content };
    }

    async _saveConfig(data) {
        // backup
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${this.configPath}.bak-${timestamp}`;
        await fs.copyFile(this.configPath, backupPath);

        const nextYaml = yaml.dump(data, { lineWidth: -1, noRefs: true });
        await fs.writeFile(this.configPath, nextYaml, 'utf-8');
    }

    _getProjects(data) {
        if (!Array.isArray(data.projects)) {
            data.projects = [];
        }
        return data.projects;
    }

    _findProject(projects, projectId) {
        return projects.find(p => p.id === projectId);
    }

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

    async upsertGitHubMapping({ project_id, owner, repo, branch }) {
        if (!project_id || !owner || !repo) {
            throw new Error('project_id, owner, repo are required');
        }

        const { data } = await this._loadConfig();
        const projects = this._getProjects(data);
        const project = this._findProject(projects, project_id);
        if (!project) {
            throw new Error(`Project not found: ${project_id}`);
        }

        project.github = {
            owner,
            repo,
            branch: branch || 'main'
        };

        await this._saveConfig(data);
        return project.github;
    }

    async deleteGitHubMapping(projectId) {
        if (!projectId) {
            throw new Error('project_id is required');
        }

        const { data } = await this._loadConfig();
        const projects = this._getProjects(data);
        const project = this._findProject(projects, projectId);
        if (!project) {
            throw new Error(`Project not found: ${projectId}`);
        }

        delete project.github;
        await this._saveConfig(data);
        return true;
    }

    async upsertNocoDBMapping({ project_id, base_id, nocodb_project_id, base_name, url }) {
        if (!project_id || !nocodb_project_id) {
            throw new Error('project_id, nocodb_project_id are required');
        }

        const { data } = await this._loadConfig();
        const projects = this._getProjects(data);
        const project = this._findProject(projects, project_id);
        if (!project) {
            throw new Error(`Project not found: ${project_id}`);
        }

        project.nocodb = {
            base_id: base_id || '',
            project_id: nocodb_project_id,
            base_name: base_name || '',
            url: url || ''
        };

        await this._saveConfig(data);
        return project.nocodb;
    }

    async deleteNocoDBMapping(projectId) {
        if (!projectId) {
            throw new Error('project_id is required');
        }

        const { data } = await this._loadConfig();
        const projects = this._getProjects(data);
        const project = this._findProject(projects, projectId);
        if (!project) {
            throw new Error(`Project not found: ${projectId}`);
        }

        delete project.nocodb;
        await this._saveConfig(data);
        return true;
    }

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

    async updateNotifications({ channels = {}, dnd = {} }) {
        const { data } = await this._loadConfig();
        const current = data.notifications || {
            channels: { slack: true, web: true, email: false },
            dnd: { enabled: false, start: 22, end: 9 }
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
            : (Number(current.dnd?.start) || 22);
        const normalizedEnd = Number.isFinite(Number(nextDnd.end))
            ? Number(nextDnd.end)
            : (Number(current.dnd?.end) || 9);

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
