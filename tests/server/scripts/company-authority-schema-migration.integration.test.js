import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runCompanyAuthoritySchemaMigration } from '../../../scripts/migrate-company-authority-schema.js';

const { Pool } = pg;
const now = new Date('2026-09-04T00:00:00.000Z');
const tenantA = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const tenantB = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const connectionA = 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW';
const connectionB = 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAY';

describe.sequential('company authority schema migration and restricted route resolver', () => {
    let container;
    let pool;

    beforeAll(async () => {
        container = await new PostgreSqlContainer('postgres:16-alpine').start();
        pool = new Pool({ connectionString: container.getConnectionUri() });
        await pool.query("CREATE ROLE brainbase_app NOLOGIN");
        await pool.query(`
            CREATE TABLE brainbase_schema_migrations (
                migration_id TEXT PRIMARY KEY,
                schema_sha256 TEXT NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL,
                applied_by TEXT NOT NULL
            );
            CREATE TABLE brainbase_tenants (
                tenant_id TEXT PRIMARY KEY,
                tenant_revision BIGINT NOT NULL,
                status TEXT NOT NULL,
                display_name TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL,
                UNIQUE (tenant_id, tenant_revision)
            );
            CREATE TABLE tenant_organizations (
                organization_id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
                tenant_revision_at_write BIGINT NOT NULL,
                organization_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                UNIQUE (tenant_id, organization_id)
            );
            CREATE TABLE tenant_memberships (
                membership_id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
                tenant_revision_at_write BIGINT NOT NULL,
                organization_id TEXT NOT NULL,
                principal_id TEXT NOT NULL,
                membership_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                FOREIGN KEY (tenant_id, organization_id)
                    REFERENCES tenant_organizations(tenant_id, organization_id)
            );
            CREATE TABLE tenant_projects (
                project_id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
                tenant_revision_at_write BIGINT NOT NULL,
                project_code TEXT NOT NULL,
                project_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                UNIQUE (tenant_id, project_code)
            );
            CREATE TABLE workspace_connections (
                connection_id TEXT PRIMARY KEY,
                connection_revision BIGINT NOT NULL,
                tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
                tenant_revision_at_write BIGINT NOT NULL,
                provider TEXT NOT NULL,
                installation_id TEXT NOT NULL,
                workspace_id TEXT NOT NULL,
                app_id TEXT NOT NULL,
                granted_scopes TEXT[] NOT NULL DEFAULT '{}',
                status TEXT NOT NULL,
                credential_ref TEXT NOT NULL,
                installed_at TIMESTAMPTZ NOT NULL,
                UNIQUE (tenant_id, connection_id)
            );
        `);
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await container?.stop();
    });

    it('fails before applying when the tenant production provisioning prerequisite is missing', async () => {
        await expect(runCompanyAuthoritySchemaMigration({ argv: ['--dry-run'], pool }))
            .rejects.toMatchObject({ code: 'SCHEMA_PREREQUISITE_MISSING' });
        await pool.query('ALTER TABLE workspace_connections ADD COLUMN enterprise_id TEXT');
    });

    it('rolls back dry-run and persists the exact schema only after approved apply', async () => {
        const dryRun = await runCompanyAuthoritySchemaMigration({ argv: ['--dry-run'], pool });
        expect(dryRun).toMatchObject({
            ok: true,
            mode: 'dry-run',
            persisted: false,
            readback: {
                table_count: 2,
                rls_table_count: 2,
                route_function_count: 1,
                route_function_security_verified: true,
                ledger_matches: true
            }
        });
        const afterDryRun = await pool.query(
            "SELECT to_regclass('company_external_identities')::TEXT AS table_name"
        );
        expect(afterDryRun.rows).toEqual([{ table_name: null }]);

        const applied = await runCompanyAuthoritySchemaMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'integration-test' },
            pool
        });
        expect(applied).toMatchObject({ ok: true, mode: 'apply', persisted: true });
        await expect(runCompanyAuthoritySchemaMigration({ argv: ['--check'], pool }))
            .resolves.toMatchObject({ ok: true, mode: 'check', persisted: true });
    }, 120_000);

    it('rejects a route resolver whose SECURITY DEFINER contract was weakened', async () => {
        await pool.query(
            `ALTER FUNCTION public.resolve_company_authority_route(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
             SECURITY INVOKER`
        );
        await expect(runCompanyAuthoritySchemaMigration({ argv: ['--check'], pool }))
            .rejects.toMatchObject({ code: 'SCHEMA_READBACK_FAILED' });

        await runCompanyAuthoritySchemaMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'integration-test-security-restore' },
            pool
        });
    }, 120_000);

    it('resolves one hinted tenant, exposes ambiguity without a hint, and keeps tables private', async () => {
        await pool.query(
            `INSERT INTO brainbase_tenants
                (tenant_id, tenant_revision, status, display_name, created_at, updated_at)
             VALUES ($1, 1, 'active', 'Tenant A', $3, $3),
                    ($2, 1, 'active', 'Tenant B', $3, $3)`,
            [tenantA, tenantB, now]
        );
        await pool.query(
            `INSERT INTO tenant_organizations
                (organization_id, tenant_id, tenant_revision_at_write)
             VALUES ('org-a', $1, 1), ('org-b', $2, 1)`,
            [tenantA, tenantB]
        );
        await pool.query(
            `INSERT INTO tenant_memberships
                (membership_id, tenant_id, tenant_revision_at_write, organization_id, principal_id, membership_payload)
             VALUES ('membership-a', $1, 1, 'org-a', 'person-a', '{"status":"active"}'::jsonb),
                    ('membership-b', $2, 1, 'org-b', 'person-b', '{"status":"active"}'::jsonb)`,
            [tenantA, tenantB]
        );
        await pool.query(
            `INSERT INTO tenant_projects
                (project_id, tenant_id, tenant_revision_at_write, project_code)
             VALUES ('project-a', $1, 1, 'alpha'), ('project-b', $2, 1, 'beta')`,
            [tenantA, tenantB]
        );
        await pool.query(
            `INSERT INTO workspace_connections
                (connection_id, connection_revision, tenant_id, tenant_revision_at_write,
                 provider, installation_id, workspace_id, app_id, enterprise_id,
                 status, credential_ref, installed_at)
             VALUES ($1, 1, $3, 1, 'slack', 'install-a', 'workspace-a', 'app-1', 'enterprise-1',
                     'active', 'vault://tenant-a/slack', $5),
                    ($2, 1, $4, 1, 'slack', 'install-b', 'workspace-b', 'app-1', 'enterprise-1',
                     'active', 'vault://tenant-b/slack', $5)`,
            [connectionA, connectionB, tenantA, tenantB, now]
        );
        await pool.query(
            `INSERT INTO company_external_identities
                (identity_id, identity_revision, tenant_id, tenant_revision_at_write,
                 provider, authenticated_subject_id, workspace_id, app_id,
                 membership_id, project_id, placement_id, principal_type, status,
                 created_at, updated_at)
             VALUES ('identity-a', 1, $1, 1, 'slack', 'U_SHARED', 'workspace-a', 'app-1',
                     'membership-a', 'project-a', 'deployment-a', 'person', 'active', $3, $3),
                    ('identity-b', 1, $2, 1, 'slack', 'U_SHARED', 'workspace-b', 'app-1',
                     'membership-b', 'project-b', 'deployment-b', 'person', 'active', $3, $3)`,
            [tenantA, tenantB, now]
        );

        const hinted = await pool.query(
            `SELECT tenant_id, connection_id
               FROM public.resolve_company_authority_route('slack', 'U_SHARED', 'workspace-a', 'app-1', 'enterprise-1', 'alpha')`
        );
        expect(hinted.rows).toEqual([{ tenant_id: tenantA, connection_id: connectionA }]);

        const ambiguous = await pool.query(
            `SELECT tenant_id
               FROM public.resolve_company_authority_route('slack', 'U_SHARED', NULL, 'app-1', 'enterprise-1', NULL)
              ORDER BY tenant_id`
        );
        expect(ambiguous.rows).toEqual([{ tenant_id: tenantA }, { tenant_id: tenantB }]);

        const appClient = await pool.connect();
        try {
            await appClient.query('SET ROLE brainbase_app');
            await expect(appClient.query(
                `SELECT tenant_id
                   FROM public.resolve_company_authority_route('slack', 'U_SHARED', 'workspace-a', 'app-1', 'enterprise-1', 'alpha')`
            )).resolves.toMatchObject({ rows: [{ tenant_id: tenantA }] });
            await expect(appClient.query('SELECT tenant_id FROM company_external_identities'))
                .rejects.toMatchObject({ code: '42501' });
        } finally {
            await appClient.query('RESET ROLE');
            appClient.release();
        }
    }, 120_000);
});
