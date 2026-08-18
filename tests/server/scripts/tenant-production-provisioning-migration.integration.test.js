import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runTenantProvisioningMigration } from '../../../scripts/migrate-tenant-production-provisioning.js';

const { Pool } = pg;
const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const now = new Date('2026-08-19T00:00:00.000Z');

describe.sequential('tenant production provisioning migration catalog readback', () => {
    let container;
    let pool;

    beforeAll(async () => {
        container = await new PostgreSqlContainer('postgres:16-alpine').start();
        pool = new Pool({ connectionString: container.getConnectionUri() });
        await pool.query(await readFile(resolve(process.cwd(), 'server/sql/multitenant-platform-schema.sql'), 'utf8'));
        await pool.query('ALTER TABLE brainbase_tenants ADD COLUMN IF NOT EXISTS tenant_key TEXT');
        await pool.query(
            `INSERT INTO brainbase_tenants (
                tenant_id, tenant_revision, tenant_key, status, display_name, created_at, updated_at
             ) VALUES ($1, 1, 'unson-business', 'active', 'Unson Business', $2, $2)`,
            [tenantId, now]
        );
        // IF NOT EXISTS in the production DDL intentionally preserves this
        // same-name object, so the catalog readback must reject it.
        await pool.query(
            `CREATE INDEX workspace_connections_tenant_provider_workspace_app_uq
                ON workspace_connections (tenant_id, workspace_id, provider, app_id)`
        );
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await container?.stop();
    });

    it('rejects a wrong same-name index before recording the migration ledger', async () => {
        await expect(runTenantProvisioningMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'integration-test' },
            pool
        })).rejects.toMatchObject({
            code: 'SCHEMA_READBACK_FAILED'
        });

        const ledger = await pool.query(
            `SELECT migration_id FROM brainbase_schema_migrations
              WHERE migration_id = 'tenant-production-provisioning.v1'`
        );
        expect(ledger.rows).toEqual([]);
    }, 120_000);

    it('accepts the canonical catalog definitions and records the ledger after repair', async () => {
        await pool.query('DROP INDEX workspace_connections_tenant_provider_workspace_app_uq');
        const result = await runTenantProvisioningMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'integration-test' },
            pool
        });
        expect(result).toMatchObject({ ok: true, mode: 'apply', persisted: true, readback: { ledger_matches: true } });
        const ledger = await pool.query(
            `SELECT schema_sha256 FROM brainbase_schema_migrations
              WHERE migration_id = 'tenant-production-provisioning.v1'`
        );
        expect(ledger.rows).toHaveLength(1);
        expect(ledger.rows[0].schema_sha256).toBe(result.schema_sha256);
    }, 120_000);
});
