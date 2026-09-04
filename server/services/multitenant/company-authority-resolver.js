import { ContractError } from './errors.js';
import { assertPersonalKnowledgePromotionAuthority } from '../personal-knowledge/promotion-authority-contract.js';

const EFFECTS = new Set(['read', 'write', 'external_side_effect']);
const DECISIONS = new Set(['auto', 'approval', 'human_action', 'deny']);
const PROVIDERS = new Set(['slack', 'codex', 'claude_code', 'service']);
const PAYLOAD_RESOURCE_REF_PATTERN = /^project:([^#\s]+)#payload_sha256=sha256:([0-9a-f]{64})$/u;
const ENCODED_FRAGMENT_SEPARATOR_PATTERN = /%23/iu;

function fail(code, { status = 403, retryable = false, fault_domain = 'protocol', details } = {}) {
    throw new ContractError(code, {
        status,
        retryable,
        fault_domain,
        ...(details ? { details } : {})
    });
}

function nonEmptyString(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        fail('COMPANY_AUTHORITY_REQUEST_INVALID', {
            status: 400,
            details: { field }
        });
    }
    return value.trim();
}

/**
 * Validate and split the optional payload binding from a requested resource.
 *
 * The fragment is carried in the signed request, but authority grants remain
 * keyed by the stable project resource.  Keep this parser independent of the
 * repository so callers can reject malformed input before any lookup.
 */
export function parseCompanyAuthorityResourceRef(resourceRef) {
    if (typeof resourceRef !== 'string' || resourceRef.trim().length === 0) {
        fail('COMPANY_AUTHORITY_REQUEST_INVALID', {
            status: 400,
            details: { field: 'requested_action.resource_ref' }
        });
    }

    if (ENCODED_FRAGMENT_SEPARATOR_PATTERN.test(resourceRef)) {
        fail('COMPANY_AUTHORITY_REQUEST_INVALID', {
            status: 400,
            details: {
                field: 'requested_action.resource_ref',
                reason: 'encoded_fragment_separator'
            }
        });
    }

    if (!resourceRef.includes('#')) {
        return {
            originalResourceRef: resourceRef,
            lookupResourceRef: resourceRef,
            projectRef: null
        };
    }

    const match = PAYLOAD_RESOURCE_REF_PATTERN.exec(resourceRef);
    // JavaScript's `$` also matches immediately before a final line terminator;
    // require the entire input to be consumed so hash-bound whitespace cannot
    // be normalized into a different signed resource.
    if (!match || match[0] !== resourceRef) {
        fail('COMPANY_AUTHORITY_REQUEST_INVALID', {
            status: 400,
            details: {
                field: 'requested_action.resource_ref',
                reason: 'invalid_payload_binding'
            }
        });
    }

    return {
        originalResourceRef: resourceRef,
        lookupResourceRef: `project:${match[1]}`,
        projectRef: match[1]
    };
}

function optionalString(value, field) {
    if (value === undefined || value === null) return undefined;
    return nonEmptyString(value, field);
}

function optionalStringArray(value, field) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
        fail('COMPANY_AUTHORITY_REQUEST_INVALID', { status: 400, details: { field } });
    }
    return [...new Set(value.map((entry, index) => nonEmptyString(entry, `${field}[${index}]`)))];
}

