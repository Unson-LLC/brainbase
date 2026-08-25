import { canonicalJson } from './canonical-json.js';
import { ContractError } from './errors.js';
import {
    PERSONAL_KNOWLEDGE_PROMOTION_CAPABILITY_MAP,
    PERSONAL_TO_ORGANIZATION_PROMOTION_CAPABILITY,
    PERSONAL_TO_ORGANIZATION_PROMOTION_SCHEMA_VERSION
} from '../personal-knowledge/promotion-authority-contract.js';

export const CANONICAL_SCHEMA_SHA256 = '359f039284efc35ad96783f798bab7f830d4a5c2a914e044dfcaa600f6591742';

const REVISION = /^(0|[1-9][0-9]*)$/;
const PROTOCOL_VERSION = /^1\.[0-9]+$/;
const PREFIXED_ULID = /^(ten|wsc|dep|cor|op|lease|usage|receipt)_[0-9A-HJKMNP-TV-Z]{26}$/;
const IDEMPOTENCY_KEY = /^ik1_[A-Za-z0-9_-]{43}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const REQUIRED_CAPABILITIES = new Set([
    'signed_tenant_context',
    'connection_revision_recheck',
    'tenant_scoped_authorization',
    'credential_broker_v1',
    'usage_receipt_v1',
    'idempotent_effects_v1',
    'container_sanitization_v1'
]);
const CREDENTIAL_MODES = new Set(['cloud_standard', 'customer_oauth', 'customer_api']);
const COLLECTION_STATES = new Set(['collected', 'partial', 'not_collected']);
const OUTCOMES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);
const DEPLOYMENT_PROFILES = new Set(['shared_cloud', 'dedicated_cloud', 'customer_managed_oss']);
const QUOTA_DECISIONS = new Set(['allowed', 'warning', 'hard_stopped', 'approval_required', 'unavailable']);
const PROMOTION_AUTHORITY_SCHEMA_VERSION = PERSONAL_TO_ORGANIZATION_PROMOTION_SCHEMA_VERSION;
const PROMOTION_AUTHORITY_CAPABILITY = PERSONAL_TO_ORGANIZATION_PROMOTION_CAPABILITY;
const PROMOTION_AUTHORITY_ACTIONS = new Set(Object.keys(PERSONAL_KNOWLEDGE_PROMOTION_CAPABILITY_MAP));
const PROMOTION_RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

function fail(path, reason = 'schema') {
    throw new ContractError('SCHEMA_INVALID', {
        status: 400,
        fault_domain: 'protocol',
        details: { path, reason, canonical_schema_sha256: CANONICAL_SCHEMA_SHA256 }
    });
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactObject(value, { required, optional = [], path = '$' }) {
    if (!isObject(value)) fail(path, 'object_required');
    const allowed = new Set([...required, ...optional]);
    for (const field of required) {
        if (!Object.hasOwn(value, field)) fail(`${path}.${field}`, 'required');
    }
    for (const field of Object.keys(value)) {
        if (!allowed.has(field)) fail(`${path}.${field}`, 'additional_property');
    }
}

function constValue(value, expected, path) {
    if (value !== expected) fail(path, 'const');
}

function enumValue(value, allowed, path) {
    if (!allowed.has(value)) fail(path, 'enum');
}

function string(value, path, { pattern, nonEmpty = false, nullable = false } = {}) {
    if (nullable && value === null) return;
    if (typeof value !== 'string' || (nonEmpty && value.length === 0) || (pattern && !pattern.test(value))) {
        fail(path, 'string');
    }
}

function timestamp(value, path) {
    string(value, path, { pattern: TIMESTAMP });
    if (!Number.isFinite(Date.parse(value))) fail(path, 'date-time');
}

function number(value, path, { nullable = false, integer = false, min = 0, max } = {}) {
    if (nullable && value === null) return;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min
        || (integer && !Number.isInteger(value)) || (max !== undefined && value > max)) {
        fail(path, integer ? 'integer' : 'number');
    }
}

