import { ContractError } from '../multitenant/errors.js';

export const PERSONAL_TO_ORGANIZATION_PROMOTION_SCHEMA_VERSION = 'personal_to_organization.promote.v1';
export const PERSONAL_TO_ORGANIZATION_PROMOTION_CAPABILITY = 'personal_to_organization.promote';

export const PERSONAL_KNOWLEDGE_PROMOTION_CAPABILITY_MAP = Object.freeze({
    request: Object.freeze({
        runtime_capability_id: 'personal_knowledge_promotion:request',
        action: 'request'
    }),
    owner_consent: Object.freeze({
        runtime_capability_id: 'personal_knowledge_promotion:owner_consent',
        action: 'owner_consent'
    }),
    organization_review: Object.freeze({
        runtime_capability_id: 'personal_knowledge_promotion:organization_review',
        action: 'organization_review'
    })
});

const ACTIONS = new Set(Object.keys(PERSONAL_KNOWLEDGE_PROMOTION_CAPABILITY_MAP));
const RUNTIME_CAPABILITIES = new Map(
    Object.entries(PERSONAL_KNOWLEDGE_PROMOTION_CAPABILITY_MAP)
        .map(([action, value]) => [value.runtime_capability_id, { action, ...value }])
);
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function invalid(field, reason = 'invalid') {
    throw new ContractError('PERSONAL_KNOWLEDGE_PROMOTION_AUTHORITY_INVALID', {
        status: 403,
        fault_domain: 'authorization',
        details: { field, reason }
    });
}

function requiredString(value, field) {
    if (typeof value !== 'string' || !value.trim() || value.length > 240) invalid(field);
    return value;
}

function nullableString(value, field) {
    if (value === null) return null;
    return requiredString(value, field);
}

function assertResourceRef(value, action) {
    requiredString(value, 'resource_ref');
    const [prefix, id] = action === 'request'
        ? ['personal-knowledge://events/', value.slice('personal-knowledge://events/'.length)]
        : ['personal-knowledge://promotions/', value.slice('personal-knowledge://promotions/'.length)];
    if (!value.startsWith(prefix) || !RESOURCE_ID.test(id)) invalid('resource_ref');
    return value;
}

function assertNormalizedPayloadHash(value, action) {
    if (action === 'request') {
        if (value !== null) invalid('normalized_payload_hash', 'must_be_null_for_request');
        return null;
    }
    if (typeof value !== 'string' || !SHA256.test(value)) invalid('normalized_payload_hash');
    return value;
}

export function actionForRuntimeCapability(runtimeCapabilityId) {
    const value = RUNTIME_CAPABILITIES.get(runtimeCapabilityId);
    return value ? { ...value } : null;
}

export function runtimeCapabilityForAction(action) {
    return ACTIONS.has(action)
        ? { action, ...PERSONAL_KNOWLEDGE_PROMOTION_CAPABILITY_MAP[action] }
        : null;
}

export function resourceRefForPersonalEvent(personalEventId) {
    requiredString(personalEventId, 'personal_event_id');
    return `personal-knowledge://events/${personalEventId}`;
}

export function resourceRefForPromotionRequest(requestId) {
    requiredString(requestId, 'request_id');
    return `personal-knowledge://promotions/${requestId}`;
}

/**
 * Wire shape signed by the company-authority producer. Request creation is
 * bound to the Personal event; later actions are bound to the promotion
 * request and the exact normalized payload hash stored in that request.
 */
export function buildPersonalKnowledgePromotionAuthority({
    action,
    personalEventId = null,
    requestId = null,
    normalizedPayloadHash = null
} = {}) {
    const mapping = runtimeCapabilityForAction(action);
    if (!mapping) invalid('action');
    const isRequest = action === 'request';
    if (isRequest && requestId !== null) invalid('request_id', 'must_be_null_for_request');
    if (!isRequest && requestId === null) invalid('request_id', 'required');
    const resourceRef = isRequest
        ? resourceRefForPersonalEvent(personalEventId)
        : resourceRefForPromotionRequest(requestId);
    return Object.freeze({
        schema_version: PERSONAL_TO_ORGANIZATION_PROMOTION_SCHEMA_VERSION,
        capability_id: PERSONAL_TO_ORGANIZATION_PROMOTION_CAPABILITY,
        action,
        resource_ref: resourceRef,
        request_id: isRequest ? null : requiredString(requestId, 'request_id'),
        normalized_payload_hash: assertNormalizedPayloadHash(normalizedPayloadHash, action)
    });
}

/** Validate and return the exact signed wire shape. */
export function assertPersonalKnowledgePromotionAuthority(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('$');
    const fields = [
        'schema_version', 'capability_id', 'action', 'resource_ref',
        'request_id', 'normalized_payload_hash'
    ];
    const keys = Object.keys(value).sort();
    if (keys.length !== fields.length || keys.some((key, index) => key !== fields.slice().sort()[index])) {
        invalid('$', 'additional_property');
    }
    if (value.schema_version !== PERSONAL_TO_ORGANIZATION_PROMOTION_SCHEMA_VERSION) {
        invalid('schema_version');
    }
    if (value.capability_id !== PERSONAL_TO_ORGANIZATION_PROMOTION_CAPABILITY) {
        invalid('capability_id');
    }
    if (!ACTIONS.has(value.action)) invalid('action');
    assertResourceRef(value.resource_ref, value.action);
    if (value.action === 'request') {
        if (value.request_id !== null) invalid('request_id', 'must_be_null_for_request');
    } else {
        nullableString(value.request_id, 'request_id');
        if (value.request_id === null) invalid('request_id', 'required');
        if (!value.resource_ref.endsWith(`/${value.request_id}`)) invalid('resource_ref', 'request_id_mismatch');
    }
    assertNormalizedPayloadHash(value.normalized_payload_hash, value.action);
    return Object.freeze(structuredClone(value));
}

/**
 * Bind the producer's requested runtime capability to the signed target.
 * This runs before the envelope is signed, so a producer cannot issue a
 * promotion authority for another action or resource accidentally.
 */
export function assertPromotionAuthorityProducerBinding(authority, {
    runtimeCapabilityId,
    resourceRef
} = {}) {
    const normalized = assertPersonalKnowledgePromotionAuthority(authority);
    const mapping = actionForRuntimeCapability(runtimeCapabilityId);
    if (!mapping || mapping.action !== normalized.action
        || normalized.capability_id !== PERSONAL_TO_ORGANIZATION_PROMOTION_CAPABILITY
        || normalized.resource_ref !== resourceRef) {
        invalid('producer_binding', 'runtime_capability_or_resource_mismatch');
    }
    return normalized;
}
