const TARGET = {
    version: 'outcome-case-control-plane.v1',
    organization_id: 'unson',
    project_id: 'prj_01KGCS8CAJKKDWACPNK1E5WX8H',
    project_code: 'brainbase',
    capability: {
        capability_id: 'cap_outcome_control',
        status: 'active'
    },
    closure_authority: {
        person_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5',
        role_code: 'outcome_case:close',
        authority_scope: 'outcome_case.close',
        sensitivity_min: 'gm',
        sensitivity: 'internal'
    }
};

export const OUTCOME_CASE_CONTROL_PLANE_TARGET = Object.freeze({
    ...TARGET,
    capability: Object.freeze({ ...TARGET.capability }),
    closure_authority: Object.freeze({ ...TARGET.closure_authority })
});

export class OutcomeCaseProductionProvisioningError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

function fail(code, message) {
    throw new OutcomeCaseProductionProvisioningError(code, message);
}

function provisioningAccess() {
    return {
        role: 'ceo',
        projectCodes: [TARGET.project_code],
        clearance: [TARGET.closure_authority.sensitivity],
        organizationId: TARGET.organization_id,
        tenantId: TARGET.organization_id
    };
}

function publicState({ capability, closureAuthority }) {
    return {
        capability: capability
            ? { capability_id: TARGET.capability.capability_id, status: capability.status }
            : null,
        closure_authority: closureAuthority
            ? {
                person_id: closureAuthority.person_id,
                role_code: closureAuthority.role_code,
                authority_scope: closureAuthority.authority_scope,
                sensitivity_min: closureAuthority.sensitivity_min,
                sensitivity: closureAuthority.sensitivity
            }
            : null
    };
}

function hasExpectedCapability(capability) {
    return capability?.status === TARGET.capability.status;
}

function hasExpectedClosureAuthority(authority) {
    return authority?.person_id === TARGET.closure_authority.person_id
        && authority.role_code === TARGET.closure_authority.role_code
        && authority.authority_scope === TARGET.closure_authority.authority_scope
        && authority.sensitivity_min === TARGET.closure_authority.sensitivity_min
        && authority.sensitivity === TARGET.closure_authority.sensitivity;
}

async function loadState(client, { lock = false } = {}) {
    const lockClause = lock ? ' FOR SHARE' : '';
    const registry = await client.query("SELECT to_regclass('brainbase_capabilities') AS relation_name");
    if (!registry.rows[0]?.relation_name) {
        fail('CAPABILITY_REGISTRY_UNAVAILABLE', 'OutcomeCase capability registry is not installed');
    }
    const project = await client.query(
        `SELECT p.id
           FROM projects p
          WHERE p.id = $1
            AND p.code = $2
            AND p.organization_id = $3${lockClause}`,
        [TARGET.project_id, TARGET.project_code, TARGET.organization_id]
    );
    if (project.rows.length !== 1) {
        fail('PROJECT_NOT_FOUND', 'Canonical Brainbase project was not resolved exactly once');
    }
    const person = await client.query(
        `SELECT id
           FROM graph_entities
          WHERE id = $1
            AND entity_type = 'person'${lockClause}`,
        [TARGET.closure_authority.person_id]
    );
    if (person.rows.length !== 1) {
        fail('CLOSURE_PERSON_NOT_FOUND', 'Canonical Sato person was not resolved exactly once');
    }
    const capability = await client.query(
        `SELECT status FROM brainbase_capabilities
          WHERE capability_id = $1${lockClause}`,
        [TARGET.capability.capability_id]
    );
    const authority = await client.query(
        `SELECT r.person_id, r.role_code, r.authority_scope, r.sensitivity_min, r.sensitivity
           FROM raci_assignments r
           JOIN projects p ON p.id = r.project_id
          WHERE p.id = $1
            AND p.code = $2
            AND p.organization_id = $3
            AND r.person_id = $4
            AND r.role_code = $5${lockClause}`,
        [
            TARGET.project_id,
            TARGET.project_code,
            TARGET.organization_id,
            TARGET.closure_authority.person_id,
            TARGET.closure_authority.role_code
        ]
    );
    return {
        capability: capability.rows[0] ?? null,
        closureAuthority: authority.rows[0] ?? null
    };
}

function requireService(infoSSOTService) {
    if (!infoSSOTService || typeof infoSSOTService.withAccessContext !== 'function'
        || typeof infoSSOTService.createRaci !== 'function') {
        fail('INFO_SSOT_REQUIRED', 'OutcomeCase provisioning requires Info SSOT service access');
    }
}

export async function provisionOutcomeCaseControlPlane({ infoSSOTService, actorId, commit = false } = {}) {
    requireService(infoSSOTService);
    if (typeof actorId !== 'string' || !actorId.trim()) {
        fail('ACTOR_REQUIRED', 'A provisioning actor is required');
    }
    const access = provisioningAccess();
    return infoSSOTService.withAccessContext(access, async (client) => {
        const before = await loadState(client, { lock: commit });
        if (!commit) {
            return {
                persisted: false,
                target: OUTCOME_CASE_CONTROL_PLANE_TARGET,
                current: publicState(before),
                plan: {
                    capability: hasExpectedCapability(before.capability) ? 'already_active' : 'upsert_active',
                    closure_authority: hasExpectedClosureAuthority(before.closureAuthority) ? 'already_authorized' : 'upsert_raci'
                }
            };
        }
        await client.query(
            `INSERT INTO brainbase_capabilities (capability_id, status, created_at, updated_at)
             VALUES ($1, $2, NOW(), NOW())
             ON CONFLICT (capability_id) DO UPDATE
                SET status = EXCLUDED.status, updated_at = NOW()
              WHERE brainbase_capabilities.status IS DISTINCT FROM EXCLUDED.status`,
            [TARGET.capability.capability_id, TARGET.capability.status]
        );
        const raci = hasExpectedClosureAuthority(before.closureAuthority)
            ? null
            : await infoSSOTService.createRaci(access, {
                projectCode: TARGET.project_code,
                personId: TARGET.closure_authority.person_id,
                roleCode: TARGET.closure_authority.role_code,
                authorityScope: TARGET.closure_authority.authority_scope,
                roleMin: TARGET.closure_authority.sensitivity_min,
                sensitivity: TARGET.closure_authority.sensitivity,
                source: 'provisioning'
            }, { client, access_context_applied: true });
        return {
            persisted: true,
            actor_id: actorId.trim(),
            capability: { ...TARGET.capability },
            closure_authority: { ...TARGET.closure_authority },
            raci: raci ? { raci_id: raci.raci_id, event_id: raci.event_id } : null
        };
    }, { requireCanonicalTenant: true });
}

export async function readbackOutcomeCaseControlPlane({ infoSSOTService } = {}) {
    requireService(infoSSOTService);
    const state = await infoSSOTService.withAccessContext(provisioningAccess(), (client) => loadState(client), {
        requireCanonicalTenant: true
    });
    if (!hasExpectedCapability(state.capability) || !hasExpectedClosureAuthority(state.closureAuthority)) {
        fail('POST_COMMIT_READBACK_FAILED', 'OutcomeCase control-plane readback does not match the approved target');
    }
    return publicState(state);
}
