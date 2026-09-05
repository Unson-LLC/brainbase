import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    provisionHumanCompanyAuthority,
    readbackHumanCompanyAuthority
} from '../../../../server/services/multitenant/human-company-authority-provisioner.js';

const { Pool } = pg;
const tenantTechKnight = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const tenantUnson = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAW';
const manifest = {
    version: 'human-company-authority.v1',
    tenant_id: tenantTechKnight,
    organization: {
        organization_id: 'org_techknight_business',
        graph_organization_id: 'techknight',
        display_name: 'Tech Knight'
    },
    project: { project_id: 'prj_techknight', project_code: 'techknight' },
    transport: { provider: 'slack', workspace_id: 'T_TECHKNIGHT', app_id: 'A_TECHKNIGHT' },
    humans: [{
        person_id: 'per_umeda_haruka',
        person_name: '梅田遼',
        slack_user_id: 'U_UMEDA',
        login_role: 'member',
        project_codes: ['techknight'],
        clearance: ['internal'],
        tenant_role: 'member',
        placement_id: 'techknight-slack-member'
    }]
};

describe.sequential('human company authority PostgreSQL boundary', () => {
    let container;
    let pool;

    beforeAll(async () => {
        container = await new PostgreSqlContainer('postgres:16-alpine').start();
        pool = new Pool({ connectionString: container.getConnectionUri() });
        await pool.query(await readFile(resolve(process.cwd(), 'server/sql/permission-schema.sql'), 'utf8'));
        await pool.query(await readFile(resolve(process.cwd(), 'server/sql/info-ssot-schema.sql'), 'utf8'));
        await pool.query("ALTER TABLE people ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'");
        await pool.query(await readFile(resolve(process.cwd(), 'server/sql/multitenant-platform-schema.sql'), 'utf8'));
        await pool.query('ALTER TABLE brainbase_tenants ADD COLUMN tenant_key TEXT');
        await pool.query('ALTER TABLE workspace_connections ADD COLUMN enterprise_id TEXT');
        await pool.query(await readFile(resolve(process.cwd(), 'server/sql/company-authority-schema.sql'), 'utf8'));
        await pool.query(
            `INSERT INTO brainbase_tenants (
                tenant_id, tenant_revision, tenant_key, status, display_name, created_at, updated_at
             ) VALUES ($1, 1, 'techknight-business', 'active', 'TechKnight', now(), now()),
                      ($2, 1, 'unson-business', 'active', 'Unson', now(), now())`,
            [tenantTechKnight, tenantUnson]
        );
        await pool.query(
            `INSERT INTO tenant_projects (
                project_id, tenant_id, tenant_revision_at_write, project_code, project_payload
             ) VALUES ('prj_techknight', $1, 1, 'techknight', '{}'::jsonb)`,
            [tenantTechKnight]
        );
        await pool.query(
            `INSERT INTO workspace_connections (
                connection_id, connection_revision, tenant_id, tenant_revision_at_write,
                provider, installation_id, workspace_id, app_id, granted_scopes,
                status, credential_ref, installed_at
             ) VALUES ('wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV', 1, $1, 1, 'slack',
                       'install-techknight', 'T_TECHKNIGHT', 'A_TECHKNIGHT',
                       ARRAY['chat:write'], 'active', 'credref://techknight/slack', now())`,
            [tenantTechKnight]
        );
        await pool.query('CREATE ROLE brainbase_human_provisioner_test_app NOLOGIN');
        await pool.query('GRANT USAGE ON SCHEMA public TO brainbase_human_provisioner_test_app');
        await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON
            organizations, people, auth_grants, brainbase_tenants, tenant_projects,
            workspace_connections, tenant_organizations, tenant_memberships,
            company_external_identities TO brainbase_human_provisioner_test_app`);
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await container?.stop();
    });

    async function connectAsProvisioner() {
        const client = await pool.connect();
        await client.query('SET ROLE brainbase_human_provisioner_test_app');
        return client;
    }

    it('commits, reads back on a fresh checkout, and remains invisible from another tenant', async () => {
        const applyClient = await connectAsProvisioner();
        try {
            const result = await provisionHumanCompanyAuthority({
                client: applyClient, manifest, actorId: 'integration-test', commit: true
            });
            expect(result.persisted).toBe(true);
        } finally {
            await applyClient.query('RESET ROLE');
            applyClient.release();
        }

        const readbackClient = await connectAsProvisioner();
        try {
            const readback = await readbackHumanCompanyAuthority({ client: readbackClient, manifest });
            expect(readback.humans[0]).toMatchObject({
                person_id: 'per_umeda_haruka',
                membership: {
                    membership_payload: {
                        slack_user_id: 'U_UMEDA', slack_workspace_id: 'T_TECHKNIGHT',
                        project_codes: ['techknight'], clearance: ['internal']
                    }
                },
                external_identity: { status: 'active', authenticated_subject_id: 'U_UMEDA' }
            });

            await readbackClient.query('BEGIN');
            await readbackClient.query("SELECT set_config('brainbase.tenant_id', $1, true)", [tenantUnson]);
            const hidden = await readbackClient.query(
                `SELECT
                    (SELECT count(*)::int FROM tenant_organizations) AS organizations,
                    (SELECT count(*)::int FROM tenant_memberships) AS memberships,
                    (SELECT count(*)::int FROM company_external_identities) AS identities`
            );
            expect(hidden.rows).toEqual([{ organizations: 0, memberships: 0, identities: 0 }]);
            await readbackClient.query('ROLLBACK');
        } finally {
            await readbackClient.query('ROLLBACK');
            await readbackClient.query('RESET ROLE');
            readbackClient.release();
        }
    }, 120_000);

    it('rolls every inserted state back when a later grant conflicts', async () => {
        await pool.query(
            `DELETE FROM company_external_identities;
             DELETE FROM tenant_memberships;
             DELETE FROM tenant_organizations;
             DELETE FROM auth_grants;
             DELETE FROM people WHERE id = 'per_umeda_haruka'`
        );
        await pool.query(
            `INSERT INTO people (id, name, status) VALUES ('per_conflict', 'Conflict', 'active');
             INSERT INTO auth_grants (
                id, person_id, person_name, slack_user_id, slack_workspace_id,
                role, project_codes, clearance, active
             ) VALUES ('grant_conflict', 'per_conflict', 'Conflict', 'U_UMEDA',
                       'T_TECHKNIGHT', 'member', ARRAY['other'], ARRAY['public'], true)`
        );
        const client = await connectAsProvisioner();
        try {
            await expect(provisionHumanCompanyAuthority({
                client, manifest, actorId: 'integration-test', commit: true
            })).rejects.toMatchObject({ code: 'AUTH_GRANT_CONFLICT' });
        } finally {
            await client.query('RESET ROLE');
            client.release();
        }
        expect((await pool.query(
            `SELECT
                (SELECT count(*)::int FROM tenant_organizations WHERE tenant_id = $1) AS organizations,
                (SELECT count(*)::int FROM tenant_memberships WHERE tenant_id = $1) AS memberships,
                (SELECT count(*)::int FROM company_external_identities WHERE tenant_id = $1) AS identities`,
            [tenantTechKnight]
        )).rows).toEqual([{ organizations: 0, memberships: 0, identities: 0 }]);
    }, 120_000);
});
