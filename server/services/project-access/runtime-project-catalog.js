import { filterProjectsForAccess } from './project-code-matcher.js';

export async function loadRuntimeProjectCatalog(projectCatalogParser, access = {}) {
    const isRuntimeCatalog = typeof projectCatalogParser?.runForOrganization === 'function';
    const organizationId = access?.organizationId || access?.tenantId || null;
    if (isRuntimeCatalog && !organizationId) {
        return {
            projects: [],
            source: { status: 'organization_context_required', mode: 'registry_scope_required' }
        };
    }

    const load = async () => {
        if (typeof projectCatalogParser?.getProjects === 'function') {
            return projectCatalogParser.getProjects();
        }
        const config = await projectCatalogParser.getAll();
        return config.projects || { projects: [] };
    };
    const catalog = isRuntimeCatalog
        ? await projectCatalogParser.runForOrganization(organizationId, load)
        : await load();
    const source = catalog?.source || (isRuntimeCatalog
        ? { status: 'runtime_catalog_source_required', mode: 'runtime_catalog_source_required' }
        : null);
    if (isRuntimeCatalog && source?.status !== 'loaded') {
        return { projects: [], source };
    }

    const activeProjects = (catalog?.projects || []).filter((project) => !project.archived);
    const shouldFilterForAccess = isRuntimeCatalog || Array.isArray(access?.projectCodes);
    return {
        ...catalog,
        projects: shouldFilterForAccess
            ? filterProjectsForAccess(activeProjects, access || {})
            : activeProjects,
        ...(source ? { source } : {})
    };
}

export function catalogUnavailableResponse(res, source) {
    return res.status(503).json({
        error: 'Project catalog unavailable',
        source: source || { status: 'unavailable', mode: 'runtime_catalog_source_required' }
    });
}

export function catalogTechnicalMetadataUnavailable(catalog) {
    return catalog?.source?.status === 'loaded'
        && catalog.source.enrichment_status === 'unavailable';
}
