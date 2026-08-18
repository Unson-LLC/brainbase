import { deepFreeze } from './canonical-json.js';
import { ContractError } from './errors.js';
import { generateCanonicalId, isCanonicalId } from './ids.js';

const TRANSITIONS = Object.freeze({
    provisioning: new Set(['active']),
    active: new Set(['suspended', 'deletion_pending']),
    suspended: new Set(['active', 'deletion_pending']),
    deletion_pending: new Set(['deleted']),
    deleted: new Set()
});

export class TenantAuthority {
    #tenants = new Map();

    constructor({ now = () => new Date() } = {}) {
        this.now = now;
    }

    createTenant({ displayName }) {
        if (!displayName || typeof displayName !== 'string') {
            throw new ContractError('TENANT_INVALID', { status: 400 });
        }
        const now = this.now().toISOString();
        const tenant = {
            tenant_id: generateCanonicalId('ten'),
            tenant_revision: '1',
            status: 'provisioning',
            display_name: displayName,
            created_at: now,
            updated_at: now,
            suspension_reason_code: null,
            deletion_after: null
        };
        this.#tenants.set(tenant.tenant_id, tenant);
        return deepFreeze(structuredClone(tenant));
    }

    transitionTenant(tenantId, expectedRevision, nextStatus, details = {}) {
        const current = this.#tenants.get(tenantId);
        if (!current) throw new ContractError('TENANT_UNKNOWN', { status: 404 });
        if (current.tenant_revision !== expectedRevision) {
            throw new ContractError('TENANT_REVISION_MISMATCH', { status: 409 });
        }
        if (!TRANSITIONS[current.status]?.has(nextStatus)) {
            throw new ContractError('TENANT_INVALID_TRANSITION', { status: 409 });
        }
        const updated = {
            ...current,
            tenant_revision: String(Number(current.tenant_revision) + 1),
            status: nextStatus,
            updated_at: this.now().toISOString(),
            suspension_reason_code: nextStatus === 'suspended' ? (details.reason_code ?? 'unspecified') : null,
            deletion_after: nextStatus === 'deletion_pending' ? (details.deletion_after ?? null) : current.deletion_after
        };
        this.#tenants.set(tenantId, updated);
        return deepFreeze(structuredClone(updated));
    }

    resolveTenant(selector = {}) {
        const candidates = selector.tenant_ids ?? (selector.tenant_id ? [selector.tenant_id] : []);
        if (!Array.isArray(candidates) || candidates.length === 0) {
            throw new ContractError('TENANT_UNKNOWN', { status: 403 });
        }
        const unique = [...new Set(candidates)];
        if (unique.length !== 1) throw new ContractError('TENANT_AMBIGUOUS', { status: 403 });
        const tenantId = unique[0];
        if (!isCanonicalId(tenantId, 'ten')) throw new ContractError('TENANT_UNKNOWN', { status: 403 });
        const tenant = this.#tenants.get(tenantId);
        if (!tenant || tenant.status !== 'active') throw new ContractError('TENANT_UNKNOWN', { status: 403 });
        return deepFreeze(structuredClone(tenant));
    }

    async resolveContext({ tenant_id, expected_tenant_revision } = {}) {
        const tenant = this.resolveTenant({ tenant_id });
        if (expected_tenant_revision !== undefined && tenant.tenant_revision !== expected_tenant_revision) {
            throw new ContractError('TENANT_REVISION_MISMATCH', { status: 409 });
        }
        return deepFreeze({ tenant });
    }

    getTenant(tenantId) {
        const tenant = this.#tenants.get(tenantId);
        return tenant ? deepFreeze(structuredClone(tenant)) : null;
    }
}
