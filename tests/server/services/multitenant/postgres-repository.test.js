import { describe, expect, it, vi } from 'vitest';
import { MultitenantPostgresRepository } from '../../../../server/services/multitenant/postgres-repository.js';
import { expectContractErrorAsync } from './test-helpers.js';

function poolWithRows(rowsByPattern) {
    const query = vi.fn(async (sql) => {
        const pattern = Object.keys(rowsByPattern).find((candidate) => sql.includes(candidate));
        return { rows: pattern ? rowsByPattern[pattern] : [], rowCount: pattern ? rowsByPattern[pattern].length : 0 };
    });
    const client = { query, release: vi.fn() };
    return { pool: { connect: vi.fn(async () => client) }, client };
}

describe('MultitenantPostgresRepository', () => {
    it('Slack installation replay readback returns the completed ledger payload without exposing credentials', async () => {
        const snapshot = {
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX',
            status: 'active'
        };
        const { pool, client } = poolWithRows({
            'FROM slack_installation_intents i': [{ consumed_at: '2026-08-19T00:00:01Z', status: 'completed', response_payload: snapshot }]
        });
        const repository = new MultitenantPostgresRepository({ pool });

        await expect(repository.readSlackInstallationResult({
            tenant_id: snapshot.tenant_id,
            installation_intent_id: 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAV'
        })).resolves.toEqual(snapshot);
        expect(client.query.mock.calls.some(([sql]) => sql.includes('FOR SHARE OF i'))).toBe(true);
        expect(client.query.mock.calls.every(([, params = []]) => !params.includes('raw-token'))).toBe(true);
    });

    it('Slack installation replay without a completed ledger fails closed after the intent is consumed', async () => {
        const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX';
        const { pool } = poolWithRows({
            'FROM slack_installation_intents i': [{ consumed_at: '2026-08-19T00:00:01Z', status: null, response_payload: null }]
        });
        const repository = new MultitenantPostgresRepository({ pool });

        await expectContractErrorAsync(
            () => repository.readSlackInstallationResult({
                tenant_id: tenantId,
                installation_intent_id: 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAV'
            }),
            { code: 'INSTALLATION_STATE_REPLAYED', status: 409 }
        );
    });

    it('AC-005/AC-105/D-003: transaction-local tenant RLSを設定しauthoritative revisionをlock付きで読む', async () => {
        const { pool, client } = poolWithRows({
            'FROM workspace_connections': [{ tenant_id: 'ten_a', connection_id: 'wsc_a', connection_revision: 3, status: 'active', workspace_id: 'w', app_id: 'a', granted_scopes: ['chat:write'] }]
        });
        const repository = new MultitenantPostgresRepository({ pool });
        await expect(repository.validateConnectionRevision({ tenant_id: 'ten_a', connection_id: 'wsc_a', expected_connection_revision: '3' })).resolves.toMatchObject({ authoritative: true, connection_revision: '3' });
        expect(client.query).toHaveBeenCalledWith("SELECT set_config('brainbase.tenant_id', $1, true)", ['ten_a']);
        expect(client.query.mock.calls.some(([sql]) => sql.includes('FOR SHARE'))).toBe(true);
        expect(client.query.mock.calls.some(([sql]) => sql.includes('JOIN credential_broker_refs cbr'))).toBe(true);
        expect(client.query.mock.calls.some(([sql]) => sql.includes('FOR SHARE OF wc, cbr'))).toBe(true);
        expect(client.query.mock.calls.some(([sql]) => sql.includes('cbr.credential_ref AS credential_ref'))).toBe(true);
        expect(client.query.mock.calls.every(([sql]) => !sql.includes('AND cbr.credential_ref = wc.credential_ref'))).toBe(true);
        expect(client.query).toHaveBeenCalledWith('COMMIT');
        expect(client.release).toHaveBeenCalled();
    });

    it('D-003: runtime contextのtenant・connection・contract revisionを単一transactionで固定する', async () => {
        const { pool, client } = poolWithRows({
            'FROM workspace_connections': [{
                tenant_id: 'ten_a', connection_id: 'wsc_a', connection_revision: 3,
                status: 'active', workspace_id: 'w', app_id: 'a', granted_scopes: ['chat:write'],
                credential_ref: 'credref:a', credential_mode: 'customer_oauth'
            }],
            'FROM brainbase_tenants': [{ tenant_id: 'ten_a', tenant_revision: 4, status: 'active' }],
            'FROM tenant_contract_revisions': [{ contract_revision: 5 }]
        });
        const repository = new MultitenantPostgresRepository({ pool });

        await expect(repository.resolveRuntimeContext({
            tenant_id: 'ten_a', expected_tenant_revision: '4', connection_id: 'wsc_a',
            expected_connection_revision: '3', workspace_id: 'w', app_id: 'a',
            authorization: { capability_ids: ['chat:write'] }
        })).resolves.toMatchObject({ contract_revision: '5' });
        expect(pool.connect).toHaveBeenCalledTimes(1);
        expect(client.query.mock.calls.filter(([sql]) => sql === 'BEGIN')).toHaveLength(1);
    });

    it('D-005: OAuth refresh CASはexpected revision一致時だけ更新する', async () => {
        const success = poolWithRows({ 'UPDATE credential_broker_refs': [{ credential_ref: 'ref:new', refresh_revision: 5 }] });
        const repository = new MultitenantPostgresRepository({ pool: success.pool });
        await expect(repository.compareAndSwapRefresh({ tenant_id: 'ten_a', credential_ref: 'ref:old', expected_refresh_revision: '4', new_credential_ref: 'ref:new' })).resolves.toMatchObject({ refresh_revision: '5' });

        const conflict = poolWithRows({ 'UPDATE credential_broker_refs': [] });
        const conflictRepository = new MultitenantPostgresRepository({ pool: conflict.pool });
        await expectContractErrorAsync(
            () => conflictRepository.compareAndSwapRefresh({ tenant_id: 'ten_a', credential_ref: 'ref:old', expected_refresh_revision: '4', new_credential_ref: 'ref:new' }),
            { code: 'OAUTH_REFRESH_CONFLICT' }
        );
    });

    it('P0-1/D-005: lease token digestと全bindingを保存しglobal single-useで消費する', async () => {
        const binding = {
            lease_id: 'lease_a', tenant_id: 'ten_a', connection_id: 'wsc_a', connection_revision: '3',
            credential_ref: 'credref:a', credential_mode: 'customer_oauth', contract_revision: '11',
            operation_id: 'op_a', audience: 'api.openai.com', provider: 'openai',
            lease_token_digest: `sha256:${'a'.repeat(64)}`, issued_at: '2026-08-18T00:00:00Z',
            expires_at: '2026-08-18T00:01:00Z', max_uses: 1
        };
        const { pool, client } = poolWithRows({
            'INSERT INTO tenant_credential_leases': [{ lease_id: 'lease_a' }],
            'FROM tenant_credential_leases AS lease': [{ ...binding, consumed_at: null }],
            'UPDATE tenant_credential_leases': [{ lease_id: 'lease_a' }]
        });
        const repository = new MultitenantPostgresRepository({
            pool,
            now: () => new Date('2026-08-18T00:00:30Z')
        });

        await expect(repository.issueCredentialLease(binding)).resolves.toMatchObject({ lease_id: 'lease_a' });
        await expect(repository.consumeCredentialLease({
            ...binding,
            provider: undefined,
            issued_at: undefined,
            expires_at: undefined,
            max_uses: undefined,
            consumed_at: '2026-08-18T00:00:30Z'
        })).resolves.toMatchObject({ lease_id: 'lease_a', provider: 'openai' });
        expect(client.query.mock.calls.some(([sql]) => sql.includes('FOR UPDATE OF lease'))).toBe(true);
        expect(client.query.mock.calls.some(([sql]) => sql.includes('lease_token_digest'))).toBe(true);
        expect(client.query.mock.calls.some(([sql]) => sql.includes('consumed_at IS NULL'))).toBe(true);
        expect(client.query.mock.calls.every(([, params = []]) => (
            !params.includes('opaque-token-must-not-be-stored')
        ))).toBe(true);
    });

    it('D-006/AC-202: claim conflict時はpayload/context hash差分を追加副作用なしで拒否する', async () => {
        const { pool } = poolWithRows({
            'INSERT INTO tenant_business_effect_claims': [],
            'FROM tenant_business_effect_claims': [{ idempotency_key: 'ik1_x', payload_hash: 'old', context_hash: 'context', claim_state: 'claimed' }]
        });
        const repository = new MultitenantPostgresRepository({ pool });
        await expectContractErrorAsync(
            () => repository.claimBusinessEffect({
                connection_revision: '7',
                claim: {
                    tenant_id: 'ten_a', connection_id: 'wsc_a', operation_id: 'op_a', idempotency_key: 'ik1_x',
                    payload_hash: 'new', context_hash: 'context', owner: 'brainbase', scope: 'business_effect',
                    slack_event_id: 'Ev-A', state: 'claimed', retention_until: '2026-09-16T00:00:00Z'
                }
            }),
            { code: 'IDEMPOTENCY_CONFLICT' }
        );
    });

    it('D-006: contract revisionをauthoritativeに読みcanonical stringへ正規化する', async () => {
        const { pool, client } = poolWithRows({
            'FROM tenant_contract_revisions': [{
                tenant_id: 'ten_a', contract_id: 'ctr_a', contract_revision: 11,
                allowances: { model_tokens: 1000 }, thresholds_basis_points: [8000, 10000],
                overage_policy: 'deny', hard_stop_basis_points: 10000,
                rate_card_revision: 8, fx_table_revision: 5, sales_price_revision: 3,
                runtime_capabilities: ['signed_tenant_context', 'tenant_scoped_authorization'],
                runtime_audience: ['mana-runtime'], runtime_deployment_id: 'dep_a', runtime_profile: 'shared_cloud'
            }]
        });
        const repository = new MultitenantPostgresRepository({ pool });

        await expect(repository.loadContractRevision({ tenant_id: 'ten_a', contract_revision: '11' }))
            .resolves.toMatchObject({
                contract_revision: '11', rate_card_revision: 8, fx_table_revision: 5, sales_price_revision: 3,
                runtime_binding: {
                    capabilities: ['signed_tenant_context', 'tenant_scoped_authorization'],
                    audience: ['mana-runtime'], deployment_id: 'dep_a', profile: 'shared_cloud'
                }
            });
        expect(client.query.mock.calls.some(([sql]) => sql.includes('FOR SHARE'))).toBe(true);
    });

    it('D-006/D-007: canonical quota・usage・receipt payloadをtenant RLS transactionで保存する', async () => {
        const quota = { message_type: 'quota_decision', tenant_id: 'ten_a', contract_revision: '11', quota_revision: '19' };
        const usage = {
            message_type: 'usage_event', usage_event_id: 'usage_a', protocol_version: '1.0', tenant_id: 'ten_a',
            connection_id: 'wsc_a', connection_revision: '7', contract_revision: '11', deployment_id: 'dep_a',
            correlation_id: 'cor_a', operation_id: 'op_a', idempotency_key: 'ik1_a', kind: 'model_tokens',
            quantity: null, unit: 'tokens', outcome: 'timed_out', collection_state: 'not_collected',
            failure_code: 'UPSTREAM_TIMEOUT', unknown_fields: ['quantity'], observed_at: '2026-08-16T00:00:00Z'
        };
        const receipt = {
            message_type: 'operation_receipt', receipt_id: 'receipt_a', protocol_version: '1.0', tenant_id: 'ten_a',
            connection_id: 'wsc_a', connection_revision: '7', contract_revision: '11', deployment_id: 'dep_a',
            correlation_id: 'cor_a', operation_ids: ['op_a'], idempotency_keys: ['ik1_a'], actor_principal_id: 'person-a',
            project_id: null, capability_id: 'task.read', quota_decision: 'allowed', credential_mode: 'customer_oauth',
            collection_state: 'partial', outcome: 'failed', failure_code: 'UPSTREAM_PARTIAL', usage_event_ids: ['usage_a'],
            reply: { state: 'failed', reply_count: 0, legacy_reply_count: 0 }, completed_at: '2026-08-16T00:00:01Z'
        };
        const { pool, client } = poolWithRows({
            'INSERT INTO tenant_quota_decisions': [{ decision_payload: quota }],
            'INSERT INTO tenant_usage_events': [{ event_payload: usage }],
            'INSERT INTO tenant_operation_receipts': [{ receipt_payload: receipt }]
        });
        const repository = new MultitenantPostgresRepository({ pool });

        await expect(repository.recordQuotaDecision(quota, { idempotency_key: 'ik1_a', metric: 'model_tokens' })).resolves.toEqual(quota);
        await expect(repository.recordUsage(usage)).resolves.toEqual(usage);
        await expect(repository.finalizeReceipt(receipt)).resolves.toEqual(receipt);
        expect(client.query.mock.calls.some(([sql]) => sql.includes('decision_payload'))).toBe(true);
        expect(client.query.mock.calls.some(([sql]) => sql.includes('event_payload'))).toBe(true);
        const usageInsert = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO tenant_usage_events'))?.[0];
        expect(usageInsert).toContain('ON CONFLICT (usage_event_id)');
        expect(usageInsert).not.toContain('ON CONFLICT (tenant_id, idempotency_key)');
        expect(client.query.mock.calls.some(([sql]) => sql.includes('receipt_payload'))).toBe(true);
        for (const [sql, params] of client.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO tenant_'))) {
            const indexes = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
            expect(Math.max(...indexes), sql).toBe(params.length);
        }
    });

    it('AC-205: canonical Receiptと価格snapshotを同一transactionで保存しtenant限定historyを返す', async () => {
        const receipt = {
            receipt_id: 'receipt_a', tenant_id: 'ten_a', protocol_version: '1.0', connection_id: 'wsc_a',
            connection_revision: '7', contract_revision: '11', deployment_id: 'dep_a', correlation_id: 'cor_a',
            operation_ids: ['op_a'], idempotency_keys: ['ik1_a'], actor_principal_id: 'person-a', project_id: null,
            capability_id: 'task.read', quota_decision: 'allowed', credential_mode: 'customer_oauth', outcome: 'failed',
            collection_state: 'partial', failure_code: 'UPSTREAM_PARTIAL', usage_event_ids: [],
            reply: { state: 'failed', reply_count: 0, legacy_reply_count: 0 }, completed_at: '2026-08-16T00:00:01Z'
        };
        const pricingSnapshot = {
            rate_card_revision: '8', fx_table_revision: '5', sales_price_revision: '3', purchase_currency: 'USD',
            purchase_minor_units: null, billing_currency: 'JPY', billing_minor_units: null,
            fx_rate_decimal: '150.1234', effective_at: '2026-08-16T00:00:01Z'
        };
        const { pool, client } = poolWithRows({
            'INSERT INTO tenant_operation_receipts': [{ receipt_payload: receipt }],
            'INSERT INTO tenant_receipt_pricing_snapshots': [{ pricing_payload: pricingSnapshot }],
            'SELECT r.receipt_payload': [{ receipt_payload: receipt, pricing_payload: pricingSnapshot }]
        });
        const repository = new MultitenantPostgresRepository({ pool });

        await expect(repository.finalizeReceiptWithPricing({ receipt, pricing_snapshot: pricingSnapshot }))
            .resolves.toEqual({ receipt, pricing_snapshot: pricingSnapshot });
        await expect(repository.readReceiptHistory({ tenant_id: 'ten_a', receipt_id: 'receipt_a' }))
            .resolves.toEqual([{ receipt, pricing_snapshot: pricingSnapshot }]);
        expect(client.query.mock.calls.filter(([sql]) => sql === 'BEGIN')).toHaveLength(2);
        const finalizeBegin = client.query.mock.calls.findIndex(([sql]) => sql === 'BEGIN');
        const receiptInsert = client.query.mock.calls.findIndex(([sql]) => sql.includes('INSERT INTO tenant_operation_receipts'));
        const pricingInsert = client.query.mock.calls.findIndex(([sql]) => sql.includes('INSERT INTO tenant_receipt_pricing_snapshots'));
        const finalizeCommit = client.query.mock.calls.findIndex(([sql]) => sql === 'COMMIT');
        expect(finalizeBegin).toBeLessThan(receiptInsert);
        expect(receiptInsert).toBeLessThan(pricingInsert);
        expect(pricingInsert).toBeLessThan(finalizeCommit);
    });
});
