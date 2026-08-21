import {
    createPrivateKey,
    createPublicKey,
    sign as ed25519Sign,
    verify as ed25519Verify
} from 'node:crypto';

export const CONTRACT_ID = 'mana-brainbase-company-authority/v1';
export const SCHEMA_VERSION = '1.0';
export const COMPANY_AUTHORITY_CAPABILITY = 'company_authority_v1';
export const MAX_TTL_SECONDS = 300;
export const MAX_CLOCK_SKEW_SECONDS = 30;
export const PROTECTED_TYP = 'application/mana-brainbase-company-authority+jws';
export const CANONICAL_ERROR_CODES = Object.freeze([
    'DESIRED_EFFECT_REQUIRED',
    'COMPANY_AUTHORITY_REQUIRED',
    'COMPANY_AUTHORITY_EFFECT_MISMATCH',
    'COMPANY_AUTHORITY_DENIED',
    'PERSON_UNKNOWN',
    'PERSON_AMBIGUOUS',
    'AUTHORITY_CROSS_ORG',
    'AUTHORITY_SCOPE_MISMATCH',
    'AUTHORITY_CONTEXT_STALE',
    'APPROVER_MISMATCH',
    'AUTHORITY_UNAVAILABLE',
    'MEMBERSHIP_INACTIVE',
    'PERSONAL_OWNER_REQUIRED',
    'PERSONAL_SCOPE_MISMATCH',
    'AUTHORITY_CONTEXT_INVALID_SIGNATURE',
    'AUTHORITY_CONTEXT_EXPIRED',
    'AUTHORITY_REPLAY_CONFLICT'
]);

const DECISIONS = new Set(['auto', 'approval', 'human_action', 'deny']);
const EFFECTS = new Set(['read', 'write', 'external_side_effect']);
const PROVIDERS = new Set(['slack', 'codex', 'claude_code', 'service']);
const REVISION = /^(0|[1-9][0-9]*)$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

export class ContractError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'ContractError';
        this.code = code;
        this.details = details;
    }
}

function fail(code, message = code, details = {}) {
    throw new ContractError(code, message, details);
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, required, path) {
    if (!isObject(value)) fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', `${path} must be an object`);
    const actual = Object.keys(value).sort();
    const expected = [...required].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', `${path} keys do not match the contract`, { path });
    }
}

function requiredKeys(value, required, optional, path) {
    if (!isObject(value)) fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', `${path} must be an object`);
    const allowed = new Set([...required, ...optional]);
    for (const key of required) {
        if (!Object.hasOwn(value, key)) fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', `${path}.${key} is required`, { path: `${path}.${key}` });
    }
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', `${path}.${key} is not allowed`, { path: `${path}.${key}` });
    }
}

function string(value, path, { nullable = false, nonEmpty = true } = {}) {
    if (nullable && value === null) return;
    if (typeof value !== 'string' || (nonEmpty && value.length === 0)) {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', `${path} must be a string`, { path });
    }
}

function nullableString(value, path) {
    string(value, path, { nullable: true });
}

function array(value, path, itemValidator, { min = 0, unique = false } = {}) {
    if (!Array.isArray(value) || value.length < min) {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', `${path} must be an array`, { path });
    }
    if (unique && new Set(value.map((entry) => canonicalJson(entry))).size !== value.length) {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', `${path} must not contain duplicates`, { path });
    }
    value.forEach((entry, index) => itemValidator(entry, `${path}[${index}]`));
}

function enumValue(value, allowed, path) {
    if (!allowed.has(value)) fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', `${path} has an invalid value`, { path });
}

function revision(value, path) {
    if (typeof value !== 'string' || !REVISION.test(value)) {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', `${path} must be a canonical decimal revision`, { path });
    }
}

