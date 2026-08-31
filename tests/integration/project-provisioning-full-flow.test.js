import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
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
        planMutations: async (access, { projectCode }) => {
            assertGraphAccess(access, projectCode);
            return { plan_id: `graph-plan-${projectCode}`, snapshot_hash: `hash-${projectCode}` };
        },
        applyPlan: async (access, { projectCode }) => {
            assertGraphAccess(access, projectCode);
            graphProjects.add(projectCode);
            return { receipt_id: `graph-apply-${projectCode}` };
        },
        getPlanReceipt: async (access, { projectCode }) => {
            assertGraphAccess(access, projectCode);
            return { receipts: [{ id: `graph-apply-${projectCode}` }] };
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

    await applySql('info-ssot-schema.sql');
    await applySql('permission-schema.sql');
    await applySql('project-provisioning-schema.sql');
    await applySql('info-ssot-rls.sql');
    await applySql('info-ssot-readback.sql');

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
    `);

    await adminPool.query(`
        CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
        GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
        GRANT SELECT ON organizations, people, auth_grants, graph_entities, graph_edges, projects,
            project_registry, project_provisioning_runs, project_provisioning_steps TO ${APP_ROLE};
        GRANT UPDATE ON organizations TO ${APP_ROLE};
        GRANT INSERT, UPDATE ON projects, auth_grants, project_registry,
            project_provisioning_runs, project_provisioning_steps TO ${APP_ROLE};
        GRANT EXECUTE ON FUNCTION project_code_collision_sources(text,text),
            claim_project_code(text,text) TO ${APP_ROLE};
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
