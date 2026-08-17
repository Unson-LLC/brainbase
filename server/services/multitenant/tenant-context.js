import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { canonicalJson, deepFreeze } from './canonical-json.js';
import { ContractError } from './errors.js';

export const MAX_ENVELOPE_TTL_SECONDS = 300;
export const MAX_CLOCK_SKEW_SECONDS = 30;
export const PROTECTED_TYP = 'application/mana-brainbase-tenant-context+jws';

const REVISION_PATTERN = /^(0|[1-9][0-9]*)$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const REQUIRED_TOP_LEVEL = [
    'schema_version', 'protocol_id', 'protocol_version', 'issuer', 'audience', 'tenant',
    'workspace_connection', 'actor', 'authorization', 'placement', 'slack', 'correlation_id',
    'operation_id', 'idempotency_key', 'contract_revision', 'credential', 'issued_at', 'expires_at'
];

const REQUIRED_OBJECT_FIELDS = Object.freeze({
    tenant: ['tenant_id', 'tenant_revision'],
    workspace_connection: ['connection_id', 'connection_revision', 'status', 'provider', 'installation_id', 'workspace_id', 'app_id'],
    actor: ['principal_id', 'principal_type', 'authenticated_subject_id'],
    authorization: ['organization_ids', 'project_ids', 'data_scopes', 'capability_ids'],
    placement: ['deployment_id', 'profile'],
    slack: ['event_id', 'channel_id', 'thread_ts', 'requester_id'],
    credential: ['mode', 'credential_ref', 'billing_principal_id']
});

const ARRAY_FIELDS = Object.freeze({
    authorization: new Set(['organization_ids', 'project_ids', 'data_scopes', 'capability_ids'])
});

function publicOrPrivateKey(key, type) {
    if (typeof key === 'string' || Buffer.isBuffer(key) || key?.type) return key;
    return type === 'private'
        ? createPrivateKey({ key, format: 'jwk' })
        : createPublicKey({ key, format: 'jwk' });
}

function unsignedEnvelope(envelope) {
    const { integrity: _integrity, ...unsigned } = envelope;
    return unsigned;
}

function signingInput(unsigned, protected64) {
    return Buffer.concat([
        Buffer.from(`${protected64}.`, 'ascii'),
        Buffer.from(canonicalJson(unsigned), 'utf8')
    ]);
}

function protectedHeader(keyId) {
    return { alg: 'EdDSA', b64: false, crit: ['b64'], kid: keyId, typ: PROTECTED_TYP };
}

function fail(code, options = {}) {
    throw new ContractError(code, { status: 400, fault_domain: 'protocol', ...options });
}

function lengthPrefix(value) {
    const bytes = Buffer.from(String(value), 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
}

function expectedIdempotencyKey(envelope) {
    const values = [
        envelope.protocol_id,
        envelope.protocol_version.split('.')[0],
        envelope.tenant.tenant_id,
        envelope.workspace_connection.connection_id,
        envelope.slack.event_id,
        envelope.operation_id
    ];
    const digest = createHash('sha256').update(Buffer.concat(values.map(lengthPrefix))).digest('base64url');
    return `ik1_${digest}`;
}

export function assertCanonicalRevision(value, field = 'revision') {
    if (typeof value !== 'string' || !REVISION_PATTERN.test(value)) {
        fail('REVISION_INVALID', { details: { field } });
    }
}

function timestampMs(value, field) {
    if (typeof value !== 'string' || !value.endsWith('Z')) fail('TIME_INVALID', { details: { field } });
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) fail('TIME_INVALID', { details: { field } });
    return parsed;
}

