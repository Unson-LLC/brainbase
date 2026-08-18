import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runTenantProvisioningMigration } from '../../../../scripts/migrate-tenant-production-provisioning.js';
import { SlackInstallationControlPlane } from '../../../../server/services/multitenant/slack-installation-control-plane.js';
import { MultitenantPostgresRepository } from '../../../../server/services/multitenant/postgres-repository.js';

const { Pool } = pg;

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const tenantKey = 'unson-business';
const personId = 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY';
const intentId = 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const contractId = 'ctr_01ARZ3NDEKTSV4RRFFQ69G5FB1';
const deploymentId = 'dep_01ARZ3NDEKTSV4RRFFQ69G5FB2';
const appId = 'A0123456789';
const workspaceId = 'T0123456789';
const enterpriseId = 'E0123456789';
const installerId = 'U0123456789';
const now = new Date('2026-08-19T00:00:00.000Z');

describe.sequential('Slack installation control-plane PostgreSQL integration', () => {
    let container;
    let pool;
    let repository;
    let oauthClient;
    let credentialStore;
    let controlPlane;

    beforeAll(async () => {
        container = await new PostgreSqlContainer('postgres:16-alpine').start();
        pool = new Pool({ connectionString: container.getConnectionUri() });
        const baseSchema = await readFile(resolve(process.cwd(), 'server/sql/multitenant-platform-schema.sql'), 'utf8');
        await pool.query(baseSchema);

        // The production migration refuses to guess tenant keys. Seed the
        // explicit key before applying the additive provisioning migration.
        await pool.query('ALTER TABLE brainbase_tenants ADD COLUMN IF NOT EXISTS tenant_key TEXT');
        await pool.query(
            `INSERT INTO brainbase_tenants (
                tenant_id, tenant_revision, tenant_key, status, display_name, created_at, updated_at
             ) VALUES ($1, 1, $2, 'active', 'Unson Business', $3, $3)`,
            [tenantId, tenantKey, now]
        );
        await runTenantProvisioningMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'integration-test' },
            pool
        });
        await pool.query(
            `INSERT INTO tenant_contract_revisions (
                contract_id, contract_revision, tenant_id, tenant_revision_at_write,
                status, effective_from, effective_until, plan_code, allowances,
                thresholds_basis_points, overage_policy, hard_stop_basis_points,
                rate_card_revision, fx_table_revision, sales_price_revision
             ) VALUES ($1, 1, $2, 1, 'active', $3, NULL, 'mana-cloud', $4::jsonb,
                       ARRAY[8000,10000]::integer[], 'deny', 10000, 1, 1, 1)`,
            [contractId, tenantId, now, JSON.stringify({ monthly_messages: 1000 })]
        );
        await pool.query(
            `INSERT INTO tenant_contract_revision_runtime_bindings (
                tenant_id, contract_id, contract_revision, capabilities, audience,
                deployment_id, profile, created_at, updated_at
             ) VALUES ($1, $2, 1, $3, $4, $5, 'shared_cloud', $6, $6)`,
            [tenantId, contractId, ['send_message', 'create_task'], ['mana-runtime'], deploymentId, now]
        );

        repository = new MultitenantPostgresRepository({ pool, now: () => now });
        oauthClient = {
            exchangeCode: vi.fn(async () => ({
                app_id: appId,
                workspace_id: workspaceId,
                enterprise_id: enterpriseId,
                installer_id: installerId,
                installation_id: `slack:${appId}:${workspaceId}`,
                granted_scopes: ['chat:write', 'commands'],
                credential_material: 'xoxb-integration-secret',
                credential_refresh_material: 'xoxr-integration-secret'
            }))
        };
        credentialStore = {
            store: vi.fn(async () => ({
                credential_ref: 'vault://slack/unson-business/A0123456789/T0123456789',
                credential_mode: 'customer_oauth',
                refresh_revision: 1
            })),
            revoke: vi.fn()
        };
        controlPlane = new SlackInstallationControlPlane({
            repository,
            oauthClient,
            credentialStore,
            now: () => now,
            ttlSeconds: 600
        });
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await container?.stop();
    });

    it('writes and reads back the intent, connection revision, opaque credential and exchange ledger atomically', async () => {
        const intent = {
            installation_intent_id: intentId,
            tenant_id: tenantId,
            app_id: appId,
            expected_workspace_id: workspaceId,
            expected_enterprise_id: enterpriseId,
            initiated_by_person_id: personId
        };
        await controlPlane.authorizeBinding(intent);

        const result = await controlPlane.exchange_and_register({
            authorization_code: 'oauth-code-one',
            redirect_uri: 'https://mana.example.test/oauth/slack/callback',
            intent
        });
        expect(result).toMatchObject({
            tenant_id: tenantId,
            connection_revision: '1',
            workspace_id: workspaceId,
            app_id: appId,
            installer_id: installerId,
            deployment_id: deploymentId,
            profile: 'shared_cloud',
            contract_revision: '1',
            status: 'active'
        });
        expect(result).not.toHaveProperty('credential_material');
        expect(result).not.toHaveProperty('credential_ref');

        const dbRows = await pool.query(
            `SELECT wc.tenant_id, wc.connection_revision, wc.credential_ref,
                    wc.deployment_id, wc.profile, wc.contract_revision,
                    cbr.credential_mode, cbr.refresh_revision,
                    revision.connection_snapshot::text AS connection_snapshot,
                    ledger.status, ledger.response_payload::text AS response_payload,
                    intent.consumed_at
               FROM workspace_connections wc
               JOIN credential_broker_refs cbr
                 ON cbr.tenant_id = wc.tenant_id
                AND cbr.connection_id = wc.connection_id
                AND cbr.connection_revision = wc.connection_revision
               JOIN workspace_connection_revisions revision
                 ON revision.tenant_id = wc.tenant_id
                AND revision.connection_id = wc.connection_id
                AND revision.connection_revision = wc.connection_revision
               JOIN slack_installation_exchange_ledger ledger
                 ON ledger.tenant_id = wc.tenant_id
               JOIN slack_installation_intents intent
                 ON intent.tenant_id = wc.tenant_id
                AND intent.installation_intent_id = ledger.installation_intent_id
              WHERE wc.tenant_id = $1
                AND ledger.installation_intent_id = $2`,
            [tenantId, intentId]
        );
        expect(dbRows.rows).toHaveLength(1);
        const stored = dbRows.rows[0];
        expect(stored).toMatchObject({
            tenant_id: tenantId,
            connection_revision: '1',
            credential_ref: 'vault://slack/unson-business/A0123456789/T0123456789',
            deployment_id: deploymentId,
            profile: 'shared_cloud',
            contract_revision: '1',
            credential_mode: 'customer_oauth',
            refresh_revision: '1',
            status: 'completed'
        });
        expect(stored.consumed_at).not.toBeNull();
        expect(stored.connection_snapshot).not.toContain('xoxb-integration-secret');
        expect(stored.connection_snapshot).not.toContain('xoxr-integration-secret');
        expect(stored.response_payload).not.toContain('xoxb-integration-secret');
        expect(stored.response_payload).not.toContain('xoxr-integration-secret');

        // Exchange retries read the completed ledger before calling Slack or
        // the secret store, so one OAuth event has one registration effect.
        const replay = await controlPlane.exchange_and_register({
            authorization_code: 'oauth-code-one',
            redirect_uri: 'https://mana.example.test/oauth/slack/callback',
            intent
        });
        expect(replay).toEqual(result);
        expect(oauthClient.exchangeCode).toHaveBeenCalledTimes(1);
        expect(credentialStore.store).toHaveBeenCalledTimes(1);
        expect(await pool.query(
            'SELECT count(*)::integer AS count FROM slack_installation_exchange_ledger WHERE tenant_id = $1',
            [tenantId]
        )).toMatchObject({ rows: [{ count: 1 }] });
    }, 120_000);
});
