import { createHash } from 'node:crypto';
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

const CLAIM_INTENT = Object.freeze({
    installation_intent_id: 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX',
    app_id: 'A0123456789',
    expected_workspace_id: 'T0123456789',
    expected_enterprise_id: null,
    initiated_by_person_id: 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY',
    expected_connection_revision: null
});

function digest(value) {
    return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function claimPool(ledger) {
    return poolWithRows({
        'FROM slack_installation_intents': [{
            ...CLAIM_INTENT,
            issued_at: '2026-08-19T00:00:00.000Z',
            expires_at: '2026-08-19T00:10:00.000Z',
            consumed_at: null
        }],
        'FROM slack_installation_exchange_ledger': [ledger]
    });
}

const QUOTA_INPUT = Object.freeze({
    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX',
    contract_revision: '11',
    metric: 'model_tokens',
    requested_quantity: 10,
    idempotency_key: 'ik1_01ARZ3NDEKTSV4RRFFQ69G5FAV'
});

function quotaContract({ allowance = 100 } = {}) {
    return {
        tenant_id: QUOTA_INPUT.tenant_id,
        contract_id: 'ctr_01ARZ3NDEKTSV4RRFFQ69G5FAY',
        contract_revision: QUOTA_INPUT.contract_revision,
        allowances: { model_tokens: allowance },
        quota_window_policy: { kind: 'calendar_month', timezone: 'UTC' },
        thresholds_basis_points: [8000, 10000],
        overage_policy: 'deny',
        hard_stop_basis_points: 10000,
        rate_card_revision: 8,
        fx_table_revision: 5,
        sales_price_revision: 3,
        runtime_capabilities: ['signed_tenant_context'],
        runtime_audience: ['mana-runtime'],
        runtime_deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
        runtime_profile: 'shared_cloud'
    };
}

function quotaPool({ now = '2026-08-22T01:00:00.000Z', allowance = 100, legacyCount = 0, aggregateUsedValue } = {}) {
    const state = {
        contract: quotaContract({ allowance }),
        stored: new Map(),
        used: 0,
        legacyCount,
        inserted: []
    };
    let lockHeld = false;
    const lockWaiters = [];
    const releaseLock = () => {
        const next = lockWaiters.shift();
        if (next) {
            lockHeld = true;
            next();
        } else {
            lockHeld = false;
        }
    };
    const query = vi.fn(async (sql, values = []) => {
        const text = String(sql);
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK'
            || text.startsWith("SELECT set_config('brainbase.tenant_id'")) {
            if (text === 'COMMIT' || text === 'ROLLBACK') releaseLock();
            return { rows: [] };
        }
        if (text.includes('pg_advisory_xact_lock')) {
            if (!lockHeld) {
                lockHeld = true;
                return { rows: [] };
            }
            await new Promise((resolve) => lockWaiters.push(resolve));
            return { rows: [] };
        }
        if (text.includes('SELECT contract_revision, quota_revision, metric, decision,')) {
            const existing = state.stored.get(values[1]);
            return { rows: existing ? [existing] : [] };
        }
        if (text.includes('FROM tenant_contract_revisions AS tcr')) {
            return { rows: [state.contract] };
        }
        if (text.includes('COALESCE(SUM(requested_value)')) {
            return {
                rows: [{
                    used_value: aggregateUsedValue === undefined ? state.used : aggregateUsedValue,
                    legacy_count: state.legacyCount
                }]
            };
        }
        if (text.includes('INSERT INTO tenant_quota_decisions')) {
            if (state.stored.has(values[3])) return { rows: [] };
            const payload = JSON.parse(values[16]);
            const row = {
                contract_revision: values[1],
                quota_revision: values[2],
                metric: values[4],
                decision: values[5],
                limit_value: values[6],
                used_value: values[7],
                remaining_value: values[8],
                decision_payload: payload,
                requested_value: values[9],
                unit: values[10],
                window_started_at: values[11],
                window_ends_at: values[12],
                decided_at: values[13],
                failure_code: values[14],
                request_fingerprint: values[15]
            };
            state.stored.set(values[3], row);
            state.inserted.push(row);
            if (['allowed', 'warning'].includes(payload.decision)) state.used += Number(values[9]);
            return { rows: [row] };
        }
        return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    return {
        state,
        client,
        pool: { connect: vi.fn(async () => client) },
        now: () => new Date(now)
    };
}

describe('MultitenantPostgresRepository', () => {
    it('keeps the original request digest across failed retries and rejects a changed OAuth request', async () => {
        const claimToken = 'claim-token-same-request';
        const requestDigest = digest('oauth-code-one');
        const sameRequest = claimPool({
            status: 'failed', request_digest: requestDigest, response_payload: null,
            claimed_at: null, attempt: 1
        });
        const sameRepository = new MultitenantPostgresRepository({ pool: sameRequest.pool });

        await expect(sameRepository.claimSlackInstallationExchange({
            intent: CLAIM_INTENT,
            request_digest: requestDigest,
            claim_token: claimToken,
            now: '2026-08-19T00:01:00.000Z'
        })).resolves.toMatchObject({ status: 'claimed', attempt: 2 });

        const changedRequest = claimPool({
            status: 'failed', request_digest: requestDigest, response_payload: null,
            claimed_at: null, attempt: 1
        });
        const changedRepository = new MultitenantPostgresRepository({ pool: changedRequest.pool });
        await expectContractErrorAsync(
            () => changedRepository.claimSlackInstallationExchange({
                intent: CLAIM_INTENT,
                request_digest: digest('oauth-code-two'),
                claim_token: 'claim-token-changed-request',
                now: '2026-08-19T00:01:00.000Z'
            }),
            { code: 'INSTALLATION_CLAIM_STALE', status: 409 }
        );
        expect(changedRequest.client.query.mock.calls.some(([sql]) => sql.includes('UPDATE slack_installation_exchange_ledger')))
            .toBe(false);

        const completedRequest = claimPool({
            status: 'completed', request_digest: requestDigest,
            response_payload: { status: 'completed' }, claimed_at: null, attempt: 1
        });
        const completedRepository = new MultitenantPostgresRepository({ pool: completedRequest.pool });
        await expectContractErrorAsync(
            () => completedRepository.claimSlackInstallationExchange({
                intent: CLAIM_INTENT,
                request_digest: digest('oauth-code-two'),
                claim_token: 'claim-token-replay',
                now: '2026-08-19T00:01:00.000Z'
            }),
            { code: 'INSTALLATION_CLAIM_STALE', status: 409 }
        );
    });

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
            'FROM workspace_connections': [{
                tenant_id: 'ten_a', connection_id: 'wsc_a', connection_revision: 3,
                status: 'active', provider: 'slack', installation_id: 'slack:app:w',
                workspace_id: 'w', app_id: 'a', granted_scopes: ['chat:write'],
                credential_ref: 'credref:a', current_credential_ref: 'credref:a',
                credential_mode: 'customer_oauth',
                connection_snapshot: {
                    provider: 'slack', installation_id: 'slack:app:w', workspace_id: 'w',
                    app_id: 'a', granted_scopes: ['chat:write'], status: 'active',
                    credential_ref: 'credref:a'
                }
            }]
        });
        const repository = new MultitenantPostgresRepository({ pool });
        await expect(repository.validateConnectionRevision({ tenant_id: 'ten_a', connection_id: 'wsc_a', expected_connection_revision: '3' })).resolves.toMatchObject({ authoritative: true, connection_revision: '3' });
        expect(client.query).toHaveBeenCalledWith("SELECT set_config('brainbase.tenant_id', $1, true)", ['ten_a']);
        expect(client.query.mock.calls.some(([sql]) => sql.includes('FOR SHARE'))).toBe(true);
        expect(client.query.mock.calls.some(([sql]) => sql.includes('JOIN workspace_connection_revisions revision')
            && sql.includes('revision.connection_revision = wc.connection_revision'))).toBe(true);
        expect(client.query.mock.calls.some(([sql]) => sql.includes('JOIN credential_broker_refs cbr'))).toBe(true);
        expect(client.query.mock.calls.some(([sql]) => sql.includes('FOR SHARE OF wc, revision, cbr'))).toBe(true);
        expect(client.query.mock.calls.some(([sql]) => sql.includes('cbr.credential_ref AS credential_ref'))).toBe(true);
        expect(client.query.mock.calls.every(([sql]) => !sql.includes('AND cbr.credential_ref = wc.credential_ref'))).toBe(true);
        expect(client.query).toHaveBeenCalledWith('COMMIT');
        expect(client.release).toHaveBeenCalled();
    });

    it('D-003: runtime contextのtenant・connection・contract revisionを単一transactionで固定する', async () => {
        const { pool, client } = poolWithRows({
            'FROM workspace_connections': [{
                tenant_id: 'ten_a', connection_id: 'wsc_a', connection_revision: 3,
                status: 'active', provider: 'slack', installation_id: 'slack:app:w',
                workspace_id: 'w', app_id: 'a', granted_scopes: ['chat:write'],
                credential_ref: 'credref:a', current_credential_ref: 'credref:a',
                credential_mode: 'customer_oauth',
                connection_snapshot: {
                    provider: 'slack', installation_id: 'slack:app:w', workspace_id: 'w',
                    app_id: 'a', granted_scopes: ['chat:write'], status: 'active',
                    credential_ref: 'credref:a'
                }
            }],
            'FROM brainbase_tenants': [{ tenant_id: 'ten_a', tenant_revision: 4, status: 'active' }],
            'FROM tenant_contract_revisions': [{ contract_revision: 5 }]
        });
        const repository = new MultitenantPostgresRepository({ pool });

        await expect(repository.resolveRuntimeContext({
            tenant_id: 'ten_a', expected_tenant_revision: '4', connection_id: 'wsc_a',
            expected_connection_revision: '3', workspace_id: 'w', app_id: 'a',
            authorization: { capability_ids: ['runtime.execute'] },
            required_connection_scopes: ['chat:write']
        })).resolves.toMatchObject({ contract_revision: '5' });
        expect(pool.connect).toHaveBeenCalledTimes(1);
        expect(client.query.mock.calls.filter(([sql]) => sql === 'BEGIN')).toHaveLength(1);
    });

    it('rejects a missing or mismatched immutable connection snapshot during runtime readback', async () => {
        const missing = poolWithRows({ 'FROM workspace_connections': [] });
        const missingRepository = new MultitenantPostgresRepository({ pool: missing.pool });
        await expectContractErrorAsync(
            () => missingRepository.validateConnectionRevision({
                tenant_id: 'ten_a', connection_id: 'wsc_a', expected_connection_revision: '3'
            }),
            { code: 'WORKSPACE_CONNECTION_UNAVAILABLE', status: 503 }
        );

        const mismatched = poolWithRows({
            'FROM workspace_connections': [{
                tenant_id: 'ten_a', connection_id: 'wsc_a', connection_revision: 3,
                status: 'active', provider: 'slack', installation_id: 'slack:app:w',
                workspace_id: 'w', app_id: 'a', granted_scopes: ['chat:write'],
                current_credential_ref: 'credref:a', credential_ref: 'credref:a',
                credential_mode: 'customer_oauth',
                connection_snapshot: {
                    provider: 'slack', installation_id: 'slack:app:w', workspace_id: 'other',
                    app_id: 'a', granted_scopes: ['chat:write'], status: 'active',
                    credential_ref: 'credref:a'
                }
            }]
        });
        const mismatchedRepository = new MultitenantPostgresRepository({ pool: mismatched.pool });
        await expectContractErrorAsync(
            () => mismatchedRepository.validateConnectionRevision({
                tenant_id: 'ten_a', connection_id: 'wsc_a', expected_connection_revision: '3'
            }),
            { code: 'WORKSPACE_CONNECTION_STALE_REVISION', status: 409 }
        );
    });

    it('inserts the immutable initial snapshot before creating the current connection pointer', async () => {
        const claimToken = 'claim-token-register';
        const requestDigest = digest('register-request');
        const responsePayload = { status: 'active', connection_revision: '1' };
        const registerIntent = { ...CLAIM_INTENT };
        delete registerIntent.expected_connection_revision;
        const query = vi.fn(async (sql) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK'
                || sql.startsWith("SELECT set_config('brainbase.tenant_id'")) return { rows: [] };
            if (sql.includes('FROM slack_installation_intents')) {
                return {
                    rows: [{
                        ...CLAIM_INTENT,
                        issued_at: '2026-08-19T00:00:00.000Z',
                        expires_at: '2026-08-19T00:10:00.000Z',
                        consumed_at: null
                    }]
                };
            }
            if (sql.includes('FROM slack_installation_exchange_ledger')) {
                return {
                    rows: [{
                        request_digest: requestDigest,
                        status: 'processing',
                        connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
                        connection_revision: 1,
                        response_payload: null,
                        claim_token_hash: digest(claimToken)
                    }]
                };
            }
            if (sql.includes('FROM brainbase_tenants')) return { rows: [{ tenant_revision: 1, status: 'active' }] };
            if (sql.includes('FROM tenant_contract_revisions')) {
                return { rows: [{ contract_revision: 11, deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FB2', profile: 'shared_cloud' }] };
            }
            if (sql.includes('FROM workspace_connections')) return { rows: [] };
            if (sql.includes('UPDATE slack_installation_exchange_ledger')) return { rows: [{ response_payload: responsePayload }] };
            return { rows: [] };
        });
        const client = { query, release: vi.fn() };
        const repository = new MultitenantPostgresRepository({ pool: { connect: vi.fn(async () => client) } });

        await expect(repository.registerSlackInstallation({
            intent: registerIntent,
            exchange: {
                installation_id: 'slack:A0123456789:T0123456789',
                workspace_id: 'T0123456789',
                enterprise_id: null,
                installer_id: 'U0123456789',
                granted_scopes: ['commands', 'chat:write']
            },
            credential: { credential_ref: 'credref:a', credential_mode: 'customer_oauth', refresh_revision: 1 },
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
            connection_revision: '1',
            claim_token: claimToken,
            request_digest: requestDigest,
            now: '2026-08-19T00:01:00.000Z'
        })).resolves.toEqual(responsePayload);

        const statements = query.mock.calls.map(([sql]) => sql);
        const snapshotInsert = statements.findIndex((sql) => sql.includes('INSERT INTO workspace_connection_revisions'));
        const currentInsert = statements.findIndex((sql) => sql.includes('INSERT INTO workspace_connections'));
        expect(snapshotInsert).toBeGreaterThan(-1);
        expect(currentInsert).toBeGreaterThan(-1);
        expect(snapshotInsert).toBeLessThan(currentInsert);
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

    it('quota authorityはtenant lockからreplay・contract/window・SUM・insertの順で同一transactionに実行する', async () => {
        const quota = quotaPool();
        const repository = new MultitenantPostgresRepository({ pool: quota.pool, now: quota.now });

        await expect(repository.decideQuota(QUOTA_INPUT)).resolves.toMatchObject({
            decision: 'allowed',
            used: 0,
            remaining: 90,
            window_started_at: '2026-08-01T00:00:00.000Z',
            window_ends_at: '2026-09-01T00:00:00.000Z'
        });

        const statements = quota.client.query.mock.calls.map(([sql]) => String(sql));
        const lock = statements.findIndex((sql) => sql.includes('pg_advisory_xact_lock'));
        const replay = statements.findIndex((sql) => sql.includes('SELECT contract_revision, quota_revision, metric, decision,'));
        const contract = statements.findIndex((sql) => sql.includes('FROM tenant_contract_revisions AS tcr'));
        const aggregate = statements.findIndex((sql) => sql.includes('COALESCE(SUM(requested_value)'));
        const insert = statements.findIndex((sql) => sql.includes('INSERT INTO tenant_quota_decisions'));
        expect(lock).toBeGreaterThan(-1);
        expect(replay).toBeGreaterThan(lock);
        expect(contract).toBeGreaterThan(replay);
        expect(aggregate).toBeGreaterThan(contract);
        expect(insert).toBeGreaterThan(aggregate);
        expect(statements[lock]).toContain('hashtextextended');
        expect(statements[insert]).toContain('ON CONFLICT (tenant_id, idempotency_key) DO NOTHING');
    });

    it('同一idempotencyは同じfingerprintならdecisionをreplayし、異なるrequestは409で停止する', async () => {
        const quota = quotaPool();
        const repository = new MultitenantPostgresRepository({ pool: quota.pool, now: quota.now });
        const first = await repository.decideQuota(QUOTA_INPUT);
        const replay = await repository.decideQuota(QUOTA_INPUT);

        expect(replay).toEqual(first);
        expect(quota.state.inserted).toHaveLength(1);
        expect(quota.client.query.mock.calls.filter(([sql]) => String(sql).includes('FROM tenant_contract_revisions AS tcr')))
            .toHaveLength(1);
        expect(quota.client.query.mock.calls.filter(([sql]) => String(sql).includes('COALESCE(SUM(requested_value)')))
            .toHaveLength(1);

        await expectContractErrorAsync(
            () => repository.decideQuota({ ...QUOTA_INPUT, requested_quantity: 11 }),
            { code: 'IDEMPOTENCY_CONFLICT', status: 409 }
        );
        expect(quota.state.inserted).toHaveLength(1);
    });

    it.each([
        ['requested_value', -1],
        ['metric', 'other_metric'],
        ['decision', 'warning'],
        ['limit_value', 999],
        ['request_fingerprint', 'not-a-sha256-digest']
    ])('保存済みquota列 %s がrequest/payloadと不整合なら503でfail closedする', async (field, value) => {
        const quota = quotaPool();
        const repository = new MultitenantPostgresRepository({ pool: quota.pool, now: quota.now });
        await repository.decideQuota(QUOTA_INPUT);
        quota.state.stored.get(QUOTA_INPUT.idempotency_key)[field] = value;

        await expectContractErrorAsync(
            () => repository.decideQuota(QUOTA_INPUT),
            { code: 'UPSTREAM_UNAVAILABLE', status: 503 }
        );
        expect(quota.state.inserted).toHaveLength(1);
    });

    it('legacy requested_value NULLを0として扱わず503でfail closedし、insertしない', async () => {
        const quota = quotaPool({ legacyCount: 1 });
        const repository = new MultitenantPostgresRepository({ pool: quota.pool, now: quota.now });

        await expectContractErrorAsync(
            () => repository.decideQuota(QUOTA_INPUT),
            { code: 'UPSTREAM_UNAVAILABLE', status: 503 }
        );
        expect(quota.state.inserted).toHaveLength(0);
        expect(quota.client.query.mock.calls.map(([sql]) => String(sql))).not.toContain('COMMIT');
    });

    it('aggregate usageがNULL/unknownなら0へ丸めず503で停止する', async () => {
        const quota = quotaPool({ aggregateUsedValue: null });
        const repository = new MultitenantPostgresRepository({ pool: quota.pool, now: quota.now });

        await expectContractErrorAsync(
            () => repository.decideQuota(QUOTA_INPUT),
            { code: 'UPSTREAM_UNAVAILABLE', status: 503 }
        );
        expect(quota.state.inserted).toHaveLength(0);
    });

    it('allowance missingは0へ丸めず503で停止する', async () => {
        const quota = quotaPool({ allowance: null });
        quota.state.contract.allowances = {};
        const repository = new MultitenantPostgresRepository({ pool: quota.pool, now: quota.now });

        await expectContractErrorAsync(
            () => repository.decideQuota(QUOTA_INPUT),
            { code: 'UPSTREAM_UNAVAILABLE', status: 503 }
        );
        expect(quota.state.inserted).toHaveLength(0);
    });

    it('hard_stoppedは同windowのallowed/warning集計へ予約量を加算しない', async () => {
        const quota = quotaPool({ allowance: 100 });
        const repository = new MultitenantPostgresRepository({ pool: quota.pool, now: quota.now });
        const stopped = await repository.decideQuota({ ...QUOTA_INPUT, requested_quantity: 101 });
        const next = await repository.decideQuota({
            ...QUOTA_INPUT,
            idempotency_key: 'ik1_01ARZ3NDEKTSV4RRFFQ69G5FB2',
            requested_quantity: 1
        });

        expect(stopped.decision).toBe('hard_stopped');
        expect(next).toMatchObject({ decision: 'allowed', used: 0, remaining: 99 });
        expect(quota.state.used).toBe(1);
        expect(quota.state.inserted).toHaveLength(2);
    });

    it('calendar_month UTCはserver nowから月境界を導出しcaller windowを受け付けない', async () => {
        const quota = quotaPool({ now: '2026-09-01T00:00:00.000Z' });
        const repository = new MultitenantPostgresRepository({ pool: quota.pool, now: quota.now });

        await expect(repository.decideQuota(QUOTA_INPUT)).resolves.toMatchObject({
            window_started_at: '2026-09-01T00:00:00.000Z',
            window_ends_at: '2026-10-01T00:00:00.000Z'
        });
        const aggregateCall = quota.client.query.mock.calls.find(([sql]) => String(sql).includes('COALESCE(SUM(requested_value)'));
        expect(aggregateCall[1].slice(-2)).toEqual([
            '2026-09-01T00:00:00.000Z',
            '2026-10-01T00:00:00.000Z'
        ]);

        await expectContractErrorAsync(
            () => repository.decideQuota({ ...QUOTA_INPUT, window_started_at: '2026-09-01T00:00:00Z' }),
            { code: 'QUOTA_INPUT_INVALID', status: 400 }
        );
    });

    it('advisory lock下の並行2要求は累計usedを進め、二重allowedを返さない', async () => {
        const quota = quotaPool({ allowance: 10 });
        const repository = new MultitenantPostgresRepository({ pool: quota.pool, now: quota.now });
        const [first, second] = await Promise.all([
            repository.decideQuota({ ...QUOTA_INPUT, requested_quantity: 6 }),
            repository.decideQuota({
                ...QUOTA_INPUT,
                idempotency_key: 'ik1_01ARZ3NDEKTSV4RRFFQ69G5FB2',
                requested_quantity: 6
            })
        ]);

        expect(first.decision).toBe('allowed');
        expect(second.decision).toBe('hard_stopped');
        expect(second.used).toBe(6);
        expect(quota.state.used).toBe(6);
        expect(quota.state.inserted).toHaveLength(2);
    });

    it.each([
        ['observed_quantity', 0],
        ['used_quantity', 0],
        ['window_started_at', '2026-08-01T00:00:00Z']
    ])('repositoryはcaller supplied %sをQUOTA_INPUT_INVALIDで拒否する', async (field, value) => {
        const quota = quotaPool();
        const repository = new MultitenantPostgresRepository({ pool: quota.pool, now: quota.now });

        await expectContractErrorAsync(
            () => repository.decideQuota({ ...QUOTA_INPUT, [field]: value }),
            { code: 'QUOTA_INPUT_INVALID', status: 400 }
        );
        expect(quota.pool.connect).not.toHaveBeenCalled();
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
        const contractQuery = client.query.mock.calls.find(([sql]) => sql.includes('FROM tenant_contract_revisions'))?.[0];
        expect(contractQuery).toBeDefined();
        expect(contractQuery).toMatch(/SELECT\s+tcr\.tenant_id,\s*tcr\.contract_id,\s*tcr\.contract_revision,/u);
        expect(contractQuery).toContain('FROM tenant_contract_revisions AS tcr');
        expect(contractQuery).toContain('FOR SHARE OF tcr, rb');
    });

    it('D-006/D-007: canonical usage・receipt payloadをtenant RLS transactionで保存する', async () => {
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
            'INSERT INTO tenant_usage_events': [{ event_payload: usage }],
            'INSERT INTO tenant_operation_receipts': [{ receipt_payload: receipt }]
        });
        const repository = new MultitenantPostgresRepository({ pool });

        await expect(repository.recordUsage(usage)).resolves.toEqual(usage);
        await expect(repository.finalizeReceipt(receipt)).resolves.toEqual(receipt);
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
