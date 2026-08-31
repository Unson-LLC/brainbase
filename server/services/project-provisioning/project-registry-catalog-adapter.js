import { AsyncLocalStorage } from 'node:async_hooks';

export class ProjectRegistryCatalogAdapter {
    constructor({ repository, fallbackConfigParser = null }) {
        this.repository = repository;
        this.fallbackConfigParser = fallbackConfigParser;
        this.organizationContext = new AsyncLocalStorage();
    }

    runForOrganization(organizationId, callback) {
        return this.organizationContext.run(organizationId, callback);
    }

    async checkIntegrity() {
        const organizationId = this.organizationContext.getStore();
        if (!organizationId) {
            try {
                const available = await this.repository.checkAvailability?.();
                return available
                    ? { applicability: 'applicable', source: { status: 'loaded', scope: 'schema' }, summary: { errors: 0 } }
                    : { applicability: 'applicable', source: { status: 'unavailable', scope: 'schema' }, summary: { errors: 1 } };
            } catch (error) {
                return {
                    applicability: 'applicable',
                    source: { status: 'unavailable', scope: 'schema', code: error?.code || 'PROJECT_REGISTRY_UNAVAILABLE' },
                    summary: { errors: 1 }
                };
            }
        }
        try {
            await this.repository.listProjects(organizationId);
            return { applicability: 'applicable', source: { status: 'loaded' }, summary: { errors: 0 } };
        } catch (error) {
            return {
                applicability: 'fallback_only',
                source: { status: 'unavailable', code: error?.code || 'PROJECT_REGISTRY_UNAVAILABLE' },
                summary: { errors: 1 }
            };
        }
    }

    async getProjects() {
        const organizationId = this.organizationContext.getStore();
        // Never query the multi-tenant registry without an explicit organization.
        // Legacy callers must use the local config parser explicitly; this adapter
        // is the runtime catalog boundary and therefore has no authority without
        // an organization scope.
        if (!organizationId) {
            return {
                projects: [],
                source: { status: 'organization_context_required', mode: 'registry_scope_required' }
            };
        }
        const fallback = this.fallbackConfigParser?.getProjects
            ? await this.fallbackConfigParser.getProjects()
            : { projects: [] };
        let rows;
        try {
            rows = await this.repository.listProjects(organizationId);
        } catch (error) {
            // A rolling deployment may start the application before the registry
            // migration is present. Do not turn an unavailable Registry into an
            // organization membership or permission grant through the legacy catalog.
            if (['42P01', 'PROJECT_REGISTRY_UNAVAILABLE'].includes(error?.code)) {
                return {
                    ...fallback,
                    projects: [],
                    source: {
                        status: 'unavailable',
                        mode: 'registry_unavailable',
                        code: error?.code || 'PROJECT_REGISTRY_UNAVAILABLE'
                    }
                };
            }
            throw error;
        }
        const fallbackById = new Map((fallback.projects || []).map((project) => [project.id, project]));
        const merged = new Map();
        for (const row of rows) {
            // Registry membership is the organization boundary. Legacy config may
            // enrich a matching Registry row with local-only metadata, but must
            // never introduce a fallback-only project into this organization.
            const existing = fallbackById.get(row.project_code) || {};
            const repository = row.repository || {};
            merged.set(row.project_code, {
                ...existing,
                id: row.project_code,
                name: row.display_name,
                catalog_version: row.catalog_version,
                archived: row.lifecycle_status !== 'active',
                session_select: row.session_select,
                organization_entity_id: row.organization_entity_id,
                owner_person_id: row.owner_person_id,
                ...(repository.mode !== 'none' ? {
                    github: {
                        ...(existing.github || {}),
                        owner: repository.owner,
                        repo: repository.repo,
                        branch: existing.github?.branch || 'main'
                    }
                } : {})
            });
        }
        return {
            root: fallback.root,
            projects: Array.from(merged.values()),
            source: { status: 'loaded', mode: 'registry_scoped' }
        };
    }
}
