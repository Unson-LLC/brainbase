import { createHash } from 'node:crypto';
import {
    CONTRACT_ID,
    SCHEMA_VERSION,
    createDetachedJws,
    validateCanonicalExecutionContext,
    validateObservedExecutionRequest
} from '../../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';
import { generateCanonicalId } from './ids.js';

const ERROR_MAP = Object.freeze({
    COMPANY_IDENTITY_UNRESOLVED: 'PERSON_UNKNOWN',
    COMPANY_IDENTITY_AMBIGUOUS: 'PERSON_AMBIGUOUS',
    COMPANY_MEMBERSHIP_INACTIVE: 'MEMBERSHIP_INACTIVE',
    CROSS_TENANT_CANDIDATE: 'AUTHORITY_CROSS_ORG',
    PROJECT_SCOPE_MISMATCH: 'AUTHORITY_SCOPE_MISMATCH',
    ACTOR_SCOPE_MISMATCH: 'AUTHORITY_SCOPE_MISMATCH',
    CAPABILITY_SCOPE_MISMATCH: 'AUTHORITY_SCOPE_MISMATCH',
    COMPANY_AUTHORITY_DENIED: 'COMPANY_AUTHORITY_DENIED',
    COMPANY_EFFECT_NOT_ALLOWED: 'COMPANY_AUTHORITY_EFFECT_MISMATCH',
    COMPANY_AUTHORITY_UNRESOLVED: 'AUTHORITY_UNAVAILABLE',
    COMPANY_AUTHORITY_AMBIGUOUS: 'AUTHORITY_UNAVAILABLE',
    TENANT_REVISION_MISMATCH: 'AUTHORITY_CONTEXT_STALE',
    WORKSPACE_CONNECTION_STALE_REVISION: 'AUTHORITY_CONTEXT_STALE',
    PERSONAL_OWNER_REQUIRED: 'PERSONAL_OWNER_REQUIRED',
    PERSONAL_SCOPE_MISMATCH: 'PERSONAL_SCOPE_MISMATCH',
    UPSTREAM_UNAVAILABLE: 'AUTHORITY_UNAVAILABLE'
});

function operationId(correlationId) {
    return generateCanonicalId('op', {
        now: 0,
        random: createHash('sha256').update(correlationId).digest().subarray(0, 10)
    });
}

function canonicalErrorCode(error) {
    return ERROR_MAP[error?.code] ?? 'AUTHORITY_UNAVAILABLE';
}

function errorResponse(correlationId, error) {
    const code = canonicalErrorCode(error);
    return {
        schema_version: SCHEMA_VERSION,
        contract_id: CONTRACT_ID,
        correlation_id: correlationId,
        context: null,
        error: {
            correlation_id: correlationId,
            code,
            phase: 'authority',
            retryable: code === 'AUTHORITY_UNAVAILABLE' && error?.retryable === true,
            business_effect: false
        }
    };
}

function personalOwner(resourceRef, canonicalPersonId) {
    if (!resourceRef.startsWith('personal://')) return null;
    const owner = resourceRef.slice('personal://'.length).split('/')[0];
    if (!owner) throw Object.assign(new Error('Personal owner is required'), { code: 'PERSONAL_OWNER_REQUIRED' });
    if (owner !== canonicalPersonId) {
        throw Object.assign(new Error('Personal owner does not match the canonical person'), {
            code: 'PERSONAL_SCOPE_MISMATCH'
        });
    }
    return owner;
}

export class CompanyAuthorityContextProducer {
    constructor({ routeRepository, tenantContextProducer, signingKey, audience = 'mana-runtime', deploymentId, now = () => new Date() }) {
        if (!routeRepository?.resolveObservedRoute) {
            throw new Error('CompanyAuthorityContextProducer requires routeRepository');
        }
        if (!tenantContextProducer?.resolveContextWithAuthority) {
            throw new Error('CompanyAuthorityContextProducer requires tenantContextProducer');
        }
        this.routeRepository = routeRepository;
        this.tenantContextProducer = tenantContextProducer;
        this.signingKey = signingKey;
        this.audience = audience;
        this.deploymentId = deploymentId;
        this.now = now;
    }