function array(value, path, validateItem, { min = 0, unique = false } = {}) {
    if (!Array.isArray(value) || value.length < min) fail(path, 'array');
    if (unique && new Set(value.map((item) => canonicalJson(item))).size !== value.length) {
        fail(path, 'unique_items');
    }
    value.forEach((item, index) => validateItem(item, `${path}[${index}]`));
}

const nonEmpty = (value, path) => string(value, path, { nonEmpty: true });
const revision = (value, path) => string(value, path, { pattern: REVISION });
const protocolVersion = (value, path) => string(value, path, { pattern: PROTOCOL_VERSION });
const prefixedUlid = (value, path) => string(value, path, { pattern: PREFIXED_ULID });
const idempotencyKey = (value, path) => string(value, path, { pattern: IDEMPOTENCY_KEY });
const sha256 = (value, path) => string(value, path, { pattern: SHA256 });

function protocolRequest(value) {
    const fields = [
        'message_type', 'protocol_id', 'supported_range', 'supported_versions',
        'required_capabilities', 'optional_capabilities', 'deployment_id', 'deployment_profile'
    ];
    exactObject(value, { required: fields });
    constValue(value.message_type, 'protocol_negotiation_request', '$.message_type');
    constValue(value.protocol_id, 'mana-brainbase-tenant-context', '$.protocol_id');
    constValue(value.supported_range, '>=1.0 <2.0', '$.supported_range');
    array(value.supported_versions, '$.supported_versions', protocolVersion, { min: 1, unique: true });
    array(value.required_capabilities, '$.required_capabilities', (item, path) => enumValue(item, REQUIRED_CAPABILITIES, path), { min: 1, unique: true });
    array(value.optional_capabilities, '$.optional_capabilities', nonEmpty, { unique: true });
    prefixedUlid(value.deployment_id, '$.deployment_id');
    enumValue(value.deployment_profile, DEPLOYMENT_PROFILES, '$.deployment_profile');
}

function optionalCapability(value, path) {
    exactObject(value, { required: ['capability', 'status'], optional: ['reason'], path });
    nonEmpty(value.capability, `${path}.capability`);
    enumValue(value.status, new Set(['supported', 'unsupported', 'non_applicable']), `${path}.status`);
    if (value.reason !== undefined) nonEmpty(value.reason, `${path}.reason`);
    if (value.status === 'non_applicable' && value.reason === undefined) fail(`${path}.reason`, 'required');
}

function protocolResponse(value) {
    const fields = [
        'message_type', 'protocol_id', 'selected_version', 'supported_range', 'supported_versions',
        'required_capabilities', 'optional_capabilities', 'compatibility_until'
    ];
    exactObject(value, { required: fields });
    constValue(value.message_type, 'protocol_negotiation_response', '$.message_type');
    constValue(value.protocol_id, 'mana-brainbase-tenant-context', '$.protocol_id');
    protocolVersion(value.selected_version, '$.selected_version');
    constValue(value.supported_range, '>=1.0 <2.0', '$.supported_range');
    array(value.supported_versions, '$.supported_versions', protocolVersion, { min: 1, unique: true });
    array(value.required_capabilities, '$.required_capabilities', (item, path) => enumValue(item, REQUIRED_CAPABILITIES, path), { min: 1, unique: true });
    array(value.optional_capabilities, '$.optional_capabilities', optionalCapability);
    timestamp(value.compatibility_until, '$.compatibility_until');
}

