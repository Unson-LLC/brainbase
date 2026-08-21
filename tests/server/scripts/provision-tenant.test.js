import { describe, expect, it } from 'vitest';

import { parseProvisionTenantArgs } from '../../../scripts/provision-tenant.js';

describe('provision tenant CLI', () => {
    it('keeps check and dry-run safe and requires explicit approval for apply', () => {
        expect(parseProvisionTenantArgs(['--manifest', 'tenant.json', '--idempotency-key', 'ik_check', '--check']))
            .toMatchObject({ mode: 'check' });
        expect(parseProvisionTenantArgs(['--manifest', 'tenant.json', '--idempotency-key', 'ik_dry', '--dry-run']))
            .toMatchObject({ mode: 'dry-run' });
        expect(() => parseProvisionTenantArgs(['--manifest', 'tenant.json', '--idempotency-key', 'ik_apply', '--apply']))
            .toThrow(/approve-apply/u);
    });

    it('requires an idempotency key and an actor for apply', () => {
        expect(() => parseProvisionTenantArgs(['--manifest', 'tenant.json', '--check']))
            .toThrow(/idempotency/u);
        expect(() => parseProvisionTenantArgs(
            ['--manifest', 'tenant.json', '--apply', '--approve-apply', '--idempotency-key', 'ik_1'],
            {}
        )).toThrow(/BRAINBASE_PROVISIONING_ACTOR/u);
    });

    it('selects explicit two-stage bootstrap phases and preserves all-at-once by default', () => {
        expect(parseProvisionTenantArgs([
            '--manifest', 'tenant-core.json', '--idempotency-key', 'ik_core', '--check', '--phase', 'core'
        ])).toMatchObject({ phase: 'core' });
        expect(parseProvisionTenantArgs([
            '--manifest', 'tenant-connection.json', '--idempotency-key', 'ik_connection', '--check', '--phase', 'connection'
        ])).toMatchObject({ phase: 'connection' });
        expect(parseProvisionTenantArgs([
            '--manifest', 'tenant.json', '--idempotency-key', 'ik_all', '--check'
        ])).toMatchObject({ phase: 'all' });
        expect(() => parseProvisionTenantArgs([
            '--manifest', 'tenant.json', '--idempotency-key', 'ik_bad', '--check', '--phase', 'unsafe'
        ])).toThrow(/phase/u);
    });
});
