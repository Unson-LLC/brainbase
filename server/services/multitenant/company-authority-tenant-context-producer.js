import { computeBusinessIdempotencyKey } from './contract-usage-ledger.js';
import { ContractError } from './errors.js';
import { createSignedTenantContext } from './tenant-context.js';
import {
    CompanyAuthorityResolver,
    normalizeObservedExecutionRequest
} from './company-authority-resolver.js';
import {
    assertPersonalKnowledgePromotionAuthority,
    assertPromotionAuthorityProducerBinding
} from '../personal-knowledge/promotion-authority-contract.js';

const MAX_TTL_SECONDS = 300;

function wireTimestamp(value) {
    return value.toISOString().replace('.000Z', 'Z');
}

function desiredEffectForCapability(capabilityId) {
    const value = String(capabilityId || '').toLowerCase();
    if (/(send|publish|post|deliver|external)/u.test(value)) return 'external_side_effect';
    if (/(create|write|update|transition|delete|apply|approve|reject)/u.test(value)) return 'write';
    return 'read';
}

function singleString(values, field) {
    if (!Array.isArray(values) || values.length !== 1
        || typeof values[0] !== 'string' || values[0].length === 0) {
        throw new ContractError('COMPANY_AUTHORITY_REQUEST_INVALID', {
            status: 400,
            fault_domain: 'protocol',
            details: { field }
        });
    }
    return values[0];
}

function requiredString(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new ContractError('COMPANY_AUTHORITY_REQUEST_INVALID', {
            status: 400,
            fault_domain: 'protocol',
            details: { field }
        });
    }
    return value.trim();
}

function observedRequest(input) {
    if (input?.provider_identity && input?.requested_action) {
        return normalizeObservedExecutionRequest(input);
    }
    if (!input?.slack || !input?.authorization) {
        return normalizeObservedExecutionRequest(input);
    }
    const projectHint = singleString(input.authorization.project_ids, 'authorization.project_ids');
    const capabilityId = singleString(input.authorization.capability_ids, 'authorization.capability_ids');
    const promotionAuthority = input.promotion_authority === undefined
        ? undefined
        : assertPersonalKnowledgePromotionAuthority(input.promotion_authority);
    return {
        tenant_id: requiredString(input.tenant_id, 'tenant_id'),
        expected_tenant_revision: input.expected_tenant_revision,
        connection_id: requiredString(input.connection_id, 'connection_id'),
        expected_connection_revision: requiredString(
            input.expected_connection_revision,
            'expected_connection_revision'
        ),
        workspace_id: input.workspace_id,
        app_id: input.app_id,
        required_connection_scopes: Array.isArray(input.required_connection_scopes)
            ? [...input.required_connection_scopes]
            : [],
        provider_identity: {
            provider: 'slack',
            authenticated_subject_id: requiredString(input.slack.requester_id, 'slack.requester_id'),
            workspace_id: input.workspace_id,
            app_id: input.app_id,
            enterprise_id: input.slack.enterprise_id
        },
        requested_action: {
            capability_id: capabilityId,
            resource_ref: `project:${projectHint}`,
            project_hint: projectHint,
            desired_effect: desiredEffectForCapability(capabilityId)
        },
        slack: structuredClone(input.slack),
        correlation_id: requiredString(input.correlation_id, 'correlation_id'),
        operation_id: requiredString(input.operation_id, 'operation_id'),
        billing_principal_id: input.billing_principal_id,
        ...(promotionAuthority ? { promotion_authority: promotionAuthority } : {})
    };
}

function canonicalizeRequest(request, canonicalRuntime) {
    const connection = canonicalRuntime.workspace_connection;
    return normalizeObservedExecutionRequest({
        ...request,
        workspace_id: request.workspace_id || connection.workspace_id,
        app_id: request.app_id || connection.app_id,
        provider_identity: {
            ...request.provider_identity,
            workspace_id: request.provider_identity.workspace_id || connection.workspace_id,
            app_id: request.provider_identity.app_id || connection.app_id
        }
    });
}

function createTestOnlyAuthorityResolver() {
    return new CompanyAuthorityResolver({
        repository: {
            async resolveCanonicalIdentity(input) {
                return {
                    tenant_id: input.tenant_id,
                    canonical_person_id: input.authenticated_subject_id,
                    principal_type: 'person',
                    membership_id: `test-membership:${input.authenticated_subject_id}`,
                    membership_revision: '1',
                    organization_id: 'test-organization',
                    project_id: input.project_hint,
                    project_code: input.project_hint,
                    placement_id: 'test-placement',
                    status: 'active',
                    identity_resolution_receipt_id: `test-idres:${input.authenticated_subject_id}`
                };
            },
            async resolveCanonicalAuthority(input) {
                return {
                    binding_id: `test-binding:${input.membership_id}:${input.capability_id}`,
                    binding_revision: '1',
                    capability_id: input.capability_id,
                    decision: 'auto',
                    allowed_effects: [input.desired_effect],
                    responsible_person_id: input.canonical_person_id,
                    accountable_person_id: input.canonical_person_id,
                    approver_person_id: null,
                    delegated_by_person_id: null,
                    policy_revision: '1',
                    raci_revision: '1',
                    resource_revision: '1',
                    stop_conditions: [],
                    authority_resolution_receipt_id: `test-authres:${input.membership_id}:${input.capability_id}`
                };
            }
        }
    });
}