function parseTimestamp(value) {
    if (typeof value !== 'string') return null;
    const match = TIMESTAMP.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    const fraction = match[7] === undefined ? 0 : Number(`0.${match[7]}`);
    if (month < 1 || month > 12 || day < 1 || day > [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month]
        || (month === 2 && day === 29 && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)))) return null;
    const offset = match[8] === 'Z' ? 0 : Number(match[8].slice(1, 3)) * 60 + Number(match[8].slice(4, 6));
    if (offset > 23 * 60 + 59 || hour > 23 || minute > 59 || second > 60) return null;
    const sign = match[8] === 'Z' || match[8][0] === '+' ? 1 : -1;
    const base = new Date(0);
    base.setUTCFullYear(year, month - 1, day);
    base.setUTCHours(hour, minute, second === 60 ? 59 : second, Math.floor(fraction * 1000));
    const utc = base.getTime() - (sign === 1 ? offset : -offset) * 60 * 1000;
    if (!Number.isFinite(utc)) return null;
    if (second === 60) {
        const leapBase = new Date(utc);
        if (leapBase.getUTCHours() !== 23 || leapBase.getUTCMinutes() !== 59) return null;
        return utc + 1000;
    }
    return utc;
}

function timestamp(value, path) {
    const parsed = parseTimestamp(value);
    if (parsed === null) {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', `${path} must be an RFC3339 date-time`, { path });
    }
    return parsed;
}

function audienceContains(audience, expectedAudience) {
    const expected = Array.isArray(expectedAudience) ? expectedAudience : [expectedAudience];
    return expected.every((entry) => audience.includes(entry));
}

function validateTimeWindow(context, now) {
    timestamp(context.issued_at, '$.issued_at');
    timestamp(context.expires_at, '$.expires_at');
    const issued = timestamp(context.issued_at, '$.issued_at');
    const expires = timestamp(context.expires_at, '$.expires_at');
    const current = now instanceof Date ? now.getTime() : parseTimestamp(now ?? context.issued_at);
    if (!Number.isFinite(current)) fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'evaluation time is invalid');
    if (expires <= issued || expires - issued > MAX_TTL_SECONDS * 1000) {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'context TTL is invalid');
    }
    if (expires < current - MAX_CLOCK_SKEW_SECONDS * 1000) {
        fail('AUTHORITY_CONTEXT_EXPIRED', 'context has expired');
    }
    if (issued > current + MAX_CLOCK_SKEW_SECONDS * 1000) {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'context is not yet valid');
    }
}

function validateTenantContext(value) {
    requiredKeys(value, [
        'schema_version', 'protocol_id', 'protocol_version', 'issuer', 'audience', 'tenant',
        'workspace_connection', 'actor', 'authorization', 'placement', 'slack', 'correlation_id',
        'operation_id', 'idempotency_key', 'contract_revision', 'credential', 'issued_at', 'expires_at', 'integrity'
    ], [], '$.tenant_context');
    if (value.schema_version !== SCHEMA_VERSION || value.protocol_id !== 'mana-brainbase-tenant-context'
        || value.protocol_version !== '1.0' || value.issuer !== 'brainbase') {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'tenant context protocol identity is invalid');
    }
    array(value.audience, '$.tenant_context.audience', string, { min: 1, unique: true });
    requiredKeys(value.tenant, ['tenant_id', 'tenant_revision'], [], '$.tenant_context.tenant');
    string(value.tenant.tenant_id, '$.tenant_context.tenant.tenant_id');
    revision(value.tenant.tenant_revision, '$.tenant_context.tenant.tenant_revision');
    requiredKeys(value.workspace_connection, [
        'connection_id', 'connection_revision', 'status', 'provider', 'installation_id', 'workspace_id', 'app_id'
    ], [], '$.tenant_context.workspace_connection');
    for (const field of ['connection_id', 'installation_id', 'workspace_id', 'app_id']) {
        string(value.workspace_connection[field], `$.tenant_context.workspace_connection.${field}`);
    }
    revision(value.workspace_connection.connection_revision, '$.tenant_context.workspace_connection.connection_revision');
    if (value.workspace_connection.status !== 'active' || value.workspace_connection.provider !== 'slack') {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'workspace connection is not active Slack');
    }
    requiredKeys(value.actor, ['principal_id', 'principal_type', 'authenticated_subject_id'], ['delegated_by'], '$.tenant_context.actor');
    for (const field of ['principal_id', 'principal_type', 'authenticated_subject_id']) string(value.actor[field], `$.tenant_context.actor.${field}`);
    if (!new Set(['person', 'service']).has(value.actor.principal_type)) fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'tenant actor type is invalid');
    if (value.actor.delegated_by !== undefined) string(value.actor.delegated_by, '$.tenant_context.actor.delegated_by');
    requiredKeys(value.authorization, ['organization_ids', 'project_ids', 'data_scopes', 'capability_ids'], [], '$.tenant_context.authorization');
    for (const field of ['organization_ids', 'project_ids', 'data_scopes', 'capability_ids']) {
        array(value.authorization[field], `$.tenant_context.authorization.${field}`, string, { unique: true });
    }
    requiredKeys(value.placement, ['deployment_id', 'profile'], [], '$.tenant_context.placement');
    string(value.placement.deployment_id, '$.tenant_context.placement.deployment_id');
    string(value.placement.profile, '$.tenant_context.placement.profile');
    requiredKeys(value.slack, ['event_id', 'channel_id'], ['enterprise_id', 'thread_ts', 'requester_id'], '$.tenant_context.slack');
    string(value.slack.event_id, '$.tenant_context.slack.event_id');
    string(value.slack.channel_id, '$.tenant_context.slack.channel_id');
    for (const field of ['enterprise_id', 'thread_ts', 'requester_id']) {
        if (value.slack[field] !== undefined) string(value.slack[field], `$.tenant_context.slack.${field}`);
    }
    for (const field of ['correlation_id', 'operation_id', 'idempotency_key', 'contract_revision']) string(value[field], `$.tenant_context.${field}`);
    revision(value.contract_revision, '$.tenant_context.contract_revision');
    requiredKeys(value.credential, ['mode', 'credential_ref', 'billing_principal_id'], [], '$.tenant_context.credential');
    for (const field of ['mode', 'credential_ref', 'billing_principal_id']) string(value.credential[field], `$.tenant_context.credential.${field}`);
    validateTimeWindow(value, value.issued_at);
    validateIntegrity(value.integrity, '$.tenant_context.integrity', 'tenant-context');
}

