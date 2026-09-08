// @ts-check
import { acceptCompanyAuthorityResponse } from '../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';

function parseJwk(value, name) {
    const source = typeof value === 'string' ? value.trim() : '';
    if (!source) throw new Error(`${name}_required`);
    try {
        return JSON.parse(source);
    } catch {
        throw new Error(`${name}_invalid_json`);
    }
}

function reject(res, code = 'routine_company_authority_rejected') {
    return res.status(403).json({ error: code });
}

const ROUTINE_SERVICE_AUTHORITY = Object.freeze({
    ohayo: Object.freeze({
        actorId: 'brainbase_ohayo',
        capability: 'routine.ohayo.execute'
    }),
    retro: Object.freeze({
        actorId: 'brainbase_retro',
        capability: 'routine.retro.execute'
    }),
    oyasumi: Object.freeze({
        actorId: 'brainbase_oyasumi',
        capability: 'routine.oyasumi.execute'
    })
});

function nonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function acceptRoutineServiceAuthority(req) {
    const claims = req.auth;
    const routine = String(req.path || '').match(/^\/(ohayo|oyasumi|retro)\/execute\/?$/u)?.[1];
    return acceptSignedRoutineAuthority({ req, routine, claims });
}

function acceptSignedRoutineAuthority({ req, routine, claims }) {
    const routineConfig = routine ? ROUTINE_SERVICE_AUTHORITY[routine] : null;
    const authority = claims?.routineAuthority;
    const capabilities = Array.isArray(claims?.capabilities) ? claims.capabilities : [];
    const projectCodes = Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : [];
    if (!routineConfig
        || claims?.sub !== routineConfig.actorId
        || !capabilities.includes(routineConfig.capability)
        || !authority || typeof authority !== 'object' || Array.isArray(authority)
        || authority.routine !== routine
        || authority.capability_id !== 'personal_read'
        || !Array.isArray(authority.allowed_effects)
        || authority.allowed_effects.length !== 1
        || authority.allowed_effects[0] !== 'read'
        || authority.project_id !== 'brainbase'
        || !projectCodes.includes(authority.project_id)
        || !nonEmpty(authority.owner_person_id)
        || !nonEmpty(authority.organization_id)
        || !nonEmpty(authority.authority_resolution_receipt_id)
        || !nonEmpty(authority.identity_resolution_receipt_id)) {
        return null;
    }
    return {
        personId: authority.owner_person_id,
        actorPersonId: claims.sub,
        organizationId: authority.organization_id,
        projectCodes: [authority.project_id],
        clearance: ['personal'],
        authorityResolutionReceiptId: authority.authority_resolution_receipt_id,
        identityResolutionReceiptId: authority.identity_resolution_receipt_id
    };
}

/**
 * Generic service tokens authenticate transport only. Fixed routine actors may
 * additionally carry Brainbase-issued, signed, read-only routine authority.
 */
export function requireRoutineCompanyAuthority({
    env = process.env,
    now = () => new Date(),
    resolveCanonicalRoutineAuthority = null,
    ownerPersonId = null,
    projectId = 'brainbase'
} = {}) {
    return async (req, res, next) => {
        const response = req.body?.company_authority_response;
        if (!response) {
            let serviceAccess = req.authSource === 'service-token'
                ? acceptRoutineServiceAuthority(req)
                : null;
            if (!serviceAccess && req.authSource === 'internal' && resolveCanonicalRoutineAuthority) {
                const routine = String(req.path || '').match(/^\/(ohayo|oyasumi|retro)\/execute\/?$/u)?.[1];
                try {
                    const claims = await resolveCanonicalRoutineAuthority({
                        routine,
                        ownerPersonId,
                        projectId
                    });
                    serviceAccess = acceptSignedRoutineAuthority({ req, routine, claims });
                    if (serviceAccess) req.routineCompanyAuthority = claims.routineAuthority;
                } catch {
                    return reject(res, 'routine_company_authority_unresolved');
                }
            }
            if (!serviceAccess) return reject(res, 'routine_company_authority_required');
            if (!req.routineCompanyAuthority) req.routineCompanyAuthority = req.auth.routineAuthority;
            req.companyAuthorityAccess = serviceAccess;
            return next();
        }

        try {
            const publicJwk = parseJwk(
                env.BRAINBASE_COMPANY_AUTHORITY_PUBLIC_JWK_JSON,
                'BRAINBASE_COMPANY_AUTHORITY_PUBLIC_JWK_JSON'
            );
            const tenantContextPublicJwk = env.BRAINBASE_TENANT_CONTEXT_PUBLIC_JWK_JSON
                ? parseJwk(
                    env.BRAINBASE_TENANT_CONTEXT_PUBLIC_JWK_JSON,
                    'BRAINBASE_TENANT_CONTEXT_PUBLIC_JWK_JSON'
                )
                : publicJwk;
            const expectedDeploymentId = typeof env.BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID === 'string'
                ? env.BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID.trim()
                : '';
            if (!expectedDeploymentId) throw new Error('BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID_required');

            const ownerPersonId = response?.context?.scope?.owner_person_id;
            const accepted = acceptCompanyAuthorityResponse(response, {
                expectedAudience: env.BRAINBASE_TENANT_RUNTIME_AUDIENCE || 'mana-runtime',
                expectedDeploymentId,
                now: now(),
                publicJwk,
                tenantContextPublicJwk,
                personalTargetPersonId: ownerPersonId
            });
            const context = accepted.context;
            if (!context
                || context.authority.decision !== 'auto'
                || context.authority.capability_id !== 'personal_read'
                || !context.authority.allowed_effects.includes('read')
                || !context.tenant_context.authorization.data_scopes.includes('personal')
                || !ownerPersonId) {
                return reject(res);
            }

            const projectId = context.scope.project_id;
            const transportProjects = Array.isArray(req.access?.projectCodes)
                ? req.access.projectCodes
                : [];
            if (!transportProjects.includes(projectId)) {
                return reject(res, 'routine_company_authority_transport_scope_mismatch');
            }

            req.routineCompanyAuthority = context;
            req.companyAuthorityAccess = {
                personId: ownerPersonId,
                actorPersonId: context.actor.canonical_person_id,
                organizationId: context.scope.organization_id,
                projectCodes: [projectId],
                clearance: ['personal'],
                authorityResolutionReceiptId: context.evidence.authority_resolution_receipt_id,
                identityResolutionReceiptId: context.evidence.identity_resolution_receipt_id
            };
            return next();
        } catch {
            return reject(res);
        }
    };
}