function tenantContext(value, { requireIntegrity }) {
    const required = [
        'schema_version', 'protocol_id', 'protocol_version', 'issuer', 'audience', 'tenant',
        'workspace_connection', 'actor', 'authorization', 'placement', 'slack', 'correlation_id',
        'operation_id', 'idempotency_key', 'contract_revision', 'credential', 'issued_at', 'expires_at'
    ];
    if (requireIntegrity) required.push('integrity');
    exactObject(value, { required, optional: requireIntegrity ? ['authority'] : ['integrity', 'authority'] });
    constValue(value.schema_version, '1.0', '$.schema_version');
    constValue(value.protocol_id, 'mana-brainbase-tenant-context', '$.protocol_id');
    protocolVersion(value.protocol_version, '$.protocol_version');
    constValue(value.issuer, 'brainbase', '$.issuer');
    array(value.audience, '$.audience', nonEmpty, { min: 1, unique: true });

    exactObject(value.tenant, { required: ['tenant_id', 'tenant_revision'], path: '$.tenant' });
    prefixedUlid(value.tenant.tenant_id, '$.tenant.tenant_id');
    revision(value.tenant.tenant_revision, '$.tenant.tenant_revision');

    exactObject(value.workspace_connection, {
        required: ['connection_id', 'connection_revision', 'status', 'provider', 'installation_id', 'workspace_id', 'app_id'],
        path: '$.workspace_connection'
    });
    prefixedUlid(value.workspace_connection.connection_id, '$.workspace_connection.connection_id');
    revision(value.workspace_connection.connection_revision, '$.workspace_connection.connection_revision');
    constValue(value.workspace_connection.status, 'active', '$.workspace_connection.status');
    constValue(value.workspace_connection.provider, 'slack', '$.workspace_connection.provider');
    for (const field of ['installation_id', 'workspace_id', 'app_id']) nonEmpty(value.workspace_connection[field], `$.workspace_connection.${field}`);

    exactObject(value.actor, { required: ['principal_id', 'principal_type', 'authenticated_subject_id'], optional: ['delegated_by'], path: '$.actor' });
    nonEmpty(value.actor.principal_id, '$.actor.principal_id');
    enumValue(value.actor.principal_type, new Set(['person', 'service']), '$.actor.principal_type');
    nonEmpty(value.actor.authenticated_subject_id, '$.actor.authenticated_subject_id');
    if (value.actor.delegated_by !== undefined) nonEmpty(value.actor.delegated_by, '$.actor.delegated_by');

    const authorizationFields = ['organization_ids', 'project_ids', 'data_scopes', 'capability_ids'];
    exactObject(value.authorization, { required: authorizationFields, path: '$.authorization' });
    for (const field of authorizationFields) array(value.authorization[field], `$.authorization.${field}`, nonEmpty, { unique: true });

    exactObject(value.placement, { required: ['deployment_id', 'profile'], path: '$.placement' });
    prefixedUlid(value.placement.deployment_id, '$.placement.deployment_id');
    enumValue(value.placement.profile, DEPLOYMENT_PROFILES, '$.placement.profile');

    exactObject(value.slack, { required: ['event_id', 'channel_id'], optional: ['enterprise_id', 'thread_ts', 'requester_id'], path: '$.slack' });
    for (const field of ['event_id', 'channel_id', 'enterprise_id', 'thread_ts', 'requester_id']) {
        if (value.slack[field] !== undefined) nonEmpty(value.slack[field], `$.slack.${field}`);
    }
    prefixedUlid(value.correlation_id, '$.correlation_id');
    prefixedUlid(value.operation_id, '$.operation_id');
    idempotencyKey(value.idempotency_key, '$.idempotency_key');
    revision(value.contract_revision, '$.contract_revision');

    exactObject(value.credential, { required: ['mode', 'credential_ref', 'billing_principal_id'], path: '$.credential' });
    enumValue(value.credential.mode, CREDENTIAL_MODES, '$.credential.mode');
    nonEmpty(value.credential.credential_ref, '$.credential.credential_ref');
    nonEmpty(value.credential.billing_principal_id, '$.credential.billing_principal_id');
    timestamp(value.issued_at, '$.issued_at');
    timestamp(value.expires_at, '$.expires_at');

    if (value.authority !== undefined) personalKnowledgePromotionAuthority(value.authority);

    if (value.integrity !== undefined) {
        exactObject(value.integrity, { required: ['method', 'algorithm', 'key_id', 'value'], path: '$.integrity' });
        constValue(value.integrity.method, 'jws_detached', '$.integrity.method');
        constValue(value.integrity.algorithm, 'EdDSA', '$.integrity.algorithm');
        nonEmpty(value.integrity.key_id, '$.integrity.key_id');
        string(value.integrity.value, '$.integrity.value', { pattern: /^[A-Za-z0-9_-]+\.\.[A-Za-z0-9_-]{86}$/ });
    }
}

