import { randomBytes } from 'node:crypto';
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
        now = () => new Date(), leaseId = defaultLeaseId, leaseToken = defaultLeaseToken, repository = null
    } = {}) {
        this.now = now;
        this.leaseId = leaseId;
        this.leaseToken = leaseToken;
        this.repository = repository;
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
        return materialize(lease.binding.credential_ref);
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