    async resolve(input) {
        validateObservedExecutionRequest(input);
        const correlationId = input.correlation_id;
        try {
            const route = await this.routeRepository.resolveObservedRoute(input);
            const delivery = input.delivery ?? {};
            if (!delivery.event_id || !delivery.channel_id) {
                throw Object.assign(new Error('Slack delivery binding is required'), {
                    code: 'AUTHORITY_SCOPE_MISMATCH'
                });
            }
            const { context: tenantContext, company_authority: companyAuthority } =
                await this.tenantContextProducer.resolveContextWithAuthority({
                    tenant_id: route.tenant_id,
                    expected_tenant_revision: String(route.tenant_revision),
                    connection_id: route.connection_id,
                    expected_connection_revision: String(route.connection_revision),
                    workspace_id: route.workspace_id,
                    app_id: route.app_id,
                    required_connection_scopes: [],
                    provider_identity: structuredClone(input.provider_identity),
                    requested_action: structuredClone(input.requested_action),
                    slack: {
                        event_id: delivery.event_id,
                        channel_id: delivery.channel_id,
                        ...(delivery.thread_ts ? { thread_ts: delivery.thread_ts } : {}),
                        requester_id: input.provider_identity.authenticated_subject_id,
                        ...(input.provider_identity.enterprise_id
                            ? { enterprise_id: input.provider_identity.enterprise_id } : {})
                    },
                    correlation_id: correlationId,
                    operation_id: operationId(correlationId)
                });
            const identity = companyAuthority.actor;
            const authority = companyAuthority.authority;
            if (authority.decision === 'deny') {
                throw Object.assign(new Error('Company authority denied'), {
                    code: 'COMPANY_AUTHORITY_DENIED'
                });
            }
            const unsigned = {
                schema_version: SCHEMA_VERSION,
                tenant_context: tenantContext,
                actor: {
                    external_subject_id: input.provider_identity.authenticated_subject_id,
                    canonical_person_id: identity.canonical_person_id,
                    membership_id: identity.membership_id,
                    membership_revision: String(identity.membership_revision)
                },
                scope: {
                    organization_id: identity.organization_id,
                    project_id: identity.project_id,
                    resource_ref: input.requested_action.resource_ref,
                    owner_person_id: personalOwner(input.requested_action.resource_ref, identity.canonical_person_id),
                    placement_id: tenantContext.placement.deployment_id
                },
                authority: {
                    decision: authority.decision,
                    capability_id: authority.capability_id,
                    responsible_person_id: authority.responsible_person_id ?? null,
                    accountable_person_id: authority.accountable_person_id ?? null,
                    approver_person_id: authority.approver_person_id ?? null,
                    delegated_by_person_id: authority.delegated_by_person_id ?? null,
                    policy_revision: String(authority.policy_revision),
                    raci_revision: String(authority.raci_revision),
                    resource_revision: String(authority.resource_revision),
                    allowed_effects: [...authority.allowed_effects],
                    stop_conditions: [...(authority.stop_conditions ?? [])]
                },
                evidence: {
                    identity_resolution_receipt_id: identity.identity_resolution_receipt_id,
                    authority_resolution_receipt_id: authority.authority_resolution_receipt_id
                },
                issued_at: tenantContext.issued_at,
                expires_at: tenantContext.expires_at,
                integrity: {
                    method: 'jws_detached',
                    algorithm: 'EdDSA',
                    key_id: this.signingKey.key_id,
                    value: ''
                }
            };
            const privateJwk = this.signingKey.private_key.export({ format: 'jwk' });
            const context = {
                ...unsigned,
                integrity: {
                    ...unsigned.integrity,
                    value: createDetachedJws(unsigned, privateJwk, this.signingKey.key_id)
                }
            };
            validateCanonicalExecutionContext(context, {
                expectedAudience: this.audience,
                expectedDeploymentId: this.deploymentId,
                now: this.now(),
                request: input
            });
            return {
                schema_version: SCHEMA_VERSION,
                contract_id: CONTRACT_ID,
                correlation_id: correlationId,
                context,
                error: null
            };
        } catch (error) {
            return errorResponse(correlationId, error);
        }
    }
}