function personalKnowledgePromotionAuthority(value) {
    const path = '$.authority';
    exactObject(value, {
        required: [
            'schema_version', 'capability_id', 'action', 'resource_ref',
            'request_id', 'normalized_payload_hash'
        ],
        path
    });
    constValue(value.schema_version, PROMOTION_AUTHORITY_SCHEMA_VERSION, `${path}.schema_version`);
    constValue(value.capability_id, PROMOTION_AUTHORITY_CAPABILITY, `${path}.capability_id`);
    enumValue(value.action, PROMOTION_AUTHORITY_ACTIONS, `${path}.action`);
    nonEmpty(value.resource_ref, `${path}.resource_ref`);
    const eventRef = value.resource_ref.startsWith('personal-knowledge://events/');
    const promotionRef = value.resource_ref.startsWith('personal-knowledge://promotions/');
    const resourceId = value.resource_ref.slice(
        eventRef ? 'personal-knowledge://events/'.length : 'personal-knowledge://promotions/'.length
    );
    if ((!eventRef && !promotionRef) || !PROMOTION_RESOURCE_ID.test(resourceId)) {
        fail(`${path}.resource_ref`, 'resource_ref');
    }
    if (value.action === 'request') {
        if (!eventRef || value.request_id !== null || value.normalized_payload_hash !== null) {
            fail(path, 'request_target');
        }
    } else {
        if (!promotionRef || typeof value.request_id !== 'string' || value.request_id.length === 0
            || value.resource_ref !== `personal-knowledge://promotions/${value.request_id}`) {
            fail(path, 'promotion_target');
        }
        sha256(value.normalized_payload_hash, `${path}.normalized_payload_hash`);
    }
}

function credentialBinding(value, path = '$.binding') {
    const fields = [
        'tenant_id', 'connection_id', 'connection_revision', 'contract_revision',
        'operation_id', 'audience', 'credential_mode', 'credential_ref'
    ];
    exactObject(value, { required: fields, path });
    prefixedUlid(value.tenant_id, `${path}.tenant_id`);
    prefixedUlid(value.connection_id, `${path}.connection_id`);
    revision(value.connection_revision, `${path}.connection_revision`);
    revision(value.contract_revision, `${path}.contract_revision`);
    prefixedUlid(value.operation_id, `${path}.operation_id`);
    nonEmpty(value.audience, `${path}.audience`);
    enumValue(value.credential_mode, CREDENTIAL_MODES, `${path}.credential_mode`);
    nonEmpty(value.credential_ref, `${path}.credential_ref`);
}

function credentialLeaseRequest(value) {
    exactObject(value, { required: ['message_type', 'protocol_version', 'binding', 'requested_ttl_seconds'] });
    constValue(value.message_type, 'credential_lease_request', '$.message_type');
    protocolVersion(value.protocol_version, '$.protocol_version');
    credentialBinding(value.binding);
    number(value.requested_ttl_seconds, '$.requested_ttl_seconds', { integer: true, min: 1, max: 60 });
}

