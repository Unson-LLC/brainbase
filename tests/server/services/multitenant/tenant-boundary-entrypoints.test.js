import { describe, expect, it, vi } from 'vitest';
import {
    TENANT_BOUNDARY_ENTRY_POINTS,
    TenantBoundaryGateway
} from '../../../../server/services/multitenant/tenant-boundary.js';
import { expectContractErrorAsync } from './test-helpers.js';

const context = {
    tenant: { tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV', tenant_revision: '3' }
};

describe('AC-005 tenant boundary entrypoints', () => {
    it.each(TENANT_BOUNDARY_ENTRY_POINTS)('%sは永続化されたresource ownerを検証し他tenantへfallbackしない', async (entryPoint) => {
        const resolveResource = vi.fn(async () => ({
            object_type: 'project',
            resource_id: 'project-b',
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAW',
            tenant_revision_at_write: '1'
        }));
        const gateway = new TenantBoundaryGateway({ resolveResource });

        await expectContractErrorAsync(
            () => gateway.authorize({
                tenant_context: context,
                entry_point: entryPoint,
                resource_ref: { object_type: 'project', resource_id: 'project-b' }
            }),
            { code: 'CROSS_TENANT_CANDIDATE', status: 403 }
        );
        expect(resolveResource).toHaveBeenCalledOnce();
    });

    it('resource不存在でも別tenant検索へfallbackしない', async () => {
        const resolveResource = vi.fn(async () => null);
        const gateway = new TenantBoundaryGateway({ resolveResource });
        await expectContractErrorAsync(
            () => gateway.authorize({
                tenant_context: context,
                entry_point: 'admin_api',
                resource_ref: { object_type: 'project', resource_id: 'missing' }
            }),
            { code: 'CROSS_TENANT_CANDIDATE', status: 403 }
        );
        expect(resolveResource).toHaveBeenCalledWith({
            tenant_id: context.tenant.tenant_id,
            object_type: 'project',
            resource_id: 'missing'
        });
    });
});
