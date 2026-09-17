import { normalizeRepositoryRelativePath } from './canonical-document-writer-adapter.js';

export const DOCUMENT_SOURCE_REGISTRATION_SCHEMA_VERSION = 'knowledge_document_source_registration.v1';

const SOURCE_CLASS = 'owning_repo';
const CONTENT_TYPE = 'team_document';

function pointerError(code, message, status = 503, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    error.details = details;
    return error;
}

function requiredText(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        throw pointerError(
            'knowledge_document_graph_pointer_required',
            `Graph document source registration is missing ${field}`,
            503,
            { reason: 'graph_source_registration_incomplete', missing_fields: [field] }
        );
    }
    return value.trim();
}

function registrationRepository(registration) {
    if (!registration?.registry_repository) return null;
    if (typeof registration.registry_repository === 'object' && !Array.isArray(registration.registry_repository)) {
        return registration.registry_repository;
    }
    if (typeof registration.registry_repository !== 'string') return null;
    try {
        const parsed = JSON.parse(registration.registry_repository);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function normalizePathScope(value) {
    const path = requiredText(value, 'path_scope').replace(/\/+$/u, '');
    try {
        return normalizeRepositoryRelativePath(path);
    } catch {
        throw pointerError(
            'knowledge_document_graph_pointer_required',
            'Graph document source registration path_scope must be repository-relative',
            503,
            { reason: 'graph_source_registration_incomplete', field: 'path_scope' }
        );
    }
}

/**
 * Resolve the persisted Graph registration into the exact pointer consumed
 * by the document authoring service.  This intentionally does not consult
 * local config: missing or inconsistent registration stays unavailable.
 */
export function resolveRegisteredDocumentPointer(registration, { projectCode, access } = {}) {
    const tenantId = access?.organizationId || access?.tenantId;
    if (!tenantId) {
        throw pointerError(
            'knowledge_document_tenant_required',
            'authenticated organization is required before resolving a document Graph pointer',
            403
        );
    }
    if (!projectCode || registration?.project_code !== projectCode) {
        throw pointerError(
            'knowledge_document_graph_pointer_mismatch',
            'Graph document source registration does not match the current project',
            503,
            { project_code: projectCode || null, registered_project_code: registration?.project_code || null }
        );
    }
    if (registration.organization_id !== tenantId || registration.tenant_id !== tenantId) {
        throw pointerError(
            'knowledge_document_tenant_mismatch',
            'Graph document source registration tenant does not match the authenticated organization',
            403,
            { project_code: projectCode }
        );
    }

    const missing = [];
    for (const field of [
        'source_class', 'content_type', 'repository_owner', 'repository_name',
        'branch', 'path_scope', 'graph_project_id', 'graph_entity_id'
    ]) {
        if (typeof registration[field] !== 'string' || !registration[field].trim()) missing.push(field);
    }
    if (missing.length) {
        throw pointerError(
            'knowledge_document_graph_pointer_required',
            'Graph document source registration is incomplete',
            503,
            { reason: 'graph_source_registration_incomplete', missing_fields: missing }
        );
    }
    if (registration.registration_status !== 'active') {
        throw pointerError(
            'knowledge_document_graph_pointer_required',
            'Graph document source registration is not active',
            503,
            { reason: 'graph_source_registration_inactive', status: registration.registration_status }
        );
    }
    if (registration.source_class !== SOURCE_CLASS || registration.content_type !== CONTENT_TYPE) {
        throw pointerError(
            'knowledge_document_graph_pointer_required',
            'Graph document source registration is not an owning repository team document',
            503,
            {
                reason: 'graph_source_registration_unsupported',
                source_class: registration.source_class,
                content_type: registration.content_type
            }
        );
    }
    if (registration.graph_entity_type !== 'project' || registration.graph_entity_lifecycle_status !== 'active') {
        throw pointerError(
            'knowledge_document_graph_pointer_required',
            'Graph document source registration is not bound to an active project entity',
            503,
            {
                reason: 'graph_source_graph_entity_unavailable',
                graph_entity_id: registration.graph_entity_id,
                graph_entity_type: registration.graph_entity_type || null,
                graph_entity_lifecycle_status: registration.graph_entity_lifecycle_status || null
            }
        );
    }

    const registryRepository = registrationRepository(registration);
    const repositoryOwner = registration.repository_owner.trim();
    const repositoryName = registration.repository_name.trim();
    if (!registryRepository?.owner || !registryRepository?.repo) {
        throw pointerError(
            'knowledge_document_graph_pointer_required',
            'project registry owner/repo is required for the Graph document source',
            503,
            { reason: 'project_registry_repository_incomplete', project_code: projectCode }
        );
    }
    if (registryRepository.owner !== repositoryOwner || registryRepository.repo !== repositoryName) {
        throw pointerError(
            'knowledge_document_graph_pointer_mismatch',
            'Graph document source owner/repo does not match the project registry',
            503,
            {
                project_code: projectCode,
                graph_owner: repositoryOwner,
                graph_repo: repositoryName,
                registry_owner: registryRepository.owner,
                registry_repo: registryRepository.repo
            }
        );
    }

    return {
        status: 'resolved',
        schema_version: DOCUMENT_SOURCE_REGISTRATION_SCHEMA_VERSION,
        source_class: SOURCE_CLASS,
        content_type: CONTENT_TYPE,
        project_code: projectCode,
        canonical_location: {
            repository: `project:${projectCode}`,
            owner: repositoryOwner,
            repo: repositoryName,
            tenant_id: tenantId,
            branch: requiredText(registration.branch, 'branch'),
            path: `${normalizePathScope(registration.path_scope)}/`
        },
        graph_registration: {
            tenant_id: tenantId,
            project_code: projectCode,
            graph_project_id: registration.graph_project_id.trim(),
            graph_entity_id: registration.graph_entity_id.trim(),
            registration_status: 'active'
        },
        retrieval_capability: 'repository.read',
        confidence: 1,
        rationale: 'Resolved from the tenant-scoped Graph owning repository source registration.'
    };
}

export class KnowledgeDocumentGraphPointerResolver {
    constructor({ graphRepository }) {
        this.graphRepository = graphRepository;
    }

    async resolve({ access, project_code: projectCode } = {}) {
        if (!access) {
            throw pointerError('knowledge_access_required', 'knowledge Graph access context is required', 403);
        }
        if (!projectCode || !Array.isArray(access.projectCodes) || !access.projectCodes.includes(projectCode)) {
            throw pointerError('knowledge_project_not_accessible', 'project is not accessible', 403, {
                project_code: projectCode || null
            });
        }
        if (typeof this.graphRepository?.readDocumentSourceRegistration !== 'function') {
            throw pointerError(
                'knowledge_document_graph_pointer_required',
                'Graph document source registration readback is not configured',
                503,
                { reason: 'graph_source_registration_reader_unconfigured' }
            );
        }

        let registration;
        try {
            registration = await this.graphRepository.readDocumentSourceRegistration({
                project_code: projectCode
            }, { access });
        } catch (error) {
            if (error?.code === '42P01' || error?.code === '42703') {
                throw pointerError(
                    'knowledge_document_graph_pointer_required',
                    'Graph document source registration schema is unavailable',
                    503,
                    { reason: 'graph_source_registration_schema_unavailable' }
                );
            }
            if (typeof error?.code === 'string' && error.code.startsWith('knowledge_')) throw error;
            throw pointerError(
                'knowledge_document_graph_pointer_unavailable',
                'Graph document source registration readback is unavailable',
                503
            );
        }
        if (!registration) {
            throw pointerError(
                'knowledge_document_graph_pointer_required',
                'a resolved owning repository Graph pointer is required before document save',
                503,
                { reason: 'graph_source_registration_not_found', project_code: projectCode }
            );
        }
        return resolveRegisteredDocumentPointer(registration, { projectCode, access });
    }
}
