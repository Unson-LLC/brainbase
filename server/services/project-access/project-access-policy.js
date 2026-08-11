// @ts-check

import { AppError } from '../../lib/errors.js';

function normalizeProjectKey(value) {
    if (!value || typeof value !== 'string') return '';
    return value.toLowerCase().replace(/_/g, '-');
}

function projectAccessKeys(projectId, projectConfig = null) {
    const keys = new Set();
    const normalizedId = normalizeProjectKey(projectId);
    if (normalizedId) {
        keys.add(normalizedId);
        keys.add(normalizedId.replace(/-/g, ''));
    }
    const aliases = Array.isArray(projectConfig?.aliases) ? projectConfig.aliases : [];
    for (const alias of aliases) {
        const normalizedAlias = normalizeProjectKey(alias);
        if (normalizedAlias) {
            keys.add(normalizedAlias);
            keys.add(normalizedAlias.replace(/-/g, ''));
        }
    }
    const githubRepo = normalizeProjectKey(projectConfig?.github?.repo);
    if (githubRepo) {
        keys.add(githubRepo);
        keys.add(githubRepo.replace(/-/g, ''));
    }
    if (normalizedId.endsWith('-app')) {
        const parentId = normalizedId.slice(0, -4);
        keys.add(parentId);
        keys.add(parentId.replace(/-/g, ''));
    }
    return keys;
}

export class ProjectAccessPolicy {
    constructor({ configParser = null } = {}) {
        this.configParser = configParser;
        this.projectConfigById = new Map();
    }

    async prepare() {
        if (!this.configParser?.getProjects) return null;
        const projectConfig = await this.configParser.getProjects();
        this.projectConfigById = new Map((projectConfig.projects || []).map((project) => [project.id, project]));
        return projectConfig;
    }

    async assertProjectSelectable(projectId) {
        if (!projectId) throw AppError.validation('project_id is required');
        if (projectId === 'general') return;
        const projectConfig = await this.prepare();
        if (!projectConfig) return;
        const exists = (projectConfig.projects || []).some((project) => (
            project.id === projectId
            && project.archived !== true
            && project.session_select !== false
        ));
        if (!exists) {
            throw AppError.validation(`project '${projectId}' is not selectable`);
        }
    }

    canAccessProject(projectId, actor = {}) {
        if (!projectId) return true;
        if (!actor || Object.keys(actor).length === 0) return true;
        if (actor.authSource === 'internal' || actor.sub === 'internal_api' || actor.person_id === 'internal_api') return true;
        if (['admin', 'ceo'].includes(String(actor.role || '').toLowerCase())) return true;
        const projectCodes = Array.isArray(actor.projectCodes) ? actor.projectCodes : [];
        if (projectCodes.length === 0) return false;
        const allowedCodes = new Set(projectCodes.flatMap((code) => {
            const normalized = normalizeProjectKey(code);
            return normalized ? [normalized, normalized.replace(/-/g, '')] : [];
        }));
        if (allowedCodes.size === 0) return false;
        const projectConfig = this.projectConfigById.get(projectId) || null;
        const keys = projectAccessKeys(projectId, projectConfig);
        return Array.from(keys).some((key) => allowedCodes.has(key));
    }

    assertProjectAccess(projectId, actor = {}) {
        if (!this.canAccessProject(projectId, actor)) {
            throw AppError.forbidden(`project '${projectId}' is not accessible`);
        }
    }

    assertOrgReferenceAllowed(orgId) {
        if (!orgId) throw AppError.validation('org_id is required');
        if (!this.projectConfigById || this.projectConfigById.size === 0) return;
        const normalizedOrg = normalizeProjectKey(orgId);
        const orgKeys = new Set();
        for (const [projectId, projectConfig] of this.projectConfigById.entries()) {
            for (const key of projectAccessKeys(projectId, projectConfig)) {
                orgKeys.add(key);
            }
        }
        if (!orgKeys.has(normalizedOrg) && !orgKeys.has(normalizedOrg.replace(/-/g, ''))) {
            throw AppError.validation(`org '${orgId}' is not a known Graph org reference`);
        }
    }
}
