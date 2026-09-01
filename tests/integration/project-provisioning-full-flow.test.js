import { randomUUID } from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import express from 'express';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { csrfMiddleware, csrfTokenHandler } from '../../server/middleware/csrf.js';
import { requireAuth } from '../../server/middleware/auth.js';
import { createProjectProvisioningRouter } from '../../server/routes/project-provisioning.js';
import { InfoSSOTService } from '../../server/services/info-ssot-service.js';
import { createProjectProvisioningService } from '../../server/services/project-provisioning/project-provisioning-service.js';

let serverUrl = '';

vi.mock('../../cli/config.js', () => ({
    getAuth: () => ({ token: 'signed-token', server_url: serverUrl }),
    getConfig: () => ({ server_url: serverUrl })
}));

import { runProjectProvisioning } from '../../cli/project-provisioning.js';

const { Pool } = pg;
const ORGANIZATION_ID = 'org_unson';
const PERSON_ID = 'person_owner';
const APP_ROLE = 'project_provisioning_test';
const APP_PASSWORD = 'project-provisioning-test';
const fullFlowManifest = path.resolve('tests/fixtures/project-provisioning-full-flow.json');
const partialFailureManifest = path.resolve('tests/fixtures/project-provisioning-partial-failure.json');

const actorAccess = {
    personId: PERSON_ID,
    role: 'gm',
    projectCodes: ['brainbase'],
    clearance: ['internal', 'restricted', 'finance', 'hr', 'contract'],
    organizationId: ORGANIZATION_ID,
    tenantId: ORGANIZATION_ID,
    authSource: 'bearer'
};

let container;
let adminPool;
let pool;
let infoSSOTService;
let currentService;
let server;
const graphProjects = new Set();
const graphPlans = new Map();
const graphAccessRecords = [];
const authGrantRecords = [];
let partialGrantFailureConsumed = false;