function validateIntegrity(value, path, kind = 'company-authority') {
    requiredKeys(value, ['method', 'algorithm', 'key_id', 'value'], [], path);
    if (value.method !== 'jws_detached' || value.algorithm !== 'EdDSA') {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', `${path} algorithm is invalid`, { path });
    }
    string(value.key_id, `${path}.key_id`);
    string(value.value, `${path}.value`);
    const parts = value.value.split('.');
    if (parts.length !== 3 || parts[1] !== '' || !BASE64URL.test(parts[0]) || !BASE64URL.test(parts[2])) {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', `${path}.value is not detached JWS`, { path, kind });
    }
}

function validateAuthority(value) {
    requiredKeys(value, [
        'decision', 'capability_id', 'responsible_person_id', 'accountable_person_id', 'approver_person_id',
        'delegated_by_person_id', 'policy_revision', 'raci_revision', 'resource_revision', 'allowed_effects', 'stop_conditions'
    ], [], '$.authority');
    enumValue(value.decision, DECISIONS, '$.authority.decision');
    string(value.capability_id, '$.authority.capability_id');
    for (const field of ['responsible_person_id', 'accountable_person_id', 'approver_person_id', 'delegated_by_person_id']) nullableString(value[field], `$.authority.${field}`);
    for (const field of ['policy_revision', 'raci_revision', 'resource_revision']) revision(value[field], `$.authority.${field}`);
    array(value.allowed_effects, '$.authority.allowed_effects', (entry, path) => enumValue(entry, EFFECTS, path), { min: 1, unique: true });
    array(value.stop_conditions, '$.authority.stop_conditions', string, { unique: true });
    if (value.decision === 'approval' && value.approver_person_id === null) fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'approval requires an approver');
    if (value.decision === 'human_action' && value.responsible_person_id === null) fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'human_action requires a responsible person');
}