function credentialLeaseResponse(value) {
    exactObject(value, { required: ['message_type', 'protocol_version', 'lease_id', 'contract_revision', 'binding', 'issued_at', 'expires_at', 'max_uses', 'lease_token'] });
    constValue(value.message_type, 'credential_lease_response', '$.message_type');
    protocolVersion(value.protocol_version, '$.protocol_version');
    prefixedUlid(value.lease_id, '$.lease_id');
    revision(value.contract_revision, '$.contract_revision');
    credentialBinding(value.binding);
    timestamp(value.issued_at, '$.issued_at');
    timestamp(value.expires_at, '$.expires_at');
    constValue(value.max_uses, 1, '$.max_uses');
    nonEmpty(value.lease_token, '$.lease_token');
}

function quotaDecision(value) {
    const required = ['message_type', 'tenant_id', 'contract_revision', 'quota_revision', 'decision', 'limit', 'used', 'remaining', 'unit', 'window_started_at', 'window_ends_at', 'decided_at'];
    exactObject(value, { required, optional: ['failure_code'] });
    constValue(value.message_type, 'quota_decision', '$.message_type');
    prefixedUlid(value.tenant_id, '$.tenant_id');
    revision(value.contract_revision, '$.contract_revision');
    revision(value.quota_revision, '$.quota_revision');
    enumValue(value.decision, QUOTA_DECISIONS, '$.decision');
    for (const field of ['limit', 'used', 'remaining']) number(value[field], `$.${field}`, { nullable: true });
    nonEmpty(value.unit, '$.unit');
    timestamp(value.window_started_at, '$.window_started_at');
    timestamp(value.window_ends_at, '$.window_ends_at');
    timestamp(value.decided_at, '$.decided_at');
    if (value.failure_code !== undefined) string(value.failure_code, '$.failure_code', { nullable: true });
}

function usageEvent(value) {
    const fields = [
        'message_type', 'usage_event_id', 'protocol_version', 'tenant_id', 'connection_id',
        'connection_revision', 'contract_revision', 'deployment_id', 'correlation_id', 'operation_id',
        'idempotency_key', 'kind', 'quantity', 'unit', 'collection_state', 'outcome', 'failure_code',
        'unknown_fields', 'observed_at'
    ];
    exactObject(value, { required: fields });
    constValue(value.message_type, 'usage_event', '$.message_type');
    prefixedUlid(value.usage_event_id, '$.usage_event_id');
    protocolVersion(value.protocol_version, '$.protocol_version');
    for (const field of ['tenant_id', 'connection_id', 'deployment_id', 'correlation_id', 'operation_id']) prefixedUlid(value[field], `$.${field}`);
    revision(value.connection_revision, '$.connection_revision');
    revision(value.contract_revision, '$.contract_revision');
    idempotencyKey(value.idempotency_key, '$.idempotency_key');
    nonEmpty(value.kind, '$.kind');
    number(value.quantity, '$.quantity', { nullable: true });
    nonEmpty(value.unit, '$.unit');
    enumValue(value.collection_state, COLLECTION_STATES, '$.collection_state');
    enumValue(value.outcome, OUTCOMES, '$.outcome');
    string(value.failure_code, '$.failure_code', { nullable: true });
    array(value.unknown_fields, '$.unknown_fields', nonEmpty, { unique: true });
    timestamp(value.observed_at, '$.observed_at');
}

