import { describe, expect, it } from 'vitest';
import {
    normalizeUsageEvent,
    validateIdempotencyClaim,
    validateOperationReceipt,
    validateQuotaDecision
} from '../../../../server/services/multitenant/contract-usage-ledger.js';
import { validateCredentialLease } from '../../../../server/services/multitenant/credential-broker.js';
import { expectContractError } from './test-helpers.js';

const ids = {
    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW',
    connection_revision: '7',
    contract_revision: '11',
    deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX',
    correlation_id: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAY',
    operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
    idempotency_key: 'ik1_SMJlU0vl95PXZjE3Cs0smROt0-VqWWO1D83Nl7IkSTE'
};

const usage = {
    message_type: 'usage_event',
    usage_event_id: 'usage_01ARZ3NDEKTSV4RRFFQ69G5FB2',
    protocol_version: '1.0',
    ...ids,
    kind: 'model_input_tokens',
    quantity: 1200,
    unit: 'tokens',
    collection_state: 'collected',
    outcome: 'succeeded',
    failure_code: null,
    unknown_fields: [],
    observed_at: '2026-08-16T13:01:31Z'
};

const receipt = {
    message_type: 'operation_receipt',
    receipt_id: 'receipt_01ARZ3NDEKTSV4RRFFQ69G5FB6',
    protocol_version: '1.0',
    tenant_id: ids.tenant_id,
    connection_id: ids.connection_id,
    connection_revision: ids.connection_revision,
    contract_revision: ids.contract_revision,
    deployment_id: ids.deployment_id,
    correlation_id: ids.correlation_id,
    operation_ids: [ids.operation_id],
    idempotency_keys: [ids.idempotency_key],
    actor_principal_id: 'person-a',
    project_id: 'project-a',
    capability_id: 'task.read',
    quota_decision: 'allowed',
    credential_mode: 'customer_oauth',
    collection_state: 'partial',
    outcome: 'failed',
    failure_code: 'UPSTREAM_PARTIAL',
    usage_event_ids: [usage.usage_event_id],
    reply: { state: 'failed', reply_count: 0, legacy_reply_count: 0 },
    completed_at: '2026-08-16T13:01:35Z'
};

const claim = {
    message_type: 'idempotency_claim',
    owner: 'brainbase',
    scope: 'business_effect',
    tenant_id: ids.tenant_id,
    connection_id: ids.connection_id,
    slack_event_id: 'Ev-A-001',
    operation_id: ids.operation_id,
    idempotency_key: ids.idempotency_key,
    context_hash: `sha256:${'a'.repeat(64)}`,
    payload_hash: `sha256:${'b'.repeat(64)}`,
    state: 'succeeded',
    retention_until: '2026-09-16T13:01:35Z'
};

function without(object, field) {
    const copy = structuredClone(object);
    delete copy[field];
    return copy;
}

describe('canonical schema strictness', () => {
    it.each([
        ['Receipt required欠落', () => validateOperationReceipt(without(receipt, 'actor_principal_id'))],
        ['Receipt unknown field', () => validateOperationReceipt({ ...receipt, pricing_snapshot: {} })],
        ['UsageEvent usage_event_id欠落', () => normalizeUsageEvent(without(usage, 'usage_event_id'))],
        ['UsageEvent observed_at欠落', () => normalizeUsageEvent(without(usage, 'observed_at'))],
        ['IdempotencyClaim context_hash欠落', () => validateIdempotencyClaim(without(claim, 'context_hash'))],
        ['IdempotencyClaim retention_until欠落', () => validateIdempotencyClaim(without(claim, 'retention_until'))]
    ])('%sをSCHEMA_INVALIDで拒否する', (_label, action) => {
        expectContractError(action, { code: 'SCHEMA_INVALID', status: 400 });
    });

    it.each([
        ['ID形式', () => normalizeUsageEvent({ ...usage, tenant_id: 'ten_invalid' })],
        ['enum', () => normalizeUsageEvent({ ...usage, credential_mode: 'legacy', outcome: 'unknown' })],
        ['時刻', () => normalizeUsageEvent({ ...usage, observed_at: '2026-08-16 13:01:31' })],
        ['hash', () => validateIdempotencyClaim({ ...claim, context_hash: 'sha256:ABC' })],
        ['revision', () => validateOperationReceipt({ ...receipt, contract_revision: '01' })],
        ['数量型', () => validateQuotaDecision({
            message_type: 'quota_decision', tenant_id: ids.tenant_id,
            contract_revision: '11', quota_revision: '19', decision: 'allowed',
            limit: 10, used: 11, remaining: -1, unit: 'calls',
            window_started_at: '2026-08-01T00:00:00Z',
            window_ends_at: '2026-09-01T00:00:00Z', decided_at: '2026-08-16T13:00:31Z'
        })]
    ])('%s違反をconsumer同等に拒否する', (_label, action) => {
        expect(action).toThrow();
    });

    it('credential leaseのunknown fieldと非canonical lease_idを拒否する', () => {
        const request = {
            message_type: 'credential_lease_request', protocol_version: '1.0',
            binding: {
                tenant_id: ids.tenant_id, connection_id: ids.connection_id,
                connection_revision: '7', contract_revision: '11', operation_id: ids.operation_id,
                audience: 'api.openai.com', credential_mode: 'customer_oauth', credential_ref: 'ref:opaque'
            },
            requested_ttl_seconds: 60
        };
        const response = {
            message_type: 'credential_lease_response', protocol_version: '1.0',
            lease_id: 'lease_not-ulid', contract_revision: '11', binding: request.binding,
            issued_at: '2026-08-16T13:00:30Z', expires_at: '2026-08-16T13:01:30Z',
            max_uses: 1, lease_token: 'opaque', unknown: true
        };
        expectContractError(
            () => validateCredentialLease(request, response, { now: new Date('2026-08-16T13:00:30Z') }),
            { code: 'SCHEMA_INVALID', status: 400 }
        );
    });
});
