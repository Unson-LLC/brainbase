// @ts-check
import { canonicalPersonalKgOwner } from '../personal-kg-owner.js';

function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function firstText(...values) {
    for (const value of values) {
        const normalized = text(value);
        if (normalized) return normalized;
    }
    return null;
}

/**
 * Resolve only explicitly supplied Personal KG access. There is intentionally
 * no owner, actor, or organization default in this boundary.
 */
export function requirePersonalKgIdentity(input, env = {}) {
    if (!input || typeof input !== 'object') {
        throw new Error('personal_kg_access_context_required');
    }
    const ownerRaw = firstText(
        input.ownerPersonId,
        input.owner_person_id,
        input.personId,
        input.person_id
    );
    const actorRaw = firstText(
        input.actorPersonId,
        input.actor_person_id,
        input.actorId,
        input.actor_id
    );
    const organizationRaw = firstText(
        input.organizationId,
        input.organization_id,
        input.tenantId,
        input.tenant_id,
        Array.isArray(input.org_ids) && input.org_ids.length === 1 ? input.org_ids[0] : null
    );
    if (!ownerRaw) throw new Error('personal_kg_owner_person_id_required');
    if (!actorRaw) throw new Error('personal_kg_actor_person_id_required');
    if (!organizationRaw) throw new Error('personal_kg_organization_id_required');

    const ownerPersonId = canonicalPersonalKgOwner(ownerRaw, env);
    const actorPersonId = canonicalPersonalKgOwner(actorRaw, env);
    if (!ownerPersonId) throw new Error('personal_kg_owner_person_id_required');
    if (!actorPersonId) throw new Error('personal_kg_actor_person_id_required');
    if (ownerPersonId !== actorPersonId) {
        // A receipt id is only an identifier, not proof of delegation. Until a
        // signed delegation verifier is available at this boundary, delegated
        // Personal KG access must fail closed before any read or write.
        throw new Error('personal_kg_verified_delegation_required');
    }

    const orgIds = Array.isArray(input.org_ids)
        ? input.org_ids.map(text).filter(Boolean)
        : [];
    return {
        ...input,
        sub: ownerPersonId,
        personId: ownerPersonId,
        ownerPersonId,
        owner_person_id: ownerPersonId,
        actorPersonId,
        actor_person_id: actorPersonId,
        organizationId: organizationRaw,
        organization_id: organizationRaw,
        org_ids: [...new Set([organizationRaw, ...orgIds])]
    };
}

export function candidateOrganizationId(candidate) {
    const organizationId = firstText(candidate?.organization_id, candidate?.organizationId);
    if (organizationId) return organizationId;
    const orgIds = Array.isArray(candidate?.org_ids) ? candidate.org_ids.map(text).filter(Boolean) : [];
    return orgIds.length === 1 ? orgIds[0] : null;
}

export function assertPersonalKgCandidateScope(candidate, identity, env = {}, { requireActorMatch = false } = {}) {
    const access = requirePersonalKgIdentity(identity, env);
    if (candidate?.owner_person_id !== access.owner_person_id) {
        throw new Error('personal_kg_candidate_owner_mismatch');
    }
    if (requireActorMatch && candidate?.actor_person_id !== access.actor_person_id) {
        throw new Error('personal_kg_candidate_actor_mismatch');
    }
    const organizationId = candidateOrganizationId(candidate);
    if (!organizationId) throw new Error('personal_kg_candidate_organization_missing');
    if (organizationId !== access.organization_id) {
        throw new Error('personal_kg_candidate_organization_mismatch');
    }
    return candidate;
}

export function isPersonalKgCandidateInScope(candidate, identity, env = {}) {
    try {
        assertPersonalKgCandidateScope(candidate, identity, env);
        return true;
    } catch {
        return false;
    }
}
