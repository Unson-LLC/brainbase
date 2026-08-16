import { describe, expect, it } from 'vitest';
import { TenantAuthority } from '../../../../server/services/multitenant/tenant-authority.js';
import { isCanonicalId } from '../../../../server/services/multitenant/ids.js';
import { expectContractError } from './test-helpers.js';

describe('TenantAuthority', () => {
    it('AC-001: canonical IDを発行し、許可された状態遷移と終端削除だけを受理する', () => {
        const authority = new TenantAuthority();
        const tenant = authority.createTenant({ displayName: 'Tenant A' });

        expect(isCanonicalId(tenant.tenant_id, 'ten')).toBe(true);
        expect(tenant.status).toBe('provisioning');
        expect(authority.transitionTenant(tenant.tenant_id, 1, 'active').tenant_revision).toBe(2);
        expect(authority.transitionTenant(tenant.tenant_id, 2, 'deletion_pending').status).toBe('deletion_pending');
        expect(authority.transitionTenant(tenant.tenant_id, 3, 'deleted').status).toBe('deleted');
        expectContractError(() => authority.transitionTenant(tenant.tenant_id, 4, 'active'), {
            code: 'TENANT_INVALID_TRANSITION'
        });
    });

    it('AC-003: workspace ID、project code、organization名をtenant IDとして解決しない', () => {
        const authority = new TenantAuthority();
        const tenant = authority.createTenant({ displayName: 'same-name' });
        authority.transitionTenant(tenant.tenant_id, 1, 'active');

        for (const selector of [
            { workspace_id: 'W_PROVIDER' },
            { project_code: 'same-name' },
            { organization_name: 'same-name' }
        ]) {
            expectContractError(() => authority.resolveTenant(selector), { code: 'TENANT_UNKNOWN' });
        }
    });

    it('AC-004: 未解決、複数解決、無効tenantを業務処理前に分類して拒否する', () => {
        const authority = new TenantAuthority();
        const first = authority.createTenant({ displayName: 'A' });
        const second = authority.createTenant({ displayName: 'B' });
        authority.transitionTenant(first.tenant_id, 1, 'active');
        authority.transitionTenant(second.tenant_id, 1, 'active');

        expectContractError(() => authority.resolveTenant({ tenant_ids: [] }), { code: 'TENANT_UNKNOWN' });
        expectContractError(
            () => authority.resolveTenant({ tenant_ids: [first.tenant_id, second.tenant_id] }),
            { code: 'TENANT_AMBIGUOUS' }
        );
        expectContractError(
            () => authority.resolveTenant({ tenant_id: 'ten_00000000000000000000000000' }),
            { code: 'TENANT_UNKNOWN' }
        );
    });

    it('D-001/AC-003: tenant-context resolverへcanonical tenant revisionだけを返す', async () => {
        const authority = new TenantAuthority();
        const created = authority.createTenant({ displayName: 'Runtime tenant' });
        const active = authority.transitionTenant(created.tenant_id, 1, 'active');
        await expect(authority.resolveContext({ tenant_id: active.tenant_id, expected_tenant_revision: 2 }))
            .resolves.toMatchObject({ tenant: { tenant_id: active.tenant_id, tenant_revision: 2 } });
        await expect(authority.resolveContext({ tenant_id: active.tenant_id, expected_tenant_revision: 1 }))
            .rejects.toMatchObject({ code: 'TENANT_REVISION_MISMATCH' });
    });
});
