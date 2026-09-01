// @ts-check
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { AppError, ErrorCodes } from '../lib/errors.js';
import {
    assertNoDeclaredCrossTenantReferences,
    inspectProjectProfile,
    normalizeCapabilities,
    reconcileProjectPeople,
    validatePeople,
    validateProjectCreateInput
} from './project-profile-service.js';

/**
 * @typedef {object} ProjectConfig
 * @property {string} id
 * @property {string} [name] - Graph subjectへ投影する場合に必須の正本表示名
 * @property {number} [catalog_version] - Graph subjectへ投影する場合に必須の正の整数version
 * @property {string} [emoji]
 * @property {boolean} [archived]
 * @property {{ path?: string, glob_include?: string[] }} [local]
 * @property {{ owner?: string, repo?: string, branch?: string }} [github]
 * @property {{ base_id?: string, project_id?: string, base_name?: string, url?: string }} [nocodb]
 * @property {string} [project_code]
 * @property {string} [organization]
 * @property {string} [created_by]
 * @property {Record<string, Record<string, any>>} [capabilities]
 * @property {Record<string, any>} [people]
 * @property {string|string[]} [success_criteria]
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
     * @param {{ invalidateCache?: () => void }|null} [configParser]
     */
    constructor(configPath, projectsRoot = null, configParser = null) {
        this.configPath = configPath;
        this.projectsRoot = projectsRoot;
        this.configParser = configParser;
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

        // SPEC-settings-phase0-guards INV-4: invalidate ConfigParser cache after write
        if (this.configParser && typeof this.configParser.invalidateCache === 'function') {
            this.configParser.invalidateCache();
        }
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
        return projects.find(p => p.id === projectId || p.project_code === projectId);
    }

    /**
     * 最小情報でProject Profileを登録する。既存のlocal_path必須CRUDとは分離する。
     * @param {Record<string, any>} input
     */
    async createProjectProfile(input, access = {}) {
        let normalized;
        try {
            normalized = validateProjectCreateInput(input);
        } catch (error) {
            throw AppError.validation(error instanceof Error ? error.message : String(error));
        }

        const { data } = await this._loadConfig();
        const projects = this._getProjects(data);
        this._assertCreateScope(normalized.organization, access);
        if (this._findProject(projects, normalized.project_code)) {
            throw AppError.conflict(`Projectコード '${normalized.project_code}' は既に利用されています`);
        }

        if (!Array.isArray(data.organizations) || data.organizations.length === 0) {
            throw AppError.validation('Project登録前に組織一覧の設定が必要です');
        }
        const sameOrganization = data.organizations
            .filter(organization => organization.id === normalized.organization);
        if (sameOrganization.length === 0) {
            throw AppError.validation(`組織 '${normalized.organization}' は登録されていません`);
        }
        if (sameOrganization.length > 1) {
            throw AppError.conflict(`組織 '${normalized.organization}' が複数あり特定できません`);
        }
        try {
            assertNoDeclaredCrossTenantReferences(
                normalized.organization,
                normalized.capabilities,
                normalized.people
            );
        } catch (error) {
            throw AppError.validation(error instanceof Error ? error.message : String(error));
        }

        const project = {
            id: normalized.project_code,
            ...normalized
        };
        projects.push(project);
        await this._saveConfig(data);
        return project;
    }

    /**
     * @param {string} projectCode
     * @param {Record<string, any>} patch
     */
    async configureProjectProfile(projectCode, patch, access = {}) {
        if (!projectCode) throw AppError.validation('project_codeは必須です');
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
            throw AppError.validation('Project設定はオブジェクト形式で指定してください');
        }

        return this._withProject(projectCode, (project) => {
            this._assertProjectScope(project, access);
            if (patch.project_code && patch.project_code !== projectCode) {
                throw AppError.validation('project_codeは変更できません');
            }
            if (patch.organization && patch.organization !== project.organization) {
                throw AppError.validation('configureではorganizationを変更できません');
            }
            if (patch.created_by && patch.created_by !== project.created_by) {
                throw AppError.validation('created_byは変更できません');
            }
            if (patch.name !== undefined) {
                if (typeof patch.name !== 'string' || !patch.name.trim()) {
                    throw AppError.validation('nameは空でない文字列で指定してください');
                }
                project.name = patch.name.trim();
            }
            if (patch.success_criteria !== undefined) {
                const criteria = patch.success_criteria;
                if (!((typeof criteria === 'string' && criteria.trim()) || (Array.isArray(criteria)
                    && criteria.length > 0
                    && criteria.every(item => typeof item === 'string' && item.trim())))) {
                    throw AppError.validation('success_criteriaは文字列または文字列配列で指定してください');
                }
                project.success_criteria = criteria;
            }
            if (patch.capabilities !== undefined) {
                let capabilities;
                try {
                    if (!patch.capabilities || typeof patch.capabilities !== 'object' || Array.isArray(patch.capabilities)) {
                        throw new Error('capabilitiesはオブジェクト形式で指定してください');
                    }
                    const mergedCapabilities = Object.fromEntries(
                        Object.entries(patch.capabilities).map(([name, capability]) => {
                            if (!capability || typeof capability !== 'object' || Array.isArray(capability)) {
                                throw new Error(`capabilities.${name}はオブジェクト形式で指定してください`);
                            }
                            if (capability.verification !== undefined) {
                                throw new Error(`capabilities.${name}.verificationは信頼済み検証器が管理します`);
                            }
                            const currentCapability = project.capabilities?.[name] || {};
                            const nextCapability = {
                                ...currentCapability,
                                ...capability
                            };
                            const verificationInputsChanged = Object.entries(capability)
                                .some(([key, value]) => key !== 'reason'
                                    && JSON.stringify(currentCapability[key]) !== JSON.stringify(value));
                            if (verificationInputsChanged) delete nextCapability.verification;
                            return [
                                name,
                                nextCapability
                            ];
                        })
                    );
                    capabilities = normalizeCapabilities(mergedCapabilities, { allowVerification: true });
                } catch (error) {
                    throw AppError.validation(error instanceof Error ? error.message : String(error));
                }
                project.capabilities = {
                    ...(project.capabilities || {}),
                    ...capabilities
                };
            }
            if (patch.people !== undefined) {
                let people;
                try {
                    if (!patch.people || typeof patch.people !== 'object' || Array.isArray(patch.people)) {
                        throw new Error('peopleはオブジェクト形式で指定してください');
                    }
                    people = validatePeople({ ...(project.people || {}), ...patch.people });
                } catch (error) {
                    throw AppError.validation(error instanceof Error ? error.message : String(error));
                }
                project.people = people;
            }
            try {
                assertNoDeclaredCrossTenantReferences(
                    project.organization,
                    project.capabilities || {},
                    project.people
                );
            } catch (error) {
                throw AppError.validation(error instanceof Error ? error.message : String(error));
            }
            return project;
        }, { profileNotFound: true });
    }

    /** @param {string} projectCode */
    async getProjectProfile(projectCode, access = {}) {
        const { data } = await this._loadConfig();
        const project = this._findProject(this._getProjects(data), projectCode);
        if (!project) {
            throw new AppError(
                `Project「${projectCode}」が見つかりません`,
                ErrorCodes.PROJECT_NOT_FOUND
            );
        }
        this._assertProjectScope(project, access);
        return project;
    }

    /** @param {string} projectCode */
    async inspectProjectProfile(projectCode, access = {}) {
        return inspectProjectProfile(await this.getProjectProfile(projectCode, access));
    }

    /**
     * createで認可・保存済みの同一レコードを、再認可せず応答用に検査する。
     * @param {ProjectConfig} project
     */
    inspectProjectRecord(project) {
        return inspectProjectProfile(project);
    }

    /**
     * @param {string} projectCode
     * @param {unknown} candidates
     */
    async reconcileProjectProfile(projectCode, candidates, access = {}) {
        try {
            return reconcileProjectPeople(await this.getProjectProfile(projectCode, access), candidates);
        } catch (error) {
            if (AppError.isAppError(error)) throw error;
            throw AppError.validation(error instanceof Error ? error.message : String(error));
        }
    }

    _accessOrganization(access = {}) {
        const organizationId = access.organizationId || access.organization_id || null;
        const tenantId = access.tenantId || null;
        if (organizationId && tenantId && organizationId !== tenantId) {
            throw AppError.forbidden('認証済みtenantとorganizationが一致しません');
        }
        return organizationId || tenantId;
    }

    _assertCreateScope(organization, access = {}) {
        const accessOrganization = this._accessOrganization(access);
        if (!accessOrganization) {
            throw AppError.forbidden('organizationを含む署名済みtenant認証が必要です');
        }
        if (accessOrganization !== organization) {
            throw AppError.forbidden(`組織 '${organization}' は認証済みtenantの範囲外です`);
        }
    }

    _assertProjectScope(project, access = {}) {
        this._assertCreateScope(project.organization, access);
        const role = String(access.role || '').toLowerCase();
        if (role === 'ceo') return;
        const allowed = Array.isArray(access.projectCodes) ? access.projectCodes : [];
        const projectKeys = new Set([project.id, project.project_code].filter(Boolean));
        if (!allowed.some(code => projectKeys.has(code))) {
            throw AppError.forbidden(`Project '${project.project_code || project.id}' は認証済み範囲外です`);
        }
    }

    /**
     * 旧CRUDはProfile未登録のProjectを全体設定として扱ってきたため、互換性を保つ。
     * Profileレコードを対象にする場合だけ、tenantとprojectの署名済みscopeを要求する。
     * @param {ProjectConfig} project
     * @param {Record<string, any>} access
     */
    _assertLegacyProjectWriteScope(project, access = {}) {
        if (project?.organization || project?.project_code) {
            this._assertProjectScope(project, access);
        }
    }

    /**
     * 接続設定が変わった場合、以前の検証証跡を再利用できないようにする。
     * @param {ProjectConfig} project
     * @param {string} capabilityName
     */
    _invalidateCapabilityVerification(project, capabilityName) {
        const capability = project.capabilities?.[capabilityName];
        if (capability && typeof capability === 'object' && !Array.isArray(capability)) {
            delete capability.verification;
        }
    }

    /**
     * プロジェクトを取得→変更→保存する共通パターン
     * @param {string} projectId
     * @param {(project: ProjectConfig, data: BrainbaseConfig) => any} fn - project を変更する関数
     * @param {{ profileNotFound?: boolean }} [options]
     */
    async _withProject(projectId, fn, options = {}) {
        const { data } = await this._loadConfig();
        const projects = this._getProjects(data);
        const project = this._findProject(projects, projectId);
        if (!project) {
            if (options.profileNotFound) {
                throw new AppError(`Project「${projectId}」が見つかりません`, ErrorCodes.PROJECT_NOT_FOUND);
            }
            throw AppError.notFound('project', projectId);
        }
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
    async upsertGitHubMapping({ project_id, owner, repo, branch }, access = {}) {
        if (!project_id || !owner || !repo) {
            throw new Error('project_id, owner, repo are required');
        }
        return this._withProject(project_id, (project) => {
            this._assertLegacyProjectWriteScope(project, access);
            const nextMapping = { owner, repo, branch: branch || 'main' };
            const currentMapping = project.github || {};
            const mappingChanged = currentMapping.owner !== nextMapping.owner
                || currentMapping.repo !== nextMapping.repo
                || currentMapping.branch !== nextMapping.branch;
            if (mappingChanged) {
                this._invalidateCapabilityVerification(project, 'github');
            }
            project.github = nextMapping;
            return project.github;
        });
    }

    async deleteGitHubMapping(projectId, access = {}) {
        if (!projectId) throw new Error('project_id is required');
        return this._withProject(projectId, (project) => {
            this._assertLegacyProjectWriteScope(project, access);
            if (project.github !== undefined) {
                delete project.github;
                this._invalidateCapabilityVerification(project, 'github');
            }
            return true;
        });
    }

    /**
     * @param {{ project_id: string, base_id?: string, nocodb_project_id: string, base_name?: string, url?: string }} param0
     * @returns {Promise<{ base_id?: string, project_id?: string, base_name?: string, url?: string }>}
     */
    async upsertNocoDBMapping({ project_id, base_id, nocodb_project_id, base_name, url }, access = {}) {
        if (!project_id || !nocodb_project_id) {
            throw new Error('project_id, nocodb_project_id are required');
        }
        return this._withProject(project_id, (project) => {
            this._assertLegacyProjectWriteScope(project, access);
            const nextMapping = {
                base_id: base_id || '',
                project_id: nocodb_project_id,
                base_name: base_name || '',
                url: url || ''
            };
            const currentMapping = project.nocodb || {};
            const mappingChanged = currentMapping.base_id !== nextMapping.base_id
                || currentMapping.project_id !== nextMapping.project_id
                || currentMapping.base_name !== nextMapping.base_name
                || currentMapping.url !== nextMapping.url;
            if (mappingChanged) {
                this._invalidateCapabilityVerification(project, 'nocodb');
            }
            project.nocodb = nextMapping;
            return project.nocodb;
        });
    }

    async deleteNocoDBMapping(projectId, access = {}) {
        if (!projectId) throw new Error('project_id is required');
        return this._withProject(projectId, (project) => {
            this._assertLegacyProjectWriteScope(project, access);
            if (project.nocodb !== undefined) {
                delete project.nocodb;
                this._invalidateCapabilityVerification(project, 'nocodb');
            }
            return true;
        });
    }

    /**
     * @param {{ id: string, emoji?: string, local_path: string, glob_include?: string[], archived?: boolean }} param0
     * @returns {Promise<{ id: string }>}
     */
    async upsertProject({ id, emoji, local_path, glob_include, archived }, access = {}) {
        if (!id || !local_path) {
            throw new Error('id and local_path are required');
        }

        const { data } = await this._loadConfig();
        const projects = this._getProjects(data);
        const existing = this._findProject(projects, id);
        if (existing) {
            this._assertLegacyProjectWriteScope(existing, access);
        }
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

    async deleteProject(projectId, access = {}) {
        if (!projectId) {
            throw new Error('id is required');
        }

        const { data } = await this._loadConfig();
        const projects = this._getProjects(data);
        const target = this._findProject(projects, projectId);
        if (target?.organization || target?.project_code) {
            this._assertProjectScope(target, access);
        }
        const next = projects.filter(p => p.id !== projectId && p.project_code !== projectId);
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