export function validateObservedExecutionRequest(request) {
    requiredKeys(request, ['provider_identity', 'requested_action', 'correlation_id'], ['delivery'], '$');
    requiredKeys(request.provider_identity, ['provider', 'authenticated_subject_id'], ['app_id', 'workspace_id', 'enterprise_id'], '$.provider_identity');
    enumValue(request.provider_identity.provider, PROVIDERS, '$.provider_identity.provider');
    string(request.provider_identity.authenticated_subject_id, '$.provider_identity.authenticated_subject_id');
    for (const field of ['app_id', 'workspace_id', 'enterprise_id']) {
        if (request.provider_identity[field] !== undefined) string(request.provider_identity[field], `$.provider_identity.${field}`);
    }
    requiredKeys(request.requested_action, ['resource_ref'], ['capability_id', 'project_hint', 'desired_effect'], '$.requested_action');
    if (request.requested_action.capability_id === undefined || request.requested_action.capability_id === null || request.requested_action.capability_id === '') {
        fail('COMPANY_AUTHORITY_REQUIRED', 'requested capability is required');
    }
    string(request.requested_action.capability_id, '$.requested_action.capability_id');
    string(request.requested_action.resource_ref, '$.requested_action.resource_ref');
    if (request.requested_action.desired_effect === undefined || request.requested_action.desired_effect === null) {
        fail('DESIRED_EFFECT_REQUIRED', 'requested_action.desired_effect is required');
    }
    enumValue(request.requested_action.desired_effect, EFFECTS, '$.requested_action.desired_effect');
    if (request.requested_action.project_hint !== undefined) string(request.requested_action.project_hint, '$.requested_action.project_hint');
    if (request.delivery !== undefined) {
        requiredKeys(request.delivery, [], ['channel_id', 'thread_ts', 'event_id'], '$.delivery');
        for (const field of ['channel_id', 'thread_ts', 'event_id']) {
            if (request.delivery[field] !== undefined) string(request.delivery[field], `$.delivery.${field}`);
        }
    }
    string(request.correlation_id, '$.correlation_id');
    return request;
}

export function validateCanonicalExecutionContext(context, {
    expectedAudience = 'mana-runtime',
    now,
    request,
    expectedRevisions,
    identityStatus,
    crossOrg = false,
    scopeMismatch = false,
    membershipStatus,
    authorityUnavailable = false,
    approvalSubjectId,
    personalTargetPersonId,
    replayConflict = false
} = {}) {
    requiredKeys(context, ['schema_version', 'tenant_context', 'actor', 'scope', 'authority', 'evidence', 'issued_at', 'expires_at', 'integrity'], [], '$');
    if (context.schema_version !== SCHEMA_VERSION) fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'context schema_version is invalid');
    validateTenantContext(context.tenant_context);
    requiredKeys(context.actor, ['external_subject_id', 'canonical_person_id', 'membership_id', 'membership_revision'], [], '$.actor');
    for (const field of ['external_subject_id', 'canonical_person_id', 'membership_id']) string(context.actor[field], `$.actor.${field}`);
    revision(context.actor.membership_revision, '$.actor.membership_revision');
    requiredKeys(context.scope, ['organization_id', 'project_id', 'resource_ref', 'owner_person_id', 'placement_id'], [], '$.scope');
    for (const field of ['organization_id', 'project_id', 'resource_ref', 'placement_id']) string(context.scope[field], `$.scope.${field}`);
    nullableString(context.scope.owner_person_id, '$.scope.owner_person_id');
    validateAuthority(context.authority);
    requiredKeys(context.evidence, ['identity_resolution_receipt_id', 'authority_resolution_receipt_id'], [], '$.evidence');
    string(context.evidence.identity_resolution_receipt_id, '$.evidence.identity_resolution_receipt_id');
    string(context.evidence.authority_resolution_receipt_id, '$.evidence.authority_resolution_receipt_id');
    validateTimeWindow(context, now ?? context.issued_at);
    validateIntegrity(context.integrity, '$.integrity');

    if (!audienceContains(context.tenant_context.audience, expectedAudience)) {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'context audience is not accepted');
    }
    if (!context.tenant_context.authorization.capability_ids.includes(COMPANY_AUTHORITY_CAPABILITY)
        || context.authority.capability_id !== COMPANY_AUTHORITY_CAPABILITY) {
        fail('COMPANY_AUTHORITY_REQUIRED', 'company_authority_v1 is required at the fixed capability path');
    }
    if (request) {
        validateObservedExecutionRequest(request);
        if (request.correlation_id !== context.tenant_context.correlation_id) {
            fail('AUTHORITY_SCOPE_MISMATCH', 'correlation_id does not bind request and context');
        }
        if (request.requested_action.capability_id !== context.authority.capability_id) {
            fail('COMPANY_AUTHORITY_REQUIRED', 'requested capability does not match authority');
        }
        if (!context.authority.allowed_effects.includes(request.requested_action.desired_effect)) {
            fail('COMPANY_AUTHORITY_EFFECT_MISMATCH', 'requested effect is not allowed');
        }
        if (request.requested_action.resource_ref !== context.scope.resource_ref) {
            fail('AUTHORITY_SCOPE_MISMATCH', 'resource_ref does not bind request and context');
        }
    }
    if (identityStatus === 'unknown') fail('PERSON_UNKNOWN', 'external subject has no canonical person');
    if (identityStatus === 'ambiguous') fail('PERSON_AMBIGUOUS', 'external subject has multiple canonical persons');
    if (membershipStatus === 'inactive') fail('MEMBERSHIP_INACTIVE', 'membership is inactive');
    if (crossOrg) fail('AUTHORITY_CROSS_ORG', 'tenant and organization do not match');
    if (scopeMismatch) fail('AUTHORITY_SCOPE_MISMATCH', 'resource is outside signed scope');
    if (authorityUnavailable) fail('AUTHORITY_UNAVAILABLE', 'company authority is unavailable');
    if (expectedRevisions) {
        const actual = {
            membership: context.actor.membership_revision,
            resource: context.authority.resource_revision,
            raci: context.authority.raci_revision,
            policy: context.authority.policy_revision,
            tenant: context.tenant_context.tenant.tenant_revision,
            connection: context.tenant_context.workspace_connection.connection_revision
        };
        for (const [name, expected] of Object.entries(expectedRevisions)) {
            if (actual[name] !== expected) fail('AUTHORITY_CONTEXT_STALE', `${name} revision is stale`, { revision: name });
        }
    }
    if (context.authority.decision === 'approval' && approvalSubjectId !== undefined
        && approvalSubjectId !== context.authority.approver_person_id) {
        fail('APPROVER_MISMATCH', 'approval actor is not the designated approver');
    }
    if (personalTargetPersonId !== undefined) {
        if (context.scope.owner_person_id === null) fail('PERSONAL_OWNER_REQUIRED', 'Personal scope has no owner');
        if (personalTargetPersonId !== context.scope.owner_person_id) fail('PERSONAL_SCOPE_MISMATCH', 'Personal scope owner mismatch');
    }
    if (replayConflict) fail('AUTHORITY_REPLAY_CONFLICT', 'idempotency key is bound to a different context');
    return context;
}

