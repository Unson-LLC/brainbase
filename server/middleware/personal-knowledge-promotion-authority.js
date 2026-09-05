import { ContractError } from '../services/multitenant/errors.js';
import { toProblem } from '../services/multitenant/protocol-contract.js';
import {
    actionForRuntimeCapability,
    assertPersonalKnowledgePromotionAuthority,
    resourceRefForPersonalEvent,
    resourceRefForPromotionRequest
} from '../services/personal-knowledge/promotion-authority-contract.js';
import {
    authorityProjectBinding,
    deriveSingleAuthorityProjectId
} from '../services/multitenant/authority-project-binding.js';

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

function requestTarget(req, mapping) {
    const eventId = req.params?.eventId;
    const requestId = req.params?.requestId;
    if (mapping.action === 'request') {
        if (!eventId) {
            throw new ContractError('PERSONAL_KNOWLEDGE_PROMOTION_AUTHORITY_TARGET_MISSING', { status: 403 });
        }
        return { resourceRef: resourceRefForPersonalEvent(eventId), requestId: null };
    }
    if (!requestId) {
        throw new ContractError('PERSONAL_KNOWLEDGE_PROMOTION_AUTHORITY_TARGET_MISSING', { status: 403 });
    }
    return { resourceRef: resourceRefForPromotionRequest(requestId), requestId };
}

function assertRequestBodyHash(req, authority) {
    const suppliedHash = req.body?.normalized_payload_hash;
    if (suppliedHash !== undefined && suppliedHash !== authority.normalized_payload_hash) {
        throw new ContractError('PERSONAL_KNOWLEDGE_PROMOTION_AUTHORITY_SCOPE_MISMATCH', { status: 403 });
    }
}

function graphOrganizationId(binding, { tenantId, organizationId }) {
    const payload = binding?.organization_payload;
    const graphId = payload?.graph_organization_id;
    if (binding?.tenant_id !== tenantId
        || binding?.organization_id !== organizationId
        || binding?.tenant_status !== 'active'
        || payload?.status !== 'active'
        || typeof graphId !== 'string'
        || !graphId.trim()) {
        throw new ContractError('ORGANIZATION_SCOPE_MISMATCH', {
            status: 403,
            fault_domain: 'protocol',
            details: { scope_reason: 'organization_not_active_or_owned' }
        });
    }
    return graphId;
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
            const mapping = actionForRuntimeCapability(capabilityId);
            const signedAuthority = assertPersonalKnowledgePromotionAuthority(context.authority);
            if (!mapping || mapping.action !== signedAuthority.action) {
                throw new ContractError('PERSONAL_KNOWLEDGE_PROMOTION_AUTHORITY_SCOPE_MISMATCH', { status: 403 });
            }
            const target = requestTarget(req, mapping);
            if (signedAuthority.resource_ref !== target.resourceRef
                || (mapping.action !== 'request' && signedAuthority.request_id !== target.requestId)) {
                throw new ContractError('PERSONAL_KNOWLEDGE_PROMOTION_AUTHORITY_SCOPE_MISMATCH', { status: 403 });
            }
            assertRequestBodyHash(req, signedAuthority);
            if (context.actor?.principal_type !== 'person'
                || !context.authorization?.capability_ids?.includes(capabilityId)) {
                throw new ContractError('CAPABILITY_SCOPE_MISMATCH', {
                    status: 403,
                    fault_domain: 'authorization'
                });
            }
            const organizationIds = context.authorization.organization_ids;
            if (!Array.isArray(organizationIds)
                || organizationIds.length !== 1
                || typeof services?.connectionRegistry?.resolveOrganizationBindingById !== 'function') {
                throw new ContractError('ORGANIZATION_SCOPE_MISMATCH', {
                    status: 403,
                    fault_domain: 'protocol',
                    details: { scope_reason: 'canonical_organization_resolver_unavailable' }
                });
            }
            const tenantOrganizationId = organizationIds[0];
            const resolvedOrganization = await services.connectionRegistry.resolveOrganizationBindingById({
                tenant_id: context.tenant.tenant_id,
                organization_id: tenantOrganizationId
            });
            const canonicalOrganizationId = graphOrganizationId(resolvedOrganization, {
                tenantId: context.tenant.tenant_id,
                organizationId: tenantOrganizationId
            });
            const projectId = deriveSingleAuthorityProjectId(context);
            if (typeof services?.connectionRegistry?.resolveProjectBindingById !== 'function') {
                throw new ContractError('PROJECT_SCOPE_MISMATCH', {
                    status: 403,
                    fault_domain: 'protocol',
                    details: { scope_reason: 'project_resolver_unavailable' }
                });
            }
            const resolvedProject = await services.connectionRegistry.resolveProjectBindingById({
                tenant_id: context.tenant.tenant_id,
                project_id: projectId
            });
            const project = authorityProjectBinding(resolvedProject, {
                tenantId: context.tenant.tenant_id,
                projectId
            });
            req.personalKnowledgePromotionAuthority = {
                capabilityId,
                actorPersonId: context.actor.principal_id,
                organizationIds: [canonicalOrganizationId],
                tenantOrganizationIds: organizationIds,
                graphOrganizationId: canonicalOrganizationId,
                projectIds: [project.project_id],
                projectCode: project.project_code,
                operationId: context.operation_id,
                idempotencyKey: context.idempotency_key,
                schemaVersion: signedAuthority.schema_version,
                canonicalCapabilityId: signedAuthority.capability_id,
                action: signedAuthority.action,
                resourceRef: signedAuthority.resource_ref,
                requestId: signedAuthority.request_id,
                normalizedPayloadHash: signedAuthority.normalized_payload_hash,
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
