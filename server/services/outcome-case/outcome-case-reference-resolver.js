const UNRESOLVED_RESOLVER_REASON = 'authoritative_resolver_unavailable';

import { resolveCanonicalTenantIdentity } from '../../lib/canonical-tenant-identity.js';

function unresolved(ref, reason) {
    return { ref, state: 'unresolved', reason };
}

function accessForActor(actor = {}) {
    const identity = resolveCanonicalTenantIdentity(actor);
    return {
        role: typeof actor.role === 'string' && actor.role ? actor.role : 'member',
        projectCodes: Array.isArray(actor.projectCodes) ? actor.projectCodes : [],
        // Clearance is an authentication claim, not a convenience default.
        // In particular, an empty claim must not make an internal RACI row
        // visible and thereby nominate a closer.
        clearance: Array.isArray(actor.clearance) ? actor.clearance : [],
        organizationId: identity.state === 'confirmed' ? identity.organizationId : null
    };
}

function organizationIdForActor(actor = {}) {
    const identity = resolveCanonicalTenantIdentity(actor);
    return identity.state === 'confirmed' ? identity.organizationId : '';
}

function organizationContextReason(actor = {}) {
    return resolveCanonicalTenantIdentity(actor).state === 'ambiguous'
        ? 'organization_context_ambiguous'
        : 'organization_context_required';
}

/**
 * Resolve OutcomeCase references through read-only, authoritative PostgreSQL
 * tables. A missing capability registry is deliberately unresolved: callers
 * must not infer a capability from request text or close the case.
 */
export function createOutcomeCaseReferenceResolver({ infoSSOTService } = {}) {
    if (!infoSSOTService || typeof infoSSOTService.withAccessContext !== 'function') {
        throw new Error('OutcomeCase reference resolver requires InfoSSOT access context');
    }

    return async function resolveOutcomeReferences({ projectCode, capabilityId, actor = {} } = {}) {
        const organizationId = organizationIdForActor(actor);
        if (!organizationId) {
            const reason = organizationContextReason(actor);
            return {
                project: unresolved(projectCode, reason),
                capability: unresolved(capabilityId, reason)
            };
        }
        try {
            return await infoSSOTService.withAccessContext(accessForActor(actor), async (client) => {
                const projectResult = await client.query(
                    'SELECT EXISTS (SELECT 1 FROM projects WHERE code = $1 AND organization_id = $2) AS confirmed',
                    [projectCode, organizationId]
                );
                const capabilityRegistryResult = await client.query(
                    "SELECT to_regclass('brainbase_capabilities') AS relation_name"
                );
                const capabilityRegistryExists = Boolean(capabilityRegistryResult.rows[0]?.relation_name);
                const capabilityResult = capabilityRegistryExists
                    ? await client.query(
                        "SELECT EXISTS (SELECT 1 FROM brainbase_capabilities WHERE capability_id = $1 AND status = 'active') AS confirmed",
                        [capabilityId]
                    )
                    : { rows: [{ confirmed: false }] };

                return {
                    project: projectResult.rows[0]?.confirmed
                        ? { ref: projectCode, state: 'confirmed' }
                        : unresolved(projectCode, 'project_not_found'),
                    capability: capabilityResult.rows[0]?.confirmed
                        ? { ref: capabilityId, state: 'confirmed' }
                        : unresolved(
                            capabilityId,
                            capabilityRegistryExists ? 'capability_not_found' : 'capability_registry_unavailable'
                        )
                };
            });
        } catch {
            return {
                project: unresolved(projectCode, UNRESOLVED_RESOLVER_REASON),
                capability: unresolved(capabilityId, UNRESOLVED_RESOLVER_REASON)
            };
        }
    };
}

/** Read-only RACI authority lookup. Request payloads never nominate closers. */
export function createOutcomeCaseClosureAuthorityResolver({ infoSSOTService } = {}) {
    if (!infoSSOTService || typeof infoSSOTService.withAccessContext !== 'function') {
        throw new Error('OutcomeCase closure authority resolver requires InfoSSOT access context');
    }
    return async function resolveClosureAuthority({ projectCode, actor = {} } = {}) {
        const organizationId = organizationIdForActor(actor);
        if (!organizationId) {
            return { state: 'unresolved', closure_authorized_person_ids: [], provenance: null, reason: organizationContextReason(actor) };
        }
        try {
            return await infoSSOTService.withAccessContext(accessForActor(actor), async (client) => {
                const result = await client.query(
                    `SELECT r.person_id, r.role_code
                     FROM raci_assignments r
                     JOIN projects p ON p.id = r.project_id
                     WHERE p.code = $1
                       AND p.organization_id = $3
                       AND r.role_code = ANY($2::text[])
                     ORDER BY r.person_id`,
                    [projectCode, ['outcome_case:close', 'decision:outcome_case', 'decision:最終決裁'], organizationId]
                );
                const ids = [...new Set(result.rows.map((row) => row.person_id).filter(Boolean))];
                return ids.length
                    ? { state: 'confirmed', closure_authorized_person_ids: ids, provenance: { source: 'info_ssot_raci', project_code: projectCode, role_codes: [...new Set(result.rows.map((row) => row.role_code))] } }
                    : { state: 'unresolved', closure_authorized_person_ids: [], provenance: null, reason: 'closure_authority_not_found' };
            });
        } catch {
            return { state: 'unresolved', closure_authorized_person_ids: [], provenance: null, reason: UNRESOLVED_RESOLVER_REASON };
        }
    };
}
