import { acceptCompanyAuthorityResponse } from '../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';

const HEADER = 'x-brainbase-company-authority-response';
const MAX_ENCODED_BYTES = 12 * 1024;

function reject(res) {
    return res.status(403).json({
        error: { code: 'judgment_company_authority_rejected', message: 'Company Authority identity proof was rejected' }
    });
}

/** Bind a service-authenticated Resolver call to the signed Slack DM actor. */
export function requireJudgmentCompanyAuthority({ env = process.env, now = () => new Date() } = {}) {
    return (req, res, next) => {
        const encoded = req.get(HEADER);
        const serviceTransport = ['service-token', 'internal'].includes(req.authSource);
        if (!encoded) return next();
        if (!serviceTransport || encoded.length > MAX_ENCODED_BYTES) return reject(res);
        try {
            const response = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
            const publicJwk = JSON.parse(env.BRAINBASE_COMPANY_AUTHORITY_PUBLIC_JWK_JSON);
            const tenantContextPublicJwk = env.BRAINBASE_TENANT_CONTEXT_PUBLIC_JWK_JSON
                ? JSON.parse(env.BRAINBASE_TENANT_CONTEXT_PUBLIC_JWK_JSON) : publicJwk;
            const expectedDeploymentId = env.BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID?.trim();
            if (!expectedDeploymentId) throw new Error('deployment_required');
            const { context } = acceptCompanyAuthorityResponse(response, {
                publicJwk, tenantContextPublicJwk, expectedDeploymentId,
                expectedAudience: env.BRAINBASE_TENANT_RUNTIME_AUDIENCE || 'mana-runtime',
                now: now()
            });
            const actor = context?.actor;
            const tenant = context?.tenant_context;
            if (!actor?.canonical_person_id
                || context.authority?.decision !== 'auto'
                || tenant?.actor?.principal_type !== 'person'
                || tenant.actor.principal_id !== actor.canonical_person_id
                || tenant.actor.authenticated_subject_id !== actor.external_subject_id
                || tenant.slack?.requester_id !== actor.external_subject_id
                || tenant.workspace_connection?.provider !== 'slack'
                || !/^D[A-Z0-9]+$/.test(tenant.slack?.channel_id || '')
                || !tenant.authorization?.organization_ids?.includes(context.scope?.organization_id)) {
                throw new Error('actor_scope_mismatch');
            }
            req.access = {
                ...req.access,
                personId: actor.canonical_person_id,
                slackUserId: tenant.slack.requester_id,
                slackWorkspaceId: tenant.workspace_connection.provider_workspace_id
                    || tenant.workspace_connection.external_workspace_id
                    || req.access?.slackWorkspaceId
            };
            req.judgmentCompanyAuthority = {
                authorityResolutionReceiptId: context.evidence?.authority_resolution_receipt_id,
                identityResolutionReceiptId: context.evidence?.identity_resolution_receipt_id
            };
            return next();
        } catch (error) {
            console.error(JSON.stringify({
                event: 'judgment_company_authority_rejected',
                reason: error instanceof Error ? error.message : String(error)
            }));
            return reject(res);
        }
    };
}
