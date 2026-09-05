import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runTenantProvisioningMigration } from '../../../../scripts/migrate-tenant-production-provisioning.js';
import {
    createInitialSlackInstallationAuthorization,
    provisionHumanCompanyAuthority,
    provisionInitialTenantAdmin,
    readbackInitialTenantAdmin,
    readbackHumanCompanyAuthority
} from '../../../../server/services/multitenant/human-company-authority-provisioner.js';
import {
    provisionHumanActionAuthority,
    readbackHumanActionAuthority
} from '../../../../server/services/multitenant/human-action-authority-provisioner.js';
import { PostgresCompanyAuthorityRepository } from '../../../../server/services/multitenant/postgres-company-authority-repository.js';
import { MultitenantPostgresRepository } from '../../../../server/services/multitenant/postgres-repository.js';
import { SlackInstallationControlPlane } from '../../../../server/services/multitenant/slack-installation-control-plane.js';
import { createSlackInstallationAccessResolver } from '../../../../server/services/multitenant/slack-installation-access.js';

const { Pool } = pg;
const tenantTechKnight = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const tenantUnson = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAW';
const tenantBootstrap = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX';
const umedaPersonId = 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY';
const satoPersonId = 'per_01ARZ3NDEKTSV4RRFFQ69G5FAZ';
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
        person_id: umedaPersonId,
        person_name: '梅田遼',
        slack_user_id: 'U_UMEDA',
        login_role: 'member',
        project_codes: ['techknight'],
        clearance: ['internal'],
        tenant_role: 'member',
        placement_id: 'techknight-slack-member'
    }]
};
const bootstrapManifest = {
    ...manifest,
    tenant_id: tenantBootstrap,
    organization: {
        organization_id: 'org_bootstrap_business',
        graph_organization_id: 'bootstrap',
        display_name: 'Bootstrap'
    },
    project: { project_id: 'prj_bootstrap', project_code: 'bootstrap' },
    transport: { provider: 'slack', workspace_id: 'T_BOOTSTRAP', app_id: 'A_BOOTSTRAP' },
    humans: [{
        person_id: satoPersonId,
        person_name: '佐藤 圭吾',
        slack_user_id: 'U_SATO',
        login_role: 'ceo',
        project_codes: ['bootstrap'],
        clearance: ['internal'],
        tenant_role: 'tenant_admin',
        placement_id: 'bootstrap-slack-admin'
    }]
};

