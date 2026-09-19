/*
 * Explicit local Docker run:
 * BRAINBASE_RUN_DOCKER_INTEGRATION=1 npm run test:run -- --maxWorkers=1 \
 *   tests/integration/outcome-service-resolvers-postgres.integration.test.js
 */

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import {
    attachTenantWorkspaceConnection,
    provisionTenantCore
} from '../../server/services/multitenant/tenant-provisioner.js';
import { MultitenantPostgresRepository } from '../../server/services/multitenant/postgres-repository.js';

const execFileAsync = promisify(execFile);
const { Pool } = pg;

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const POSTGRES_IMAGE = 'postgres:16-alpine';
const POSTGRES_PASSWORD = 'outcome-service-resolver-local-test-password';
const POSTGRES_DATABASE = 'outcome_service_resolver_test';
const APP_PASSWORD = 'outcome-service-resolver-app-password';
const TENANT_ID = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const TENANT_KEY = 'unson-business';
const ORGANIZATION_ID = 'org_unson';
const CONTRACT_ID = 'ctr_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const DEPLOYMENT_ID = 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const PROFILE_ID = 'mana-outcome';
const NOW = '2026-09-18T00:00:00Z';

const projects = [
    {
        projectCode: 'mana',
        projectId: 'project_mana',
        actorId: 'svc_mana_runtime',
        connectionId: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        workspaceId: 'T0123456789',
        appId: 'A0123456789',
        installationId: 'install_mana_01',
        credentialRef: 'credref://unson-business/slack/mana',
        resourceRef: 'outcome://mana'
    },
    {
        projectCode: 'mana-secondary',
        projectId: 'project_mana_secondary',
        actorId: 'svc_mana_secondary',
        connectionId: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW',
        workspaceId: 'T012345678A',
        appId: 'A012345678A',
        installationId: 'install_mana_02',
        credentialRef: 'credref://unson-business/slack/mana-secondary',
        resourceRef: 'outcome://mana-secondary'
    }
];

const projectByCode = new Map(projects.map((project) => [project.projectCode, project]));

const DOCKER_BIN = [
    '/usr/local/bin/docker',
    '/Applications/Docker.app/Contents/Resources/bin/docker',
    'docker'
].find((candidate) => candidate === 'docker' || existsSync(candidate));

function inspectDockerReadiness() {
    if (!DOCKER_BIN) {
        return { available: false, reason: 'Docker CLI was not found in the supported local paths' };
    }
    try {
        execFileSync(DOCKER_BIN, ['version'], { stdio: 'ignore', timeout: 5_000 });
    } catch {
        return { available: false, reason: 'Docker daemon is not reachable' };
    }
    try {
        execFileSync(DOCKER_BIN, ['image', 'inspect', POSTGRES_IMAGE], { stdio: 'ignore', timeout: 5_000 });
    } catch {
        return {
            available: false,
            reason: `${POSTGRES_IMAGE} is not available locally (the fixture never pulls images)`
        };
    }
    return { available: true, reason: '' };
}

const execDocker = async (args, options = {}) => execFileAsync(DOCKER_BIN || 'docker', args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 15_000,
    maxBuffer: 4 * 1024 * 1024
});

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findFreePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (!port) throw new Error('could not reserve a local port for the temporary Postgres container');
    return port;
}

async function waitForPostgres(pool, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        try {
            await pool.query('SELECT 1');
            return;
        } catch (error) {
            lastError = error;
            await delay(250);
        }
    }
    throw new Error(`temporary Postgres did not become ready: ${lastError?.message || 'timeout'}`);
}

async function removeContainer(containerName) {
    try {
        await execDocker(['rm', '--force', containerName], { timeout: 10_000 });
    } catch (error) {
        const message = `${String(error?.stderr || '')} ${String(error?.stdout || '')}`.toLowerCase();
        if (!message.includes('no such container') && !message.includes('no such object')) throw error;
    }
}

async function assertContainerAbsent(containerName) {
    try {
        await execDocker(['inspect', containerName], { timeout: 10_000 });
    } catch (error) {
        const message = `${String(error?.stderr || '')} ${String(error?.stdout || '')}`.toLowerCase();
        if (message.includes('no such container') || message.includes('no such object')) return;
        throw error;
    }
    throw new Error(`temporary Postgres container was not cleaned up: ${containerName}`);
}

