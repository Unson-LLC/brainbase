import { createHash, randomBytes } from 'node:crypto';
import { canonicalJson, deepFreeze } from './canonical-json.js';
import { validateCanonicalWire } from './canonical-wire-validator.js';
import { ContractError } from './errors.js';
import { generateCanonicalId } from './ids.js';
import { assertCanonicalRevision, validateTimeWindow } from './tenant-context.js';

const MAX_LEASE_TTL_SECONDS = 60;
const REQUIRED_CREDENTIAL_FIELDS = [
    'tenant_id', 'connection_id', 'connection_revision', 'credential_ref', 'credential_mode'
];
const REQUIRED_LEASE_BINDING_FIELDS = [
    ...REQUIRED_CREDENTIAL_FIELDS, 'contract_revision', 'operation_id', 'audience'
];

function fail(code, options = {}) {
    throw new ContractError(code, { status: 400, fault_domain: 'protocol', ...options });
}

function assertFields(input, fields, code) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(code);
    for (const field of fields) {
        if (input[field] === undefined || input[field] === null || input[field] === '') {
            fail(code, { details: { field } });
        }
    }
}

function assertCredentialBinding(input) {
    assertFields(input, REQUIRED_CREDENTIAL_FIELDS, 'CREDENTIAL_BINDING_INVALID');
    assertCanonicalRevision(input.connection_revision, 'connection_revision');
}

function assertLeaseRequest(request) {
    if (request?.message_type !== 'credential_lease_request' || request.protocol_version !== '1.0') {
        fail('CREDENTIAL_LEASE_INVALID');
    }
    assertFields(request.binding, REQUIRED_LEASE_BINDING_FIELDS, 'CREDENTIAL_LEASE_INVALID');
    assertCanonicalRevision(request.binding.connection_revision, 'binding.connection_revision');
    assertCanonicalRevision(request.binding.contract_revision, 'binding.contract_revision');
    if (!Number.isInteger(request.requested_ttl_seconds)
        || request.requested_ttl_seconds < 1
        || request.requested_ttl_seconds > MAX_LEASE_TTL_SECONDS) {
        fail('CREDENTIAL_LEASE_TTL_INVALID');
    }
    validateCanonicalWire('CredentialLeaseRequest', request);
}

function defaultLeaseId() {
    return generateCanonicalId('lease');
}

function defaultLeaseToken() {
    return randomBytes(32).toString('base64url');
}

function wireTimestamp(value) {
    return value.toISOString().replace('.000Z', 'Z');
}

