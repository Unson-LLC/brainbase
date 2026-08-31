// @ts-check

import { AppError } from '../../lib/errors.js';
import { isProjectAllowed, normalizeProjectCode } from './project-code-matcher.js';

function normalizeProjectKey(value) {
    return normalizeProjectCode(value);
}

function organizationIdFromActor(actor = {}) {
    const value = actor.organizationId || actor.organization_id || actor.tenantId || actor.tenant_id || null;
    return typeof value === 'string' ? value.trim() || null : value;
}

function noAuthorityCatalog(status = 'organization_context_required') {
    return {
        projects: [],
        source: {
            status,
            mode: status === 'organization_context_required'
                ? 'registry_scope_required'
                : 'runtime_catalog_source_required'
        }
    };
}

function projectAccessKeys(projectId, projectConfig = null) {
    const keys = new Set();
    const normalizedId = normalizeProjectKey(projectId);
    if (normalizedId) {
        keys.add(normalizedId);
    }
    const aliases = Array.isArray(projectConfig?.aliases) ? projectConfig.aliases : [];
    for (const alias of aliases) {
        const normalizedAlias = normalizeProjectKey(alias);
        if (normalizedAlias) {
            keys.add(normalizedAlias);
        }
    }
    const githubRepo = normalizeProjectKey(projectConfig?.github?.repo);
    if (githubRepo) {
        keys.add(githubRepo);
    }
    return keys;
}

export class ProjectAccessPolicy {
    constructor({ configParser = null } = {}) {
        this.configParser = configParser;
        this.projectConfigByOrganization = new Map();
        this.projectCatalogStatusByOrganization = new Map();
    }

    _organizationKey(actor = {}) {
        return organizationIdFromActor(actor) || '__legacy__';
    }

    _projectCatalog(actor = {}) {
        return this.projectConfigByOrganization.get(this._organizationKey(actor)) || new Map();
    }

    _projectCatalogStatus(actor = {}) {
        return this.projectCatalogStatusByOrganization.get(this._organizationKey(actor)) || null;
    }

    async prepare(actor = {}) {
        const organizationId = organizationIdFromActor(actor);
        const organizationKey = this._organizationKey(actor);
        let projectConfig;
        if (!organizationId) {
            // A person/grant without an organization is not a membership proof.
            // Keep the legacy parser available to explicit legacy callers, but do
            // not let this authorization policy read it as a runtime catalog.
            projectConfig = noAuthorityCatalog();
        } else if (!this.configParser?.getProjects) {
            projectConfig = noAuthorityCatalog('unavailable');
        } else {
            projectConfig = this.configParser?.runForOrganization
                ? await this.configParser.runForOrganization(organizationId, () => this.configParser.getProjects())
                : await this.configParser.getProjects();
        }
        this.projectConfigByOrganization.set(
            organizationKey,
            new Map((projectConfig.projects || []).map((project) => [project.id, project]))
        );
        this.projectCatalogStatusByOrganization.set(
            organizationKey,
            projectConfig?.source?.status || null
        );
        return projectConfig;
    }

    async assertProjectSelectable(projectId, actor = {}) {
        if (!projectId) throw AppError.validation('project_id is required');
        if (projectId === 'general') return;
        const projectConfig = await this.prepare(actor);
        if (projectConfig?.source?.status !== 'loaded') {
            throw AppError.validation(`project '${projectId}' is not selectable`);
        }
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
        if (actor.authSource === 'internal' || actor.sub === 'internal_api' || actor.person_id === 'internal_api') return true;
        if (!organizationIdFromActor(actor)) return false;
        if (this._projectCatalogStatus(actor) !== 'loaded') return false;
        const projectCodes = Array.isArray(actor.projectCodes) ? actor.projectCodes : [];
        if (projectCodes.length === 0) return false;
        const projectConfig = this._projectCatalog(actor).get(projectId) || null;
        const project = {
            ...(projectConfig || {}),
            id: projectConfig?.id || projectId
        };
        return isProjectAllowed(project, projectCodes);
    }

    assertProjectAccess(projectId, actor = {}) {
        if (!this.canAccessProject(projectId, actor)) {
            throw AppError.forbidden(`project '${projectId}' is not accessible`);
        }
    }

    assertOrgReferenceAllowed(orgId, actor = {}) {
        if (!orgId) throw AppError.validation('org_id is required');
        if (!organizationIdFromActor(actor) || this._projectCatalogStatus(actor) !== 'loaded') {
            throw AppError.validation(`org '${orgId}' is not a known Graph org reference`);
        }
        const projectCatalog = this._projectCatalog(actor);
        if (projectCatalog.size === 0) return;
        const normalizedOrg = normalizeProjectKey(orgId);
        const orgKeys = new Set();
        for (const [projectId, projectConfig] of projectCatalog.entries()) {
            for (const key of projectAccessKeys(projectId, projectConfig)) {
                orgKeys.add(key);
            }
        }
        if (!orgKeys.has(normalizedOrg)) {
            throw AppError.validation(`org '${orgId}' is not a known Graph org reference`);
        }
    }
}
