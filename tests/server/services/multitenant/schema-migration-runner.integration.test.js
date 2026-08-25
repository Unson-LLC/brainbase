import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMultitenantSchemaMigration } from '../../../../scripts/migrate-multitenant-platform-schema.js';

const { Pool } = pg;

describe.sequential('multitenant platform production schema runner', () => {
    let container;
    let pool;
    const historicalV1Hash = 'a'.repeat(64);

    beforeAll(async () => {
        container = await new PostgreSqlContainer('postgres:16-alpine').start();
        pool = new Pool({ connectionString: container.getConnectionUri() });
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await container?.stop();
    });

    it('dry-runは実PostgreSQLで検査後rollbackし、applyは再実行可能でcheckが同じhashを読む', async () => {
        const dryRun = await runMultitenantSchemaMigration({ argv: ['--dry-run'], pool });
        expect(dryRun).toMatchObject({ ok: true, persisted: false, readback: { ledger_matches: true } });
        const afterDryRun = await pool.query("SELECT to_regclass('brainbase_tenants') AS table_name");
        expect(afterDryRun.rows[0].table_name).toBeNull();

        const input = {
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'integration-test' },
            pool
        };
        const firstApply = await runMultitenantSchemaMigration(input);
        await pool.query(
            `INSERT INTO brainbase_schema_migrations (migration_id, schema_sha256, applied_at, applied_by)
             VALUES ('multitenant-platform-schema.v1', $1, now(), 'historical-test')`,
            [historicalV1Hash]
        );
        const secondApply = await runMultitenantSchemaMigration(input);
        const checked = await runMultitenantSchemaMigration({ argv: ['--check'], pool });

        expect(firstApply).toMatchObject({ ok: true, persisted: true });
        expect(secondApply).toMatchObject({ ok: true, persisted: true });
        expect(checked).toMatchObject({
            ok: true,
            schema_sha256: firstApply.schema_sha256,
            readback: { ledger_matches: true }
        });
        const ledger = await pool.query(
            'SELECT migration_id, schema_sha256 FROM brainbase_schema_migrations ORDER BY migration_id'
        );
        expect(ledger.rows).toEqual([
            {
                migration_id: 'multitenant-platform-schema.v1',
                schema_sha256: historicalV1Hash
            },
            {
                migration_id: 'multitenant-platform-schema.v2',
                schema_sha256: firstApply.schema_sha256
            }
        ]);

        const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
        const tenantClient = await pool.connect();
        try {
            await tenantClient.query('BEGIN');
            await tenantClient.query("SELECT set_config('brainbase.tenant_id', $1, true)", [tenantId]);
            await tenantClient.query(
                `INSERT INTO brainbase_tenants (
                    tenant_id, tenant_revision, status, display_name, created_at, updated_at
                 ) VALUES ($1, 1, 'active', 'Quota Constraint Test', now(), now())`,
                [tenantId]
            );
            await tenantClient.query('COMMIT');
        } finally {
            tenantClient.release();
        }
        const insertDecision = async ({ idempotencyKey, requestedValue, requestFingerprint }) => {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [tenantId]);
                await client.query(
                    `INSERT INTO tenant_quota_decisions (
                        tenant_id, contract_revision, quota_revision, idempotency_key, metric,
                        decision, limit_value, used_value, remaining_value, requested_value, unit,
                        window_started_at, window_ends_at, decided_at, failure_code,
                        request_fingerprint, decision_payload
                     ) VALUES ($1, '1', '1', $2, 'tool_calls', 'allowed', 100, 0, 99, $3,
                        'tool_calls', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
                        '2026-08-22T00:00:00Z', NULL, $4, '{}'::jsonb)`,
                    [tenantId, idempotencyKey, requestedValue, requestFingerprint]
                );
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        };
        await expect(insertDecision({
            idempotencyKey: `ik1_${'A'.repeat(43)}`,
            requestedValue: 1,
            requestFingerprint: `sha256:${'b'.repeat(64)}`
        })).resolves.toBeUndefined();
        await expect(insertDecision({
            idempotencyKey: `ik1_${'B'.repeat(43)}`,
            requestedValue: null,
            requestFingerprint: null
        })).resolves.toBeUndefined();
        for (const [suffix, requestedValue, requestFingerprint] of [
            ['C', 0, `sha256:${'c'.repeat(64)}`],
            ['D', -1, `sha256:${'d'.repeat(64)}`],
            ['E', 1, 'not-a-sha256-digest']
        ]) {
            await expect(insertDecision({
                idempotencyKey: `ik1_${suffix.repeat(43)}`,
                requestedValue,
                requestFingerprint
            })).rejects.toMatchObject({ code: '23514' });
        }
    }, 120_000);
});
