import { ContractError } from './errors.js';

export const OWNED_OBJECT_TYPES = Object.freeze([
    'organization',
    'membership',
    'project',
    'graph_entity',
    'graph_relation',
    'workspace_connection',
    'contract',
    'usage_event',
    'operation_receipt'
]);

export const TENANT_BOUNDARY_ENTRY_POINTS = Object.freeze([
    'admin_api', 'mcp', 'background_job', 'migration', 'audit_log'
]);

export function assertTenantBoundary({ tenantId, tenantRevision, resource, entryPoint }) {
    if (!tenantId || !Number.isInteger(tenantRevision) || tenantRevision < 1 || !resource
        || !OWNED_OBJECT_TYPES.includes(resource.object_type)
        || !resource.tenant_id || !Number.isInteger(resource.tenant_revision_at_write)) {
        throw new ContractError('TENANT_BOUNDARY_INVALID', { status: 400 });
    }
    if (entryPoint && !TENANT_BOUNDARY_ENTRY_POINTS.includes(entryPoint)) {
        throw new ContractError('TENANT_BOUNDARY_INVALID', { status: 400 });
    }
    if (resource.tenant_id !== tenantId) {
        throw new ContractError('CROSS_TENANT_CANDIDATE', { status: 403, details: { required_action: 'none' } });
    }
    if (resource.tenant_revision_at_write > tenantRevision) {
        throw new ContractError('TENANT_REVISION_MISMATCH', { status: 409 });
    }
    return true;
}
