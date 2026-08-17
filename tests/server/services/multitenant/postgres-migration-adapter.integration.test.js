import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresTenantMigrationAdapter } from '../../../../server/services/multitenant/postgres-migration-adapter.js';

const { Pool } = pg;
const tenantA = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const tenantB = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAW';

describe.sequential('AC-006 PostgreSQL migration adapter', () => {
    let container;
    let pool;
    let adapter;

    beforeAll(async () => {
        container = await new PostgreSqlContainer('postgres:16-alpine').start();
        pool = new Pool({ connectionString: container.getConnectionUri() });
        const schema = await readFile(resolve(process.cwd(), 'server/sql/multitenant-platform-schema.sql'), 'utf8');
        await pool.query(schema);
        await pool.query(`INSERT INTO brainbase_tenants (tenant_id, tenant_revision, status, display_name, created_at, updated_at)
            VALUES ($1, 3, 'active', 'A', now(), now()), ($2, 2, 'active', 'B', now(), now())`, [tenantA, tenantB]);
        await pool.query(`INSERT INTO tenant_migration_source_rows (source_id, source_revision, source_payload)
            VALUES ('source-a', 1, '{"name":"A"}'), ('source-b', 1, '{"name":"B"}')`);
        adapter = new PostgresTenantMigrationAdapter({ pool, now: () => new Date('2026-08-17T00:00:00Z') });
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await container?.stop();
    });

    it('dry-runはwrite_count=0でDBを変更しない', async () => {
        const plan = await adapter.dryRun({
            target_tenant_id: tenantA,
            source_snapshot: 'sha256:snapshot-a',
            mapping_rule_revision: 1,
            rows: [{ id: 'source-a', revision: 1, candidates: [tenantA] }]
        });
        expect(plan).toMatchObject({ mode: 'dry_run', write_count: 0 });
        const result = await pool.query('SELECT tenant_id FROM tenant_migration_source_rows WHERE source_id = $1', ['source-a']);
        expect(result.rows[0].tenant_id).toBeNull();
    });

    it('apply・tenant isolation readback・rollbackを各transactionで完結させる', async () => {
        const dryRun = await adapter.dryRun({
            target_tenant_id: tenantA,
            source_snapshot: 'sha256:snapshot-a',
            mapping_rule_revision: 1,
            rows: [{ id: 'source-a', revision: 1, candidates: [tenantA] }]
        });
        const applied = await adapter.apply(dryRun);
        expect(applied).toMatchObject({ mode: 'apply', write_count: 1 });
        expect(await adapter.readback({ tenant_id: tenantA, migration_id: applied.migration_id }))
            .toMatchObject([{ source_id: 'source-a', tenant_id: tenantA }]);
        expect(await adapter.readback({ tenant_id: tenantB, migration_id: applied.migration_id })).toEqual([]);

        const rolledBack = await adapter.rollback(applied);
        expect(rolledBack).toMatchObject({ mode: 'rollback', write_count: 1 });
        expect(await adapter.readback({ tenant_id: tenantA, migration_id: applied.migration_id })).toEqual([]);
    });

    it('apply途中のDB失敗は全変更をrollbackする', async () => {
        const plan = await adapter.dryRun({
            target_tenant_id: tenantA,
            source_snapshot: 'sha256:snapshot-failure',
            mapping_rule_revision: 1,
            rows: [
                { id: 'source-a', revision: 1, candidates: [tenantA] },
                { id: 'missing', revision: 1, candidates: [tenantA] }
            ]
        });
        await expect(adapter.apply(plan, { fail_on_conflict: true })).rejects.toMatchObject({ code: 'MIGRATION_APPLY_CONFLICT' });
        const result = await pool.query('SELECT tenant_id FROM tenant_migration_source_rows WHERE source_id = $1', ['source-a']);
        expect(result.rows[0].tenant_id).toBeNull();
    });
});
