import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runTenantProvisioningMigration } from '../../../scripts/migrate-tenant-production-provisioning.js';

const { Pool } = pg;
const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const connectionId = 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW';
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

    it('enforces the immutable revision as the current-pointer target at commit', async () => {
        const foreignKeys = await pool.query(
            `SELECT conname,
                    conrelid::regclass::text AS source_table,
                    confrelid::regclass::text AS target_table,
                    pg_get_constraintdef(oid) AS definition
               FROM pg_constraint
              WHERE conname = 'workspace_connections_current_revision_fk'
                 OR (conrelid = 'workspace_connection_revisions'::regclass
                     AND confrelid = 'workspace_connections'::regclass
                     AND contype = 'f')
              ORDER BY conname`
        );
        expect(foreignKeys.rows).toEqual([
            expect.objectContaining({
                conname: 'workspace_connections_current_revision_fk',
                source_table: 'workspace_connections',
                target_table: 'workspace_connection_revisions',
                definition: expect.stringContaining(
                    'FOREIGN KEY (tenant_id, connection_id, connection_revision) REFERENCES workspace_connection_revisions'
                )
            })
        ]);

        await pool.query('BEGIN');
        try {
            await pool.query(
                `INSERT INTO workspace_connection_revisions (
                    tenant_id, connection_id, connection_revision, connection_snapshot, recorded_at
                 ) VALUES ($1, $2, 1, $3::jsonb, $4)`,
                [tenantId, connectionId, JSON.stringify({
                    provider: 'slack',
                    installation_id: 'inst_integration',
                    workspace_id: 'T_INTEGRATION',
                    app_id: 'A_INTEGRATION',
                    granted_scopes: ['chat:write'],
                    status: 'active',
                    credential_ref: 'vault://integration/slack'
                }), now]
            );
            await pool.query(
                `INSERT INTO workspace_connections (
                    connection_id, connection_revision, tenant_id, tenant_revision_at_write,
                    provider, installation_id, workspace_id, app_id, granted_scopes,
                    status, credential_ref, installed_at
                 ) VALUES ($1, 1, $2, 1, 'slack', 'inst_integration', 'T_INTEGRATION',
                           'A_INTEGRATION', ARRAY['chat:write'], 'active',
                           'vault://integration/slack', $3)`,
                [connectionId, tenantId, now]
            );
            await pool.query('COMMIT');
        } catch (error) {
            await pool.query('ROLLBACK');
            throw error;
        }

        await expect(pool.query(
            `UPDATE workspace_connections
                SET connection_revision = 2
              WHERE tenant_id = $1 AND connection_id = $2`,
            [tenantId, connectionId]
        )).rejects.toMatchObject({ code: '23503' });

        await expect(pool.query(
            `INSERT INTO workspace_connection_revisions (
                tenant_id, connection_id, connection_revision, connection_snapshot, recorded_at
             ) VALUES ($1, $2, 2, $3::jsonb, $4)`,
            [tenantId, connectionId, JSON.stringify({
                provider: 'slack',
                installation_id: 'inst_integration',
                workspace_id: 'T_INTEGRATION',
                app_id: 'A_INTEGRATION',
                granted_scopes: ['chat:write'],
                status: 'active',
                credential_ref: 'vault://integration/slack'
            }), now]
        )).rejects.toMatchObject({ code: 'P0001' });

        await pool.query('BEGIN');
        try {
            await pool.query(
                `INSERT INTO workspace_connection_revisions (
                    tenant_id, connection_id, connection_revision, connection_snapshot, recorded_at
                 ) VALUES ($1, $2, 2, $3::jsonb, $4)`,
                [tenantId, connectionId, JSON.stringify({
                    provider: 'slack',
                    installation_id: 'inst_integration',
                    workspace_id: 'T_INTEGRATION',
                    app_id: 'A_INTEGRATION',
                    granted_scopes: ['chat:write'],
                    status: 'active',
                    credential_ref: 'vault://integration/slack'
                }), now]
            );
            await pool.query(
                `UPDATE workspace_connections
                    SET connection_revision = 2,
                        supersedes_connection_revision = 1
                  WHERE tenant_id = $1 AND connection_id = $2`,
                [tenantId, connectionId]
            );
            await pool.query('COMMIT');
        } catch (error) {
            await pool.query('ROLLBACK');
            throw error;
        }

        const readback = await pool.query(
            `SELECT current.connection_revision,
                    revision.connection_snapshot ->> 'workspace_id' AS workspace_id
               FROM workspace_connections current
               JOIN workspace_connection_revisions revision
                 ON revision.tenant_id = current.tenant_id
                AND revision.connection_id = current.connection_id
                AND revision.connection_revision = current.connection_revision
              WHERE current.tenant_id = $1 AND current.connection_id = $2`,
            [tenantId, connectionId]
        );
        expect(readback.rows).toEqual([{ connection_revision: '2', workspace_id: 'T_INTEGRATION' }]);
    }, 120_000);

    it('rejects a missing multiline inline primary key before ledger readback succeeds', async () => {
        await pool.query('ALTER TABLE slack_installation_exchange_ledger DROP CONSTRAINT slack_installation_exchange_ledger_pkey');
        try {
            await expect(runTenantProvisioningMigration({ argv: ['--check'], pool }))
                .rejects.toMatchObject({ code: 'SCHEMA_READBACK_FAILED' });
        } finally {
            await pool.query(
                `ALTER TABLE slack_installation_exchange_ledger
                 ADD CONSTRAINT slack_installation_exchange_ledger_pkey PRIMARY KEY (installation_intent_id)`
            );
        }
    }, 120_000);

    it('rejects a wrong ownership foreign key before ledger readback succeeds', async () => {
        await pool.query('ALTER TABLE slack_installation_exchange_ledger DROP CONSTRAINT slack_installation_exchange_ledger_tenant_intent_fk');
        try {
            await pool.query(
                `ALTER TABLE slack_installation_exchange_ledger
                 ADD CONSTRAINT slack_installation_exchange_ledger_tenant_intent_fk
                 FOREIGN KEY (tenant_id) REFERENCES slack_installation_intents(installation_intent_id)`
            );
            await expect(runTenantProvisioningMigration({ argv: ['--check'], pool }))
                .rejects.toMatchObject({ code: 'SCHEMA_READBACK_FAILED' });
        } finally {
            await pool.query('ALTER TABLE slack_installation_exchange_ledger DROP CONSTRAINT slack_installation_exchange_ledger_tenant_intent_fk');
            await pool.query(
                `ALTER TABLE slack_installation_exchange_ledger
                 ADD CONSTRAINT slack_installation_exchange_ledger_tenant_intent_fk
                 FOREIGN KEY (tenant_id, installation_intent_id)
                 REFERENCES slack_installation_intents(tenant_id, installation_intent_id)`
            );
        }
    }, 120_000);

    it('rejects a missing inline check constraint from the real catalog', async () => {
        await pool.query('ALTER TABLE brainbase_service_actor_keys DROP CONSTRAINT brainbase_service_actor_keys_status_check');
        await expect(runTenantProvisioningMigration({ argv: ['--check'], pool }))
            .rejects.toMatchObject({ code: 'SCHEMA_READBACK_FAILED' });
        await pool.query(
            `ALTER TABLE brainbase_service_actor_keys
             ADD CONSTRAINT brainbase_service_actor_keys_status_check
             CHECK (status IN ('active', 'revoked'))`
        );
    }, 120_000);

    it('rejects a wrong inline primary key definition from the real catalog', async () => {
        await pool.query('ALTER TABLE brainbase_service_actor_keys DROP CONSTRAINT brainbase_service_actor_keys_pkey');
        await pool.query(
            `ALTER TABLE brainbase_service_actor_keys
             ADD CONSTRAINT brainbase_service_actor_keys_pkey PRIMARY KEY (actor_id)`
        );
        await expect(runTenantProvisioningMigration({ argv: ['--check'], pool }))
            .rejects.toMatchObject({ code: 'SCHEMA_READBACK_FAILED' });
        await pool.query('ALTER TABLE brainbase_service_actor_keys DROP CONSTRAINT brainbase_service_actor_keys_pkey');
        await pool.query(
            `ALTER TABLE brainbase_service_actor_keys
             ADD CONSTRAINT brainbase_service_actor_keys_pkey PRIMARY KEY (actor_id, kid)`
        );
    }, 120_000);

    it('rejects a missing inline unique constraint from the real catalog', async () => {
        await pool.query('ALTER TABLE slack_installation_intents DROP CONSTRAINT slack_installation_intents_state_hash_key');
        await expect(runTenantProvisioningMigration({ argv: ['--check'], pool }))
            .rejects.toMatchObject({ code: 'SCHEMA_READBACK_FAILED' });
        await pool.query(
            `ALTER TABLE slack_installation_intents
             ADD CONSTRAINT slack_installation_intents_state_hash_key UNIQUE (state_hash)`
        );
    }, 120_000);

    it('rejects a wrong inline foreign key definition from the real catalog', async () => {
        await pool.query('ALTER TABLE brainbase_service_actor_keys DROP CONSTRAINT brainbase_service_actor_keys_actor_id_fkey');
        await pool.query(
            `ALTER TABLE brainbase_service_actor_keys
             ADD CONSTRAINT brainbase_service_actor_keys_actor_id_fkey
             FOREIGN KEY (kid) REFERENCES brainbase_service_actors(actor_id)`
        );
        await expect(runTenantProvisioningMigration({ argv: ['--check'], pool }))
            .rejects.toMatchObject({ code: 'SCHEMA_READBACK_FAILED' });
        await pool.query('ALTER TABLE brainbase_service_actor_keys DROP CONSTRAINT brainbase_service_actor_keys_actor_id_fkey');
        await pool.query(
            `ALTER TABLE brainbase_service_actor_keys
             ADD CONSTRAINT brainbase_service_actor_keys_actor_id_fkey
             FOREIGN KEY (actor_id) REFERENCES brainbase_service_actors(actor_id)`
        );
    }, 120_000);

    it('still accepts the restored complete constraint catalog', async () => {
        const result = await runTenantProvisioningMigration({ argv: ['--check'], pool });
        expect(result).toMatchObject({ ok: true, mode: 'check', readback: { ledger_matches: true } });
    }, 120_000);
});

