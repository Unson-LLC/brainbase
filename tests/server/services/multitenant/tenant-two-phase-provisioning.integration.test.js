import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    attachTenantWorkspaceConnection,
    provisionTenantCore
} from '../../../../server/services/multitenant/tenant-provisioner.js';

const { Pool } = pg;
const now = '2026-08-21T00:00:00Z';
const coreManifest = {
    tenant_key: 'unson-business',
    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    display_name: 'Unson Business',
    project_code: 'mana',
    service_actor: {
        actor_id: 'svc_mana_runtime',
        canonical_project_id: 'project_mana',
        capabilities: ['send_message']
    },
    contract_revision: {
        contract_id: 'ctr_01ARZ3NDEKTSV4RRFFQ69G5FAV', revision: '1', status: 'active',
        effective_from: '2026-08-18T00:00:00Z', effective_until: null, plan_code: 'mana-standard',
        allowances: { tool_calls: 1000 }, thresholds_basis_points: [5000, 8000, 10000],
        overage_policy: 'deny', hard_stop_basis_points: 10000,
        rate_card_revision: 8, fx_table_revision: 5, sales_price_revision: 3,
        capabilities: [
            'signed_tenant_context', 'connection_revision_recheck', 'tenant_scoped_authorization',
            'credential_broker_v1', 'usage_receipt_v1', 'idempotent_effects_v1', 'container_sanitization_v1'
        ],
        audience: ['mana-runtime'], deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV', profile: 'shared_cloud'
    }
};
const fullManifest = {
    ...coreManifest,
    workspace_connection: {
        provider: 'slack', workspace_id: 'T0123456789', app_id: 'A0123456789',
        installation_id: 'install_01', connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        credential_ref: 'credref://unson-business/slack/primary', credential_mode: 'customer_oauth',
        scopes: ['chat:write']
    }
};

describe.sequential('tenant two-phase provisioning DB readback', () => {
    let container;
    let pool;
    let schemaSha256;

    beforeAll(async () => {
        container = await new PostgreSqlContainer('postgres:16-alpine').start();
        pool = new Pool({ connectionString: container.getConnectionUri() });
        await pool.query(await readFile(resolve(process.cwd(), 'server/sql/multitenant-platform-schema.sql'), 'utf8'));
        const schema = await readFile(resolve(process.cwd(), 'server/sql/tenant-production-provisioning-schema.sql'), 'utf8');
        await pool.query(schema);
        schemaSha256 = createHash('sha256').update(schema).digest('hex');
        await pool.query(
            `INSERT INTO brainbase_schema_migrations (migration_id, schema_sha256, applied_at, applied_by)
             VALUES ('tenant-production-provisioning.v1', $1, $2, 'integration-test')
             ON CONFLICT (migration_id) DO UPDATE SET schema_sha256 = EXCLUDED.schema_sha256`,
            [schemaSha256, now]
        );
        await pool.query('CREATE ROLE brainbase_tenant_provisioner_test_app NOLOGIN');
        await pool.query('GRANT USAGE ON SCHEMA public TO brainbase_tenant_provisioner_test_app');
        await pool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO brainbase_tenant_provisioner_test_app');
        await pool.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO brainbase_tenant_provisioner_test_app');
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await container?.stop();
    });

    it('persists exact core readback before registering the OAuth connection', async () => {
        const client = await pool.connect();
        try {
            await client.query('SET ROLE brainbase_tenant_provisioner_test_app');
            const graphResolver = { resolveCanonicalProject: async () => ({ project_id: 'project_mana', matches: 1 }) };
            const core = await provisionTenantCore({
                client, manifest: coreManifest, idempotencyKey: 'integration-core', actorId: 'integration-test',
                graphResolver, schemaSha256, now
            });
            expect(core.receipt.readback).toMatchObject({ tenant: true, tenant_project: true, service_actor: true });
            await client.query('BEGIN');
            await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [coreManifest.tenant_id]);
            expect((await client.query('SELECT count(*)::int AS count FROM workspace_connections')).rows[0].count).toBe(0);
            expect((await client.query('SELECT count(*)::int AS count FROM credential_broker_refs')).rows[0].count).toBe(0);
            await client.query('COMMIT');

            const connection = await attachTenantWorkspaceConnection({
                client, manifest: fullManifest, idempotencyKey: 'integration-connection', actorId: 'integration-test',
                graphResolver,
                credentialResolver: {
                    verifyOpaqueReference: async ({ tenant_key, allow_unregistered }) => ({
                        tenant_key, valid: allow_unregistered === false
                    })
                },
                schemaSha256, now
            });
            expect(connection.receipt.readback.workspace_connection).toBe(true);
            await client.query('BEGIN');
            await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [coreManifest.tenant_id]);
            const readback = await client.query(
                `SELECT t.tenant_key, tp.project_code, sa.actor_id, wc.workspace_id, cbr.credential_ref
                   FROM brainbase_tenants t
                   JOIN tenant_projects tp ON tp.tenant_id = t.tenant_id
                   JOIN brainbase_service_actors sa ON sa.tenant_key = t.tenant_key
                   JOIN workspace_connections wc ON wc.tenant_id = t.tenant_id
                   JOIN credential_broker_refs cbr ON cbr.tenant_id = t.tenant_id
                  WHERE t.tenant_id = $1`,
                [coreManifest.tenant_id]
            );
            expect(readback.rows).toEqual([{
                tenant_key: 'unson-business', project_code: 'mana', actor_id: 'svc_mana_runtime',
                workspace_id: 'T0123456789', credential_ref: 'credref://unson-business/slack/primary'
            }]);
            await client.query('COMMIT');
        } finally {
            await client.query('ROLLBACK');
            await client.query('RESET ROLE');
            client.release();
        }
    }, 120_000);
});
