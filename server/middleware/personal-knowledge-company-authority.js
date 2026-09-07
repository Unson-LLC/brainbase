import { acceptCompanyAuthorityResponse } from '../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';
import { authorityProjectBinding } from '../services/multitenant/authority-project-binding.js';

const OPERATIONS = {
    '/search': { capability: 'personal_read', effect: 'read' },
    '/events': { capability: 'personal_write', effect: 'write' }
};

/** A service token authenticates transport, never the human Personal KG owner. */
export function requirePersonalKnowledgeCompanyAuthority({
    env = process.env,
    now = () => new Date(),
    connectionRegistry = null
} = {}) {
    return async (req, res, next) => {
        const response = req.body?.company_authority_response;
        const serviceTransport = ['service-token', 'internal'].includes(req.authSource);
        // This router must not inherit authority granted for a different operation.
        delete req.companyAuthorityAccess;
        if (!serviceTransport) {
            if (response !== undefined) {
                return res.status(403).json({ error: 'personal_knowledge_interactive_authority_override_rejected' });
            }
            return next();
        }
        const operation = req.method === 'POST' && OPERATIONS[String(req.path).replace(/\/$/, '')];
        if (!operation || !response) {
            return res.status(403).json({ error: 'personal_knowledge_service_proxy_denied' });
        }
        try {
            const publicJwk = JSON.parse(env.BRAINBASE_COMPANY_AUTHORITY_PUBLIC_JWK_JSON);
            const tenantContextPublicJwk = env.BRAINBASE_TENANT_CONTEXT_PUBLIC_JWK_JSON
                ? JSON.parse(env.BRAINBASE_TENANT_CONTEXT_PUBLIC_JWK_JSON) : publicJwk;
            const expectedDeploymentId = env.BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID?.trim();
            if (!expectedDeploymentId) throw new Error('deployment_required');
            const { context } = acceptCompanyAuthorityResponse(response, {
                publicJwk, tenantContextPublicJwk, expectedDeploymentId,
                expectedAudience: env.BRAINBASE_TENANT_RUNTIME_AUDIENCE || 'mana-runtime',
                personalTargetPersonId: response.context?.scope?.owner_person_id,
                now: now()
            });
            const owner = context?.scope?.owner_person_id;
            const projectId = context?.scope?.project_id;
            if (!owner
                || context.actor.canonical_person_id !== owner
                || context.scope.resource_ref !== `personal://${owner}/notes`
                || context.authority.decision !== 'auto'
                || context.authority.capability_id !== operation.capability
                || context.authority.allowed_effects.length !== 1
                || context.authority.allowed_effects[0] !== operation.effect
                || !context.tenant_context.authorization.data_scopes.includes('personal')
                || context.tenant_context.actor.principal_type !== 'person'
                || context.tenant_context.slack?.requester_id !== context.actor.external_subject_id
                || context.tenant_context.workspace_connection.provider !== 'slack'
                || !/^D[A-Z0-9]+$/.test(context.tenant_context.slack?.channel_id || '')
                || typeof connectionRegistry?.resolveProjectBindingById !== 'function') {
                throw new Error('personal_scope_mismatch');
            }
            const tenantId = context.tenant_context.tenant?.tenant_id;
            const resolvedProject = await connectionRegistry.resolveProjectBindingById({
                tenant_id: tenantId,
                project_id: projectId
            });
            const project = authorityProjectBinding(resolvedProject, {
                tenantId,
                projectId
            });
            if (!Array.isArray(req.access?.projectCodes)
                || !req.access.projectCodes.includes(project.project_code)) {
                throw new Error('personal_scope_mismatch');
            }
            req.companyAuthorityAccess = {
                personId: owner,
                actorPersonId: context.actor.canonical_person_id,
                organizationId: context.scope.organization_id,
                projectCodes: [project.project_code],
                clearance: ['personal'],
                authorityResolutionReceiptId: context.evidence.authority_resolution_receipt_id,
                identityResolutionReceiptId: context.evidence.identity_resolution_receipt_id
            };
            // Authority is transport metadata, not part of the immutable personal event.
            const { company_authority_response: _authority, ...input } = req.body;
            req.body = input;
            return next();
        } catch {
            return res.status(403).json({ error: 'personal_knowledge_company_authority_rejected' });
        }
    };
}
