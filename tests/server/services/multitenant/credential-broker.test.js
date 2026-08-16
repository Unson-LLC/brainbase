import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialBroker } from '../../../../server/services/multitenant/credential-broker.js';
import { expectContractError } from './test-helpers.js';

const binding = {
    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    connection_revision: 2,
    credential_ref: 'credref:opaque',
    credential_mode: 'customer_oauth'
};

describe('CredentialBroker', () => {
    it('D-005: 最大60秒、single-use、operation/audience/mode束縛のopaque leaseを発行する', () => {
        let nowMs = Date.parse('2026-08-16T00:00:00Z');
        const broker = new CredentialBroker({ now: () => new Date(nowMs) });
        broker.register(binding);

        expectContractError(
            () => broker.issueLease({ ...binding, operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV', audience: 'mana-runtime', ttl_seconds: 61 }),
            { code: 'CREDENTIAL_LEASE_INVALID' }
        );
        const lease = broker.issueLease({ ...binding, operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV', audience: 'mana-runtime', ttl_seconds: 60 });
        expect(lease).not.toHaveProperty('credential');
        expect(lease).not.toHaveProperty('token');
        expectContractError(
            () => broker.consumeLease({ lease_ref: lease.lease_ref, operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV', audience: 'other' }),
            { code: 'CREDENTIAL_LEASE_SCOPE_MISMATCH' }
        );
        const volatile = broker.consumeLease({
            lease_ref: lease.lease_ref,
            operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            audience: 'mana-runtime',
            materialize: () => randomBytes(32)
        });
        expect(Buffer.isBuffer(volatile)).toBe(true);
        expectContractError(
            () => broker.consumeLease({ lease_ref: lease.lease_ref, operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV', audience: 'mana-runtime' }),
            { code: 'CREDENTIAL_LEASE_ALREADY_USED' }
        );
    });

    it('D-005: OAuth refreshをexpected revisionのCASで更新し競合を監査する', () => {
        const broker = new CredentialBroker();
        broker.register({ ...binding, refresh_revision: 4 });
        expect(broker.compareAndSwapRefresh({
            credential_ref: binding.credential_ref,
            expected_refresh_revision: 4,
            new_credential_ref: 'credref:rotated'
        })).toMatchObject({ credential_ref: 'credref:rotated', refresh_revision: 5 });
        expectContractError(() => broker.compareAndSwapRefresh({
            credential_ref: 'credref:rotated', expected_refresh_revision: 4, new_credential_ref: 'credref:stale'
        }), { code: 'OAUTH_REFRESH_CONFLICT' });
        expect(broker.auditEvents.every((event) => !JSON.stringify(event).includes('token'))).toBe(true);
    });
});