function quoteIdentifier(identifier) {
    return `"${String(identifier).replaceAll('"', '""')}"`;
}

async function applySchemas(pool) {
    await pool.query(await fs.readFile(`${BACKEND}/server/sql/multitenant-platform-schema.sql`, 'utf8'));
    const productionSchema = await fs.readFile(
        `${BACKEND}/server/sql/tenant-production-provisioning-schema.sql`,
        'utf8'
    );
    await pool.query(productionSchema);
    return {
        productionSchema,
        schemaSha256: createHash('sha256').update(productionSchema).digest('hex')
    };
}

async function createApplicationRole(adminPool, appRole) {
    const role = quoteIdentifier(appRole);
    await adminPool.query(`CREATE ROLE ${role} LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
    await adminPool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await adminPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await adminPool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    // The production schema grants this function conditionally to the named
    // brainbase_app role.  This fixture uses a disposable role, so its
    // EXECUTE grant is explicit and intentionally recorded by the assertions.
    await adminPool.query(
        `GRANT EXECUTE ON FUNCTION public.resolve_active_tenant_for_organization(TEXT) TO ${role}`
    );
}

function contractRevision() {
    return {
        contract_id: CONTRACT_ID,
        revision: '1',
        status: 'active',
        effective_from: '2026-08-18T00:00:00Z',
        effective_until: null,
        plan_code: 'mana-standard',
        allowances: { tool_calls: 1000 },
        thresholds_basis_points: [5000, 8000, 10000],
        overage_policy: 'deny',
        hard_stop_basis_points: 10000,
        rate_card_revision: 8,
        fx_table_revision: 5,
        sales_price_revision: 3,
        capabilities: [
            'signed_tenant_context', 'connection_revision_recheck', 'tenant_scoped_authorization',
            'credential_broker_v1', 'usage_receipt_v1', 'idempotent_effects_v1', 'container_sanitization_v1'
        ],
        audience: ['mana-runtime'],
        deployment_id: DEPLOYMENT_ID,
        profile: 'shared_cloud'
    };
}

function coreManifest(project) {
    return {
        tenant_key: TENANT_KEY,
        tenant_id: TENANT_ID,
        display_name: 'Unson Business',
        project_code: project.projectCode,
        service_actor: {
            actor_id: project.actorId,
            canonical_project_id: project.projectId,
            capabilities: ['send_message']
        },
        contract_revision: contractRevision()
    };
}

function fullManifest(project) {
    return {
        ...coreManifest(project),
        workspace_connection: {
            provider: 'slack',
            workspace_id: project.workspaceId,
            app_id: project.appId,
            installation_id: project.installationId,
            connection_id: project.connectionId,
            credential_ref: project.credentialRef,
            credential_mode: 'customer_oauth',
            scopes: ['chat:write', 'signed_tenant_context']
        },
        outcome_service_profile: {
            profile_id: PROFILE_ID,
            schema_version: 'outcome_service_profile.v1',
            audience: 'mana-runtime',
            capability_id: 'signed_tenant_context',
            deployment_id: DEPLOYMENT_ID,
            workspace_id: project.workspaceId,
            app_id: project.appId,
            authenticated_subject_id: project.actorId,
            connection_id: project.connectionId,
            resource_ref: project.resourceRef,
            organization_ids: [ORGANIZATION_ID],
            data_scopes: ['graph:read'],
            billing_principal_id: 'billing_unson',
            profile: 'shared_cloud'
        }
    };
}

const graphResolver = {
    resolveCanonicalProject: async ({ project_code: projectCode }) => {
        const project = projectByCode.get(projectCode);
        return project
            ? { project_id: project.projectId, matches: 1 }
            : { project_id: null, matches: 0 };
    }
};

// These doubles stand in for the external Graph and credential authorities;
// all tenant/project/profile/connection persistence and resolver reads remain
// against the disposable PostgreSQL database.
const credentialResolver = {
    verifyOpaqueReference: async ({ tenant_key: tenantKey, allow_unregistered: allowUnregistered }) => ({
        tenant_key: tenantKey,
        valid: allowUnregistered === true
    })
};

async function provisionCore(client, project, schemaSha256, idempotencySuffix) {
    return provisionTenantCore({
        client,
        manifest: coreManifest(project),
        idempotencyKey: `outcome-resolver-core-${idempotencySuffix}`,
        actorId: `outcome-resolver-${idempotencySuffix}`,
        graphResolver,
        schemaSha256,
        now: NOW
    });
}

async function provisionConnection(client, project, schemaSha256, idempotencySuffix) {
    return attachTenantWorkspaceConnection({
        client,
        manifest: fullManifest(project),
        idempotencyKey: `outcome-resolver-connection-${idempotencySuffix}`,
        actorId: `outcome-resolver-${idempotencySuffix}`,
        graphResolver,
        credentialResolver,
        schemaSha256,
        now: NOW
    });
}

async function setTenantContext(client, tenantId) {
    await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [tenantId]);
}

async function run() {
    const containerName = `brainbase-outcome-resolver-pg-${process.pid}-${randomBytes(5).toString('hex')}`;
    const appRole = `outcome_resolver_app_${process.pid}_${randomBytes(3).toString('hex')}`;
    const port = await findFreePort();
    let containerStarted = false;
    let adminPool;
    let resolverPool;

    try {
        // This test never pulls an image and only touches its own named
        // disposable container.
        await execDocker(['image', 'inspect', POSTGRES_IMAGE]);
        await execDocker([
            'run', '--rm', '--detach', '--name', containerName,
            '--env', 'POSTGRES_USER=postgres',
            '--env', `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
            '--env', `POSTGRES_DB=${POSTGRES_DATABASE}`,
            '--publish', `127.0.0.1:${port}:5432`,
            POSTGRES_IMAGE
        ]);
        containerStarted = true;

        adminPool = new Pool({
            host: '127.0.0.1',
            port,
            user: 'postgres',
            password: POSTGRES_PASSWORD,
            database: POSTGRES_DATABASE,
            max: 4,
            connectionTimeoutMillis: 2_000,
            idleTimeoutMillis: 2_000
        });
        await waitForPostgres(adminPool);
        const { schemaSha256 } = await applySchemas(adminPool);
        await adminPool.query(
            `INSERT INTO brainbase_schema_migrations (migration_id, schema_sha256, applied_at, applied_by)
             VALUES ('tenant-production-provisioning.v1', $1, $2, 'outcome-resolver-integration')
             ON CONFLICT (migration_id) DO UPDATE SET schema_sha256 = EXCLUDED.schema_sha256`,
            [schemaSha256, NOW]
        );
        await createApplicationRole(adminPool, appRole);

        const appConnection = new URL(`postgresql://postgres:${encodeURIComponent(POSTGRES_PASSWORD)}@127.0.0.1:${port}/${POSTGRES_DATABASE}`);
        appConnection.username = appRole;
        appConnection.password = APP_PASSWORD;
        resolverPool = new Pool({
            connectionString: appConnection.toString(),
            max: 4,
            connectionTimeoutMillis: 2_000,
            idleTimeoutMillis: 2_000
        });
        await waitForPostgres(resolverPool);

        const provisioningClient = await resolverPool.connect();
        let provisioned;
        try {
            // The profile's organization ownership is checked while attaching
            // the connection. Register the tenant organization between the
            // core and connection phases, as production provisioning does.
            const firstCore = await provisionCore(provisioningClient, projects[0], schemaSha256, 'first');
            await provisioningClient.query('BEGIN');
            await setTenantContext(provisioningClient, TENANT_ID);
            await provisioningClient.query(
                `INSERT INTO tenant_organizations (
                    organization_id, tenant_id, tenant_revision_at_write, organization_payload
                 ) VALUES ($1, $2, 1, $3::jsonb)`,
                [ORGANIZATION_ID, TENANT_ID, JSON.stringify({ source: 'outcome-resolver-integration' })]
            );
            await provisioningClient.query('COMMIT');
            const firstConnection = await provisionConnection(
                provisioningClient,
                projects[0],
                schemaSha256,
                'first'
            );
            // A second canonical project carries the same profile_id.  Its
            // separate connection makes project scope observable in both
            // profile and connection resolver readback.
            const secondCore = await provisionCore(provisioningClient, projects[1], schemaSha256, 'second');
            const secondConnection = await provisionConnection(
                provisioningClient,
                projects[1],
                schemaSha256,
                'second'
            );
            provisioned = {
                first: { core: firstCore, connection: firstConnection },
                second: { core: secondCore, connection: secondConnection }
            };
        } finally {
            await provisioningClient.query('ROLLBACK').catch(() => {});
            provisioningClient.release();
        }

        const organizationTenant = await resolverPool.query(
            `SELECT tenant_id, organization_id
               FROM public.resolve_active_tenant_for_organization($1)`,
            [ORGANIZATION_ID]
        );
        const unknownOrganizationTenant = await resolverPool.query(
            `SELECT tenant_id, organization_id
               FROM public.resolve_active_tenant_for_organization($1)`,
            ['org_unknown_outcome_resolver']
        );
        const resolverPrivilege = await resolverPool.query(
            `SELECT has_function_privilege(
                        current_user,
                        'public.resolve_active_tenant_for_organization(text)',
                        'EXECUTE'
                    ) AS can_execute`
        );
        assert.equal(resolverPrivilege.rows[0]?.can_execute, true);
        assert.deepEqual(organizationTenant.rows, [{
            tenant_id: TENANT_ID,
            organization_id: ORGANIZATION_ID
        }]);
        assert.deepEqual(unknownOrganizationTenant.rows, []);

        const repository = new MultitenantPostgresRepository({
            pool: resolverPool,
            now: () => new Date(NOW)
        });
        const tenant = await repository.resolveOutcomeServiceTenant(TENANT_ID);
        const firstProfile = await repository.resolveOutcomeServiceProfile({
            tenant_id: TENANT_ID,
            project_id: projects[0].projectId,
            profile_id: PROFILE_ID
        });
        const secondProfile = await repository.resolveOutcomeServiceProfile({
            tenant_id: TENANT_ID,
            project_id: projects[1].projectId,
            profile_id: PROFILE_ID
        });
        const firstConnection = await repository.resolveOutcomeServiceConnection({
            tenant_id: TENANT_ID,
            project_id: projects[0].projectId,
            connection_id: projects[0].connectionId,
            profile_id: PROFILE_ID
        });
        const secondConnection = await repository.resolveOutcomeServiceConnection({
            tenant_id: TENANT_ID,
            project_id: projects[1].projectId,
            connection_id: projects[1].connectionId,
            profile_id: PROFILE_ID
        });

        const otherTenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAA';
        const crossTenant = {
            tenant: await repository.resolveOutcomeServiceTenant(otherTenantId),
            profile: await repository.resolveOutcomeServiceProfile({
                tenant_id: otherTenantId,
                project_id: projects[0].projectId,
                profile_id: PROFILE_ID
            }),
            connection: await repository.resolveOutcomeServiceConnection({
                tenant_id: otherTenantId,
                project_id: projects[0].projectId,
                connection_id: projects[0].connectionId,
                profile_id: PROFILE_ID
            })
        };

        assert.deepEqual(tenant, { tenant_id: TENANT_ID, tenant_revision: '1', status: 'active' });
        assert.equal(firstProfile?.profile_id, PROFILE_ID);
        assert.equal(secondProfile?.profile_id, PROFILE_ID);
        assert.notEqual(firstProfile?.connection_id, secondProfile?.connection_id);
        assert.equal(firstConnection?.snapshot.connection_id, projects[0].connectionId);
        assert.equal(secondConnection?.snapshot.connection_id, projects[1].connectionId);
        assert.equal(firstConnection?.snapshot.deployment_id, DEPLOYMENT_ID);
        assert.equal(secondConnection?.snapshot.deployment_id, DEPLOYMENT_ID);
        assert.equal(firstConnection?.credential.billing_principal_id, 'billing_unson');
        assert.equal(secondConnection?.credential.billing_principal_id, 'billing_unson');
        assert.deepEqual(crossTenant, { tenant: null, profile: null, connection: null });

        const profileRows = await adminPool.query(
            `SELECT project_id, profile_id, connection_id
               FROM tenant_outcome_service_profiles
              WHERE tenant_id = $1
              ORDER BY project_id`,
            [TENANT_ID]
        );
        const roleResult = await adminPool.query(
            `SELECT rolsuper, rolbypassrls
               FROM pg_roles
              WHERE rolname = $1`,
            [appRole]
        );
        assert.equal(roleResult.rowCount, 1, 'application role must exist');
        assert.equal(roleResult.rows[0].rolsuper, false, 'application role must be non-superuser');
        assert.equal(roleResult.rows[0].rolbypassrls, false, 'application role must not bypass RLS');
        const rlsResult = await adminPool.query(
            `SELECT relrowsecurity, relforcerowsecurity
               FROM pg_class
              WHERE oid = 'tenant_outcome_service_profiles'::regclass`
        );
        assert.equal(rlsResult.rowCount, 1);
        assert.equal(rlsResult.rows[0].relrowsecurity, true);
        assert.equal(rlsResult.rows[0].relforcerowsecurity, true);

        return {
            ok: true,
            contract: 'outcome-service-resolvers.postgres',
            database: `temporary ${POSTGRES_IMAGE}`,
            application_role: {
                superuser: roleResult.rows[0].rolsuper,
                bypass_rls: roleResult.rows[0].rolbypassrls,
                organization_tenant_resolver_execute: resolverPrivilege.rows[0].can_execute,
                organization_tenant_resolver_grant: 'explicit_fixture_role_grant'
            },
            organization_tenant_resolver: {
                known: organizationTenant.rows[0],
                unknown: unknownOrganizationTenant.rows[0] ?? null
            },
            same_profile_different_projects: {
                profile_id: PROFILE_ID,
                project_ids: profileRows.rows.map(({ project_id: projectId }) => projectId),
                rows: profileRows.rowCount,
                connections_distinct: firstProfile.connection_id !== secondProfile.connection_id
            },
            resolver_readback: {
                tenant,
                profiles: { first: firstProfile, second: secondProfile },
                connections: { first: firstConnection, second: secondConnection },
                cross_tenant: crossTenant
            },
            rls: {
                relrowsecurity: rlsResult.rows[0].relrowsecurity,
                relforcerowsecurity: rlsResult.rows[0].relforcerowsecurity
            },
            provisioned: {
                first: provisioned.first.connection.receipt.readback,
                second: provisioned.second.connection.receipt.readback
            },
            cleanup: 'completed'
        };
    } finally {
        await resolverPool?.end();
        await adminPool?.end();
        if (containerStarted) {
            await removeContainer(containerName);
            await assertContainerAbsent(containerName);
        }
    }
}