describe.sequential('tenant production provisioning migration from the legacy Slack ledger', () => {
    let container;
    let pool;
    const legacyIntentId = 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAX';
    const ownershipIntentId = 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAY';
    const otherTenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAZ';

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
        await pool.query(
            `INSERT INTO brainbase_tenants (
                tenant_id, tenant_revision, tenant_key, status, display_name, created_at, updated_at
             ) VALUES ($1, 1, 'other-business', 'active', 'Other Business', $2, $2)`,
            [otherTenantId, now]
        );
        await pool.query(`
            CREATE TABLE brainbase_tenant_revisions (
                tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
                tenant_revision BIGINT NOT NULL CHECK (tenant_revision > 0),
                tenant_key TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('provisioning', 'active', 'suspended', 'deletion_pending', 'deleted')),
                display_name TEXT NOT NULL,
                suspension_reason_code TEXT,
                deletion_after TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL,
                recorded_at TIMESTAMPTZ NOT NULL,
                PRIMARY KEY (tenant_id, tenant_revision),
                UNIQUE (tenant_key, tenant_revision)
            )
        `);
        await pool.query(
            `INSERT INTO brainbase_tenant_revisions (
                tenant_id, tenant_revision, tenant_key, status, display_name,
                created_at, updated_at, recorded_at
             ) VALUES ($1, 1, 'unson-business', 'active', 'Unson Business', $2, $2, $2)`,
            [tenantId, now]
        );
        await pool.query(
            `INSERT INTO brainbase_tenant_revisions (
                tenant_id, tenant_revision, tenant_key, status, display_name,
                created_at, updated_at, recorded_at
             ) VALUES ($1, 1, 'other-business', 'active', 'Other Business', $2, $2, $2)`,
            [otherTenantId, now]
        );
        await pool.query(`
            CREATE TABLE slack_installation_intents (
                installation_intent_id TEXT PRIMARY KEY CHECK (installation_intent_id ~ '^insi_[0-9A-HJKMNP-TV-Z]{26}$'),
                tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
                tenant_revision_at_write BIGINT NOT NULL,
                app_id TEXT NOT NULL CHECK (app_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
                expected_workspace_id TEXT,
                expected_enterprise_id TEXT,
                initiated_by_principal_id TEXT NOT NULL CHECK (initiated_by_principal_id ~ '^per_[0-9A-HJKMNP-TV-Z]{26}$'),
                expected_connection_revision BIGINT,
                state_hash TEXT CHECK (state_hash IS NULL OR state_hash ~ '^sha256:[a-f0-9]{64}$'),
                nonce_hash TEXT CHECK (nonce_hash IS NULL OR nonce_hash ~ '^sha256:[a-f0-9]{64}$'),
                issued_at TIMESTAMPTZ NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                consumed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL,
                CONSTRAINT slack_installation_intents_tenant_revision_history_fk
                    FOREIGN KEY (tenant_id, tenant_revision_at_write)
                    REFERENCES brainbase_tenant_revisions(tenant_id, tenant_revision),
                UNIQUE (state_hash),
                CHECK (expires_at > issued_at),
                CHECK (expires_at <= issued_at + INTERVAL '10 minutes'),
                CHECK (expected_connection_revision IS NULL OR expected_connection_revision > 0),
                CHECK (consumed_at IS NULL OR consumed_at >= issued_at)
            );

            CREATE TABLE slack_installation_exchange_ledger (
                installation_intent_id TEXT PRIMARY KEY
                    REFERENCES slack_installation_intents(installation_intent_id),
                tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
                request_digest TEXT NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
                status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
                connection_id TEXT,
                connection_revision BIGINT,
                response_payload JSONB,
                claim_token_hash TEXT CHECK (claim_token_hash IS NULL OR claim_token_hash ~ '^sha256:[a-f0-9]{64}$'),
                claimed_at TIMESTAMPTZ,
                attempt BIGINT NOT NULL DEFAULT 1 CHECK (attempt > 0),
                failure_code TEXT,
                created_at TIMESTAMPTZ NOT NULL,
                completed_at TIMESTAMPTZ,
                UNIQUE (tenant_id, installation_intent_id),
                CHECK (status <> 'completed' OR (
                    connection_id IS NOT NULL
                    AND connection_revision IS NOT NULL
                    AND response_payload IS NOT NULL
                ))
            );
        `);
        await pool.query(
            `INSERT INTO slack_installation_intents (
                installation_intent_id, tenant_id, tenant_revision_at_write, app_id,
                initiated_by_principal_id, issued_at, expires_at, created_at
             ) VALUES ($1, $2, 1, 'A_LEGACY', 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY', $3, $4, $3)`,
            [legacyIntentId, tenantId, now, new Date(now.getTime() + 10 * 60 * 1000)]
        );
        await pool.query(
            `INSERT INTO slack_installation_intents (
                installation_intent_id, tenant_id, tenant_revision_at_write, app_id,
                initiated_by_principal_id, issued_at, expires_at, created_at
             ) VALUES ($1, $2, 1, 'A_CROSS', 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY', $3, $4, $3)`,
            [ownershipIntentId, tenantId, now, new Date(now.getTime() + 10 * 60 * 1000)]
        );
        await pool.query(
            `INSERT INTO slack_installation_exchange_ledger (
                installation_intent_id, tenant_id, request_digest, status,
                attempt, failure_code, created_at, completed_at
             ) VALUES ($1, $2, $3, 'failed', 1, 'UPSTREAM_UNAVAILABLE', $4, $4)`,
            [legacyIntentId, tenantId, `sha256:${'a'.repeat(64)}`, now]
        );
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await container?.stop();
    });

    it('preserves a legacy failed row and adds bounded diagnostic columns idempotently', async () => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const result = await runTenantProvisioningMigration({
                argv: ['--apply', '--approve-apply'],
                env: { BRAINBASE_MIGRATION_ACTOR: 'integration-test' },
                pool
            });
            expect(result).toMatchObject({ ok: true, mode: 'apply', persisted: true, readback: { ledger_matches: true } });
        }

        const readback = await pool.query(
            `SELECT installation_intent_id, status, failure_code, failure_stage, cleanup_status
               FROM slack_installation_exchange_ledger
              WHERE installation_intent_id = $1`,
            [legacyIntentId]
        );
        expect(readback.rows).toEqual([{
            installation_intent_id: legacyIntentId,
            status: 'failed',
            failure_code: 'UPSTREAM_UNAVAILABLE',
            failure_stage: null,
            cleanup_status: null
        }]);

        await expect(pool.query(
            `UPDATE slack_installation_exchange_ledger
                SET failure_stage = 'unknown_stage'
              WHERE installation_intent_id = $1`,
            [legacyIntentId]
        )).rejects.toMatchObject({ code: '23514' });
        await expect(pool.query(
            `UPDATE slack_installation_exchange_ledger
                SET cleanup_status = 'unknown_status'
              WHERE installation_intent_id = $1`,
            [legacyIntentId]
        )).rejects.toMatchObject({ code: '23514' });
    }, 120_000);

    it('enforces tenant and installation-intent ownership with the migrated composite foreign key', async () => {
        const foreignKeys = await pool.query(
            `SELECT conname, pg_get_constraintdef(oid) AS definition
               FROM pg_constraint
              WHERE conrelid = 'slack_installation_exchange_ledger'::regclass
                AND confrelid = 'slack_installation_intents'::regclass
                AND contype = 'f'`
        );
        expect(foreignKeys.rows).toEqual([
            expect.objectContaining({
                conname: 'slack_installation_exchange_ledger_tenant_intent_fk',
                definition: expect.stringContaining(
                    'FOREIGN KEY (tenant_id, installation_intent_id) REFERENCES slack_installation_intents(tenant_id, installation_intent_id)'
                )
            })
        ]);

        await expect(pool.query(
            `INSERT INTO slack_installation_exchange_ledger (
                installation_intent_id, tenant_id, request_digest, status, attempt, created_at
             ) VALUES ($1, $2, $3, 'failed', 1, $4)`,
            [ownershipIntentId, otherTenantId, `sha256:${'b'.repeat(64)}`, now]
        )).rejects.toMatchObject({ code: '23503' });
    }, 120_000);

    it('fails loudly when legacy data violates tenant and installation-intent ownership', async () => {
        await pool.query('ALTER TABLE slack_installation_exchange_ledger DROP CONSTRAINT slack_installation_exchange_ledger_tenant_intent_fk');
        try {
            await pool.query(
                `INSERT INTO slack_installation_exchange_ledger (
                    installation_intent_id, tenant_id, request_digest, status, attempt, created_at
                 ) VALUES ($1, $2, $3, 'failed', 1, $4)`,
                [ownershipIntentId, otherTenantId, `sha256:${'c'.repeat(64)}`, now]
            );
            await expect(runTenantProvisioningMigration({
                argv: ['--apply', '--approve-apply'],
                env: { BRAINBASE_MIGRATION_ACTOR: 'integration-test' },
                pool
            })).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
        } finally {
            await pool.query(
                `DELETE FROM slack_installation_exchange_ledger
                  WHERE installation_intent_id = $1`,
                [ownershipIntentId]
            );
            await pool.query(
                `ALTER TABLE slack_installation_exchange_ledger
                 ADD CONSTRAINT slack_installation_exchange_ledger_tenant_intent_fk
                 FOREIGN KEY (tenant_id, installation_intent_id)
                 REFERENCES slack_installation_intents(tenant_id, installation_intent_id)`
            );
        }
    }, 120_000);
});