function leaseTokenDigest(value) {
    return `sha256:${createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

function credentialEncodings(credential) {
    if (!Buffer.isBuffer(credential) || credential.length === 0) return [];
    return [...new Set([
        credential.toString('utf8'),
        credential.toString('base64'),
        credential.toString('base64url'),
        credential.toString('hex')
    ].filter((candidate) => candidate.length >= 8))];
}

function containsCredentialMaterial(value, encodings = []) {
    if (typeof value === 'string') return encodings.some((candidate) => value.includes(candidate));
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some((child) => containsCredentialMaterial(child, encodings));
    return Object.entries(value).some(([key, child]) => (
        /^(authorization|credential|credential_value|secret|token|api_key)$/i.test(key)
        || containsCredentialMaterial(child, encodings)
    ));
}

export function validateCredentialLease(request, response, { now = new Date() } = {}) {
    assertLeaseRequest(request);
    if (!response || response.message_type !== 'credential_lease_response'
        || response.protocol_version !== '1.0' || !response.lease_id
        || !response.contract_revision || response.max_uses !== 1 || !response.lease_token
        || !response.binding) {
        fail('CREDENTIAL_LEASE_INVALID');
    }
    assertCanonicalRevision(response.contract_revision, 'response.contract_revision');
    if (canonicalJson(request.binding) !== canonicalJson(response.binding)
        || response.contract_revision !== request.binding.contract_revision) {
        fail('CREDENTIAL_LEASE_BINDING_MISMATCH');
    }
    validateTimeWindow(response, { now, max_ttl_seconds: MAX_LEASE_TTL_SECONDS });
    const ttlSeconds = (Date.parse(response.expires_at) - Date.parse(response.issued_at)) / 1000;
    if (ttlSeconds > request.requested_ttl_seconds) fail('CREDENTIAL_LEASE_TTL_INVALID');
    validateCanonicalWire('CredentialLeaseResponse', response);
    return true;
}

export class CredentialBroker {
    #credentials = new Map();
    #leases = new Map();
    #currentByConnection = new Map();

    constructor({
        now = () => new Date(),
        leaseId = defaultLeaseId,
        leaseToken = defaultLeaseToken,
        repository = null,
        credentialMaterializer = null,
        providerForwarders = {}
    } = {}) {
        this.now = now;
        this.leaseId = leaseId;
        this.leaseToken = leaseToken;
        this.repository = repository;
        this.credentialMaterializer = credentialMaterializer;
        this.providerForwarders = Object.freeze({ ...providerForwarders });
        this.auditEvents = [];
    }

    register(input) {
        assertCredentialBinding(input);
        const record = Object.freeze({
            tenant_id: input.tenant_id,
            connection_id: input.connection_id,
            connection_revision: input.connection_revision,
            credential_ref: input.credential_ref,
            credential_mode: input.credential_mode,
            provider: input.provider ?? null,
            refresh_revision: String(input.refresh_revision ?? '0')
        });
        assertCanonicalRevision(record.refresh_revision, 'refresh_revision');
        this.#credentials.set(record.credential_ref, record);
        this.#currentByConnection.set(`${record.tenant_id}:${record.connection_id}`, record);
        return record;
    }

    issueLease(request) {
        assertLeaseRequest(request);
        const { binding } = request;
        const credential = this.#credentials.get(binding.credential_ref);
        if (!credential) throw new ContractError('CREDENTIAL_REF_UNKNOWN', { status: 403 });
        for (const field of REQUIRED_CREDENTIAL_FIELDS) {
            if (credential[field] !== binding[field]) {
                throw new ContractError('CROSS_TENANT_CANDIDATE', { status: 403 });
            }
        }
        const issuedAt = this.now();
        const response = {
            message_type: 'credential_lease_response',
            protocol_version: '1.0',
            lease_id: this.leaseId(),
            contract_revision: binding.contract_revision,
            binding: structuredClone(binding),
            issued_at: wireTimestamp(issuedAt),
            expires_at: wireTimestamp(new Date(issuedAt.getTime() + request.requested_ttl_seconds * 1000)),
            max_uses: 1,
            lease_token: this.leaseToken()
        };
        validateCredentialLease(request, response, { now: issuedAt });
        if (typeof this.repository?.issueCredentialLease === 'function') {
            const credentialRecord = this.#credentials.get(binding.credential_ref);
            return Promise.resolve(this.repository.issueCredentialLease({
                ...structuredClone(binding),
                provider: credentialRecord?.provider ?? null,
                lease_id: response.lease_id,
                lease_token_digest: leaseTokenDigest(response.lease_token),
                issued_at: response.issued_at,
                expires_at: response.expires_at,
                max_uses: response.max_uses
            })).then(() => deepFreeze(response));
        }
        this.#leases.set(response.lease_id, { ...structuredClone(response), used: false });
        return deepFreeze(response);
    }

    consumeLease({ lease_id, lease_token, operation_id, audience, materialize = () => undefined }) {
        const lease = this.#leases.get(lease_id);
        if (!lease || lease.lease_token !== lease_token) {
            throw new ContractError('CREDENTIAL_LEASE_UNKNOWN', { status: 403 });
        }
        if (lease.used) throw new ContractError('CREDENTIAL_LEASE_ALREADY_USED', { status: 409 });
        if (this.now().getTime() > Date.parse(lease.expires_at)) {
            throw new ContractError('CREDENTIAL_LEASE_EXPIRED', { status: 403 });
        }
        if (lease.binding.operation_id !== operation_id || lease.binding.audience !== audience) {
            throw new ContractError('CREDENTIAL_LEASE_SCOPE_MISMATCH', { status: 403 });
        }
        const current = this.#currentByConnection.get(`${lease.binding.tenant_id}:${lease.binding.connection_id}`);
        if (!current || REQUIRED_CREDENTIAL_FIELDS.some((field) => current[field] !== lease.binding[field])) {
            throw new ContractError('CREDENTIAL_BINDING_STALE', { status: 409 });
        }
        lease.used = true;
        return materialize(lease.binding.credential_ref, structuredClone(lease.binding));
    }

    async forwardProviderRequest(input) {
        assertFields(input, [
            ...REQUIRED_LEASE_BINDING_FIELDS,
            'lease_id', 'lease_token', 'provider_operation'
        ], 'CREDENTIAL_LEASE_INVALID');
        if (!input.request || typeof input.request !== 'object' || Array.isArray(input.request)) {
            fail('CREDENTIAL_LEASE_INVALID');
        }
        const expectedBinding = Object.fromEntries(
            REQUIRED_LEASE_BINDING_FIELDS.map((field) => [field, input[field]])
        );
        let binding;
        if (typeof this.repository?.consumeCredentialLease === 'function') {
            binding = await this.repository.consumeCredentialLease({
                ...expectedBinding,
                lease_id: input.lease_id,
                lease_token_digest: leaseTokenDigest(input.lease_token),
                consumed_at: wireTimestamp(this.now())
            });
        } else {
            binding = this.consumeLease({
                lease_id: input.lease_id,
                lease_token: input.lease_token,
                operation_id: input.operation_id,
                audience: input.audience,
                materialize: (_credentialRef, leaseBinding) => leaseBinding
            });
            if (REQUIRED_LEASE_BINDING_FIELDS.some((field) => binding[field] !== expectedBinding[field])) {
                throw new ContractError('CREDENTIAL_LEASE_SCOPE_MISMATCH', { status: 403 });
            }
            binding = {
                ...binding,
                provider: this.#credentials.get(binding.credential_ref)?.provider ?? null
            };
        }
        const forwarder = this.providerForwarders[binding.audience];
        if (!forwarder || typeof forwarder.forward !== 'function') {
            console.error(JSON.stringify({
                event: 'credential_lease_scope_mismatch',
                scope_reason: 'provider_forwarder_unavailable',
                audience: binding.audience,
                binding_provider: binding.provider ?? null,
                forwarder_provider: forwarder?.provider ?? null,
                provider_operation: input.provider_operation
            }));
            throw new ContractError('CREDENTIAL_LEASE_SCOPE_MISMATCH', {
                status: 403,
                details: { scope_reason: 'provider_forwarder_unavailable' }
            });
        }
        const requiresCredential = forwarder.requiresCredential?.(input.provider_operation) !== false;
        const allowsBindingProviderMismatch = !requiresCredential
            && forwarder.allowsBindingProviderMismatch?.(input.provider_operation) === true;
        if (binding.provider && forwarder.provider !== binding.provider && !allowsBindingProviderMismatch) {
            console.error(JSON.stringify({
                event: 'credential_lease_scope_mismatch',
                scope_reason: 'provider_forwarder_mismatch',
                audience: binding.audience,
                binding_provider: binding.provider,
                forwarder_provider: forwarder.provider ?? null,
                provider_operation: input.provider_operation
            }));
            throw new ContractError('CREDENTIAL_LEASE_SCOPE_MISMATCH', {
                status: 403,
                details: { scope_reason: 'provider_forwarder_mismatch' }
            });
        }
        const materialize = typeof this.credentialMaterializer === 'function'
            ? this.credentialMaterializer
            : this.credentialMaterializer?.materialize?.bind(this.credentialMaterializer);
        if (requiresCredential && typeof materialize !== 'function') {
            throw new ContractError('UPSTREAM_UNAVAILABLE', {
                status: 503,
                retryable: true,
                fault_domain: 'brainbase_cloud'
            });
        }
        let credential;
        try {
            if (requiresCredential) {
                const materialized = await materialize(binding.credential_ref, {
                    tenant_id: binding.tenant_id,
                    connection_id: binding.connection_id,
                    connection_revision: binding.connection_revision,
                    credential_mode: binding.credential_mode,
                    provider: forwarder.provider
                });
                if (materialized === undefined || materialized === null) {
                    throw new ContractError('CREDENTIAL_REF_UNKNOWN', { status: 403 });
                }
                credential = Buffer.isBuffer(materialized) ? materialized : Buffer.from(String(materialized), 'utf8');
            } else {
                credential = Buffer.alloc(0);
            }
            const providerResult = await forwarder.forward({
                credential,
                operation: input.provider_operation,
                request: structuredClone(input.request),
                binding: deepFreeze(structuredClone(expectedBinding))
            });
            if (!providerResult || !Number.isInteger(providerResult.status)
                || providerResult.status < 100 || providerResult.status > 599
                || containsCredentialMaterial(providerResult.body, credentialEncodings(credential))) {
                throw new ContractError('UPSTREAM_INVALID_RESPONSE', {
                    status: 502,
                    retryable: false,
                    fault_domain: 'external_provider'
                });
            }
            return deepFreeze({
                provider: forwarder.provider,
                operation_id: input.operation_id,
                provider_operation: input.provider_operation,
                status: providerResult.status,
                response_encoding: providerResult.response_encoding,
                content_type: providerResult.content_type ?? null,
                body: structuredClone(providerResult.body ?? null)
            });
        } finally {
            credential?.fill(0);
        }
    }

    compareAndSwapRefresh(input) {
        if (this.repository) return this.repository.compareAndSwapRefresh(input);
        const { credential_ref, expected_refresh_revision, new_credential_ref } = input;
        const current = this.#credentials.get(credential_ref);
        const expected = String(expected_refresh_revision);
        if (!current || current.refresh_revision !== expected || !new_credential_ref) {
            this.auditEvents.push(Object.freeze({
                event_type: 'oauth_refresh.conflict.v1',
                credential_ref,
                expected_refresh_revision: expected,
                observed_refresh_revision: current?.refresh_revision ?? null,
                occurred_at: this.now().toISOString()
            }));
            throw new ContractError('OAUTH_REFRESH_CONFLICT', { status: 409 });
        }
        const updated = Object.freeze({
            ...current,
            credential_ref: new_credential_ref,
            refresh_revision: String(Number(current.refresh_revision) + 1)
        });
        this.#credentials.delete(credential_ref);
        this.#credentials.set(new_credential_ref, updated);
        this.#currentByConnection.set(`${updated.tenant_id}:${updated.connection_id}`, updated);
        this.auditEvents.push(Object.freeze({
            event_type: 'oauth_refresh.updated.v1',
            previous_credential_ref: credential_ref,
            credential_ref: new_credential_ref,
            refresh_revision: updated.refresh_revision,
            occurred_at: this.now().toISOString()
        }));
        return updated;
    }
}
