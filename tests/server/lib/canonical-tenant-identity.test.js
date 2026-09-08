import { describe, expect, it } from 'vitest';

import {
    requireCanonicalTenantIdentity,
    resolveCanonicalTenantIdentity
} from '../../../server/lib/canonical-tenant-identity.js';

describe('canonical tenant identity', () => {
    it('accepts one organization value across every legacy alias', () => {
        expect(resolveCanonicalTenantIdentity({
            organizationId: 'org_unson',
            organization_id: ' org_unson ',
            tenantId: 'org_unson',
            tenant_id: 'org_unson'
        })).toEqual({ state: 'confirmed', organizationId: 'org_unson' });
    });

    it.each([
        { organizationId: 'org_unson', organization_id: 'org_other' },
        { tenantId: 'org_unson', tenant_id: 'org_other' },
        { organization_id: 'org_unson', tenantId: 'org_other' }
    ])('rejects conflicting tenant aliases: %j', (access) => {
        expect(resolveCanonicalTenantIdentity(access)).toEqual({
            state: 'ambiguous',
            organizationId: null
        });
        expect(() => requireCanonicalTenantIdentity(access)).toThrow(expect.objectContaining({
            code: 'canonical_tenant_identity_invalid',
            identityState: 'ambiguous',
            status: 403
        }));
    });
});