export function canonicalJson(value) {
    const seen = new Set();
    function stringValue(input) {
        for (let index = 0; index < input.length; index += 1) {
            const code = input.charCodeAt(index);
            if (code >= 0xd800 && code <= 0xdbff) {
                const next = input.charCodeAt(index + 1);
                if (next >= 0xdc00 && next <= 0xdfff) {
                    index += 1;
                    continue;
                }
                throw new TypeError('RFC 8785 forbids lone UTF-16 surrogates');
            }
            if (code >= 0xdc00 && code <= 0xdfff) throw new TypeError('RFC 8785 forbids lone UTF-16 surrogates');
        }
        return JSON.stringify(input);
    }
    function serialize(input) {
        if (input === null) return 'null';
        if (typeof input === 'boolean') return input ? 'true' : 'false';
        if (typeof input === 'number') {
            if (!Number.isFinite(input)) throw new TypeError('RFC 8785 requires finite numbers');
            return JSON.stringify(input);
        }
        if (typeof input === 'string') {
            return stringValue(input);
        }
        if (!input || typeof input !== 'object') throw new TypeError(`RFC 8785 cannot encode ${typeof input}`);
        if (seen.has(input)) throw new TypeError('RFC 8785 cannot encode cyclic values');
        seen.add(input);
        const result = Array.isArray(input)
            ? `[${input.map((entry) => serialize(entry)).join(',')}]`
            : `{${Object.keys(input).sort().map((key) => `${stringValue(key)}:${serialize(input[key])}`).join(',')}}`;
        seen.delete(input);
        return result;
    }
    return serialize(value);
}

function unsignedContext(context) {
    const { integrity: _integrity, ...unsigned } = context;
    return unsigned;
}