const dockerIntegrationRequested = process.env.BRAINBASE_RUN_DOCKER_INTEGRATION === '1';
const dockerReadiness = dockerIntegrationRequested
    ? inspectDockerReadiness()
    : { available: false, reason: 'set BRAINBASE_RUN_DOCKER_INTEGRATION=1 to run the disposable PostgreSQL fixture' };
const describeWithDocker = dockerIntegrationRequested && dockerReadiness.available ? describe : describe.skip;

if (!dockerReadiness.available) {
    console.warn(`[SKIP] Outcome service resolver PostgreSQL integration: ${dockerReadiness.reason}`);
}

describeWithDocker.sequential('Outcome service resolver PostgreSQL contract', () => {
    it('resolves tenant, same-profile project scopes, and tenant isolation', async () => {
        const result = await run();
        expect(result).toMatchObject({
            ok: true,
            contract: 'outcome-service-resolvers.postgres',
            database: `temporary ${POSTGRES_IMAGE}`,
            application_role: {
                superuser: false,
                bypass_rls: false,
                organization_tenant_resolver_execute: true,
                organization_tenant_resolver_grant: 'explicit_fixture_role_grant'
            },
            organization_tenant_resolver: {
                known: { tenant_id: TENANT_ID, organization_id: ORGANIZATION_ID },
                unknown: null
            },
            same_profile_different_projects: {
                profile_id: PROFILE_ID,
                project_ids: [projects[0].projectId, projects[1].projectId],
                rows: 2,
                connections_distinct: true
            },
            rls: { relrowsecurity: true, relforcerowsecurity: true },
            cleanup: 'completed'
        });
        expect(result.resolver_readback.cross_tenant).toEqual({
            tenant: null,
            profile: null,
            connection: null
        });
        expect(result.provisioned.first.outcome_service_profile).toEqual({
            profile_id: PROFILE_ID,
            profile_revision: '1'
        });
        expect(result.provisioned.second.outcome_service_profile).toEqual({
            profile_id: PROFILE_ID,
            profile_revision: '1'
        });
    }, 120_000);
});

export { run as checkOutcomeServiceResolversPostgres };
