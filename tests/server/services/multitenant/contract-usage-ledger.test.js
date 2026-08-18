import { describe, expect, it } from 'vitest';
import {
    ContractUsageLedger,
    computeBusinessIdempotencyKey,
    normalizeUsageEvent
} from '../../../../server/services/multitenant/contract-usage-ledger.js';
import { expectContractError } from './test-helpers.js';

const ids = {
    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    connection_revision: '1',
    deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    correlation_id: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    contract_revision: '11',
    idempotency_key: 'ik1_0123456789012345678901234567890123456789012'
};

function usageEvent(overrides = {}) {
    return {
        ...ids,
        message_type: 'usage_event',
        usage_event_id: 'usage_01ARZ3NDEKTSV4RRFFQ69G5FB2',
        protocol_version: '1.0',
        kind: 'tool',
        quantity: 1,
        unit: 'call',
        collection_state: 'collected',
        outcome: 'succeeded',
        failure_code: null,
        unknown_fields: [],
        observed_at: '2026-08-16T00:00:00Z',
        ...overrides
    };
}

describe('ContractUsageLedger', () => {
    it('AC-201/AC-203: plan枠、警告閾値、hard stop、超過方針をrevision固定で判断する', () => {
        const ledger = new ContractUsageLedger();
        ledger.registerContract({
            ...ids, contract_id: ids.contract_revision, contract_revision_number: 4,
            plan_code: 'plan-a', allowances: { tool_calls: 100 },
            thresholds_basis_points: [5000, 8000, 10000], overage_policy: 'deny',
            hard_stop_basis_points: 10000, rate_card_revision: 8, fx_table_revision: 5,
            window_started_at: '2026-08-01T00:00:00Z', window_ends_at: '2026-09-01T00:00:00Z'
        });
        expect(ledger.decideQuota({ tenant_id: ids.tenant_id, contract_revision: ids.contract_revision, metric: 'tool_calls', observed_quantity: 79, requested_quantity: 1 }).decision).toBe('warning');
        expect(ledger.decideQuota({ tenant_id: ids.tenant_id, contract_revision: ids.contract_revision, metric: 'tool_calls', observed_quantity: 99, requested_quantity: 1 }).decision).toBe('hard_stopped');
        expectContractError(
            () => ledger.decideQuota({ tenant_id: ids.tenant_id, contract_revision: '12', metric: 'tool_calls', observed_quantity: 0, requested_quantity: 1 }),
            { code: 'UPSTREAM_UNAVAILABLE' }
        );
        expectContractError(
            () => ledger.decideQuota({ tenant_id: ids.tenant_id, contract_revision: ids.contract_revision, metric: 'tool_calls', observed_quantity: 0, requested_quantity: -1 }),
            { code: 'QUOTA_INPUT_INVALID' }
        );
    });

    it('AC-202/D-006: length-prefix固定式でtenant別の副作用claimを冪等化する', () => {
        const input = {
            protocol_id: 'mana-brainbase-tenant-context', protocol_major: '1',
            tenant_id: ids.tenant_id, connection_id: ids.connection_id,
            slack_event_id: 'Ev-opaque', operation_id: ids.operation_id
        };
        const key = computeBusinessIdempotencyKey(input);
        expect(key).toMatch(/^ik1_[A-Za-z0-9_-]{43}$/);
        const ledger = new ContractUsageLedger();
        expect(ledger.claimEffect({ idempotency_key: key, payload_hash: 'payload-a', context_hash: 'context-a' }).state).toBe('claimed');
        expect(ledger.claimEffect({ idempotency_key: key, payload_hash: 'payload-a', context_hash: 'context-a' }).replayed).toBe(true);
        expectContractError(
            () => ledger.claimEffect({ idempotency_key: key, payload_hash: 'payload-b', context_hash: 'context-a' }),
            { code: 'IDEMPOTENCY_CONFLICT' }
        );
    });

    it('AC-204/D-007: outcomeとcollection_stateを分離し、失敗消費と未計測を0へ丸めない', () => {
        expect(normalizeUsageEvent(usageEvent({ kind: 'ai', unit: 'token', quantity: null, outcome: 'failed', collection_state: 'not_collected', failure_code: 'UPSTREAM_UNAVAILABLE' })))
            .toMatchObject({ outcome: 'failed', collection_state: 'not_collected', quantity: null });
        expectContractError(
            () => normalizeUsageEvent(usageEvent({ kind: 'ai', unit: 'token', quantity: 0, outcome: 'failed', collection_state: 'not_collected', failure_code: 'UPSTREAM_UNAVAILABLE' })),
            { code: 'USAGE_NOT_COLLECTED_HAS_QUANTITY' }
        );
        expect(normalizeUsageEvent(usageEvent({ quantity: 0, failure_code: 'NO_DATA' })))
            .toMatchObject({ quantity: 0, failure_code: 'NO_DATA' });
    });

    it('AC-205: canonical Receiptを変えずBrainbase価格revisionをimmutable snapshotとして固定する', () => {
        const ledger = new ContractUsageLedger();
        const canonicalReceipt = {
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
            actor_principal_id: 'person-opaque', project_id: 'project-opaque', capability_id: 'task.write',
            quota_decision: 'allowed', credential_mode: 'customer_oauth', outcome: 'failed', failure_code: 'UPSTREAM_UNAVAILABLE',
            collection_state: 'partial', usage_event_ids: [],
            reply: { state: 'failed', reply_count: 0, legacy_reply_count: 0 },
            completed_at: '2026-08-16T00:00:00Z'
        };
        const pricingSnapshot = {
            rate_card_revision: '8', fx_table_revision: '5', sales_price_revision: '3',
            purchase_currency: 'USD', purchase_minor_units: null,
            billing_currency: 'JPY', billing_minor_units: null,
            fx_rate_decimal: '150.1234', effective_at: '2026-08-16T00:00:00Z'
        };
        const finalized = ledger.finalizeReceiptWithPricing({ receipt: canonicalReceipt, pricing_snapshot: pricingSnapshot });
        expect(finalized).toEqual({ receipt: canonicalReceipt, pricing_snapshot: pricingSnapshot });
        expect(finalized.receipt).not.toHaveProperty('pricing_snapshot');
        expect(Object.isFrozen(finalized)).toBe(true);
        expect(ledger.readReceiptHistory({ tenant_id: ids.tenant_id, receipt_id: canonicalReceipt.receipt_id }))
            .toEqual([finalized]);
        expect(ledger.finalizeReceiptWithPricing({ receipt: canonicalReceipt, pricing_snapshot: pricingSnapshot })).toEqual(finalized);
        expectContractError(
            () => ledger.finalizeReceiptWithPricing({
                receipt: canonicalReceipt,
                pricing_snapshot: { ...pricingSnapshot, fx_table_revision: '6' }
            }),
            { code: 'IDEMPOTENCY_CONFLICT' }
        );
    });

    it('AC-204/AC-205: Usageのsame-payload replayとpartialのunknown_fieldsを厳密化する', () => {
        const ledger = new ContractUsageLedger();
        const input = usageEvent();
        const first = ledger.recordUsage(input);
        expect(ledger.recordUsage(input)).toEqual(first);
        expectContractError(() => ledger.recordUsage({ ...input, quantity: 2 }), { code: 'IDEMPOTENCY_CONFLICT' });
        expectContractError(() => normalizeUsageEvent(usageEvent({ outcome: 'failed', collection_state: 'partial', unknown_fields: [] })), { code: 'USAGE_PARTIAL_UNKNOWN_FIELDS_REQUIRED' });
        expectContractError(() => normalizeUsageEvent(usageEvent({ quantity: -1 })), { code: 'USAGE_COLLECTED_QUANTITY_REQUIRED' });
    });

    it('D-006: 同じbusiness-effect keyに属する複数UsageEventをevent ID単位で冪等化する', () => {
        const ledger = new ContractUsageLedger();
        const base = {
            ...ids,
            message_type: 'usage_event', protocol_version: '1.0',
            idempotency_key: 'ik1_SMJlU0vl95PXZjE3Cs0smROt0-VqWWO1D83Nl7IkSTE',
            unit: 'tokens', quantity: 1, outcome: 'succeeded', collection_state: 'collected',
            failure_code: null, unknown_fields: [], observed_at: '2026-08-16T13:01:31Z'
        };
        const first = ledger.recordUsage({ ...base, usage_event_id: 'usage_01ARZ3NDEKTSV4RRFFQ69G5FB2', kind: 'model_input_tokens' });
        const second = ledger.recordUsage({ ...base, usage_event_id: 'usage_01ARZ3NDEKTSV4RRFFQ69G5FB3', kind: 'model_output_tokens' });

        expect(second.usage_event_id).not.toBe(first.usage_event_id);
        expect(ledger.recordUsage({ ...base, usage_event_id: first.usage_event_id, kind: first.kind })).toEqual(first);
        expectContractError(
            () => ledger.recordUsage({ ...base, usage_event_id: first.usage_event_id, kind: 'provider_cost' }),
            { code: 'IDEMPOTENCY_CONFLICT' }
        );
    });
});