export class TenantContextProducer {
    constructor({
        tenantAuthority,
        connectionRegistry,
        resolveContractRevision,
        resolveCanonicalContext,
        companyAuthorityResolver,
        allowTestAuthorityFallback = false,
        signingKey,
        audience,
        deploymentId,
        deploymentProfile,
        now = () => new Date()
    }) {
        this.tenantAuthority = tenantAuthority;
        this.connectionRegistry = connectionRegistry;
        this.resolveContractRevision = resolveContractRevision;
        this.resolveCanonicalContext = resolveCanonicalContext;
        this.companyAuthorityResolver = companyAuthorityResolver
            ?? (allowTestAuthorityFallback ? createTestOnlyAuthorityResolver() : null);
        if (!this.companyAuthorityResolver) {
            throw new Error('TenantContextProducer requires companyAuthorityResolver');
        }
        this.signingKey = signingKey;
        this.audience = audience;
        this.deploymentId = deploymentId;
        this.deploymentProfile = deploymentProfile;
        this.now = now;
    }

    async #loadCanonicalRuntime(request) {
        const lookup = {
            ...request,
            authorization: {
                capability_ids: [request.requested_action.capability_id]
            },
            required_connection_scopes: request.required_connection_scopes
        };
        if (this.resolveCanonicalContext) return this.resolveCanonicalContext(lookup);
        const tenant = this.tenantAuthority.resolveTenant({ tenant_id: request.tenant_id });
        if (request.expected_tenant_revision !== undefined
            && request.expected_tenant_revision !== tenant.tenant_revision) {
            throw new ContractError('TENANT_REVISION_MISMATCH', { status: 409 });
        }
        const workspace_connection = await this.connectionRegistry.validateRevision({
            tenant_id: request.tenant_id,
            connection_id: request.connection_id,
            expected_connection_revision: request.expected_connection_revision,
            workspace_id: request.workspace_id,
            app_id: request.app_id,
            required_scopes: request.required_connection_scopes
        });
        const contract_revision = await this.resolveContractRevision({
            tenant_id: request.tenant_id,
            tenant_revision: tenant.tenant_revision
        });
        return { tenant, workspace_connection, contract_revision };
    }

    async resolveContext(input) {
        const preliminaryRequest = observedRequest(input);
        const canonicalRuntime = await this.#loadCanonicalRuntime(preliminaryRequest);
        const request = canonicalizeRequest(preliminaryRequest, canonicalRuntime);
        const resolvedAuthority = await this.companyAuthorityResolver.resolve(request, canonicalRuntime);
        const promotionAuthority = request.promotion_authority
            ? assertPromotionAuthorityProducerBinding(request.promotion_authority, {
                runtimeCapabilityId: request.requested_action.capability_id,
                resourceRef: request.requested_action.resource_ref
            })
            : undefined;
        const issuedAt = this.now();
        const expiresAt = new Date(issuedAt.getTime() + MAX_TTL_SECONDS * 1000);
        const tenant = canonicalRuntime.tenant;
        const connection = canonicalRuntime.workspace_connection;
        const idempotencyKey = computeBusinessIdempotencyKey({
            protocol_id: 'mana-brainbase-tenant-context',
            protocol_major: '1',
            tenant_id: tenant.tenant_id,
            connection_id: connection.connection_id,
            slack_event_id: request.slack.event_id,
            operation_id: request.operation_id
        });
        return createSignedTenantContext({
            schema_version: '1.0',
            protocol_id: 'mana-brainbase-tenant-context',
            protocol_version: '1.0',
            issuer: 'brainbase',
            audience: [this.audience],
            tenant: {
                tenant_id: tenant.tenant_id,
                tenant_revision: tenant.tenant_revision
            },
            workspace_connection: {
                connection_id: connection.connection_id,
                connection_revision: connection.connection_revision,
                status: connection.status,
                provider: connection.provider,
                installation_id: connection.installation_id,
                workspace_id: connection.workspace_id,
                app_id: connection.app_id
            },
            actor: structuredClone(resolvedAuthority.actor),
            authorization: structuredClone(resolvedAuthority.authorization),
            ...(promotionAuthority ? { authority: promotionAuthority } : {}),
            placement: {
                deployment_id: this.deploymentId,
                profile: this.deploymentProfile
            },
            slack: structuredClone(request.slack),
            correlation_id: request.correlation_id,
            operation_id: request.operation_id,
            idempotency_key: idempotencyKey,
            contract_revision: canonicalRuntime.contract_revision,
            credential: {
                mode: connection.credential_mode,
                credential_ref: connection.credential_ref,
                billing_principal_id: request.billing_principal_id
                    ?? resolvedAuthority.actor.principal_id
            },
            issued_at: wireTimestamp(issuedAt),
            expires_at: wireTimestamp(expiresAt)
        }, {
            key_id: this.signingKey.key_id,
            private_key: this.signingKey.private_key
        });
    }
}