function base64Url(value) {
    return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value) {
    if (typeof value !== 'string' || !BASE64URL.test(value) || Buffer.from(value, 'base64url').toString('base64url') !== value) {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'detached JWS is malformed');
    }
    return Buffer.from(value, 'base64url');
}

function protectedHeader(keyId) {
    return { alg: 'EdDSA', b64: false, crit: ['b64'], kid: keyId, typ: PROTECTED_TYP };
}

function signingInput(context, protected64) {
    return Buffer.concat([
        Buffer.from(`${protected64}.`, 'ascii'),
        Buffer.from(canonicalJson(unsignedContext(context)), 'utf8')
    ]);
}

export function createDetachedJws(context, privateJwk, keyId) {
    const protected64 = base64Url(canonicalJson(protectedHeader(keyId)));
    const signature = ed25519Sign(null, signingInput(context, protected64), createPrivateKey({ key: privateJwk, format: 'jwk' }));
    return `${protected64}..${base64Url(signature)}`;
}

export function verifyDetachedJws(context, publicJwk) {
    const value = context?.integrity?.value;
    const keyId = context?.integrity?.key_id;
    if (typeof value !== 'string' || typeof keyId !== 'string') fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'integrity is missing');
    const parts = value.split('.');
    if (parts.length !== 3 || parts[1] !== '') fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'detached JWS shape is invalid');
    const protectedBytes = decodeBase64Url(parts[0]);
    let header;
    try {
        header = JSON.parse(protectedBytes.toString('utf8'));
    } catch {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'protected header is invalid');
    }
    if (canonicalJson(header) !== protectedBytes.toString('utf8') || canonicalJson(header) !== canonicalJson(protectedHeader(keyId))) {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'protected header is not canonical');
    }
    const signature = decodeBase64Url(parts[2]);
    if (signature.length !== 64 || !ed25519Verify(null, signingInput(context, parts[0]), createPublicKey({ key: publicJwk, format: 'jwk' }), signature)) {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'Ed25519 signature verification failed');
    }
    return true;
}

export function applyFixtureMutations(value, mutations = []) {
    const result = structuredClone(value);
    for (const mutation of mutations) {
        const parts = mutation.path.split('/').filter(Boolean);
        const key = parts.pop();
        const parent = parts.reduce((current, part) => current[part], result);
        if (mutation.operation === 'delete') delete parent[key];
        else if (mutation.operation === 'set') parent[key] = mutation.value;
        else if (mutation.operation === 'append') parent[key] = `${parent[key]}${mutation.value}`;
        else if (mutation.operation === 'remove_capability') parent[key] = parent[key].filter((entry) => entry !== COMPANY_AUTHORITY_CAPABILITY);
        else throw new Error(`unknown fixture mutation: ${mutation.operation}`);
    }
    return result;
}

export function validateWireResponse(response) {
    requiredKeys(response, ['schema_version', 'contract_id', 'correlation_id', 'context', 'error'], [], '$');
    if (response.schema_version !== SCHEMA_VERSION || response.contract_id !== CONTRACT_ID) {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'wire response identity is invalid');
    }
    string(response.correlation_id, '$.correlation_id');
    const hasContext = response.context !== null;
    const hasError = response.error !== null;
    if (hasContext === hasError) {
        fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'wire response must contain exactly one context or error');
    }
    if (hasContext) {
        validateCanonicalExecutionContext(response.context);
        if (response.context.tenant_context.correlation_id !== response.correlation_id) {
            fail('AUTHORITY_SCOPE_MISMATCH', 'wire response correlation_id does not bind context');
        }
    }
    if (hasError) {
        requiredKeys(response.error, ['code', 'phase', 'retryable', 'business_effect'], [], '$.error');
        if (!CANONICAL_ERROR_CODES.includes(response.error.code)) fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'unknown canonical error code');
        if (response.error.phase !== 'authority') fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'error phase is invalid');
        if (response.error.retryable !== true && response.error.retryable !== false) fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'retryable must be boolean');
        if (response.error.business_effect !== false) fail('AUTHORITY_CONTEXT_INVALID_SIGNATURE', 'error cannot claim business effect');
    }
    return response;
}