async function insertActiveWorkspaceConnection(pool, {
    tenantId, connectionId, installationId, workspaceId, appId, credentialRef
}) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO workspace_connection_revisions (
                tenant_id, connection_id, connection_revision, connection_snapshot, recorded_at
             ) VALUES ($1, $2, 1, $3::jsonb, now())`,
            [tenantId, connectionId, JSON.stringify({
                provider: 'slack',
                installation_id: installationId,
                workspace_id: workspaceId,
                app_id: appId,
                granted_scopes: ['chat:write'],
                status: 'active',
                credential_ref: credentialRef
            })]
        );
        await client.query(
            `INSERT INTO workspace_connections (
                connection_id, connection_revision, tenant_id, tenant_revision_at_write,
                provider, installation_id, workspace_id, app_id, granted_scopes,
                status, credential_ref, installed_at
             ) VALUES ($1, 1, $2, 1, 'slack', $3, $4, $5,
                       ARRAY['chat:write'], 'active', $6, now())`,
            [connectionId, tenantId, installationId, workspaceId, appId, credentialRef]
        );
        await client.query('COMMIT');
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* preserve setup failure */ }
        throw error;
    } finally {
        client.release();
    }
}

describe.sequential('human company authority PostgreSQL boundary', () => {
    let container;
    let pool;
    let restrictedPool;

    beforeAll(async () => {
        container = await new PostgreSqlContainer('postgres:16-alpine').start();
        pool = new Pool({ connectionString: container.getConnectionUri() });
        await pool.query(await readFile(resolve(process.cwd(), 'server/sql/permission-schema.sql'), 'utf8'));
        await pool.query(
            `INSERT INTO organizations (id, name, workspace_id, projects)
             VALUES ('bootstrap', 'Bootstrap', 'T_BOOTSTRAP', ARRAY['bootstrap'])`
        );
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
                      ($2, 1, 'unson-business', 'active', 'Unson', now(), now()),
                      ($3, 1, 'bootstrap-business', 'active', 'Bootstrap', now(), now())`,
            [tenantTechKnight, tenantUnson, tenantBootstrap]
        );
        await runTenantProvisioningMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'integration-test' },
            pool
        });
        await pool.query(
            `INSERT INTO tenant_projects (
                project_id, tenant_id, tenant_revision_at_write, project_code, project_payload
             ) VALUES ('prj_techknight', $1, 1, 'techknight', '{}'::jsonb)`,
            [tenantTechKnight]
        );
        await pool.query(
            `INSERT INTO tenant_projects (
                project_id, tenant_id, tenant_revision_at_write, project_code, project_payload
             ) VALUES ('prj_bootstrap', $1, 1, 'bootstrap', '{}'::jsonb)`,
            [tenantBootstrap]
        );
        await insertActiveWorkspaceConnection(pool, {
            tenantId: tenantTechKnight,
            connectionId: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            installationId: 'install-techknight',
            workspaceId: 'T_TECHKNIGHT',
            appId: 'A_TECHKNIGHT',
            credentialRef: 'credref://techknight/slack'
        });
        await pool.query("CREATE ROLE brainbase_human_provisioner_test_app LOGIN PASSWORD 'test-only-password'");
        await pool.query('GRANT USAGE ON SCHEMA public TO brainbase_human_provisioner_test_app');
        await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON
            organizations, people, auth_grants, brainbase_tenants, tenant_projects,
            workspace_connections, tenant_organizations, tenant_memberships,
            company_external_identities, company_authority_bindings, slack_installation_intents
            TO brainbase_human_provisioner_test_app`);
        await pool.query(`GRANT EXECUTE ON FUNCTION
            resolve_company_authority_route(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
            TO brainbase_human_provisioner_test_app`);
        const restrictedUrl = new URL(container.getConnectionUri());
        restrictedUrl.username = 'brainbase_human_provisioner_test_app';
        restrictedUrl.password = 'test-only-password';
        restrictedPool = new Pool({ connectionString: restrictedUrl.toString() });
    }, 120_000);

    afterAll(async () => {
        await restrictedPool?.end();
        await pool?.end();
        await container?.stop();
    });

    async function connectAsProvisioner() {
        const client = await pool.connect();
        await client.query('SET ROLE brainbase_human_provisioner_test_app');
        return client;
    }

    it('bootstraps an admin before the first connection, then completes the same identity after OAuth', async () => {
        const bootstrapClient = await connectAsProvisioner();
        try {
            await expect(provisionInitialTenantAdmin({
                client: bootstrapClient,
                manifest: bootstrapManifest,
                actorId: 'integration-test',
                commit: true
            })).resolves.toMatchObject({ persisted: true });
        } finally {
            await bootstrapClient.query('RESET ROLE');
            bootstrapClient.release();
        }

        const singleConnectionPool = new Pool({ connectionString: container.getConnectionUri(), max: 1 });
        const readbackClient = await singleConnectionPool.connect();
        let readbackClientReleased = false;
        try {
            await readbackClient.query('SET ROLE brainbase_human_provisioner_test_app');
            await expect(readbackInitialTenantAdmin({
                client: readbackClient, manifest: bootstrapManifest
            })).resolves.toMatchObject({ human: { person_id: satoPersonId } });
            const repository = new MultitenantPostgresRepository({ pool: singleConnectionPool });
            const controlPlane = new SlackInstallationControlPlane({ repository });
            const authorization = await createInitialSlackInstallationAuthorization({
                client: readbackClient,
                manifest: bootstrapManifest,
                actorId: 'integration-test',
                controlPlane,
                oauthFlow: { createAuthorization: () => ({
                    authorization_url: 'https://slack.example/authorize?signed=1',
                    oauth_state: 'signed-state',
                    redirect_uri: 'https://bb.example/api/v1/slack-installations:callback'
                }) }
            });
            expect(authorization).toMatchObject({ initiated_by_person_id: satoPersonId });
            await readbackClient.query('RESET ROLE');
            readbackClient.release();
            readbackClientReleased = true;
            expect((await singleConnectionPool.query(
                `SELECT tenant_id, app_id, expected_workspace_id, initiated_by_principal_id
                   FROM slack_installation_intents
                  WHERE installation_intent_id = $1`,
                [authorization.installation_intent_id]
            )).rows).toEqual([{
                tenant_id: tenantBootstrap,
                app_id: 'A_BOOTSTRAP',
                expected_workspace_id: 'T_BOOTSTRAP',
                initiated_by_principal_id: satoPersonId
            }]);
        } finally {
            if (!readbackClientReleased) {
                try { await readbackClient.query('RESET ROLE'); } catch { /* preserve test failure */ }
                readbackClient.release();
            }
            await singleConnectionPool.end();
        }
        expect((await pool.query(
            'SELECT count(*)::int AS identities FROM company_external_identities WHERE tenant_id = $1',
            [tenantBootstrap]
        )).rows).toEqual([{ identities: 0 }]);

        await insertActiveWorkspaceConnection(pool, {
            tenantId: tenantBootstrap,
            connectionId: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAX',
            installationId: 'install-bootstrap',
            workspaceId: 'T_BOOTSTRAP',
            appId: 'A_BOOTSTRAP',
            credentialRef: 'credref://bootstrap/slack'
        });
        const completeClient = await connectAsProvisioner();
        try {
            const completed = await provisionHumanCompanyAuthority({
                client: completeClient,
                manifest: bootstrapManifest,
                actorId: 'integration-test',
                commit: true
            });
            expect(completed.plan.filter((entry) => entry.operation === 'noop')).toHaveLength(4);
            expect(completed.plan.filter((entry) => entry.entity === 'company_external_identity'))
                .toEqual([expect.objectContaining({ operation: 'create' })]);
        } finally {
            await completeClient.query('RESET ROLE');
            completeClient.release();
        }
    }, 120_000);

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
                person_id: umedaPersonId,
                membership: {
                    membership_payload: {
                        slack_user_id: 'U_UMEDA', slack_workspace_id: 'T_TECHKNIGHT',
                        project_codes: ['techknight'], clearance: ['internal']
                    }
                },
                external_identity: { status: 'active', authenticated_subject_id: 'U_UMEDA' }
            });

            const resolveSlackAccess = createSlackInstallationAccessResolver({
                companyAuthorityRepository: new PostgresCompanyAuthorityRepository({
                    pool: restrictedPool
                }),
                trustedAppId: 'A_TECHKNIGHT'
            });
            await expect(resolveSlackAccess({
                access: {
                    slackUserId: 'U_UMEDA',
                    slackWorkspaceId: 'T_TECHKNIGHT'
                }
            })).resolves.toMatchObject({
                tenantId: tenantTechKnight,
                personId: umedaPersonId,
                role: 'member',
                projectCodes: ['techknight']
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

    it('adds an exact human action binding and resolves it from a fresh checkout', async () => {
        const foundationClient = await restrictedPool.connect();
        let foundation;
        try {
            foundation = await readbackHumanCompanyAuthority({ client: foundationClient, manifest });
        } finally {
            foundationClient.release();
        }
        const human = foundation.humans[0];
        const actionManifest = {
            version: 'human-company-action-authority.v1',
            tenant_id: tenantTechKnight,
            organization_id: 'org_techknight_business',
            project: { project_id: 'prj_techknight', project_code: 'techknight' },
            transport: { provider: 'slack', workspace_id: 'T_TECHKNIGHT', app_id: 'A_TECHKNIGHT' },
            humans: [{
                person_id: umedaPersonId,
                slack_user_id: 'U_UMEDA',
                membership_id: human.membership.membership_id,
                membership_revision: String(human.membership.membership_payload.revision),
                identity_id: human.external_identity.identity_id,
                identity_revision: String(human.external_identity.identity_revision),
                placement_id: 'techknight-slack-member',
                bindings: [{
                    resource_ref: 'project:techknight',
                    capability_id: 'task.read',
                    decision: 'auto',
                    allowed_effects: ['read'],
                    responsible_person_id: umedaPersonId,
                    accountable_person_id: satoPersonId,
                    approver_person_id: null,
                    delegated_by_person_id: satoPersonId,
                    resource_revision: '1',
                    policy_revision: '1',
                    raci_revision: '1',
                    stop_conditions: [],
                    valid_from: '2026-01-01T00:00:00.000Z',
                    valid_until: null
                }]
            }]
        };
        const applyClient = await restrictedPool.connect();
        try {
            await expect(provisionHumanActionAuthority({
                client: applyClient,
                manifest: actionManifest,
                actorId: 'integration-test',
                commit: true
            })).resolves.toMatchObject({ persisted: true });
        } finally {
            applyClient.release();
        }

        const readbackClient = await restrictedPool.connect();
        try {
            await expect(readbackHumanActionAuthority({
                client: readbackClient,
                manifest: actionManifest
            })).resolves.toMatchObject({
                humans: [{
                    person_id: umedaPersonId,
                    bindings: [expect.objectContaining({
                        resource_ref: 'project:techknight',
                        capability_id: 'task.read',
                        decision: 'auto',
                        allowed_effects: ['read']
                    })]
                }]
            });
        } finally {
            readbackClient.release();
        }

        const repository = new PostgresCompanyAuthorityRepository({ pool: restrictedPool });
        await expect(repository.resolveCanonicalAuthority({
            tenant_id: tenantTechKnight,
            canonical_person_id: umedaPersonId,
            membership_id: human.membership.membership_id,
            membership_revision: String(human.membership.membership_payload.revision),
            organization_id: 'org_techknight_business',
            project_id: 'prj_techknight',
            resource_ref: 'project:techknight',
            capability_id: 'task.read',
            desired_effect: 'read'
        })).resolves.toMatchObject({
            decision: 'auto',
            allowed_effects: ['read'],
            responsible_person_id: umedaPersonId,
            accountable_person_id: satoPersonId
        });
    }, 120_000);

    it('rolls every inserted state back when a later grant conflicts', async () => {
        await pool.query(
            `DELETE FROM company_authority_bindings;
             DELETE FROM company_external_identities;
             DELETE FROM tenant_memberships;
             DELETE FROM tenant_organizations;
             DELETE FROM auth_grants;
             DELETE FROM people WHERE id = '${umedaPersonId}'`
        );
        await pool.query(
            `INSERT INTO people (id, name, status) VALUES ('per_conflict', 'Conflict', 'active');
             INSERT INTO auth_grants (
                id, person_id, person_name, slack_user_id, slack_workspace_id,
                organization_id, role, project_codes, clearance, active
             ) VALUES ('grant_conflict', 'per_conflict', 'Conflict', 'U_UMEDA',
                       'T_TECHKNIGHT', 'techknight', 'member', ARRAY['other'], ARRAY['public'], true)`
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
