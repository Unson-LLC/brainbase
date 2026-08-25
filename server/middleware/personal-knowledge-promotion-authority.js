import { ContractError } from '../services/multitenant/errors.js';
import { toProblem } from '../services/multitenant/protocol-contract.js';

function decodeContext(req) {
    const value = req.get('Brainbase-Tenant-Context');
    if (!value || value.length > 32_768) {
        throw new ContractError('TENANT_CONTEXT_INVALID', { status: 400, fault_domain: 'protocol' });
    }
    try {
        const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('invalid');
        return decoded;
    } catch {
        throw new ContractError('TENANT_CONTEXT_INVALID', { status: 400, fault_domain: 'protocol' });
    }
}

export function createPersonalKnowledgePromotionAuthorityGuard(services, capabilityId) {
    if (typeof services?.tenantContextVerifier !== 'function') {
        throw new Error('Personal knowledge promotion authority guard requires tenant context verification');
    }
    return async (req, res, next) => {
        let context;
        try {
            context = await services.tenantContextVerifier(decodeContext(req), {
                service_identity: 'brainbase-personal-knowledge-promotion'
            });
            if (context.actor?.principal_type !== 'person'
                || !context.authorization?.capability_ids?.includes(capabilityId)) {
                throw new ContractError('CAPABILITY_SCOPE_MISMATCH', {
                    status: 403,
                    fault_domain: 'authorization'
                });
            }
            req.personalKnowledgePromotionAuthority = {
                capabilityId,
                actorPersonId: context.actor.principal_id,
                organizationIds: context.authorization.organization_ids,
                projectIds: context.authorization.project_ids,
                operationId: context.operation_id,
                idempotencyKey: context.idempotency_key,
                issuedAt: context.issued_at,
                expiresAt: context.expires_at
            };
            return next();
        } catch (error) {
            const problem = toProblem(error, context?.correlation_id ?? null);
            return res.status(problem.status).type('application/problem+json').json(problem);
        }
    };
}

export function createUnavailablePersonalKnowledgePromotionAuthorityGuard() {
    return (_req, res) => res.status(503).json({
        error: 'personal_knowledge_promotion_authority_unavailable'
    });
}
