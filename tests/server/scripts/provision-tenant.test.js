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
});