export function normalizeObservedExecutionRequest(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        fail('COMPANY_AUTHORITY_REQUEST_INVALID', { status: 400 });
    }
    if (Object.hasOwn(input, 'actor') || Object.hasOwn(input, 'authorization')) {
        fail('COMPANY_AUTHORITY_SELF_ASSERTION_FORBIDDEN', { status: 403 });
    }
    const providerIdentity = input.provider_identity;
    const requestedAction = input.requested_action;
    const slack = input.slack;
    if (!providerIdentity || typeof providerIdentity !== 'object' || Array.isArray(providerIdentity)
        || !requestedAction || typeof requestedAction !== 'object' || Array.isArray(requestedAction)
        || !slack || typeof slack !== 'object' || Array.isArray(slack)) {
        fail('COMPANY_AUTHORITY_REQUEST_INVALID', { status: 400 });
    }
    const provider = nonEmptyString(providerIdentity.provider, 'provider_identity.provider');
    if (!PROVIDERS.has(provider)) {
        fail('COMPANY_AUTHORITY_REQUEST_INVALID', {
            status: 400,
            details: { field: 'provider_identity.provider' }
        });
    }
    const desiredEffect = nonEmptyString(requestedAction.desired_effect, 'requested_action.desired_effect');
    if (!EFFECTS.has(desiredEffect)) {
        fail('COMPANY_AUTHORITY_REQUEST_INVALID', {
            status: 400,
            details: { field: 'requested_action.desired_effect' }
        });
    }
    const promotionAuthority = input.promotion_authority === undefined
        ? undefined
        : assertPersonalKnowledgePromotionAuthority(input.promotion_authority);
    return {
        tenant_id: nonEmptyString(input.tenant_id, 'tenant_id'),
        expected_tenant_revision: optionalString(input.expected_tenant_revision, 'expected_tenant_revision'),
        connection_id: nonEmptyString(input.connection_id, 'connection_id'),
        expected_connection_revision: nonEmptyString(input.expected_connection_revision, 'expected_connection_revision'),
        workspace_id: nonEmptyString(input.workspace_id, 'workspace_id'),
        app_id: nonEmptyString(input.app_id, 'app_id'),
        required_connection_scopes: optionalStringArray(
            input.required_connection_scopes,
            'required_connection_scopes'
        ),
        provider_identity: {
            provider,
            authenticated_subject_id: nonEmptyString(
                providerIdentity.authenticated_subject_id,
                'provider_identity.authenticated_subject_id'
            ),
            workspace_id: optionalString(providerIdentity.workspace_id, 'provider_identity.workspace_id'),
            app_id: optionalString(providerIdentity.app_id, 'provider_identity.app_id'),
            enterprise_id: optionalString(providerIdentity.enterprise_id, 'provider_identity.enterprise_id')
        },
        requested_action: {
            capability_id: nonEmptyString(requestedAction.capability_id, 'requested_action.capability_id'),
            resource_ref: nonEmptyString(
                parseCompanyAuthorityResourceRef(requestedAction.resource_ref).originalResourceRef,
                'requested_action.resource_ref'
            ),
            project_hint: optionalString(requestedAction.project_hint, 'requested_action.project_hint'),
            desired_effect: desiredEffect
        },
        slack: structuredClone(slack),
        correlation_id: nonEmptyString(input.correlation_id, 'correlation_id'),
        operation_id: nonEmptyString(input.operation_id, 'operation_id'),
        billing_principal_id: optionalString(input.billing_principal_id, 'billing_principal_id'),
        ...(promotionAuthority ? { promotion_authority: promotionAuthority } : {})
    };
}

function assertResolvedIdentity(identity, request, resourceRefBinding) {
    if (!identity || typeof identity !== 'object') {
        fail('COMPANY_IDENTITY_UNRESOLVED');
    }
    if (identity.status !== 'active') fail('COMPANY_MEMBERSHIP_INACTIVE');
    const required = [
        'canonical_person_id', 'membership_id', 'membership_revision',
        'organization_id', 'project_id', 'placement_id',
        'identity_resolution_receipt_id'
    ];
    for (const field of required) nonEmptyString(identity[field], `identity.${field}`);
    if (identity.tenant_id !== request.tenant_id) fail('CROSS_TENANT_CANDIDATE');
    if (request.requested_action.project_hint
        && ![identity.project_id, identity.project_code].includes(request.requested_action.project_hint)) {
        fail('PROJECT_SCOPE_MISMATCH');
    }
    if (resourceRefBinding.projectRef !== null
        && ![identity.project_id, identity.project_code].includes(resourceRefBinding.projectRef)) {
        fail('PROJECT_SCOPE_MISMATCH');
    }
}

function assertResolvedAuthority(authority, request) {
    if (!authority || typeof authority !== 'object') fail('COMPANY_AUTHORITY_UNRESOLVED');
    if (!DECISIONS.has(authority.decision)) fail('COMPANY_AUTHORITY_UNRESOLVED');
    if (authority.decision === 'deny') fail('COMPANY_AUTHORITY_DENIED');
    const required = [
        'capability_id', 'policy_revision', 'raci_revision',
        'resource_revision', 'authority_resolution_receipt_id'
    ];
    for (const field of required) nonEmptyString(authority[field], `authority.${field}`);
    if (!Array.isArray(authority.allowed_effects)
        || !authority.allowed_effects.includes(request.requested_action.desired_effect)) {
        fail('COMPANY_EFFECT_NOT_ALLOWED');
    }
    if (authority.capability_id !== request.requested_action.capability_id) {
        fail('CAPABILITY_SCOPE_MISMATCH');
    }
}