export function validateTimeWindow(value, {
    now,
    max_ttl_seconds = MAX_ENVELOPE_TTL_SECONDS,
    max_clock_skew_seconds = MAX_CLOCK_SKEW_SECONDS
} = {}) {
    const issuedAt = timestampMs(value.issued_at, 'issued_at');
    const expiresAt = timestampMs(value.expires_at, 'expires_at');
    const nowMs = now instanceof Date ? now.getTime() : timestampMs(now ?? value.issued_at, 'now');
    if (expiresAt <= issuedAt) fail('TIME_ORDER_INVALID');
    if (expiresAt - issuedAt > max_ttl_seconds * 1000) fail('TTL_EXCEEDED');
    if (issuedAt > nowMs + max_clock_skew_seconds * 1000) fail('NOT_YET_VALID');
    if (expiresAt < nowMs - max_clock_skew_seconds * 1000) fail('EXPIRED', { status: 403 });
    return true;
}

function decodeBase64Url(value) {
    if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value) || value.includes('=')) {
        fail('JWS_MALFORMED');
    }
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) fail('JWS_MALFORMED');
    return decoded;
}

function assertExactProtectedHeader(header) {
    if (!header || typeof header !== 'object' || Array.isArray(header)) fail('SCHEMA_INVALID');
    const keys = Object.keys(header).sort();
    const expected = ['alg', 'b64', 'crit', 'kid', 'typ'].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        fail('SCHEMA_INVALID');
    }
}

function assertEnvelopeShape(envelope) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        fail('SCHEMA_INVALID');
    }
    for (const field of REQUIRED_TOP_LEVEL) {
        if (envelope[field] === undefined) fail('SCHEMA_INVALID', { details: { field } });
    }
    if (envelope.schema_version !== '1.0' || envelope.protocol_id !== 'mana-brainbase-tenant-context'
        || envelope.protocol_version !== '1.0' || envelope.issuer !== 'brainbase') {
        fail('SCHEMA_INVALID');
    }
    if (!Array.isArray(envelope.audience) || envelope.audience.length === 0
        || envelope.audience.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
        fail('SCHEMA_INVALID', { details: { field: 'audience' } });
    }
    for (const [objectField, fields] of Object.entries(REQUIRED_OBJECT_FIELDS)) {
        const value = envelope[objectField];
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            fail('SCHEMA_INVALID', { details: { field: objectField } });
        }
        for (const field of fields) {
            const candidate = value[field];
            const expectsArray = ARRAY_FIELDS[objectField]?.has(field);
            const invalid = expectsArray
                ? !Array.isArray(candidate) || candidate.some((entry) => typeof entry !== 'string')
                : candidate === undefined || candidate === null || candidate === '';
            if (invalid) {
                fail('SCHEMA_INVALID', { details: { field: `${objectField}.${field}` } });
            }
        }
    }
    assertCanonicalRevision(envelope.tenant.tenant_revision, 'tenant.tenant_revision');
    assertCanonicalRevision(envelope.workspace_connection.connection_revision, 'workspace_connection.connection_revision');
    assertCanonicalRevision(envelope.contract_revision, 'contract_revision');
    if (envelope.idempotency_key !== expectedIdempotencyKey(envelope)) fail('IDEMPOTENCY_KEY_INVALID');
}

export function createSignedTenantContext(envelope, { key_id, private_key }) {
    assertEnvelopeShape(envelope);
    validateTimeWindow(envelope, { now: new Date(envelope.issued_at) });
    const unsigned = unsignedEnvelope(envelope);
    const protected64 = Buffer.from(canonicalJson(protectedHeader(key_id))).toString('base64url');
    const signature64 = sign(null, signingInput(unsigned, protected64), publicOrPrivateKey(private_key, 'private')).toString('base64url');
    return deepFreeze({
        ...unsigned,
        integrity: {
            method: 'jws_detached',
            algorithm: 'EdDSA',
            key_id,
            value: `${protected64}..${signature64}`
        }
    });
}

