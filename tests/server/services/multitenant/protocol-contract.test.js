import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    createSignedTenantContext,
    verifyTenantContext
} from '../../../../server/services/multitenant/tenant-context.js';
import { negotiateProtocol } from '../../../../server/services/multitenant/protocol-contract.js';
import { expectContractError } from './test-helpers.js';

function validEnvelope() {
    return {
        schema_version: '1.0', protocol_id: 'mana-brainbase-tenant-context', protocol_version: '1.0',
        issuer: 'brainbase', audience: ['mana-runtime', 'brainbase-api'],
        tenant: { tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV', tenant_revision: 1 },
        workspace_connection: { connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV', connection_revision: 1, status: 'active', provider: 'slack', installation_id: 'i', workspace_id: 'w', app_id: 'a' },
        actor: { principal_id: 'person-opaque', principal_type: 'person', authenticated_subject_id: 'subject-opaque' },
        authorization: { organization_ids: ['org-opaque'], project_ids: ['project-opaque'], data_scopes: ['graph:read'], capability_ids: ['receipt:write'] },
        placement: { deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV', profile: 'shared_cloud' },
        slack: { event_id: 'event-opaque', channel_id: 'channel-opaque', thread_ts: 'thread-opaque', requester_id: 'requester-opaque' },
        correlation_id: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAV', operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        idempotency_key: 'ik1_0123456789012345678901234567890123456789012', contract_revision: 'ctr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        credential: { mode: 'customer_oauth', credential_ref: 'credref:opaque', billing_principal_id: 'billing-opaque' },
        issued_at: '2026-08-16T00:00:00.000Z', expires_at: '2026-08-16T00:05:00.000Z'
    };
}

describe('canonical TenantContextEnvelope', () => {
    it('D-001/AC-301: snake_case canonical JSONのdetached Ed25519 JWSを検証しimmutable化する', () => {
        const { publicKey, privateKey } = generateKeyPairSync('ed25519');
        const signed = createSignedTenantContext(validEnvelope(), { key_id: 'key-current', private_key: privateKey });
        const verified = verifyTenantContext(signed, {
            keys: [{ key_id: 'key-current', status: 'current', public_key: publicKey }],
            audience: 'mana-runtime', deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV', now: new Date('2026-08-16T00:04:59Z')
        });
        expect(Object.isFrozen(verified)).toBe(true);
        expect(verified.integrity).toMatchObject({ method: 'jws_detached', algorithm: 'EdDSA', key_id: 'key-current' });
    });

    it('D-001: TTL超過、期限切れ、改ざん、unknown keyを分類して拒否する', () => {
        const { publicKey, privateKey } = generateKeyPairSync('ed25519');
        const tooLong = validEnvelope();
        tooLong.expires_at = '2026-08-16T00:05:01.000Z';
        const signed = createSignedTenantContext(tooLong, { key_id: 'key-current', private_key: privateKey });
        expectContractError(
            () => verifyTenantContext(signed, { keys: [{ key_id: 'key-current', status: 'current', public_key: publicKey }], audience: 'mana-runtime', deployment_id: tooLong.placement.deployment_id, now: new Date('2026-08-16T00:00:01Z') }),
            { code: 'TENANT_CONTEXT_EXPIRED' }
        );
        const valid = createSignedTenantContext(validEnvelope(), { key_id: 'key-current', private_key: privateKey });
        expectContractError(
            () => verifyTenantContext({ ...valid, actor: { ...valid.actor, principal_id: 'tampered' } }, { keys: [{ key_id: 'key-current', status: 'current', public_key: publicKey }], audience: 'mana-runtime', deployment_id: valid.placement.deployment_id, now: new Date('2026-08-16T00:01:00Z') }),
            { code: 'TENANT_CONTEXT_SIGNATURE_INVALID' }
        );
    });
});

describe('protocol negotiation', () => {
    it.each(['shared_cloud', 'customer_managed_oss'])('AC-301/302: %sでprotocol v1と共通必須capabilityを交渉する', (profile) => {
        expect(negotiateProtocol({
            deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV', deployment_profile: profile,
            supported_range: '>=1.0 <2.0', required_capabilities: ['signed_tenant_context', 'usage_receipt_v1'],
            optional_capabilities: ['cloud_billing_export']
        })).toMatchObject({ protocol_id: 'mana-brainbase-tenant-context', selected_version: '1.0', deployment_profile: profile });
    });

    it('AC-303: OSSではCloud任意機能だけを理由付きnon_applicableにする', () => {
        const result = negotiateProtocol({ deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV', deployment_profile: 'customer_managed_oss', supported_range: '>=1.0 <2.0', required_capabilities: ['signed_tenant_context'], optional_capabilities: ['cloud_billing_export'] });
        expect(result.optional_capabilities.cloud_billing_export).toMatchObject({ status: 'non_applicable', reason: expect.any(String) });
        expect(result.required_capabilities).toContain('tenant_scoped_authorization');
    });

    it('AC-302/305: major不一致や必須機能不足を拒否しsilent downgradeしない', () => {
        expectContractError(
            () => negotiateProtocol({ deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV', deployment_profile: 'shared_cloud', supported_range: '>=2.0 <3.0', required_capabilities: [] }),
            { code: 'PROTOCOL_VERSION_UNSUPPORTED' }
        );
        expectContractError(
            () => negotiateProtocol({ deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV', deployment_profile: 'shared_cloud', supported_range: '>=1.0 <2.0', required_capabilities: ['unknown_required'] }),
            { code: 'PROTOCOL_CAPABILITY_UNSUPPORTED' }
        );
    });
});
