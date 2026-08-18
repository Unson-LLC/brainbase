import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMultitenantSchemaMigration } from '../../../../scripts/migrate-multitenant-platform-schema.js';

const { Pool } = pg;

describe.sequential('multitenant platform production schema runner', () => {
    let container;
    let pool;

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
            'SELECT migration_id, schema_sha256 FROM brainbase_schema_migrations'
        );
        expect(ledger.rows).toEqual([{
            migration_id: 'multitenant-platform-schema.v1',
            schema_sha256: firstApply.schema_sha256
        }]);
    }, 120_000);
});
