import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    createSignedTenantContext,
    verifyTenantContext
} from '../../../../server/services/multitenant/tenant-context.js';
import {
    negotiateProtocol,
    REQUIRED_CAPABILITIES
} from '../../../../server/services/multitenant/protocol-contract.js';
import { computeBusinessIdempotencyKey } from '../../../../server/services/multitenant/contract-usage-ledger.js';
import { expectContractError } from './test-helpers.js';

function validEnvelope() {
    const envelope = {
        schema_version: '1.0', protocol_id: 'mana-brainbase-tenant-context', protocol_version: '1.0',
        issuer: 'brainbase', audience: ['mana-runtime', 'brainbase-api'],
        tenant: { tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV', tenant_revision: '1' },
        workspace_connection: { connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV', connection_revision: '1', status: 'active', provider: 'slack', installation_id: 'i', workspace_id: 'w', app_id: 'a' },
        actor: { principal_id: 'person-opaque', principal_type: 'person', authenticated_subject_id: 'subject-opaque' },
        authorization: { organization_ids: ['org-opaque'], project_ids: ['project-opaque'], data_scopes: ['graph:read'], capability_ids: ['receipt:write'] },
        placement: { deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV', profile: 'shared_cloud' },
        slack: { event_id: 'event-opaque', channel_id: 'channel-opaque', thread_ts: 'thread-opaque', requester_id: 'requester-opaque' },
        correlation_id: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAV', operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        idempotency_key: '', contract_revision: '1',
        credential: { mode: 'customer_oauth', credential_ref: 'credref:opaque', billing_principal_id: 'billing-opaque' },
        issued_at: '2026-08-16T00:00:00.000Z', expires_at: '2026-08-16T00:05:00.000Z'
    };
    envelope.idempotency_key = computeBusinessIdempotencyKey({
        protocol_id: envelope.protocol_id,
        protocol_major: '1',
        tenant_id: envelope.tenant.tenant_id,
        connection_id: envelope.workspace_connection.connection_id,
        slack_event_id: envelope.slack.event_id,
        operation_id: envelope.operation_id
    });
    return envelope;
}

function validNegotiation(deploymentProfile, overrides = {}) {
    return {
        message_type: 'protocol_negotiation_request',
        protocol_id: 'mana-brainbase-tenant-context',
        deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        deployment_profile: deploymentProfile,
        supported_range: '>=1.0 <2.0',
        supported_versions: ['1.0'],
        required_capabilities: [...REQUIRED_CAPABILITIES],
        optional_capabilities: [],
        ...overrides
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

    it('D-001/AC-004: TTL超過、期限切れ、改ざん、unknown keyを分類して拒否する', () => {
        const { publicKey, privateKey } = generateKeyPairSync('ed25519');
        const tooLong = validEnvelope();
        tooLong.expires_at = '2026-08-16T00:05:01.000Z';
        expectContractError(
            () => createSignedTenantContext(tooLong, { key_id: 'key-current', private_key: privateKey }),
            { code: 'TTL_EXCEEDED' }
        );
        const valid = createSignedTenantContext(validEnvelope(), { key_id: 'key-current', private_key: privateKey });
        expectContractError(
            () => verifyTenantContext(valid, { keys: [{ key_id: 'key-current', status: 'current', public_key: publicKey }], audience: 'mana-runtime', deployment_id: valid.placement.deployment_id, now: new Date('2026-08-16T00:05:31Z') }),
            { code: 'EXPIRED' }
        );
        expectContractError(
            () => verifyTenantContext({ ...valid, actor: { ...valid.actor, principal_id: 'tampered' } }, { keys: [{ key_id: 'key-current', status: 'current', public_key: publicKey }], audience: 'mana-runtime', deployment_id: valid.placement.deployment_id, now: new Date('2026-08-16T00:01:00Z') }),
            { code: 'TENANT_CONTEXT_SIGNATURE_INVALID' }
        );
        expectContractError(
            () => verifyTenantContext(valid, { keys: [], audience: 'mana-runtime', deployment_id: valid.placement.deployment_id, now: new Date('2026-08-16T00:01:00Z') }),
            { code: 'TENANT_CONTEXT_SIGNATURE_INVALID' }
        );
    });

    it('D-001/AC-004/AC-305: nested shape、audience型、JWS header、公開鍵有効期間をfail closedにする', () => {
        const { publicKey, privateKey } = generateKeyPairSync('ed25519');
        const options = {
            keys: [{ key_id: 'key-current', status: 'current', public_key: publicKey, not_before: '2026-08-15T00:00:00Z', expires_at: '2026-08-17T00:00:00Z' }],
            audience: 'mana-runtime', deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV', now: new Date('2026-08-16T00:01:00Z')
        };
        expectContractError(() => createSignedTenantContext({ ...validEnvelope(), audience: 'mana-runtime' }, { key_id: 'key-current', private_key: privateKey }), { code: 'SCHEMA_INVALID' });
        expectContractError(() => createSignedTenantContext({ ...validEnvelope(), actor: { principal_id: 'person-opaque' } }, { key_id: 'key-current', private_key: privateKey }), { code: 'SCHEMA_INVALID' });

        const signed = createSignedTenantContext(validEnvelope(), { key_id: 'key-current', private_key: privateKey });
        const [protected64, , signature64] = signed.integrity.value.split('.');
        const wrongHeader = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key-other' })).toString('base64url');
        expectContractError(() => verifyTenantContext({ ...signed, integrity: { ...signed.integrity, value: `${wrongHeader}..${signature64}` } }, options), { code: 'SCHEMA_INVALID' });
        expect(protected64).not.toBe(wrongHeader);
        expectContractError(() => verifyTenantContext(signed, { ...options, keys: [{ ...options.keys[0], expires_at: '2026-08-15T23:59:00Z' }] }), { code: 'TENANT_CONTEXT_SIGNATURE_INVALID' });
    });
});

describe('protocol negotiation', () => {
    it.each(['shared_cloud', 'customer_managed_oss'])('AC-301/AC-302: %sでprotocol v1と共通必須capabilityを交渉する', (profile) => {
        expect(negotiateProtocol(validNegotiation(profile, { optional_capabilities: ['cloud_billing_export'] })))
            .toMatchObject({ message_type: 'protocol_negotiation_response', protocol_id: 'mana-brainbase-tenant-context', selected_version: '1.0' });
    });

    it('AC-303: OSSではCloud任意機能だけを理由付きnon_applicableにする', () => {
        const result = negotiateProtocol(validNegotiation('customer_managed_oss', { optional_capabilities: ['cloud_billing_export'] }));
        expect(result.optional_capabilities).toContainEqual({
            capability: 'cloud_billing_export',
            status: 'non_applicable',
            reason: 'Brainbase Cloud billing export is not present in a customer-managed deployment.'
        });
        expect(result.required_capabilities).toContain('tenant_scoped_authorization');
    });

    it('AC-302/AC-305: major不一致や必須機能不足を拒否しsilent downgradeしない', () => {
        expectContractError(
            () => negotiateProtocol(validNegotiation('shared_cloud', { supported_range: '>=2.0 <3.0', supported_versions: ['2.0'] })),
            { code: 'PROTOCOL_VERSION_UNSUPPORTED' }
        );
        expectContractError(
            () => negotiateProtocol(validNegotiation('shared_cloud', { required_capabilities: [...REQUIRED_CAPABILITIES, 'unknown_required'] })),
            { code: 'PROTOCOL_CAPABILITY_UNSUPPORTED' }
        );
        for (const supported_range of ['1.x', '>=1.0', '>=0.9 <1.0', 'garbage >=1 <2']) {
            expectContractError(
                () => negotiateProtocol(validNegotiation('shared_cloud', { supported_range })),
                { code: 'PROTOCOL_VERSION_UNSUPPORTED' }
            );
        }
    });

    it('D-004: canonical rangeと意味的に重なるだけの非canonical rangeを拒否する', () => {
        expectContractError(
            () => negotiateProtocol(validNegotiation('shared_cloud', { supported_range: '>=0.9 <1.1' })),
            { code: 'PROTOCOL_VERSION_UNSUPPORTED' }
        );
    });
});
