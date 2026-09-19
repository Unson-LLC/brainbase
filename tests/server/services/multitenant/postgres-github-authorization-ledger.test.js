import { describe, expect, it, vi } from 'vitest';

import { PostgresGitHubAuthorizationLedger } from '../../../../server/services/multitenant/postgres-github-authorization-ledger.js';
import { ContractError } from '../../../../server/services/multitenant/errors.js';

const state = Object.freeze({
    provider: 'github',
    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    person_id: 'per_01ARZ3NDEKTSV4RRFFQ69G5FAW',
    jti: '60f0c7ae-a42b-4b65-a736-3e3ca50970a4',
    issued_at: '2026-09-20T10:00:00.000Z',
    expires_at: '2026-09-20T10:10:00.000Z',
    state_digest: 'a'.repeat(64)
});

function createPool({ insertRowCount = 1, updateRowCounts = [1], failOn } = {}) {
    const calls = [];
    let updateIndex = 0;
    const client = {
        query: vi.fn(async (sql, params) => {
            calls.push({ sql: String(sql), params });
            if (failOn && String(sql).startsWith(failOn)) throw new Error('simulated database error');
            if (String(sql).startsWith('INSERT INTO github_authorization_states')) {
                return { rowCount: insertRowCount, rows: insertRowCount === 1 ? [{ jti: state.jti }] : [] };
            }
            if (String(sql).startsWith('UPDATE github_authorization_states')) {
                const rowCount = updateRowCounts[Math.min(updateIndex, updateRowCounts.length - 1)] ?? 0;
                updateIndex += 1;
                return { rowCount, rows: rowCount === 1 ? [{ jti: state.jti }] : [] };
            }
            return { rowCount: 0, rows: [] };
        }),
        release: vi.fn()
    };
    return {
        calls,
        client,
        pool: { connect: vi.fn(async () => client) }
    };
}

describe('PostgresGitHubAuthorizationLedger', () => {
    it('issues a tenant-bound digest record and never accepts/persists the signed state', async () => {
        const fixture = createPool();
        const ledger = new PostgresGitHubAuthorizationLedger({
            pool: fixture.pool,
            now: () => new Date('2026-09-20T10:00:01.000Z')
        });

        await expect(ledger.issue(state)).resolves.toBe(true);

        expect(fixture.client.query).toHaveBeenCalledWith(
            "SELECT set_config('brainbase.tenant_id', $1, true)", [state.tenant_id]
        );
        const insert = fixture.calls.find(({ sql }) => sql.startsWith('INSERT INTO github_authorization_states'));
        expect(insert.params).toEqual([
            state.tenant_id, state.jti, state.person_id, state.state_digest, state.issued_at, state.expires_at
        ]);
        expect(insert.sql).toContain('ON CONFLICT DO NOTHING');
        expect(fixture.client.query).toHaveBeenCalledWith('COMMIT');
        expect(fixture.client.release).toHaveBeenCalledOnce();
    });

    it('atomically consumes an unexpired state once and binds every signed claim', async () => {
        const fixture = createPool({ updateRowCounts: [1, 0] });
        const ledger = new PostgresGitHubAuthorizationLedger({ pool: fixture.pool });
        const consumeInput = { ...state, now: '2026-09-20T10:01:00.000Z' };

        await expect(ledger.consume(consumeInput)).resolves.toBe(true);
        await expect(ledger.consume(consumeInput)).resolves.toBe(false);

        const updates = fixture.calls.filter(({ sql }) => sql.startsWith('UPDATE github_authorization_states'));
        expect(updates).toHaveLength(2);
        expect(updates[0].sql).toContain('AND consumed_at IS NULL');
        expect(updates[0].sql).toContain('AND expires_at > $7::timestamptz');
        expect(updates[0].params).toEqual([
            state.tenant_id, state.jti, state.person_id, state.state_digest,
            state.issued_at, state.expires_at, consumeInput.now
        ]);
    });

    it('rejects expired, malformed, cross-provider, and replayable raw-state input before database access', async () => {
        const fixture = createPool();
        const ledger = new PostgresGitHubAuthorizationLedger({
            pool: fixture.pool,
            now: () => new Date('2026-09-20T10:01:00.000Z')
        });

        await expect(ledger.issue({ ...state, signed_state: 'payload.signature' })).resolves.toBe(false);
        await expect(ledger.issue({ ...state, expires_at: '2026-09-20T10:10:00.001Z' })).resolves.toBe(false);
        await expect(ledger.issue({ ...state, provider: 'slack' })).resolves.toBe(false);
        await expect(ledger.consume({ ...state, now: '2026-09-20T10:10:00.000Z' })).resolves.toBe(false);
        expect(fixture.pool.connect).not.toHaveBeenCalled();
    });

    it('fails closed on PostgreSQL failure and rolls back/release the transaction', async () => {
        const fixture = createPool({ failOn: 'INSERT INTO github_authorization_states' });
        const ledger = new PostgresGitHubAuthorizationLedger({
            pool: fixture.pool,
            now: () => new Date('2026-09-20T10:00:01.000Z')
        });

        await expect(ledger.issue(state)).rejects.toMatchObject({
            code: 'GITHUB_STATE_STORE_UNAVAILABLE', status: 503, retryable: true
        });
        expect(fixture.client.query).toHaveBeenCalledWith('ROLLBACK');
        expect(fixture.client.release).toHaveBeenCalledOnce();
    });
});