function copy(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function assertOrganization(value, source) {
    if (value !== ORGANIZATION_ID) {
        throw new Error(`${source} received an unexpected organization: ${value}`);
    }
}

function assertGraphAccess(access, projectCode) {
    assertOrganization(access.organizationId, 'Graph access');
    if (access.personId !== PERSON_ID || !access.projectCodes.includes(projectCode)) {
        throw new Error('Graph access did not preserve actor/project scope');
    }
    graphAccessRecords.push(copy(access));
}

function createGraphBoundary() {
    return {
        exportSnapshot: async (access, { projectCode }) => {
            assertGraphAccess(access, projectCode);
            return {
                snapshot_id: `snapshot-${projectCode}`,
                snapshot_hash: `hash-${projectCode}`,
                entities: graphProjects.has(projectCode) ? [{ id: projectCode }] : []
            };
        },
        planMutations: async (access, { projectCode, idempotencyKey }) => {
            assertGraphAccess(access, projectCode);
            const plan = {
                plan_id: `graph-plan-${projectCode}`,
                snapshot_hash: `hash-${projectCode}`,
                idempotency_key: idempotencyKey
            };
            graphPlans.set(plan.plan_id, plan);
            return plan;
        },
        applyPlan: async (access, { projectCode, planId }, { client = adminPool } = {}) => {
            assertGraphAccess(access, projectCode);
            const apply = async (scopedClient) => {
                const { rows } = await scopedClient.query(
                    `SELECT p.id AS project_id, pr.display_name, pr.catalog_version
                     FROM projects p
                     JOIN project_registry pr
                       ON pr.project_code=p.code AND pr.organization_id=p.organization_id
                     WHERE p.code=$1 AND p.organization_id=$2`,
                    [projectCode, ORGANIZATION_ID]
                );
                if (rows.length !== 1) throw new Error('Graph boundary could not read the provisioned project identity');
                const identity = rows[0];
                await scopedClient.query(
                    `INSERT INTO graph_entities
                        (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
                     VALUES ($1, 'project', $2, $3::jsonb, 'member', 'internal', 'active', 1)`,
                    [projectCode, identity.project_id, JSON.stringify({
                        name: identity.display_name,
                        catalog_project_id: projectCode,
                        catalog_version: identity.catalog_version,
                        source_ref: `project-catalog:${projectCode}@${identity.catalog_version}`
                    })]
                );
                graphProjects.add(projectCode);
                const receipt = { receipt_id: `graph-apply-${projectCode}` };
                graphPlans.set(planId, { ...graphPlans.get(planId), apply_receipt_id: receipt.receipt_id });
                return receipt;
            };
            if (client === adminPool) return apply(client);
            return infoSSOTService.withAccessContext({
                ...access,
                organizationId: ORGANIZATION_ID,
                projectCodes: [...new Set([...(access.projectCodes || []), projectCode])],
                graphMaintenanceMode: true
            }, apply, { client });
        },
        getPlanReceipt: async (access, { projectCode, planId }) => {
            assertGraphAccess(access, projectCode);
            const plan = graphPlans.get(planId);
            if (!plan) throw new Error('Plan receipt is required');
            return {
                plan_id: planId,
                receipts: [{
                    receipt_id: plan.apply_receipt_id,
                    plan_id: planId,
                    receipt_type: 'apply',
                    status: 'completed',
                    result: { idempotency_key: plan.idempotency_key }
                }]
            };
        },
        validate: async (access, { projectCode }) => {
            assertGraphAccess(access, projectCode);
            return { valid: graphProjects.has(projectCode) };
        }
    };
}

function wrapProductionAuthGrantService(service) {
    const productionAuthGrantService = service.authGrantService;
    return {
        addProjectGrant: async (input) => {
            assertOrganization(input.organizationId, 'project grant write');
            if (input.personId !== PERSON_ID) throw new Error('actor was not propagated to grant write');
            authGrantRecords.push(copy(input));
            if (input.projectCode === 'acceptance-partial-failure' && !partialGrantFailureConsumed) {
                partialGrantFailureConsumed = true;
                throw Object.assign(new Error('temporary grant failure'), {
                    code: 'TEMPORARY_GRANT_FAILURE',
                    statusCode: 503
                });
            }
            return productionAuthGrantService.addProjectGrant(input);
        },
        readProjectGrant: async (input) => {
            assertOrganization(input.organizationId, 'project grant readback');
            return productionAuthGrantService.readProjectGrant(input);
        }
    };
}

function createService() {
    const service = createProjectProvisioningService({ infoSSOTService });
    service.graphService = createGraphBoundary();
    service.authGrantService = wrapProductionAuthGrantService(service);
    return service;
}

async function applySql(fileName, targetPool = adminPool) {
    const sql = await readFile(path.resolve('server/sql', fileName), 'utf8');
    await targetPool.query(sql.replace(/^\\set ON_ERROR_STOP on\s*$/m, ''));
}

async function setupDatabase() {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const adminConnectionString = container.getConnectionUri();
    adminPool = new Pool({ connectionString: adminConnectionString });

    await adminPool.query('CREATE ROLE brainbase_app NOLOGIN');
    await applySql('info-ssot-schema.sql');
    await applySql('permission-schema.sql');
    await applySql('project-provisioning-schema.sql');
    await applySql('info-ssot-rls.sql');
    await applySql('info-ssot-readback.sql');
    const runtimeProbePrivilege = await adminPool.query(
        `SELECT has_function_privilege('brainbase_app', 'project_graph_identity_probe(text)', 'EXECUTE') AS allowed`
    );
    expect(runtimeProbePrivilege.rows[0].allowed).toBe(true);

    await adminPool.query(`
        INSERT INTO organizations (id, name, workspace_id, projects)
        VALUES ('${ORGANIZATION_ID}', 'UNSON Integration', 'WS_ORG_UNSON', ARRAY['brainbase'])
        ON CONFLICT (id) DO NOTHING;
        INSERT INTO people (id, name, status)
        VALUES ('${PERSON_ID}', 'Integration Owner', 'active')
        ON CONFLICT (id) DO UPDATE SET status='active';
        INSERT INTO projects (id, code, name, organization_id)
        VALUES ('project_brainbase', 'brainbase', 'Brainbase', '${ORGANIZATION_ID}')
        ON CONFLICT (code) DO UPDATE SET organization_id=EXCLUDED.organization_id;
        INSERT INTO graph_entities
            (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
        VALUES
            ('${ORGANIZATION_ID}', 'org', 'project_brainbase', '{"name":"UNSON Integration"}',
             'member', 'internal', 'active', 1)
        ON CONFLICT (id) DO NOTHING;
        INSERT INTO auth_grants
            (id, person_id, person_name, slack_user_id, slack_workspace_id, role,
             project_codes, clearance, active)
        VALUES
            ('grant_integration_owner', '${PERSON_ID}', 'Integration Owner', 'U_INTEGRATION',
             'WS_ORG_UNSON', 'gm', ARRAY['brainbase'],
             ARRAY['internal','restricted','finance','hr','contract'], true)
        ON CONFLICT (id) DO UPDATE SET
            person_id=EXCLUDED.person_id,
            slack_workspace_id=EXCLUDED.slack_workspace_id,
            role=EXCLUDED.role,
            project_codes=EXCLUDED.project_codes,
            clearance=EXCLUDED.clearance,
            active=true;

        INSERT INTO organizations (id, name, workspace_id, projects)
        VALUES ('org_other', 'Other Integration', 'WS_ORG_OTHER', ARRAY['brainbase'])
        ON CONFLICT (id) DO NOTHING;
        INSERT INTO projects (id, code, name, organization_id)
        VALUES ('project_other', 'other-project', 'Other Project', 'org_other')
        ON CONFLICT (code) DO UPDATE SET organization_id=EXCLUDED.organization_id;
        INSERT INTO graph_entities
            (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
        VALUES
            ('org_other', 'org', 'project_other', '{"name":"Other Integration"}',
             'member', 'internal', 'active', 1)
        ON CONFLICT (id) DO NOTHING;
        INSERT INTO people (id, name, status)
        VALUES
            ('person_inactive', 'Inactive Owner', 'inactive'),
            ('person_no_grant', 'Owner Without Grant', 'active'),
            ('person_wrong_workspace', 'Owner With Wrong Workspace', 'active')
        ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status;
        INSERT INTO auth_grants
            (id, person_id, person_name, slack_user_id, slack_workspace_id, role,
             project_codes, clearance, active)
        VALUES
            ('grant_wrong_workspace', 'person_wrong_workspace', 'Owner With Wrong Workspace',
             'U_WRONG_WORKSPACE', 'WS_ORG_OTHER', 'gm', ARRAY['brainbase'], ARRAY['internal'], true)
        ON CONFLICT (id) DO UPDATE SET
            person_id=EXCLUDED.person_id,
            slack_workspace_id=EXCLUDED.slack_workspace_id,
            active=true;
    `);

    await adminPool.query(`
        CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
        GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
        GRANT SELECT ON organizations, people, auth_grants, graph_entities, graph_edges, projects,
            graph_maintenance_snapshots, graph_maintenance_plans, graph_maintenance_receipts, project_registry,
            project_provisioning_runs, project_provisioning_steps TO ${APP_ROLE};
        GRANT UPDATE ON organizations TO ${APP_ROLE};
        GRANT INSERT, UPDATE ON projects, auth_grants, project_registry,
            project_provisioning_runs, project_provisioning_steps TO ${APP_ROLE};
        GRANT UPDATE ON graph_entities, graph_edges, graph_maintenance_plans TO ${APP_ROLE};
        GRANT INSERT ON graph_entities, graph_maintenance_snapshots, graph_maintenance_plans,
            graph_maintenance_receipts TO ${APP_ROLE};
        GRANT EXECUTE ON FUNCTION project_code_collision_sources(text,text),
            project_graph_identity_probe(text), claim_project_code(text,text) TO ${APP_ROLE};
    `);

    const appUrl = new URL(adminConnectionString);
    appUrl.username = APP_ROLE;
    appUrl.password = APP_PASSWORD;
    pool = new Pool({ connectionString: appUrl.toString(), max: 8 });
    const roleReadback = await pool.query(`
        SELECT r.rolsuper, r.rolbypassrls
        FROM pg_roles r
        WHERE r.rolname = current_user
    `);
    expect(roleReadback.rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
    infoSSOTService = new InfoSSOTService({ pool });
}

const authService = {
    verifyToken: vi.fn((token) => {
        if (token !== 'signed-token') throw new Error('invalid token');
        return {
            sub: PERSON_ID,
            role: 'gm',
            projectCodes: ['brainbase'],
            clearance: ['internal', 'restricted', 'finance', 'hr', 'contract'],
            organizationId: ORGANIZATION_ID,
            tenantId: ORGANIZATION_ID
        };
    })
};

const serviceProxy = {
    check: (...args) => currentService.check(...args),
    plan: (...args) => currentService.plan(...args),
    status: (...args) => currentService.status(...args),
    approve: (...args) => currentService.approve(...args),
    apply: (...args) => currentService.apply(...args),
    verify: (...args) => currentService.verify(...args),
    resume: (...args) => currentService.resume(...args)
};

const app = express();
app.use(express.json());
app.use(csrfMiddleware());
app.get('/api/csrf-token', csrfTokenHandler);
app.use(
    '/api/project-provisioning',
    requireAuth(authService, { allowInsecureHeaders: false }),
    createProjectProvisioningRouter({ service: serviceProxy })
);

async function cli(subcommand, args) {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
        await runProjectProvisioning(subcommand, args);
        const output = log.mock.calls.at(-1)?.[0];
        expect(output).toBeDefined();
        return JSON.parse(output);
    } finally {
        log.mockRestore();
    }
}

function projectManifest(projectCode, displayName, overrides = {}) {
    return {
        schema_version: 'project-provisioning.v1',
        project_code: projectCode,
        display_name: displayName,
        kind: 'client',
        catalog_version: 1,
        session_select: true,
        organization_entity_id: ORGANIZATION_ID,
        owner_person_id: PERSON_ID,
        initial_grants: [],
        repository: { mode: 'none' },
        ...overrides
    };
}

async function cliManifest(subcommand, manifest, args = []) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'project-provisioning-acceptance-'));
    const manifestPath = path.join(directory, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest));
    try {
        return await cli(subcommand, ['--manifest', manifestPath, ...args]);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

async function httpProvisioningRequest(route, { method = 'GET', body, idempotencyKey } = {}) {
    const authHeaders = { Authorization: 'Bearer signed-token' };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        const sessionId = `project-provisioning-acceptance-${randomUUID()}`;
        const csrfResponse = await fetch(`${serverUrl}/api/csrf-token`, {
            headers: { ...authHeaders, 'x-session-id': sessionId }
        });
        const csrfPayload = await csrfResponse.json();
        expect(csrfResponse.ok).toBe(true);
        expect(csrfPayload.token).toEqual(expect.any(String));
        authHeaders['x-session-id'] = sessionId;
        authHeaders['x-csrf-token'] = csrfPayload.token;
    }
    const response = await fetch(`${serverUrl}/api/project-provisioning${route}`, {
        method,
        headers: {
            ...authHeaders,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    return { response, payload: await response.json() };
}

async function removePersistedGraphPreflight(runId) {
    await infoSSOTService.withAccessContext(actorAccess, (client) => client.query(
        `UPDATE project_provisioning_runs
         SET plan=jsonb_set(
             plan,
             '{preflight}',
             (COALESCE(plan->'preflight', '{}'::jsonb) - 'graph_project_subject'),
             true
         )
         WHERE run_id=$1 AND organization_id=$2`,
        [runId, ORGANIZATION_ID]
    ));
    const { rows } = await adminPool.query(
        `SELECT plan->'preflight'->'graph_project_subject' AS graph_project_subject
         FROM project_provisioning_runs
         WHERE run_id=$1 AND organization_id=$2`,
        [runId, ORGANIZATION_ID]
    );
    expect(rows[0]?.graph_project_subject ?? null).toBeNull();
}

async function insertGraphProjectSubject({
    entityId,
    projectId = 'project_brainbase',
    payload,
    version = 1,
    entityType = 'project',
    lifecycleStatus = 'active'
}) {
    await adminPool.query(
        `INSERT INTO graph_entities
            (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
         VALUES ($1, $2, $3, $4::jsonb, 'member', 'internal', $5, $6)
         ON CONFLICT (id) DO UPDATE SET
             entity_type=EXCLUDED.entity_type,
             project_id=EXCLUDED.project_id,
             payload=EXCLUDED.payload,
             lifecycle_status=EXCLUDED.lifecycle_status,
             version=EXCLUDED.version`,
        [entityId, entityType, projectId, JSON.stringify(payload), lifecycleStatus, version]
    );
}

async function waitForAdvisoryLockWaiter() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const { rows } = await adminPool.query(
            `SELECT COUNT(*)::integer AS waiting
             FROM pg_locks
             WHERE locktype='advisory' AND granted=false`
        );
        if (rows[0]?.waiting > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('project Graph identity apply did not wait for the concurrent writer');
}

async function readNoWriteState(projectCode) {
    const [projects, registry, claims, entities] = await Promise.all([
        adminPool.query(
            `SELECT id, code, name, organization_id
             FROM projects WHERE code=$1 ORDER BY id`,
            [projectCode]
        ),
        adminPool.query(
            `SELECT project_code, organization_id, display_name, kind, catalog_version
             FROM project_registry WHERE project_code=$1 ORDER BY project_code`,
            [projectCode]
        ),
        adminPool.query(
            `SELECT project_code, organization_id
             FROM project_code_claims WHERE project_code=$1 ORDER BY project_code`,
            [projectCode]
        ),
        adminPool.query(
            `SELECT id, project_id, entity_type, payload, lifecycle_status, version
             FROM graph_entities WHERE id=$1 ORDER BY id`,
            [projectCode]
        )
    ]);
    return {
        projects: projects.rows,
        registry: registry.rows,
        claims: claims.rows,
        entities: entities.rows
    };
}

async function readLedger(runId) {
    return infoSSOTService.withAccessContext(actorAccess, async (client) => {
        const { rows } = await client.query(`
            SELECT r.state,
                   r.actor->>'personId' AS actor_person_id,
                   r.actor->>'organizationId' AS actor_organization_id,
                   COUNT(s.*)::integer AS step_count,
                   COUNT(*) FILTER (WHERE s.state='completed')::integer AS completed_step_count
            FROM project_provisioning_runs r
            LEFT JOIN project_provisioning_steps s
              ON s.run_id=r.run_id AND s.organization_id=r.organization_id
            WHERE r.run_id=$1 AND r.organization_id=$2
            GROUP BY r.run_id
        `, [runId, ORGANIZATION_ID]);
        return rows[0] || null;
    });
}

function observeProductionSharedClient(service) {
    const transactionClients = [];
    const graphClients = [];
    const originalTransaction = service.repository.withOrganizationTransaction.bind(service.repository);
    service.repository.withOrganizationTransaction = (organizationId, handler) => originalTransaction(
        organizationId,
        async (client) => {
            transactionClients.push(client);
            return handler(client);
        }
    );
    for (const methodName of [
        'listAccessibleProjectCodes', 'exportSnapshot', 'planMutations',
        'applyPlan', 'getPlanReceipt', 'validate'
    ]) {
        const originalMethod = service.graphService[methodName].bind(service.graphService);
        service.graphService[methodName] = async (...args) => {
            const options = args.at(-1);
            if (options?.client) graphClients.push({ methodName, client: options.client });
            return originalMethod(...args);
        };
    }
    return { transactionClients, graphClients };
}

describe.sequential('Project Provisioning acceptance E2E', () => {
    beforeAll(async () => {
        vi.stubEnv('NODE_ENV', 'production');
        await setupDatabase();
        currentService = createService();
        server = http.createServer(app);
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                if (!address || typeof address === 'string') {
                    reject(new Error('acceptance server did not receive a TCP address'));
                    return;
                }
                serverUrl = `http://127.0.0.1:${address.port}`;
                resolve();
            });
        });
    }, 300_000);

    afterAll(async () => {
        if (server) {
            server.closeAllConnections?.();
            await new Promise((resolve) => server.close(resolve));
        }
        await pool?.end();
        await adminPool?.end();
        await container?.stop();
        vi.unstubAllEnvs();
    }, 300_000);

    it('実PostgreSQL authorityは不正組織・組織横断entity・inactive owner・grant欠落/別workspaceを拒否する', async () => {
        const repository = currentService.repository;
        const baseManifest = {
            organization_entity_id: ORGANIZATION_ID,
            owner_person_id: PERSON_ID
        };

        await expect(repository.verifyManifestAuthority(baseManifest, {
            ...actorAccess, organizationId: 'org_missing', tenantId: 'org_missing'
        })).resolves.toMatchObject({ organization_exists: false });
        await expect(repository.verifyManifestAuthority({
            ...baseManifest, organization_entity_id: 'org_other'
        }, actorAccess)).resolves.toMatchObject({ organization_entity_exists: false });
        await expect(repository.verifyManifestAuthority({
            ...baseManifest, owner_person_id: 'person_inactive'
        }, actorAccess)).resolves.toMatchObject({
            owner_person_exists: false,
            owner_has_organization_grant: false
        });
        await expect(repository.verifyManifestAuthority({
            ...baseManifest, owner_person_id: 'person_no_grant'
        }, actorAccess)).resolves.toMatchObject({
            owner_person_exists: true,
            owner_has_organization_grant: false
        });
        await expect(repository.verifyManifestAuthority({
            ...baseManifest, owner_person_id: 'person_wrong_workspace'
        }, actorAccess)).resolves.toMatchObject({
            owner_person_exists: true,
            owner_has_organization_grant: false
        });
    }, 300_000);

    it('実PostgreSQLのGraph同一ID probeは同一組織だけidentityを返し他組織の詳細を隠す', async () => {
        await adminPool.query(`
            INSERT INTO graph_entities
                (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
            VALUES
                ('probe-same', 'project', 'project_brainbase',
                 '{"name":"Probe Same","catalog_project_id":"probe-same","catalog_version":1,"source_ref":"project-catalog:probe-same@1"}',
                 'member', 'internal', 'active', 2),
                ('probe-incompatible', 'project', 'project_brainbase',
                 '{"name":"Wrong Identity","catalog_project_id":"probe-incompatible","catalog_version":1,"source_ref":"project-catalog:probe-incompatible@1"}',
                 'member', 'internal', 'active', 2),
                ('probe-other', 'project', 'project_other',
                 '{"name":"Secret Other","catalog_project_id":"probe-other","catalog_version":1,"source_ref":"project-catalog:probe-other@1"}',
                 'member', 'internal', 'active', 4)
            ON CONFLICT (id) DO NOTHING
        `);

        await expect(currentService.repository.findProjectSubjectIdentity('probe-same', ORGANIZATION_ID))
            .resolves.toMatchObject({
                scope_relation: 'same_organization', entity_id: 'probe-same',
                entity_type: 'project', project_code: 'brainbase', entity_version: 2,
                display_name: 'Probe Same', catalog_project_id: 'probe-same', catalog_version: 1
            });
        await expect(currentService.repository.findProjectSubjectIdentity('probe-other', ORGANIZATION_ID))
            .resolves.toEqual({
                scope_relation: 'other_organization', entity_id: 'probe-other',
                entity_type: null, lifecycle_status: null, project_code: null,
                entity_version: null, display_name: null, catalog_project_id: null,
                catalog_version: null, source_ref: null
            });
        await expect(currentService.repository.findProjectSubjectIdentity('probe-absent', ORGANIZATION_ID))
            .resolves.toBeNull();

        const probeManifest = (projectCode, displayName) => ({
            schema_version: 'project-provisioning.v1', project_code: projectCode,
            display_name: displayName, kind: 'client', catalog_version: 1,
            session_select: true, organization_entity_id: ORGANIZATION_ID,
            owner_person_id: PERSON_ID, initial_grants: [], repository: { mode: 'none' }
        });
        await expect(currentService.check(actorAccess, probeManifest('probe-same', 'Probe Same')))
            .resolves.toMatchObject({
                ok: true,
                graph_project_subject: { status: 'reusable', project_code: 'brainbase', entity_version: 2 }
            });
        await expect(currentService.check(actorAccess, probeManifest('probe-incompatible', 'Expected Identity')))
            .resolves.toMatchObject({
                ok: false,
                graph_project_subject: { status: 'conflict' },
                collisions: expect.arrayContaining([expect.objectContaining({ source: 'graph_identity_conflict' })])
            });
        await expect(currentService.check(actorAccess, probeManifest('probe-other', 'Hidden Other')))
            .resolves.toMatchObject({ ok: false, graph_project_subject: { status: 'conflict' } });
        await expect(currentService.check(
            { ...actorAccess, projectCodes: [] },
            probeManifest('probe-same', 'Probe Same')
        )).resolves.toMatchObject({
            ok: false,
            collisions: expect.arrayContaining([expect.objectContaining({ source: 'graph_scope_unavailable' })])
        });
    }, 300_000);

    it('実PostgreSQLとproduction Graphで既存Project subjectをplanから最終readbackまで再利用する', async () => {
        const projectCode = 'acceptance-existing-subject';
        const displayName = 'Acceptance Existing Subject';
        await adminPool.query(`
            INSERT INTO graph_entities
                (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
            VALUES
                ($1, 'project', 'project_brainbase', $2::jsonb,
                 'member', 'internal', 'active', 3)
            ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload, version=EXCLUDED.version
        `, [projectCode, JSON.stringify({
            name: displayName,
            catalog_project_id: projectCode,
            catalog_version: 1,
            source_ref: `project-catalog:${projectCode}@1`
        })]);
        const productionService = createProjectProvisioningService({ infoSSOTService });
        const reuseManifest = {
            schema_version: 'project-provisioning.v1',
            project_code: projectCode,
            display_name: displayName,
            kind: 'client',
            catalog_version: 1,
            session_select: true,
            organization_entity_id: ORGANIZATION_ID,
            owner_person_id: PERSON_ID,
            initial_grants: [],
            repository: { mode: 'none' }
        };

        const checked = await productionService.check(actorAccess, reuseManifest);
        expect(checked).toMatchObject({
            ok: true,
            graph_project_subject: { status: 'reusable', project_code: 'brainbase', entity_version: 3 },
            writes_performed: 0
        });
        const plan = await productionService.plan(actorAccess, reuseManifest, {
            idempotencyKey: 'acceptance-existing-subject'
        });
        await productionService.approve(actorAccess, plan.run_id, {
            approvedGates: ['manifest_plan_approval'],
            reviewRef: 'acceptance-existing-subject-review'
        });
        const applied = await productionService.apply(actorAccess, plan.run_id);

        expect(applied).toMatchObject({ state: 'active', receipt: { verified: true } });
        expect(applied.steps.find((step) => step.step_name === 'graph').receipt).toMatchObject({
            status: 'already_materialized', project_code: 'brainbase', entity_version: 3
        });
    }, 300_000);

    it('実PostgreSQLのproduction Repository transactionとGraph shared clientで新規subject・Registry・claimを同時commitする', async () => {
        const projectCode = 'acceptance-production-graph-commit';
        const displayName = 'Acceptance Production Graph Commit';
        const productionService = createProjectProvisioningService({ infoSSOTService });
        const observed = observeProductionSharedClient(productionService);
        const manifest = projectManifest(projectCode, displayName);
        const planned = await productionService.plan(actorAccess, manifest, {
            idempotencyKey: projectCode
        });
        await productionService.approve(actorAccess, planned.run_id, {
            approvedGates: ['manifest_plan_approval'],
            reviewRef: `${projectCode}-review`
        });

        const applied = await productionService.apply(actorAccess, planned.run_id);

        expect(applied).toMatchObject({ state: 'active', receipt: { verified: true } });
        expect(observed.transactionClients).toHaveLength(1);
        expect(observed.graphClients.length).toBeGreaterThanOrEqual(6);
        expect(new Set(observed.graphClients.map(({ client }) => client))).toEqual(
            new Set([observed.transactionClients[0]])
        );
        const state = await readNoWriteState(projectCode);
        expect(state.projects).toEqual([{
            id: `project_${projectCode.replaceAll('-', '_')}`,
            code: projectCode,
            name: displayName,
            organization_id: ORGANIZATION_ID
        }]);
        expect(state.registry).toEqual([{
            project_code: projectCode,
            organization_id: ORGANIZATION_ID,
            display_name: displayName,
            kind: 'client',
            catalog_version: 1
        }]);
        expect(state.claims).toEqual([{
            project_code: projectCode,
            organization_id: ORGANIZATION_ID
        }]);
        expect(state.entities).toEqual([expect.objectContaining({
            id: projectCode,
            project_id: `project_${projectCode.replaceAll('-', '_')}`,
            entity_type: 'project',
            payload: expect.objectContaining({
                name: displayName,
                catalog_project_id: projectCode,
                catalog_version: 1,
                source_ref: `project-catalog:${projectCode}@1`
            }),
            lifecycle_status: 'active',
            version: 1
        })]);
        const graphStep = applied.steps.find((step) => step.step_name === 'graph');
        expect(graphStep.receipt).toMatchObject({
            project_code: projectCode,
            receipt: { plan_id: expect.any(String), receipts: [expect.objectContaining({
                receipt_type: 'apply', status: 'completed'
            })] },
            validation: { valid: true }
        });
        const maintenance = await adminPool.query(
            `SELECT p.status, COUNT(r.id)::integer AS receipt_count
             FROM graph_maintenance_plans p
             LEFT JOIN graph_maintenance_receipts r ON r.plan_id=p.id
             WHERE p.organization_id=$1 AND p.idempotency_key=$2
             GROUP BY p.status`,
            [ORGANIZATION_ID, `project-provisioning:${planned.run_id}:graph`]
        );
        expect(maintenance.rows).toEqual([{ status: 'applied', receipt_count: 1 }]);
    }, 300_000);

    it('実PostgreSQLのproduction Graph書込み後に失敗を注入するとRegistry・claim・Graphを全てrollbackする', async () => {
        const projectCode = 'acceptance-production-graph-rollback';
        const displayName = 'Acceptance Production Graph Rollback';
        const productionService = createProjectProvisioningService({ infoSSOTService });
        const observed = observeProductionSharedClient(productionService);
        const productionApplyPlan = productionService.graphService.applyPlan.bind(productionService.graphService);
        let graphWriteObserved = false;
        productionService.graphService.applyPlan = async (...args) => {
            await productionApplyPlan(...args);
            const client = args.at(-1)?.client;
            const { rows } = await client.query(
                'SELECT id FROM graph_entities WHERE id=$1',
                [projectCode]
            );
            graphWriteObserved = rows.length === 1;
            throw Object.assign(new Error('injected Graph apply failure'), {
                code: 'TEST_GRAPH_APPLY_FAILURE',
                statusCode: 503
            });
        };
        const planned = await productionService.plan(
            actorAccess,
            projectManifest(projectCode, displayName),
            { idempotencyKey: projectCode }
        );
        await productionService.approve(actorAccess, planned.run_id, {
            approvedGates: ['manifest_plan_approval'],
            reviewRef: `${projectCode}-review`
        });

        await expect(productionService.apply(actorAccess, planned.run_id)).rejects.toMatchObject({
            code: 'TEST_GRAPH_APPLY_FAILURE'
        });

        expect(graphWriteObserved).toBe(true);
        expect(observed.transactionClients).toHaveLength(1);
        expect(observed.graphClients.length).toBeGreaterThanOrEqual(4);
        expect(new Set(observed.graphClients.map(({ client }) => client))).toEqual(
            new Set([observed.transactionClients[0]])
        );
        expect(await readNoWriteState(projectCode)).toEqual({
            projects: [], registry: [], claims: [], entities: []
        });
        const maintenance = await adminPool.query(
            `SELECT p.id
             FROM graph_maintenance_plans p
             WHERE p.organization_id=$1 AND p.idempotency_key=$2`,
            [ORGANIZATION_ID, `project-provisioning:${planned.run_id}:graph`]
        );
        expect(maintenance.rows).toEqual([]);
        expect(await readLedger(planned.run_id)).toMatchObject({
            state: 'partial_failed',
            step_count: 4,
            completed_step_count: 0
        });
        await expect(productionService.status(actorAccess, planned.run_id)).resolves.toMatchObject({
            state: 'partial_failed',
            failure: { code: 'TEST_GRAPH_APPLY_FAILURE' }
        });
    }, 300_000);

    it('受入れE2E: legacy planのGraph preflightを実HTTP/CLIで再開し、absent・reusable・incompatibleを分岐する', async () => {
        const absentManifest = projectManifest(
            'acceptance-legacy-absent',
            'Acceptance Legacy Absent'
        );
        expect(await cliManifest('check', absentManifest)).toMatchObject({
            ok: true,
            graph_project_subject: { status: 'absent' },
            writes_performed: 0
        });
        const absentPlan = await cliManifest('plan', absentManifest, [
            '--idempotency-key', 'acceptance-legacy-absent'
        ]);
        await removePersistedGraphPreflight(absentPlan.run_id);
        await cli('approve', [
            absentPlan.run_id,
            '--gates', 'manifest_plan_approval',
            '--review-ref', 'acceptance-legacy-absent-review'
        ]);

        currentService = createService();
        const absentApplied = await cli('apply', [absentPlan.run_id]);
        expect(absentApplied).toMatchObject({
            state: 'active',
            run_id: absentPlan.run_id,
            receipt: { verified: true }
        });

        const reusableManifest = projectManifest(
            'acceptance-legacy-reusable',
            'Acceptance Legacy Reusable'
        );
        expect(await cliManifest('check', reusableManifest)).toMatchObject({
            ok: true,
            graph_project_subject: { status: 'absent' },
            writes_performed: 0
        });
        const reusablePlan = await cliManifest('plan', reusableManifest, [
            '--idempotency-key', 'acceptance-legacy-reusable'
        ]);
        await removePersistedGraphPreflight(reusablePlan.run_id);
        await cli('approve', [
            reusablePlan.run_id,
            '--gates', 'manifest_plan_approval',
            '--review-ref', 'acceptance-legacy-reusable-review'
        ]);
        await insertGraphProjectSubject({
            entityId: reusableManifest.project_code,
            payload: {
                name: reusableManifest.display_name,
                catalog_project_id: reusableManifest.project_code,
                catalog_version: reusableManifest.catalog_version,
                source_ref: `project-catalog:${reusableManifest.project_code}@${reusableManifest.catalog_version}`
            },
            version: 4
        });

        // The legacy plan is resumed through a fresh production factory. The
        // existing subject is therefore proven reusable at the real HTTP/CLI
        // boundary, rather than by the test-only Graph double.
        currentService = createProjectProvisioningService({ infoSSOTService });
        const reusableApplied = await cli('apply', [reusablePlan.run_id]);
        expect(reusableApplied).toMatchObject({
            state: 'active',
            run_id: reusablePlan.run_id,
            receipt: { verified: true }
        });
        expect(reusableApplied.steps.find((step) => step.step_name === 'graph').receipt).toMatchObject({
            status: 'already_materialized',
            project_code: 'brainbase',
            entity_version: 4
        });

        const conflictManifest = projectManifest(
            'acceptance-legacy-conflict',
            'Acceptance Legacy Conflict'
        );
        currentService = createService();
        const conflictPlan = await cliManifest('plan', conflictManifest, [
            '--idempotency-key', 'acceptance-legacy-conflict'
        ]);
        await removePersistedGraphPreflight(conflictPlan.run_id);
        await cli('approve', [
            conflictPlan.run_id,
            '--gates', 'manifest_plan_approval',
            '--review-ref', 'acceptance-legacy-conflict-review'
        ]);
        await insertGraphProjectSubject({
            entityId: conflictManifest.project_code,
            payload: {
                name: 'Unexpected Legacy Conflict',
                catalog_project_id: conflictManifest.project_code,
                catalog_version: 99,
                source_ref: `project-catalog:${conflictManifest.project_code}@99`
            },
            version: 8
        });
        const conflictCheck = await cliManifest('check', conflictManifest);
        expect(conflictCheck).toMatchObject({
            ok: false,
            graph_project_subject: { status: 'conflict' },
            writes_performed: 0,
            collisions: expect.arrayContaining([
                expect.objectContaining({ source: 'graph_identity_conflict' })
            ])
        });

        const beforeState = await readNoWriteState(conflictManifest.project_code);
        const beforeLedger = await readLedger(conflictPlan.run_id);
        currentService = createService();
        await expect(cli('apply', [conflictPlan.run_id])).rejects.toThrow(
            'PROJECT_PROVISIONING_GRAPH_IDENTITY_CONFLICT'
        );
        const afterState = await readNoWriteState(conflictManifest.project_code);
        const afterLedger = await readLedger(conflictPlan.run_id);
        expect(afterState).toEqual(beforeState);
        expect(afterLedger).toEqual(beforeLedger);
        expect(afterLedger).toMatchObject({
            state: 'planned',
            step_count: 4,
            completed_step_count: 0
        });
        const conflictStatus = await cli('status', [conflictPlan.run_id]);
        expect(conflictStatus.state).toBe('planned');
        expect(conflictStatus.steps).toEqual(expect.arrayContaining([
            expect.objectContaining({ step_name: 'registry', state: 'pending' }),
            expect.objectContaining({ step_name: 'graph', state: 'pending' })
        ]));

        currentService = createService();
    }, 300_000);

    it('受入れE2E: same-ID conflict・cross-org redaction・Graph scope denialを実HTTP/CLIで検証する', async () => {
        currentService = createService();
        const incompatibleCode = 'acceptance-api-incompatible';
        await insertGraphProjectSubject({
            entityId: incompatibleCode,
            payload: {
                name: 'Unexpected API Identity',
                catalog_project_id: incompatibleCode,
                catalog_version: 7,
                source_ref: `project-catalog:${incompatibleCode}@7`
            },
            version: 2
        });
        const incompatible = await httpProvisioningRequest('/check', {
            method: 'POST',
            body: projectManifest(incompatibleCode, 'Expected API Identity')
        });
        expect(incompatible.response.status).toBe(200);
        expect(incompatible.payload).toMatchObject({
            ok: false,
            graph_project_subject: { status: 'conflict' },
            writes_performed: 0,
            collisions: expect.arrayContaining([
                expect.objectContaining({ source: 'graph_identity_conflict' })
            ])
        });

        const crossOrgCode = 'acceptance-api-cross-org';
        await insertGraphProjectSubject({
            entityId: crossOrgCode,
            projectId: 'project_other',
            payload: {
                name: 'API Cross Org Secret',
                catalog_project_id: crossOrgCode,
                catalog_version: 1,
                source_ref: `project-catalog:${crossOrgCode}@1`
            },
            version: 5
        });
        const crossOrg = await cliManifest(
            'check',
            projectManifest(crossOrgCode, 'API Cross Org Expected')
        );
        expect(crossOrg).toMatchObject({
            ok: false,
            graph_project_subject: { status: 'conflict' },
            writes_performed: 0
        });
        expect(JSON.stringify(crossOrg)).not.toContain('API Cross Org Secret');
        expect(JSON.stringify(crossOrg)).not.toContain('other-project');

        const scopeDeniedCode = 'acceptance-api-scope-denied';
        await adminPool.query(
            `INSERT INTO projects (id, code, name, organization_id)
             VALUES ('project_scope_hidden', $1, 'Hidden Scope Project', $2)
             ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code,
                 name=EXCLUDED.name, organization_id=EXCLUDED.organization_id`,
            ['scope-hidden', ORGANIZATION_ID]
        );
        await insertGraphProjectSubject({
            entityId: scopeDeniedCode,
            projectId: 'project_scope_hidden',
            payload: {
                name: 'Scope Denied Subject',
                catalog_project_id: scopeDeniedCode,
                catalog_version: 1,
                source_ref: `project-catalog:${scopeDeniedCode}@1`
            },
            version: 3
        });
        const scopeDenied = await cliManifest(
            'check',
            projectManifest(scopeDeniedCode, 'Scope Denied Subject')
        );
        expect(scopeDenied).toMatchObject({
            ok: false,
            graph_project_subject: { status: 'conflict' },
            writes_performed: 0,
            collisions: expect.arrayContaining([
                expect.objectContaining({ source: 'graph_scope_unavailable' })
            ])
        });
        expect(JSON.stringify(scopeDenied)).not.toContain('scope-hidden');

        currentService = createService();
    }, 300_000);

    it('受入れE2E: existing subject reuseとdisplay-name/tenant guardを実HTTP/CLIで検証する', async () => {
        currentService = createProjectProvisioningService({ infoSSOTService });
        const reusableCode = 'acceptance-api-reuse';
        const reusableName = 'Acceptance API Reuse';
        await insertGraphProjectSubject({
            entityId: reusableCode,
            payload: {
                name: reusableName,
                catalog_project_id: reusableCode,
                catalog_version: 1,
                source_ref: `project-catalog:${reusableCode}@1`
            },
            version: 6
        });
        const reusableManifest = projectManifest(reusableCode, reusableName);
        expect(await cliManifest('check', reusableManifest)).toMatchObject({
            ok: true,
            graph_project_subject: { status: 'reusable', project_code: 'brainbase', entity_version: 6 },
            writes_performed: 0
        });
        const reusablePlan = await cliManifest('plan', reusableManifest, [
            '--idempotency-key', 'acceptance-api-reuse'
        ]);
        await cli('approve', [
            reusablePlan.run_id,
            '--gates', 'manifest_plan_approval',
            '--review-ref', 'acceptance-api-reuse-review'
        ]);
        const reusableApplied = await cli('apply', [reusablePlan.run_id]);
        expect(reusableApplied).toMatchObject({
            state: 'active', receipt: { verified: true }
        });
        expect(reusableApplied.steps.find((step) => step.step_name === 'graph').receipt).toMatchObject({
            status: 'already_materialized', project_code: 'brainbase', entity_version: 6
        });
        expect(await cli('status', [reusablePlan.run_id])).toMatchObject({
            state: 'active', run_id: reusablePlan.run_id
        });
        expect(await cli('verify', [reusablePlan.run_id])).toMatchObject({
            verified: true, run_id: reusablePlan.run_id, incomplete_steps: []
        });

        const displaySourceId = 'acceptance-api-display-source';
        await insertGraphProjectSubject({
            entityId: displaySourceId,
            payload: {
                name: 'Acceptance API Display Name',
                aliases: ['Acceptance API Alias'],
                catalog_project_id: displaySourceId,
                catalog_version: 1,
                source_ref: `project-catalog:${displaySourceId}@1`
            },
            version: 1
        });
        for (const displayName of ['Acceptance API Display Name', 'Acceptance API Alias']) {
            const displayCollision = await httpProvisioningRequest('/check', {
                method: 'POST',
                body: projectManifest(`acceptance-api-${displayName === 'Acceptance API Alias' ? 'alias' : 'display'}`, displayName)
            });
            expect(displayCollision.response.status).toBe(200);
            expect(displayCollision.payload).toMatchObject({
                ok: false,
                writes_performed: 0,
                collisions: expect.arrayContaining([
                    expect.objectContaining({ source: 'graph_entity', entity_id: displaySourceId })
                ])
            });
        }

        const tenantGuardCode = 'acceptance-api-tenant-guard';
        await insertGraphProjectSubject({
            entityId: tenantGuardCode,
            projectId: 'project_other',
            payload: {
                name: 'Tenant Guard Secret',
                catalog_project_id: tenantGuardCode,
                catalog_version: 1,
                source_ref: `project-catalog:${tenantGuardCode}@1`
            },
            version: 9
        });
        const tenantGuard = await cliManifest(
            'check',
            projectManifest(tenantGuardCode, 'Tenant Guard Expected')
        );
        expect(tenantGuard).toMatchObject({
            ok: false,
            graph_project_subject: { status: 'conflict' },
            writes_performed: 0
        });
        expect(JSON.stringify(tenantGuard)).not.toContain('Tenant Guard Secret');
        expect(JSON.stringify(tenantGuard)).not.toContain('other-project');

        currentService = createService();
    }, 300_000);

    it('受入れE2E: Graph identityの同時追加はRegistry書込前に再検証し、部分状態を残さない', async () => {
        const productionService = createProjectProvisioningService({ infoSSOTService });
        const projectCode = 'acceptance-race-graph-identity';
        const manifest = projectManifest(projectCode, 'Acceptance Race Graph Identity');
        const planned = await productionService.plan(actorAccess, manifest, {
            idempotencyKey: 'acceptance-race-graph-identity'
        });
        await productionService.approve(actorAccess, planned.run_id, {
            approvedGates: ['manifest_plan_approval'],
            reviewRef: 'acceptance-race-graph-identity-review'
        });

        const blocker = await adminPool.connect();
        let applyPromise;
        let committed = false;
        try {
            await blocker.query('BEGIN');
            await blocker.query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1, 0::bigint))`,
                [`brainbase:project-graph-identity:${projectCode}`]
            );
            applyPromise = productionService.apply(actorAccess, planned.run_id);
            await waitForAdvisoryLockWaiter();
            await blocker.query(
                `INSERT INTO graph_entities
                    (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
                 VALUES ($1, 'project', 'project_brainbase', $2::jsonb, 'member', 'internal', 'active', 1)`,
                [projectCode, JSON.stringify({
                    name: 'Concurrent Graph Identity',
                    catalog_project_id: projectCode,
                    catalog_version: 1,
                    source_ref: `project-catalog:${projectCode}@1`
                })]
            );
            await blocker.query('COMMIT');
            committed = true;
        } catch (error) {
            if (!committed) await blocker.query('ROLLBACK').catch(() => {});
            if (applyPromise) await applyPromise.catch(() => {});
            throw error;
        } finally {
            blocker.release();
        }

        await expect(applyPromise).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_GRAPH_IDENTITY_CONFLICT'
        });
        const state = await readNoWriteState(projectCode);
        expect(state.projects).toEqual([]);
        expect(state.registry).toEqual([]);
        expect(state.claims).toEqual([]);
        expect(state.entities).toMatchObject([{
            id: projectCode,
            entity_type: 'project',
            payload: { name: 'Concurrent Graph Identity' },
            version: 1
        }]);
        expect(await readLedger(planned.run_id)).toMatchObject({
            state: 'partial_failed',
            step_count: 4,
            completed_step_count: 0
        });
    }, 300_000);

    it('acceptance-e2e-full-provisioning-flow-missing: real PostgreSQL/factory flow preserves auth, CSRF, scope, and durable resume', async () => {
        const csrfRejected = await fetch(`${serverUrl}/api/project-provisioning/check`, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer signed-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        expect(csrfRejected.status).toBe(403);
        expect(await csrfRejected.json()).toMatchObject({ message: 'CSRF token required' });

        const unauthorized = await fetch(`${serverUrl}/api/project-provisioning/runs/missing`, {
            headers: { Authorization: 'Bearer invalid-token' }
        });
        expect(unauthorized.status).toBe(401);

        const checked = await cli('check', ['--manifest', fullFlowManifest]);
        expect(checked).toMatchObject({ ok: true, writes_performed: 0 });

        const planned = await cli('plan', [
            '--manifest', fullFlowManifest,
            '--idempotency-key', 'acceptance-full-flow'
        ]);
        const fullRunId = planned.run_id;
        expect(planned).toMatchObject({
            state: 'planned',
            organization_id: ORGANIZATION_ID,
            actor: { personId: PERSON_ID, role: 'gm', organizationId: ORGANIZATION_ID },
            plan: { required_human_gates: ['manifest_plan_approval'] }
        });

        const approved = await cli('approve', [
            fullRunId,
            '--gates', 'manifest_plan_approval',
            '--review-ref', 'acceptance-review-full'
        ]);
        expect(approved.human_gate_receipt).toMatchObject({
            approved_by: PERSON_ID,
            review_ref: 'acceptance-review-full',
            approved_gates: ['manifest_plan_approval']
        });

        const applied = await cli('apply', [fullRunId]);
        expect(applied).toMatchObject({ state: 'active', run_id: fullRunId, receipt: { verified: true } });
        expect(await cli('status', [fullRunId])).toMatchObject({ state: 'active', run_id: fullRunId });
        expect(await cli('verify', [fullRunId])).toMatchObject({
            verified: true,
            run_id: fullRunId,
            incomplete_steps: []
        });

        const originalReceipts = await infoSSOTService.withAccessContext(actorAccess, async (client) => {
            const { rows } = await client.query(
                `SELECT human_gate_receipt, receipt
                 FROM project_provisioning_runs
                 WHERE run_id=$1 AND organization_id=$2`,
                [fullRunId, ORGANIZATION_ID]
            );
            return rows[0];
        });
        expect(originalReceipts).toMatchObject({
            human_gate_receipt: { review_ref: 'acceptance-review-full' },
            receipt: { verified: true }
        });

        const originalGraphStep = await infoSSOTService.withAccessContext(actorAccess, async (client) => {
            const { rows } = await client.query(
                `SELECT receipt
                 FROM project_provisioning_steps
                 WHERE run_id=$1 AND organization_id=$2 AND step_name='graph'`,
                [fullRunId, ORGANIZATION_ID]
            );
            return rows[0];
        });
        expect(originalGraphStep.receipt).toMatchObject({
            project_code: 'acceptance-full-flow',
            catalog_version: 1,
            source_ref: 'project-catalog:acceptance-full-flow@1',
            idempotency_key: `project-provisioning:${fullRunId}:graph`
        });

        await expect(infoSSOTService.withAccessContext(actorAccess, (client) => client.query(
            `UPDATE project_provisioning_steps
             SET receipt=$1::jsonb
             WHERE run_id=$2 AND organization_id=$3 AND step_name='graph'`,
            [JSON.stringify({ ...originalGraphStep.receipt, source_ref: 'project-catalog:tampered@1' }), fullRunId, ORGANIZATION_ID]
        ))).rejects.toThrow('project provisioning step receipt is immutable');
        await expect(infoSSOTService.withAccessContext(actorAccess, async (client) => {
            const { rows } = await client.query(
                `SELECT receipt
                 FROM project_provisioning_steps
                 WHERE run_id=$1 AND organization_id=$2 AND step_name='graph'`,
                [fullRunId, ORGANIZATION_ID]
            );
            return rows[0];
        })).resolves.toEqual(originalGraphStep);

        await expect(infoSSOTService.withAccessContext(actorAccess, (client) => client.query(
            `UPDATE project_provisioning_runs
             SET human_gate_receipt=$1::jsonb
             WHERE run_id=$2 AND organization_id=$3`,
            [JSON.stringify({ ...originalReceipts.human_gate_receipt, review_ref: 'tampered' }), fullRunId, ORGANIZATION_ID]
        ))).rejects.toThrow('project provisioning human gate receipt is immutable');
        await expect(infoSSOTService.withAccessContext(actorAccess, async (client) => {
            const { rows } = await client.query(
                `SELECT human_gate_receipt, receipt
                 FROM project_provisioning_runs
                 WHERE run_id=$1 AND organization_id=$2`,
                [fullRunId, ORGANIZATION_ID]
            );
            return rows[0];
        })).resolves.toEqual(originalReceipts);

        await expect(infoSSOTService.withAccessContext(actorAccess, (client) => client.query(
            `UPDATE project_provisioning_runs
             SET receipt=$1::jsonb
             WHERE run_id=$2 AND organization_id=$3`,
            [JSON.stringify({ ...originalReceipts.receipt, verified: false }), fullRunId, ORGANIZATION_ID]
        ))).rejects.toThrow('project provisioning receipt is immutable');
        await expect(infoSSOTService.withAccessContext(actorAccess, async (client) => {
            const { rows } = await client.query(
                `SELECT human_gate_receipt, receipt
                 FROM project_provisioning_runs
                 WHERE run_id=$1 AND organization_id=$2`,
                [fullRunId, ORGANIZATION_ID]
            );
            return rows[0];
        })).resolves.toEqual(originalReceipts);

        const partialPlan = await cli('plan', [
            '--manifest', partialFailureManifest,
            '--idempotency-key', 'acceptance-partial-failure'
        ]);
        const partialRunId = partialPlan.run_id;

        // Read the plan through a newly-created factory service before approval.
        currentService = createService();
        await cli('approve', [
            partialRunId,
            '--gates', 'manifest_plan_approval',
            '--review-ref', 'acceptance-review-partial'
        ]);

        // A second service/repository instance must resume from the PostgreSQL
        // plan, not from process-local run or step state.
        currentService = createService();
        await expect(cli('apply', [partialRunId])).rejects.toThrow('TEMPORARY_GRANT_FAILURE');

        currentService = createService();
        const failed = await cli('status', [partialRunId]);
        expect(failed.state).toBe('partial_failed');
        expect(failed.steps).toEqual(expect.arrayContaining([
            expect.objectContaining({ step_name: 'registry', state: 'completed' }),
            expect.objectContaining({ step_name: 'graph', state: 'completed' }),
            expect.objectContaining({ step_name: 'auth_grants', state: 'failed' }),
            expect.objectContaining({ step_name: 'repository', state: 'pending' })
        ]));

        currentService = createService();
        const resumed = await cli('resume', [partialRunId]);
        expect(resumed).toMatchObject({
            state: 'active',
            run_id: partialRunId,
            human_gate_receipt: { review_ref: 'acceptance-review-partial' },
            receipt: { verified: true }
        });
        currentService = createService();
        expect(await cli('status', [partialRunId])).toMatchObject({ state: 'active' });
        expect(await cli('verify', [partialRunId])).toMatchObject({
            verified: true,
            run_id: partialRunId,
            incomplete_steps: []
        });

        const durableLedger = await readLedger(partialRunId);
        expect(durableLedger).toMatchObject({
            state: 'active',
            actor_person_id: PERSON_ID,
            actor_organization_id: ORGANIZATION_ID,
            step_count: 4,
            completed_step_count: 4
        });
        const projectReadback = await infoSSOTService.withAccessContext(actorAccess, (client) => client.query(
            `SELECT project_code, organization_id, display_name
             FROM project_registry
             WHERE project_code=$1 AND organization_id=$2`,
            ['acceptance-partial-failure', ORGANIZATION_ID]
        ));
        expect(projectReadback.rows).toEqual([{
            project_code: 'acceptance-partial-failure',
            organization_id: ORGANIZATION_ID,
            display_name: 'Acceptance Partial Failure'
        }]);
        const grantReadback = await pool.query(
            `SELECT project_codes FROM auth_grants
             WHERE id='grant_integration_owner' AND person_id=$1`,
            [PERSON_ID]
        );
        expect(grantReadback.rows[0].project_codes).toEqual(
            expect.arrayContaining(['acceptance-full-flow', 'acceptance-partial-failure'])
        );
        expect(authGrantRecords).toEqual(expect.arrayContaining([
            expect.objectContaining({ personId: PERSON_ID, organizationId: ORGANIZATION_ID })
        ]));
        expect(graphAccessRecords).toEqual(expect.arrayContaining([
            expect.objectContaining({ personId: PERSON_ID, organizationId: ORGANIZATION_ID })
        ]));
        expect(authService.verifyToken).toHaveBeenCalledWith('signed-token');
    }, 300_000);
});
