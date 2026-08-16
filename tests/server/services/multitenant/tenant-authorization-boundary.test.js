import { describe, expect, it } from 'vitest';
import {
    OWNED_OBJECT_TYPES,
    assertTenantBoundary
} from '../../../../server/services/multitenant/tenant-boundary.js';

describe('tenant authorization boundary', () => {
    it('AC-002: 全帰属objectにtenant_idとwrite時revisionを要求する', () => {
        expect(OWNED_OBJECT_TYPES).toEqual(expect.arrayContaining([
            'organization', 'membership', 'project', 'graph_entity', 'graph_relation',
            'workspace_connection', 'contract', 'usage_event', 'operation_receipt'
        ]));

        for (const objectType of OWNED_OBJECT_TYPES) {
            expect(() => assertTenantBoundary({
                tenantId: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
                tenantRevision: 3,
                resource: { object_type: objectType, tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV', tenant_revision_at_write: 3 }
            })).not.toThrow();
        }
    });

    it('AC-005/AC-305: 全entry pointで越境を同じ非開示エラーにしfallbackしない', () => {
        for (const entryPoint of ['admin_api', 'mcp', 'background_job', 'migration', 'audit_log']) {
            expect(() => assertTenantBoundary({
                tenantId: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
                tenantRevision: 1,
                entryPoint,
                resource: {
                    object_type: 'project',
                    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAW',
                    tenant_revision_at_write: 1
                }
            })).toThrowErrorMatchingObject({ code: 'CROSS_TENANT_CANDIDATE', status: 403 });
        }
    });
});
