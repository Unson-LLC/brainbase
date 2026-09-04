import { ContractError } from './errors.js';

export const AUTHORITY_MCP_OPERATION = 'brainbase.authority_mcp.post';
export const AUTHORITY_JUDGMENT_HOOK_OPERATION = 'brainbase.authority_judgment_hook.post';
export const AUTHORITY_PROVIDER_OPERATIONS = new Set([
    AUTHORITY_MCP_OPERATION,
    AUTHORITY_JUDGMENT_HOOK_OPERATION
]);
export const AUTHORITY_PROJECT_BOUND_MCP_TOOLS = new Set([
    'brainbase_knowledge_resolve'
]);

const PROJECT_OVERRIDE_FIELDS = new Set([
    'project',
    'project_id',
    'project_code',
    'project_ids',
    'project_codes'
]);

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function failProjectScope(reason) {
    throw new ContractError('PROJECT_SCOPE_MISMATCH', {
        status: 403,
        fault_domain: 'protocol',
        details: { scope_reason: reason }
    });
}

export function deriveSingleAuthorityProjectId(tenantContext) {
    const projectIds = tenantContext?.authorization?.project_ids;
    if (!Array.isArray(projectIds)
        || projectIds.length !== 1
        || typeof projectIds[0] !== 'string'
        || projectIds[0].length === 0) {
        failProjectScope('exactly_one_project_required');
    }
    return projectIds[0];
}

function activeStatus(project) {
    const payload = isObject(project?.project_payload) ? project.project_payload : {};
    return project?.status
        ?? project?.project_status
        ?? payload.status;
}

function activeFlag(project) {
    const payload = isObject(project?.project_payload) ? project.project_payload : {};
    return project?.active
        ?? project?.is_active
        ?? payload.active
        ?? payload.is_active;
}

export function isActiveAuthorityProject(project) {
    if (!isObject(project)) return false;
    const status = activeStatus(project);
    if (typeof status !== 'string' || status.toLowerCase() !== 'active') {
        return false;
    }
    const active = activeFlag(project);
    return active !== false;
}

export function authorityProjectBinding(project, { tenantId, projectId } = {}) {
    if (!isObject(project)
        || (tenantId !== undefined && project.tenant_id !== tenantId)
        || project.project_id !== projectId
        || typeof project.project_code !== 'string'
        || project.project_code.length === 0
        || !isActiveAuthorityProject(project)) {
        failProjectScope('project_not_active_or_owned');
    }
    return Object.freeze({
        project_id: projectId,
        project_code: project.project_code
    });
}

export function isAuthorityProjectBinding(value) {
    return isObject(value)
        && Object.keys(value).length === 2
        && typeof value.project_id === 'string'
        && value.project_id.length > 0
        && typeof value.project_code === 'string'
        && value.project_code.length > 0;
}

export function assertAuthorityProjectBinding(value) {
    if (!isAuthorityProjectBinding(value)) failProjectScope('canonical_project_binding_invalid');
    return value;
}

function stripDirectProjectOverrides(value) {
    return Object.fromEntries(Object.entries(value)
        .filter(([field]) => !PROJECT_OVERRIDE_FIELDS.has(field)));
}

export function injectAuthorityProject(request, projectBinding) {
    assertAuthorityProjectBinding(projectBinding);
    if (!isObject(request)
        || !isObject(request.body)
        || request.body.jsonrpc !== '2.0'
        || request.body.method !== 'tools/call'
        || !isObject(request.body.params)
        || !AUTHORITY_PROJECT_BOUND_MCP_TOOLS.has(request.body.params.name)
        || !isObject(request.body.params.arguments)) {
        throw new ContractError('SCHEMA_INVALID', { status: 400, fault_domain: 'protocol' });
    }
    const body = stripDirectProjectOverrides(request.body);
    const params = stripDirectProjectOverrides(body.params);
    const args = stripDirectProjectOverrides(params.arguments);
    return {
        ...structuredClone(request),
        body: {
            ...body,
            params: {
                ...params,
                arguments: {
                    ...args,
                    project_code: projectBinding.project_code
                }
            }
        }
    };
}
