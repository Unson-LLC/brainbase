import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { MigrationPlanAttestor } from '../../../../server/services/multitenant/migration-plan-attestor.js';
import { TenantMigrationPlanner } from '../../../../server/services/multitenant/migration-planner.js';

function createAttestor(keyId = 'migration-test-key') {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return new MigrationPlanAttestor({
        key_id: keyId,
        private_key: privateKey,
        public_key: publicKey
    });
}

function signedPlan() {
    const planner = new TenantMigrationPlanner();
    const plan = planner.dryRun({
        target_tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        source_snapshot: 'snapshot:immutable',
        mapping_rule_revision: 1,
        rows: [{ id: 'source-a', revision: 2, candidates: ['ten_01ARZ3NDEKTSV4RRFFQ69G5FAV'] }]
    });
    return { attestor: createAttestor(), plan };
}

describe('MigrationPlanAttestor', () => {
    it('canonical planをEd25519で署名し正しい署名だけを検証する', () => {
        const { attestor, plan } = signedPlan();
        const signed = attestor.attest(plan);

        expect(signed.attestation).toMatchObject({
            algorithm: 'EdDSA',
            key_id: 'migration-test-key'
        });
        expect(signed.attestation.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(attestor.verify(signed)).toBe(signed);
    });

    it.each([
        ['candidate', (value) => { value.candidates[0].source_revision += 1; }],
        ['source_snapshot', (value) => { value.source_snapshot = 'snapshot:tampered'; }],
        ['count', (value) => { value.counts.eligible += 1; }],
        ['digest', (value) => { value.attestation.digest = `sha256:${'0'.repeat(64)}`; }],
        ['signature', (value) => {
            value.attestation.signature = `${value.attestation.signature.slice(0, -1)}${value.attestation.signature.endsWith('A') ? 'B' : 'A'}`;
        }],
        ['key_id', (value) => { value.attestation.key_id = 'untrusted-key'; }],
        ['attestation extra field', (value) => { value.attestation.extra = 'unexpected'; }]
    ])('改ざんした%sをfail-closedで拒否する', (_field, mutate) => {
        const { attestor, plan } = signedPlan();
        const signed = attestor.attest(plan);
        const tampered = structuredClone(signed);
        mutate(tampered);

        expect(() => attestor.verify(tampered)).toThrow(expect.objectContaining({
            code: 'MIGRATION_PLAN_ATTESTATION_INVALID',
            status: 403
        }));
    });

    it('signed planのcandidate target不一致を署名前後の両境界で拒否する', () => {
        const { attestor, plan } = signedPlan();
        const mismatched = structuredClone(plan);
        mismatched.candidates[0].recommended_tenant_id = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAW';

        expect(() => attestor.attest(mismatched)).toThrow(expect.objectContaining({
            code: 'CROSS_TENANT_CANDIDATE',
            status: 403,
            details: expect.objectContaining({
                required_action: 'none',
                audit_event: 'cross_tenant_candidate_denied'
            })
        }));

        const signed = attestor.attest(plan);
        const tampered = structuredClone(signed);
        tampered.candidates[0].recommended_tenant_id = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAW';
        expect(() => attestor.verify(tampered)).toThrow(expect.objectContaining({
            code: 'CROSS_TENANT_CANDIDATE',
            status: 403,
            details: expect.objectContaining({
                required_action: 'none',
                audit_event: 'cross_tenant_candidate_denied'
            })
        }));
    });
});
