import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { canonicalJson, deepFreeze } from './canonical-json.js';
import { ContractError } from './errors.js';

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
    const payload64 = Buffer.from(canonicalJson(unsigned)).toString('base64url');
    return Buffer.from(`${protected64}.${payload64}`);
}

function assertEnvelopeShape(envelope) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        throw new ContractError('TENANT_CONTEXT_INVALID', { status: 400 });
    }
    for (const field of REQUIRED_TOP_LEVEL) {
        if (envelope[field] === undefined) throw new ContractError('TENANT_CONTEXT_INVALID', { status: 400, details: { field } });
    }
    if (envelope.schema_version !== '1.0' || envelope.protocol_id !== 'mana-brainbase-tenant-context'
        || envelope.protocol_version !== '1.0' || envelope.issuer !== 'brainbase') {
        throw new ContractError('PROTOCOL_VERSION_UNSUPPORTED', { status: 400, fault_domain: 'protocol' });
    }
    if (!Array.isArray(envelope.audience) || envelope.audience.length === 0
        || envelope.audience.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
        throw new ContractError('TENANT_CONTEXT_INVALID', { status: 400, details: { field: 'audience' } });
    }
    for (const [objectField, fields] of Object.entries(REQUIRED_OBJECT_FIELDS)) {
        const value = envelope[objectField];
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new ContractError('TENANT_CONTEXT_INVALID', { status: 400, details: { field: objectField } });
        }
        for (const field of fields) {
            const candidate = value[field];
            const expectsArray = ARRAY_FIELDS[objectField]?.has(field);
            const invalid = expectsArray
                ? !Array.isArray(candidate) || candidate.some((entry) => typeof entry !== 'string')
                : candidate === undefined || candidate === null || candidate === '';
            if (invalid) {
                throw new ContractError('TENANT_CONTEXT_INVALID', { status: 400, details: { field: `${objectField}.${field}` } });
            }
        }
    }
}

export function createSignedTenantContext(envelope, { key_id, private_key }) {
    assertEnvelopeShape(envelope);
    const unsigned = unsignedEnvelope(envelope);
    const protected64 = Buffer.from(canonicalJson({ alg: 'EdDSA', kid: key_id })).toString('base64url');
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
    keys, audience, deployment_id, now = new Date(), max_ttl_seconds = 300, max_clock_skew_seconds = 30
}) {
    assertEnvelopeShape(envelope);
    const integrity = envelope.integrity;
    if (!integrity || integrity.method !== 'jws_detached' || integrity.algorithm !== 'EdDSA') {
        throw new ContractError('TENANT_CONTEXT_SIGNATURE_INVALID', { status: 403, fault_domain: 'protocol' });
    }
    const key = keys.find((candidate) => candidate.key_id === integrity.key_id && ['current', 'retiring'].includes(candidate.status));
    if (!key) throw new ContractError('TENANT_CONTEXT_SIGNATURE_INVALID', { status: 403, fault_domain: 'protocol' });
    const parts = integrity.value.split('.');
    if (parts.length !== 3 || parts[1] !== '') {
        throw new ContractError('TENANT_CONTEXT_SIGNATURE_INVALID', { status: 403, fault_domain: 'protocol' });
    }
    let protectedHeader;
    try {
        protectedHeader = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch {
        throw new ContractError('TENANT_CONTEXT_SIGNATURE_INVALID', { status: 403, fault_domain: 'protocol' });
    }
    if (protectedHeader?.alg !== 'EdDSA' || protectedHeader?.kid !== integrity.key_id
        || Object.keys(protectedHeader).some((field) => !['alg', 'kid'].includes(field))) {
        throw new ContractError('TENANT_CONTEXT_SIGNATURE_INVALID', { status: 403, fault_domain: 'protocol' });
    }
    const unsigned = unsignedEnvelope(envelope);
    const verified = verify(null, signingInput(unsigned, parts[0]), publicOrPrivateKey(key.public_key, 'public'), Buffer.from(parts[2], 'base64url'));
    if (!verified) throw new ContractError('TENANT_CONTEXT_SIGNATURE_INVALID', { status: 403, fault_domain: 'protocol' });
    const issuedAt = Date.parse(envelope.issued_at);
    const expiresAt = Date.parse(envelope.expires_at);
    const nowMs = now.getTime();
    const keyNotBefore = key.not_before == null ? null : Date.parse(key.not_before);
    const keyExpiresAt = key.expires_at == null ? null : Date.parse(key.expires_at);
    if ((keyNotBefore !== null && (!Number.isFinite(keyNotBefore) || nowMs + max_clock_skew_seconds * 1000 < keyNotBefore))
        || (keyExpiresAt !== null && (!Number.isFinite(keyExpiresAt) || nowMs - max_clock_skew_seconds * 1000 > keyExpiresAt))) {
        throw new ContractError('TENANT_CONTEXT_SIGNATURE_INVALID', { status: 403, fault_domain: 'protocol' });
    }
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
        || expiresAt - issuedAt > max_ttl_seconds * 1000
        || issuedAt - nowMs > max_clock_skew_seconds * 1000
        || nowMs - expiresAt > max_clock_skew_seconds * 1000) {
        throw new ContractError('TENANT_CONTEXT_EXPIRED', { status: 403, fault_domain: 'protocol' });
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
