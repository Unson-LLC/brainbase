import { describe, expect, it, vi } from 'vitest';

import { PostgresContractUsageLedger } from '../../../../server/services/multitenant/postgres-contract-usage-ledger.js';
import { computeBusinessIdempotencyKey } from '../../../../server/services/multitenant/contract-usage-ledger.js';

const now = new Date('2026-08-16T13:00:31Z');
const ids = {
    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW',
    connection_revision: '7',
    contract_revision: '11',
    deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX',
    correlation_id: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAY',
    operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAZ'
};
const idempotencyKey = computeBusinessIdempotencyKey({
    protocol_id: 'mana-brainbase-tenant-context',
    protocol_major: '1',
    tenant_id: ids.tenant_id,
    connection_id: ids.connection_id,
    slack_event_id: 'Ev-A-001',
    operation_id: ids.operation_id
});

function createRepository() {
    return {
        loadContractRevision: vi.fn(async () => ({
            tenant_id: ids.tenant_id,
            contract_id: 'ctr_01ARZ3NDEKTSV4RRFFQ69G5FB1',
            contract_revision: ids.contract_revision,
            allowances: { model_tokens: 1000000 },
            thresholds_basis_points: [8000, 10000],
            overage_policy: 'deny',
            hard_stop_basis_points: 10000,
            rate_card_revision: 8,
            fx_table_revision: 5,
            sales_price_revision: 3
        })),
        recordQuotaDecision: vi.fn(async (decision) => decision),
        recordUsage: vi.fn(async (event) => event),
        finalizeReceipt: vi.fn(async (receipt) => receipt),
        finalizeReceiptWithPricing: vi.fn(async (input) => input),
        readReceiptHistory: vi.fn(async () => []),
        claimBusinessEffect: vi.fn(async ({ claim }) => claim)
    };
}

