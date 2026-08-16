import { randomBytes } from 'node:crypto';
import { ContractError } from './errors.js';

const REQUIRED_BINDING_FIELDS = [
    'tenant_id', 'connection_id', 'connection_revision', 'credential_ref', 'credential_mode'
];

function assertBinding(input) {
    for (const field of REQUIRED_BINDING_FIELDS) {
        if (input[field] === undefined || input[field] === null || input[field] === '') {
            throw new ContractError('CREDENTIAL_BINDING_INVALID', { status: 400 });
        }
    }
}

function leaseRef() {
    return `lease_${randomBytes(24).toString('base64url')}`;
}

export class CredentialBroker {
    #credentials = new Map();
    #leases = new Map();
    #currentByConnection = new Map();

    constructor({ now = () => new Date() } = {}) {
        this.now = now;
        this.auditEvents = [];
    }

    register(input) {
        assertBinding(input);
        const record = Object.freeze({
            tenant_id: input.tenant_id,
            connection_id: input.connection_id,
            connection_revision: input.connection_revision,
            credential_ref: input.credential_ref,
            credential_mode: input.credential_mode,
            refresh_revision: input.refresh_revision ?? 1
        });
        this.#credentials.set(record.credential_ref, record);
        this.#currentByConnection.set(`${record.tenant_id}:${record.connection_id}`, record);
        return record;
    }

    issueLease(input) {
        assertBinding(input);
        const ttlSeconds = input.ttl_seconds ?? 60;
        if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 60 || !input.operation_id || !input.audience) {
            throw new ContractError('CREDENTIAL_LEASE_INVALID', { status: 400 });
        }
        const credential = this.#credentials.get(input.credential_ref);
        if (!credential) throw new ContractError('CREDENTIAL_REF_UNKNOWN', { status: 403 });
        for (const field of REQUIRED_BINDING_FIELDS) {
            if (credential[field] !== input[field]) {
                throw new ContractError('CROSS_TENANT_CANDIDATE', { status: 403 });
            }
        }
        const issuedAt = this.now();
        const lease = {
            lease_ref: leaseRef(),
            tenant_id: input.tenant_id,
            connection_id: input.connection_id,
            connection_revision: input.connection_revision,
            credential_ref: input.credential_ref,
            credential_mode: input.credential_mode,
            operation_id: input.operation_id,
            audience: input.audience,
            issued_at: issuedAt.toISOString(),
            expires_at: new Date(issuedAt.getTime() + ttlSeconds * 1000).toISOString(),
            used: false
        };
        this.#leases.set(lease.lease_ref, lease);
        const { used: _used, ...publicLease } = lease;
        return Object.freeze(publicLease);
    }

    consumeLease({ lease_ref, operation_id, audience, materialize = () => undefined }) {
        const lease = this.#leases.get(lease_ref);
        if (!lease) throw new ContractError('CREDENTIAL_LEASE_UNKNOWN', { status: 403 });
        if (lease.used) throw new ContractError('CREDENTIAL_LEASE_ALREADY_USED', { status: 409 });
        if (this.now().getTime() > Date.parse(lease.expires_at)) {
            throw new ContractError('CREDENTIAL_LEASE_EXPIRED', { status: 403 });
        }
        if (lease.operation_id !== operation_id || lease.audience !== audience) {
            throw new ContractError('CREDENTIAL_LEASE_SCOPE_MISMATCH', { status: 403 });
        }
        const current = this.#currentByConnection.get(`${lease.tenant_id}:${lease.connection_id}`);
        if (!current || REQUIRED_BINDING_FIELDS.some((field) => current[field] !== lease[field])) {
            throw new ContractError('CREDENTIAL_BINDING_STALE', { status: 409 });
        }
        lease.used = true;
        return materialize(lease.credential_ref);
    }

    compareAndSwapRefresh({ credential_ref, expected_refresh_revision, new_credential_ref }) {
        const current = this.#credentials.get(credential_ref);
        if (!current || current.refresh_revision !== expected_refresh_revision || !new_credential_ref) {
            this.auditEvents.push(Object.freeze({
                event_type: 'oauth_refresh.conflict.v1',
                credential_ref,
                expected_refresh_revision,
                observed_refresh_revision: current?.refresh_revision ?? null,
                occurred_at: this.now().toISOString()
            }));
            throw new ContractError('OAUTH_REFRESH_CONFLICT', { status: 409 });
        }
        const updated = Object.freeze({
            ...current,
            credential_ref: new_credential_ref,
            refresh_revision: current.refresh_revision + 1
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
