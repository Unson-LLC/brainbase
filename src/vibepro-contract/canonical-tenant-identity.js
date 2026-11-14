function normalizedClaim(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

// A Graph organization and a canonical tenant are different namespaces.  The
// binding is intentionally private to this process: callers must receive the
// pair from the authenticated tenant resolver instead of inferring a mapping
// from either identifier's prefix or value.
export const CANONICAL_TENANT_BINDING = Symbol('brainbase.canonicalTenantBinding');

function resolveAliasNamespace(values) {
    const claims = values.map(normalizedClaim).filter(Boolean);
    const identities = new Set(claims);
    if (identities.size > 1) return { state: 'ambiguous', value: '' };
    return claims.length
        ? { state: 'confirmed', value: claims[0] }
        : { state: 'missing', value: '' };
}

function resolvedBinding(access) {
    const binding = access?.[CANONICAL_TENANT_BINDING];
    if (!binding || typeof binding !== 'object') return null;
    const organizationId = normalizedClaim(binding.organizationId);
    const tenantId = normalizedClaim(binding.tenantId);
    return organizationId && tenantId ? { organizationId, tenantId } : null;
}

/**
 * Records the exact organization-to-tenant pair returned by the trusted auth
 * resolver.  The non-enumerable symbol keeps this provenance out of API
 * payloads while allowing authorization consumers to distinguish a resolved
 * namespace mapping from an untrusted pair of claims.
 */
export function attachCanonicalTenantBinding(access, mapping = {}) {
    if (!access || typeof access !== 'object') return access;
    const organizationId = normalizedClaim(mapping.organization_id ?? mapping.organizationId);
    const tenantId = normalizedClaim(mapping.tenant_id ?? mapping.tenantId);
    if (!organizationId || !tenantId || access[CANONICAL_TENANT_BINDING]) return access;
    try {
        Object.defineProperty(access, CANONICAL_TENANT_BINDING, {
            value: Object.freeze({ organizationId, tenantId }),
            enumerable: false,
            writable: false,
            configurable: false
        });
    } catch {
        // A frozen access object cannot carry resolver provenance. Consumers
        // then fail closed when two namespaces disagree.
    }
    return access;
}

/** Preserve resolver provenance across an internal actor projection without inferring a mapping. */
export function copyCanonicalTenantBinding(source, target) {
    const binding = resolvedBinding(source);
    return binding ? attachCanonicalTenantBinding(target, binding) : target;
}

// Legacy tenantId and organizationId are aliases only when they agree.  A
// differing pair is valid only when this process received the exact pair from
// the authenticated tenant resolver; choosing either claim with `||` would
// turn contradictory authentication claims into an authorization bypass.
export function resolveCanonicalTenantIdentity(access = {}) {
    const organization = resolveAliasNamespace([
        access?.organizationId,
        access?.organization_id
    ]);
    const tenant = resolveAliasNamespace([
        access?.tenantId,
        access?.tenant_id
    ]);
    if (organization.state === 'ambiguous' || tenant.state === 'ambiguous') {
        return { state: 'ambiguous', organizationId: null };
    }
    if (organization.state === 'missing' && tenant.state === 'missing') {
        return { state: 'missing', organizationId: null };
    }
    if (organization.state === 'confirmed' && tenant.state === 'confirmed') {
        if (organization.value === tenant.value) {
            return { state: 'confirmed', organizationId: organization.value };
        }
        const binding = resolvedBinding(access);
        if (binding?.organizationId === organization.value && binding.tenantId === tenant.value) {
            return { state: 'confirmed', organizationId: organization.value };
        }
        return { state: 'ambiguous', organizationId: null };
    }
    return {
        state: 'confirmed',
        organizationId: organization.value || tenant.value
    };
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