describe('PostgresContractUsageLedger', () => {
    it('D-006: authoritative contractからcanonical QuotaDecisionを作り永続化する', async () => {
        const repository = createRepository();
        const ledger = new PostgresContractUsageLedger({ repository, now: () => now });
        const input = {
            tenant_id: ids.tenant_id,
            contract_revision: ids.contract_revision,
            quota_revision: '19',
            metric: 'model_tokens',
            observed_quantity: 1200,
            requested_quantity: 0,
            unit: 'model_tokens',
            window_started_at: '2026-08-01T00:00:00Z',
            window_ends_at: '2026-09-01T00:00:00Z',
            idempotency_key: idempotencyKey
        };

        const decision = await ledger.decideQuota(input);

        expect(decision).toEqual({
            message_type: 'quota_decision',
            tenant_id: ids.tenant_id,
            contract_revision: '11',
            quota_revision: '19',
            limit: 1000000,
            used: 1200,
            remaining: 998800,
            unit: 'model_tokens',
            window_started_at: '2026-08-01T00:00:00Z',
            window_ends_at: '2026-09-01T00:00:00Z',
            decision: 'allowed',
            decided_at: '2026-08-16T13:00:31.000Z',
            failure_code: null
        });
        expect(repository.loadContractRevision).toHaveBeenCalledWith({ tenant_id: ids.tenant_id, contract_revision: '11' });
        expect(repository.recordQuotaDecision).toHaveBeenCalledWith(decision, {
            idempotency_key: idempotencyKey,
            metric: 'model_tokens'
        });
    });

    it('D-006/D-007: canonical UsageEventとOperationReceiptを状態混同なしで保存する', async () => {
        const repository = createRepository();
        const ledger = new PostgresContractUsageLedger({ repository, now: () => now });
        const usage = {
            message_type: 'usage_event',
            usage_event_id: 'usage_01ARZ3NDEKTSV4RRFFQ69G5FB2',
            protocol_version: '1.0',
            ...ids,
            idempotency_key: idempotencyKey,
            kind: 'provider_cost',
            quantity: null,
            unit: 'usd',
            collection_state: 'not_collected',
            outcome: 'timed_out',
            failure_code: 'UPSTREAM_TIMEOUT',
            unknown_fields: ['amount'],
            observed_at: '2026-08-16T13:01:34Z'
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
            idempotency_keys: [idempotencyKey],
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

        await expect(ledger.recordUsage(usage)).resolves.toEqual(usage);
        await expect(ledger.finalizeReceipt(receipt)).resolves.toEqual(receipt);
        expect(repository.recordUsage).toHaveBeenCalledWith(usage);
        expect(repository.finalizeReceipt).toHaveBeenCalledWith(receipt);
    });

    it('D-006: Brainbase-owned business-effect claimだけをconnection revision付きで保存する', async () => {
        const repository = createRepository();
        const ledger = new PostgresContractUsageLedger({ repository, now: () => now });
        const claim = {
            message_type: 'idempotency_claim',
            owner: 'brainbase',
            scope: 'business_effect',
            tenant_id: ids.tenant_id,
            connection_id: ids.connection_id,
            slack_event_id: 'Ev-A-001',
            operation_id: ids.operation_id,
            idempotency_key: idempotencyKey,
            context_hash: `sha256:${'a'.repeat(64)}`,
            payload_hash: `sha256:${'b'.repeat(64)}`,
            state: 'succeeded',
            retention_until: '2026-09-16T13:01:35Z'
        };

        await expect(ledger.claimEffect(claim, { connection_revision: ids.connection_revision })).resolves.toEqual(claim);
        expect(repository.claimBusinessEffect).toHaveBeenCalledWith({ claim, connection_revision: '7' });
    });

    it('AC-205: authoritative価格revision一致時だけReceiptとsnapshotを同一永続境界へ渡す', async () => {
        const repository = createRepository();
        const ledger = new PostgresContractUsageLedger({ repository, now: () => now });
        const receipt = {
            message_type: 'operation_receipt', receipt_id: 'receipt_01ARZ3NDEKTSV4RRFFQ69G5FB6',
            protocol_version: '1.0', tenant_id: ids.tenant_id, connection_id: ids.connection_id,
            connection_revision: ids.connection_revision, contract_revision: ids.contract_revision,
            deployment_id: ids.deployment_id, correlation_id: ids.correlation_id,
            operation_ids: [ids.operation_id], idempotency_keys: [idempotencyKey],
            actor_principal_id: 'person-a', project_id: 'project-a', capability_id: 'task.read',
            quota_decision: 'allowed', credential_mode: 'customer_oauth', collection_state: 'partial',
            outcome: 'failed', failure_code: 'UPSTREAM_PARTIAL', usage_event_ids: [],
            reply: { state: 'failed', reply_count: 0, legacy_reply_count: 0 },
            completed_at: '2026-08-16T13:01:35Z'
        };
        const pricingSnapshot = {
            rate_card_revision: '8', fx_table_revision: '5', sales_price_revision: '3',
            purchase_currency: 'USD', purchase_minor_units: null,
            billing_currency: 'JPY', billing_minor_units: null,
            fx_rate_decimal: '150.1234', effective_at: '2026-08-16T13:01:35Z'
        };

        await expect(ledger.finalizeReceiptWithPricing({ receipt, pricing_snapshot: pricingSnapshot }))
            .resolves.toEqual({ receipt, pricing_snapshot: pricingSnapshot });
        expect(repository.finalizeReceiptWithPricing).toHaveBeenCalledWith({ receipt, pricing_snapshot: pricingSnapshot });
        await expect(ledger.finalizeReceiptWithPricing({
            receipt,
            pricing_snapshot: { ...pricingSnapshot, fx_table_revision: '6' }
        })).rejects.toMatchObject({ code: 'PRICING_REVISION_MISMATCH' });
        expect(repository.finalizeReceiptWithPricing).toHaveBeenCalledTimes(1);
    });
});
