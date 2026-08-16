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
    it('AC-005/D-003: transaction-local tenant RLSを設定しauthoritative revisionをlock付きで読む', async () => {
        const { pool, client } = poolWithRows({
            'FROM workspace_connections': [{ tenant_id: 'ten_a', connection_id: 'wsc_a', connection_revision: 3, status: 'active', workspace_id: 'w', app_id: 'a', granted_scopes: ['chat:write'] }]
        });
        const repository = new MultitenantPostgresRepository({ pool });
        await expect(repository.validateConnectionRevision({ tenant_id: 'ten_a', connection_id: 'wsc_a', expected_connection_revision: 3 })).resolves.toMatchObject({ authoritative: true, connection_revision: 3 });
        expect(client.query).toHaveBeenCalledWith("SELECT set_config('brainbase.tenant_id', $1, true)", ['ten_a']);
        expect(client.query.mock.calls.some(([sql]) => sql.includes('FOR SHARE'))).toBe(true);
        expect(client.query).toHaveBeenCalledWith('COMMIT');
        expect(client.release).toHaveBeenCalled();
    });

    it('D-005: OAuth refresh CASはexpected revision一致時だけ更新する', async () => {
        const success = poolWithRows({ 'UPDATE credential_broker_refs': [{ credential_ref: 'ref:new', refresh_revision: 5 }] });
        const repository = new MultitenantPostgresRepository({ pool: success.pool });
        await expect(repository.compareAndSwapRefresh({ tenant_id: 'ten_a', credential_ref: 'ref:old', expected_refresh_revision: 4, new_credential_ref: 'ref:new' })).resolves.toMatchObject({ refresh_revision: 5 });

        const conflict = poolWithRows({ 'UPDATE credential_broker_refs': [] });
        const conflictRepository = new MultitenantPostgresRepository({ pool: conflict.pool });
        await expectContractErrorAsync(
            () => conflictRepository.compareAndSwapRefresh({ tenant_id: 'ten_a', credential_ref: 'ref:old', expected_refresh_revision: 4, new_credential_ref: 'ref:new' }),
            { code: 'OAUTH_REFRESH_CONFLICT' }
        );
    });

    it('D-006: claim conflict時はpayload/context hash差分を追加副作用なしで拒否する', async () => {
        const { pool } = poolWithRows({
            'INSERT INTO tenant_business_effect_claims': [],
            'FROM tenant_business_effect_claims': [{ idempotency_key: 'ik1_x', payload_hash: 'old', context_hash: 'context', claim_state: 'claimed' }]
        });
        const repository = new MultitenantPostgresRepository({ pool });
        await expectContractErrorAsync(
            () => repository.claimBusinessEffect({ tenant_id: 'ten_a', connection_id: 'wsc_a', operation_id: 'op_a', idempotency_key: 'ik1_x', payload_hash: 'new', context_hash: 'context' }),
            { code: 'IDEMPOTENCY_CONFLICT' }
        );
    });
});
