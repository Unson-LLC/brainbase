import { ContractError } from './errors.js';

const REVISION = /^(0|[1-9][0-9]*)$/;

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
    const tenantRevisionString = String(tenantRevision);
    const resourceRevisionString = String(resource?.tenant_revision_at_write);
    if (!tenantId || !REVISION.test(tenantRevisionString) || BigInt(tenantRevisionString) < 1n || !resource
        || !OWNED_OBJECT_TYPES.includes(resource.object_type)
        || !resource.tenant_id || !REVISION.test(resourceRevisionString)) {
        throw new ContractError('TENANT_BOUNDARY_INVALID', { status: 400 });
    }
    if (entryPoint && !TENANT_BOUNDARY_ENTRY_POINTS.includes(entryPoint)) {
        throw new ContractError('TENANT_BOUNDARY_INVALID', { status: 400 });
    }
    if (resource.tenant_id !== tenantId) {
        throw new ContractError('CROSS_TENANT_CANDIDATE', { status: 403, details: { required_action: 'none' } });
    }
    if (BigInt(resourceRevisionString) > BigInt(tenantRevisionString)) {
        throw new ContractError('TENANT_REVISION_MISMATCH', { status: 409 });
    }
    return true;
}

export class TenantBoundaryGateway {
    constructor({ resolveResource } = {}) {
        if (typeof resolveResource !== 'function') throw new Error('Tenant resource resolver is required');
        this.resolveResource = resolveResource;
    }

    async authorize({ tenant_context: tenantContext, entry_point: entryPoint, resource_ref: resourceRef }) {
        const tenantId = tenantContext?.tenant?.tenant_id;
        const tenantRevision = tenantContext?.tenant?.tenant_revision;
        if (!tenantId || !resourceRef || typeof resourceRef !== 'object'
            || !OWNED_OBJECT_TYPES.includes(resourceRef.object_type)
            || typeof resourceRef.resource_id !== 'string' || resourceRef.resource_id.length === 0
            || !TENANT_BOUNDARY_ENTRY_POINTS.includes(entryPoint)
            || Object.keys(resourceRef).some((field) => !['object_type', 'resource_id'].includes(field))) {
            throw new ContractError('TENANT_BOUNDARY_INVALID', { status: 400 });
        }
        const resource = await this.resolveResource({
            tenant_id: tenantId,
            object_type: resourceRef.object_type,
            resource_id: resourceRef.resource_id
        });
        if (!resource) {
            throw new ContractError('CROSS_TENANT_CANDIDATE', {
                status: 403,
                details: { required_action: 'none' }
            });
        }
        assertTenantBoundary({ tenantId, tenantRevision, resource, entryPoint });
        return {
            authorized: true,
            entry_point: entryPoint,
            resource_ref: structuredClone(resourceRef),
            tenant_id: tenantId,
            tenant_revision_at_write: String(resource.tenant_revision_at_write)
        };
    }
}
