function normalizedClaim(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

// Legacy tenantId and organizationId are aliases only when they agree.
// Choosing either with `||` would turn contradictory authentication claims
// into an authorization bypass.
export function resolveCanonicalTenantIdentity(access = {}) {
    const organizationId = normalizedClaim(access?.organizationId ?? access?.organization_id);
    const tenantId = normalizedClaim(access?.tenantId ?? access?.tenant_id);
    if (!organizationId && !tenantId) return { state: 'missing', organizationId: null };
    if (organizationId && tenantId && organizationId !== tenantId) {
        return { state: 'ambiguous', organizationId: null };
    }
    return { state: 'confirmed', organizationId: organizationId || tenantId };
}

export class CanonicalTenantIdentityError extends Error {
    constructor(state) {
        super(state === 'ambiguous'
            ? 'Conflicting authenticated organization claims'
            : 'An authenticated organization is required');
        this.name = 'CanonicalTenantIdentityError';
        this.code = 'canonical_tenant_identity_invalid';
        this.identityState = state;
        this.status = 403;
    }
}

export function requireCanonicalTenantIdentity(access = {}) {
    const identity = resolveCanonicalTenantIdentity(access);
    if (identity.state !== 'confirmed') throw new CanonicalTenantIdentityError(identity.state);
    return identity.organizationId;
}