function compactAuthorityScopes(identity, authority, request) {
    return [
        `company_authority:decision:${authority.decision}`,
        `company_authority:membership:${identity.membership_id}@${identity.membership_revision}`,
        `company_authority:resource:${request.requested_action.resource_ref}@${authority.resource_revision}`,
        `company_authority:raci:${authority.raci_revision}`,
        `company_authority:policy:${authority.policy_revision}`,
        `company_authority:effect:${request.requested_action.desired_effect}`,
        `company_authority:placement:${identity.placement_id}`,
        `company_authority:identity_receipt:${identity.identity_resolution_receipt_id}`,
        `company_authority:authority_receipt:${authority.authority_resolution_receipt_id}`,
        ...(authority.responsible_person_id
            ? [`company_authority:responsible:${authority.responsible_person_id}`] : []),
        ...(authority.accountable_person_id
            ? [`company_authority:accountable:${authority.accountable_person_id}`] : []),
        ...(authority.approver_person_id
            ? [`company_authority:approver:${authority.approver_person_id}`] : []),
        ...(authority.delegated_by_person_id
            ? [`company_authority:delegated_by:${authority.delegated_by_person_id}`] : [])
    ];
}

/**
 * Resolves company authority from Brainbase-owned canonical data.
 * The runtime supplies only an observed provider identity and a requested action.
 */
export class CompanyAuthorityResolver {
    constructor({ repository }) {
        if (!repository?.resolveCanonicalIdentity || !repository?.resolveCanonicalAuthority) {
            throw new Error('CompanyAuthorityResolver requires a canonical authority repository');
        }
        this.repository = repository;
    }

    async resolve(rawInput, canonicalRuntime) {
        const request = normalizeObservedExecutionRequest(rawInput);
        const resourceRefBinding = parseCompanyAuthorityResourceRef(request.requested_action.resource_ref);
        const identity = await this.repository.resolveCanonicalIdentity({
            tenant_id: request.tenant_id,
            provider: request.provider_identity.provider,
            authenticated_subject_id: request.provider_identity.authenticated_subject_id,
            workspace_id: request.workspace_id,
            app_id: request.app_id,
            project_hint: request.requested_action.project_hint
        });
        assertResolvedIdentity(identity, request, resourceRefBinding);
        const authority = await this.repository.resolveCanonicalAuthority({
            tenant_id: request.tenant_id,
            canonical_person_id: identity.canonical_person_id,
            membership_id: identity.membership_id,
            membership_revision: identity.membership_revision,
            organization_id: identity.organization_id,
            project_id: identity.project_id,
            resource_ref: resourceRefBinding.lookupResourceRef,
            capability_id: request.requested_action.capability_id,
            desired_effect: request.requested_action.desired_effect
        });
        assertResolvedAuthority(authority, request);

        return {
            request,
            actor: {
                principal_id: identity.canonical_person_id,
                principal_type: identity.principal_type === 'service' ? 'service' : 'person',
                authenticated_subject_id: request.provider_identity.authenticated_subject_id,
                ...(authority.delegated_by_person_id
                    ? { delegated_by: authority.delegated_by_person_id }
                    : {})
            },
            authorization: {
                organization_ids: [identity.organization_id],
                project_ids: [identity.project_id],
                data_scopes: compactAuthorityScopes(identity, authority, request),
                capability_ids: [request.requested_action.capability_id]
            },
            company_authority: {
                actor: structuredClone(identity),
                authority: structuredClone(authority),
                resource_ref: request.requested_action.resource_ref,
                desired_effect: request.requested_action.desired_effect,
                tenant_revision: String(canonicalRuntime.tenant.tenant_revision),
                connection_revision: String(canonicalRuntime.workspace_connection.connection_revision),
                contract_revision: String(canonicalRuntime.contract_revision)
            }
        };
    }
}
