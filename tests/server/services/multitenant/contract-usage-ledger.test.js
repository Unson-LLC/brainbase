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
    connection_revision: 1,
    deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    correlation_id: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    contract_revision: 'ctr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    tenant_revision_at_write: 3,
    idempotency_key: 'ik1_0123456789012345678901234567890123456789012'
};

describe('ContractUsageLedger', () => {
    it('AC-201/AC-203: plan枠、警告閾値、hard stop、超過方針をrevision固定で判断する', () => {
        const ledger = new ContractUsageLedger();
        ledger.registerContract({
            ...ids, contract_id: ids.contract_revision, contract_revision_number: 4,
            plan_code: 'plan-a', allowances: { tool_calls: 100 },
            thresholds_basis_points: [5000, 8000, 10000], overage_policy: 'deny',
            hard_stop_basis_points: 10000, rate_card_revision: 8, fx_table_revision: 5
        });
        expect(ledger.decideQuota({ tenant_id: ids.tenant_id, contract_revision: ids.contract_revision, metric: 'tool_calls', observed_quantity: 79, requested_quantity: 1 }).decision).toBe('warning');
        expect(ledger.decideQuota({ tenant_id: ids.tenant_id, contract_revision: ids.contract_revision, metric: 'tool_calls', observed_quantity: 99, requested_quantity: 1 }).decision).toBe('hard_stopped');
        expectContractError(
            () => ledger.decideQuota({ tenant_id: ids.tenant_id, contract_revision: 'ctr_01ARZ3NDEKTSV4RRFFQ69G5FAW', metric: 'tool_calls', observed_quantity: 0, requested_quantity: 1 }),
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
        expect(normalizeUsageEvent({ ...ids, kind: 'ai', unit: 'token', quantity: null, outcome: 'failed', collection_state: 'not_collected', failure_code: 'UPSTREAM_UNAVAILABLE' }))
            .toMatchObject({ outcome: 'failed', collection_state: 'not_collected', quantity: null });
        expectContractError(
            () => normalizeUsageEvent({ ...ids, kind: 'ai', unit: 'token', quantity: 0, outcome: 'failed', collection_state: 'not_collected', failure_code: 'UPSTREAM_UNAVAILABLE' }),
            { code: 'USAGE_COLLECTION_INVALID' }
        );
        expect(normalizeUsageEvent({ ...ids, kind: 'tool', unit: 'call', quantity: 0, outcome: 'succeeded', collection_state: 'collected', failure_code: 'NO_DATA' }))
            .toMatchObject({ quantity: '0', failure_code: 'NO_DATA' });
    });

    it('AC-205: Receiptへ当時のrate・FX・販売価格revisionをimmutable snapshotとして固定する', () => {
        const ledger = new ContractUsageLedger();
        const receipt = ledger.finalizeReceipt({
            ...ids,
            actor_principal_id: 'person-opaque', project_id: 'project-opaque', capability_id: 'task.write',
            quota_decision: 'allowed', credential_mode: 'customer_oauth', outcome: 'failed', failure_code: 'UPSTREAM_UNAVAILABLE',
            usage: { collection_state: 'partial', observed_units: '12', unknown_fields: ['external_api'] },
            pricing_snapshot: { rate_card_revision: 8, fx_table_revision: 5, sales_price_revision: 3, purchase_currency: 'USD', purchase_minor_units: null, billing_currency: 'JPY', billing_minor_units: null, fx_rate_decimal: '150.1234', effective_at: '2026-08-16T00:00:00Z' }
        });
        expect(receipt.pricing_snapshot).toMatchObject({ rate_card_revision: 8, fx_table_revision: 5, sales_price_revision: 3, purchase_minor_units: null });
        expect(Object.isFrozen(receipt)).toBe(true);
        expect(ledger.finalizeReceipt({ ...receipt })).toEqual(receipt);
        expectContractError(() => ledger.finalizeReceipt({ ...receipt, outcome: 'succeeded' }), { code: 'IDEMPOTENCY_CONFLICT' });
    });

    it('AC-204/AC-205: Usageのsame-payload replayとpartialのunknown_fieldsを厳密化する', () => {
        const ledger = new ContractUsageLedger();
        const input = { ...ids, kind: 'tool', unit: 'call', quantity: 1, outcome: 'succeeded', collection_state: 'collected', observed_at: '2026-08-16T00:00:00Z' };
        const first = ledger.recordUsage(input);
        expect(ledger.recordUsage(input)).toEqual(first);
        expectContractError(() => ledger.recordUsage({ ...input, quantity: 2 }), { code: 'IDEMPOTENCY_CONFLICT' });
        expectContractError(() => normalizeUsageEvent({ ...ids, kind: 'tool', unit: 'call', quantity: 1, outcome: 'failed', collection_state: 'partial', unknown_fields: [] }), { code: 'USAGE_COLLECTION_INVALID' });
        expectContractError(() => normalizeUsageEvent({ ...ids, kind: 'tool', unit: 'call', quantity: -1, outcome: 'succeeded', collection_state: 'collected' }), { code: 'USAGE_COLLECTION_INVALID' });
    });
});
