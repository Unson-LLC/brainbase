const UNRESOLVED_RESOLVER_REASON = 'authoritative_resolver_unavailable';

function unresolved(ref, reason) {
    return { ref, state: 'unresolved', reason };
}

function accessForActor(actor = {}) {
    return {
        role: typeof actor.role === 'string' && actor.role ? actor.role : 'member',
        projectCodes: Array.isArray(actor.projectCodes) ? actor.projectCodes : [],
        clearance: Array.isArray(actor.clearance) && actor.clearance.length ? actor.clearance : ['internal'],
        organizationId: actor.organizationId || null,
        tenantId: actor.tenantId || null
    };
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
        try {
            return await infoSSOTService.withAccessContext(accessForActor(actor), async (client) => {
                const projectResult = await client.query(
                    'SELECT EXISTS (SELECT 1 FROM projects WHERE code = $1) AS confirmed',
                    [projectCode]
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