function operationReceipt(value) {
    const fields = [
        'message_type', 'receipt_id', 'protocol_version', 'tenant_id', 'connection_id',
        'connection_revision', 'contract_revision', 'deployment_id', 'correlation_id', 'operation_ids',
        'idempotency_keys', 'actor_principal_id', 'project_id', 'capability_id', 'quota_decision',
        'credential_mode', 'collection_state', 'outcome', 'failure_code', 'usage_event_ids', 'reply', 'completed_at'
    ];
    exactObject(value, { required: fields });
    constValue(value.message_type, 'operation_receipt', '$.message_type');
    prefixedUlid(value.receipt_id, '$.receipt_id');
    protocolVersion(value.protocol_version, '$.protocol_version');
    for (const field of ['tenant_id', 'connection_id', 'deployment_id', 'correlation_id']) prefixedUlid(value[field], `$.${field}`);
    revision(value.connection_revision, '$.connection_revision');
    revision(value.contract_revision, '$.contract_revision');
    array(value.operation_ids, '$.operation_ids', prefixedUlid, { min: 1, unique: true });
    array(value.idempotency_keys, '$.idempotency_keys', idempotencyKey, { min: 1, unique: true });
    nonEmpty(value.actor_principal_id, '$.actor_principal_id');
    string(value.project_id, '$.project_id', { nullable: true });
    nonEmpty(value.capability_id, '$.capability_id');
    enumValue(value.quota_decision, QUOTA_DECISIONS, '$.quota_decision');
    enumValue(value.credential_mode, CREDENTIAL_MODES, '$.credential_mode');
    enumValue(value.collection_state, COLLECTION_STATES, '$.collection_state');
    enumValue(value.outcome, OUTCOMES, '$.outcome');
    string(value.failure_code, '$.failure_code', { nullable: true });
    array(value.usage_event_ids, '$.usage_event_ids', prefixedUlid, { unique: true });
    exactObject(value.reply, { required: ['state', 'reply_count', 'legacy_reply_count'], optional: ['slack_reply_ts'], path: '$.reply' });
    enumValue(value.reply.state, new Set(['not_attempted', 'delivered', 'failed', 'unknown']), '$.reply.state');
    number(value.reply.reply_count, '$.reply.reply_count', { integer: true, min: 0, max: 1 });
    number(value.reply.legacy_reply_count, '$.reply.legacy_reply_count', { integer: true, min: 0, max: 0 });
    if (value.reply.slack_reply_ts !== undefined) nonEmpty(value.reply.slack_reply_ts, '$.reply.slack_reply_ts');
    timestamp(value.completed_at, '$.completed_at');
}

function idempotencyClaim(value) {
    const fields = [
        'message_type', 'owner', 'scope', 'tenant_id', 'connection_id', 'slack_event_id',
        'operation_id', 'idempotency_key', 'context_hash', 'payload_hash', 'state', 'retention_until'
    ];
    exactObject(value, { required: fields });
    constValue(value.message_type, 'idempotency_claim', '$.message_type');
    enumValue(value.owner, new Set(['brainbase', 'mana_runtime']), '$.owner');
    enumValue(value.scope, new Set(['credential_lease', 'quota_decision', 'business_effect', 'usage_receipt', 'queue_execution', 'slack_delivery']), '$.scope');
    prefixedUlid(value.tenant_id, '$.tenant_id');
    prefixedUlid(value.connection_id, '$.connection_id');
    nonEmpty(value.slack_event_id, '$.slack_event_id');
    prefixedUlid(value.operation_id, '$.operation_id');
    idempotencyKey(value.idempotency_key, '$.idempotency_key');
    sha256(value.context_hash, '$.context_hash');
    sha256(value.payload_hash, '$.payload_hash');
    enumValue(value.state, new Set(['pending', 'claimed', 'succeeded', 'failed_terminal']), '$.state');
    timestamp(value.retention_until, '$.retention_until');
}

const validators = Object.freeze({
    ProtocolNegotiationRequest: protocolRequest,
    ProtocolNegotiationResponse: protocolResponse,
    TenantContextUnsigned: (value) => tenantContext(value, { requireIntegrity: false }),
    TenantContextEnvelope: (value) => tenantContext(value, { requireIntegrity: true }),
    CredentialLeaseRequest: credentialLeaseRequest,
    CredentialLeaseResponse: credentialLeaseResponse,
    QuotaDecision: quotaDecision,
    UsageEvent: usageEvent,
    OperationReceipt: operationReceipt,
    IdempotencyClaim: idempotencyClaim
});

export function validateCanonicalWire(type, value) {
    const validator = validators[type];
    if (!validator) throw new Error(`Unknown canonical wire type: ${type}`);
    validator(value);
    return true;
}