export function verifyTenantContext(envelope, {
    keys, audience, deployment_id, now = new Date(), max_ttl_seconds = MAX_ENVELOPE_TTL_SECONDS,
    max_clock_skew_seconds = MAX_CLOCK_SKEW_SECONDS
}) {
    assertEnvelopeShape(envelope);
    validateTimeWindow(envelope, { now, max_ttl_seconds, max_clock_skew_seconds });
    const integrity = envelope.integrity;
    if (!integrity || integrity.method !== 'jws_detached' || integrity.algorithm !== 'EdDSA') {
        fail('JWS_PROTECTED_HEADER_INVALID', { status: 403 });
    }
    const key = keys.find((candidate) => candidate.key_id === integrity.key_id && ['current', 'retiring'].includes(candidate.status));
    if (!key) throw new ContractError('TENANT_CONTEXT_SIGNATURE_INVALID', { status: 403, fault_domain: 'protocol' });
    const parts = typeof integrity.value === 'string' ? integrity.value.split('.') : [];
    if (parts.length !== 3 || parts[1] !== '' || !parts[0] || !parts[2]) fail('JWS_MALFORMED', { status: 403 });
    let protectedHeader;
    try {
        protectedHeader = JSON.parse(decodeBase64Url(parts[0]).toString('utf8'));
    } catch {
        fail('JWS_MALFORMED', { status: 403 });
    }
    assertExactProtectedHeader(protectedHeader);
    if (protectedHeader.alg !== 'EdDSA' || protectedHeader.b64 !== false
        || !Array.isArray(protectedHeader.crit) || protectedHeader.crit.length !== 1
        || protectedHeader.crit[0] !== 'b64' || protectedHeader.kid !== integrity.key_id
        || protectedHeader.typ !== PROTECTED_TYP
        || decodeBase64Url(parts[0]).toString('utf8') !== canonicalJson(protectedHeader)) {
        fail('JWS_PROTECTED_HEADER_INVALID', { status: 403 });
    }
    const unsigned = unsignedEnvelope(envelope);
    const signature = decodeBase64Url(parts[2]);
    if (signature.length !== 64) fail('JWS_MALFORMED', { status: 403 });
    const verified = verify(null, signingInput(unsigned, parts[0]), publicOrPrivateKey(key.public_key, 'public'), signature);
    if (!verified) throw new ContractError('TENANT_CONTEXT_SIGNATURE_INVALID', { status: 403, fault_domain: 'protocol' });
    const nowMs = now.getTime();
    const keyNotBefore = key.not_before == null ? null : Date.parse(key.not_before);
    const keyExpiresAt = key.expires_at == null ? null : Date.parse(key.expires_at);
    if ((keyNotBefore !== null && (!Number.isFinite(keyNotBefore) || nowMs + max_clock_skew_seconds * 1000 < keyNotBefore))
        || (keyExpiresAt !== null && (!Number.isFinite(keyExpiresAt) || nowMs - max_clock_skew_seconds * 1000 > keyExpiresAt))) {
        throw new ContractError('TENANT_CONTEXT_SIGNATURE_INVALID', { status: 403, fault_domain: 'protocol' });
    }
    if (!envelope.audience.some((candidate) => candidate === audience)) {
        throw new ContractError('ACTOR_SCOPE_MISMATCH', { status: 403 });
    }
    if (envelope.placement.deployment_id !== deployment_id) {
        throw new ContractError('FALLBACK_FORBIDDEN', { status: 403, fault_domain: 'protocol' });
    }
    return deepFreeze(structuredClone(envelope));
}

export function serializeVerificationKeys(keys) {
    return {
        keys: keys
            .filter((key) => ['current', 'retiring'].includes(key.status))
            .map((key) => deepFreeze({
                key_id: key.key_id,
                algorithm: 'EdDSA',
                public_key_format: 'jwk',
                public_key: key.public_key?.export ? key.public_key.export({ format: 'jwk' }) : key.public_key,
                status: key.status,
                not_before: key.not_before ?? null,
                expires_at: key.expires_at ?? null
            }))
    };
}
