import express from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createOutcomeCaseService } from '../../../server/bootstrap/core-services.js';
import { registerApiRoutes } from '../../../server/bootstrap/register-api-routes.js';
import { createOutcomeCaseRouter } from '../../../server/routes/outcome-cases.js';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';
import { OutcomeCasePostgresRepository } from '../../../server/services/outcome-case/outcome-case-postgres-repository.js';
import { createOutcomeCaseClosureAuthorityResolver } from '../../../server/services/outcome-case/outcome-case-reference-resolver.js';
import { OutcomeCaseService } from '../../../server/services/outcome-case/outcome-case-service.js';
import { RunReceiptQueryService } from '../../../server/services/run-receipt/query-service.js';

// VibePro traceability: story-outcome-case-v1:ac:db-rls-api-roundtrip.
// This is opt-in because it applies an isolated schema to a real PostgreSQL
// instance. The local Docker launcher is
// scripts/verify-outcome-case-postgres-rls-integration.sh.
const databaseUrl = process.env.OUTCOME_CASE_DATABASE_URL || '';
const describeWithPostgres = process.env.RUN_OUTCOME_CASE_DB_TESTS === '1' && databaseUrl ? describe : describe.skip;
const { Pool } = pg;
const APP_PASSWORD = 'outcome-case-it';
const projectActor = {
    personId: 'per_owner',
    projectCodes: ['brainbase'],
    clearance: ['internal'],
    role: 'member',
    organizationId: 'org_unson'
};
const createPayload = {
    project_code: 'brainbase', capability_id: 'cap_outcome_control',
    user_observable_outcome: '利用者が外部完了を読戻せる',
    protected_constraints: ['外部読戻しなしで閉鎖しない'], non_goals: ['generic workflow'],
    selected_domain_pack: 'delivery-control/v1', current_external_state: 'processing',
    technical_story_refs: ['story-outcome-case-v1'], run_receipt_refs: ['run-initial'],
    prior_attempt_refs: [], unresolved_failure_boundary: null
};

let adminPool;
let appPool;
let schema;
let appRole;

function connectionUrl({ role, password, searchPath }) {
    const url = new URL(databaseUrl);
    url.username = role;
    url.password = password;
    if (searchPath) url.searchParams.set('options', `-csearch_path=${searchPath}`);
    return url.toString();
}

async function applySql(name) {
    const schemaPool = new Pool({ connectionString: connectionUrl({
        role: new URL(databaseUrl).username || 'postgres',
        password: new URL(databaseUrl).password || 'postgres',
        searchPath: schema
    }) });
    try {
        await schemaPool.query(await readFile(path.resolve('server/sql', name), 'utf8'));
    } finally {
        await schemaPool.end();
    }
}

function serviceFor(actor, auditSink = null) {
    const infoSSOTService = new InfoSSOTService({ pool: appPool });
    const repository = new OutcomeCasePostgresRepository({ pool: appPool, infoSSOTService });
    const service = new OutcomeCaseService({
        repository,
        readRunReceipt: async () => ({ evidence_state: 'confirmed' }),
        resolveOutcomeReferences: async ({ projectCode, capabilityId }) => ({
            project: { ref: projectCode, state: 'confirmed' },
            capability: { ref: capabilityId, state: 'confirmed' }
        }),
        resolveClosureAuthority: createOutcomeCaseClosureAuthorityResolver({ infoSSOTService })
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.auth = { sub: actor.personId, role: actor.role };
        req.access = actor;
        next();
    });
    app.use('/api/outcome-cases', createOutcomeCaseRouter({ service, auditSink }));
    return app;
}

function runReceipt({ id, evidenceState }) {
    return {
        id,
        workflow_id: `workflow-${id}`,
        project_id: 'brainbase',
        action_required: 'none',
        created_at: '2026-09-04T00:00:00.000Z',
        finished_at: '2026-09-04T00:00:00.000Z',
        metadata: {
            run_receipt: {
                source: { type: 'mana', workflow_id: `workflow-${id}` },
                source_status: 'success',
                source_external_run_id: id,
                evidence_state: evidenceState,
                evidence_refs: evidenceState === 'confirmed' ? [{ kind: 'log_ref', ref: `log:${id}` }] : []
            }
        }
    };
}

// This uses the same exported default OutcomeCase factory that
// createCoreServices wires at runtime, plus registerApiRoutes and the real
// RunReceiptQueryService. The only in-memory boundary is the existing
// RunReceipt runtime ledger; Info SSOT and OutcomeCase persistence stay on the
// isolated PostgreSQL/FORCE RLS database below.
function defaultCompositionApp(receiptsById) {
    const infoSSOTService = new InfoSSOTService({ pool: appPool });
    const runReceiptQueryService = new RunReceiptQueryService({
        repository: {
            getRun: (runId) => receiptsById.get(runId) || null,
            listLatestRunReceipts: () => [...receiptsById.values()],
            listRuns: () => [...receiptsById.values()]
        },
        assertProjectAccess: (projectId, actor) => {
            if (!actor?.projectCodes?.includes(projectId)) throw new Error('project access denied');
        }
    });
    const outcomeCaseService = createOutcomeCaseService({ infoSSOTService, runReceiptQueryService });
    const app = express();
    app.use(express.json());
    const authService = {
        verifyToken: () => ({
            sub: 'per_owner', role: 'member', projectCodes: ['brainbase'], clearance: ['internal'],
            tenantId: 'org_unson', organizationId: 'org_unson'
        })
    };
    registerApiRoutes(app, {
        configParser: {}, configService: {}, runtimePaths: { varDir: '/tmp' }, scheduleParser: {},
        googleCalendarService: {}, projectsRoot: '/tmp', authService, infoSSOTService,
        canonicalTaskStoreConfig: { ownerPersonId: 'per_owner', ownerAliasIds: [] }, canonicalTaskService: {},
        learningService: {}, learningHealthService: {}, candidateRepository: null, knowledgeEventService: null,
        knowledgeFeedbackService: null, knowledgeCycleQueryService: null, onboardingRuntimeService: null,
        wikiService: {}, tokenUsageService: {}, agentControlCatalogService: {}, loopIntentService: {},
        meetingAutomationService: {}, automationRunService: {}, runReceiptQueryService, outcomeCaseService,
        companionApprovalInboxService: {}, meetingSourceMcpSyncService: null, externalRunnerIngestService: {},
        runReceiptIngestService: {}, routineLivenessService: {}, uploadMiddleware: (_req, _res, next) => next(),
        appVersion: 'test', workspaceRoot: '/tmp', uploadsDir: '/tmp/uploads', runtimeInfo: {}, brainbaseRoot: '/tmp'
    });
    return { app, runReceiptQueryService };
}

describeWithPostgres('OutcomeCase PostgreSQL FORCE RLS API acceptance', () => {
    beforeAll(async () => {
        adminPool = new Pool({ connectionString: databaseUrl });
        schema = `outcome_case_it_${process.pid}_${Date.now()}`;
        appRole = `outcome_case_it_${process.pid}_${Date.now()}`;
        await adminPool.query(`CREATE SCHEMA ${schema}; CREATE ROLE ${appRole} LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS;`);
        await applySql('info-ssot-schema.sql');
        await applySql('outcome-case-schema.sql');
        await applySql('info-ssot-rls.sql');
        await adminPool.query(`
            CREATE TABLE ${schema}.brainbase_capabilities (
                capability_id TEXT PRIMARY KEY,
                status TEXT NOT NULL
            );
            GRANT USAGE ON SCHEMA ${schema} TO ${appRole};
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${appRole};
            INSERT INTO ${schema}.projects (id, code, name, organization_id)
            VALUES ('project_brainbase', 'brainbase', 'Brainbase', 'org_unson'),
                   ('project_vibepro', 'vibepro', 'VibePro', 'org_unson');
            INSERT INTO ${schema}.people (id, name)
            VALUES ('per_owner', 'OutcomeCase Owner');
            INSERT INTO ${schema}.brainbase_capabilities (capability_id, status)
            VALUES ('cap_outcome_control', 'active');
            INSERT INTO ${schema}.raci_assignments
              (id, project_id, person_id, role_code, authority_scope, sensitivity_min, sensitivity)
            VALUES
              ('raci_outcome_case_close', 'project_brainbase', 'per_owner', 'outcome_case:close', '', 'member', 'internal');
        `);
        appPool = new Pool({ connectionString: connectionUrl({ role: appRole, password: APP_PASSWORD, searchPath: schema }) });
        const role = await appPool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
        expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    }, 300_000);

    afterAll(async () => {
        await appPool?.end();
        if (schema) await adminPool?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        if (appRole) await adminPool?.query(`DROP ROLE IF EXISTS ${appRole}`);
        await adminPool?.end();
    }, 300_000);

    it('permits scoped create/read/evaluate and rejects missing, cross-project, and cross-organization API access under FORCE RLS', async () => {
        const authorized = serviceFor(projectActor);
        const created = await request(authorized).post('/api/outcome-cases').send(createPayload).expect(201);
        await request(authorized).get(`/api/outcome-cases/${created.body.case_id}`).expect(200);
        const evaluated = await request(authorized)
            .post(`/api/outcome-cases/${created.body.case_id}/evaluations`)
            .send({
                technical_evidence: { status: 'confirmed', refs: ['test:postgres-rls'] },
                run_receipt_refs: ['run-evaluation'],
                external_readback: { status: 'confirm', ref: 'external:postgres-rls' },
                constraints_status: 'satisfied', evaluator: 'request-text-is-not-authority',
                observed_at: '2026-09-04T00:00:00.000Z'
            }).expect(200);
        expect(evaluated.body).toMatchObject({ closure_status: 'closed', revision: 2 });
        expect(evaluated.body.evaluation_history).toHaveLength(1);

        const scopedInfoSSOT = new InfoSSOTService({ pool: appPool });
        await expect(scopedInfoSSOT.withAccessContext(projectActor, (client) => client.query(
            `UPDATE outcome_cases SET evaluation_history='[]'::jsonb WHERE case_id=$1`,
            [created.body.case_id]
        ))).rejects.toThrow('OUTCOME_CASE_EVALUATION_HISTORY_APPEND_ONLY');
        await expect(scopedInfoSSOT.withAccessContext(projectActor, (client) => client.query(
            `UPDATE outcome_cases
                SET evaluation_history=jsonb_build_array(jsonb_build_object('rewritten', true))
              WHERE case_id=$1`,
            [created.body.case_id]
        ))).rejects.toThrow('OUTCOME_CASE_EVALUATION_HISTORY_APPEND_ONLY');

        const crossProject = serviceFor({ ...projectActor, projectCodes: ['vibepro'] });
        await request(crossProject).get(`/api/outcome-cases/${created.body.case_id}`).expect(404);
        await request(crossProject)
            .post(`/api/outcome-cases/${created.body.case_id}/evaluations`)
            .send({ evaluator: 'per_owner' }).expect(404);

        // The globally unique project code is not a tenant boundary. The same
        // project claim in a different authenticated organization must not
        // reveal, evaluate, or insert an OutcomeCase.
        const auditEntries = [];
        const auditSink = { writeAuditLog: (entry) => auditEntries.push(entry) };
        const crossOrganization = serviceFor({ ...projectActor, organizationId: 'org_other' }, auditSink);
        const crossRead = await request(crossOrganization).get(`/api/outcome-cases/${created.body.case_id}`).expect(404);
        expect(crossRead.body.details).toEqual({ audit_id: expect.stringMatching(/^oca_/) });
        const crossEvaluate = await request(crossOrganization)
            .post(`/api/outcome-cases/${created.body.case_id}/evaluations`)
            .send({ evaluator: 'per_owner' }).expect(404);
        expect(crossEvaluate.body.details).toEqual({ audit_id: expect.stringMatching(/^oca_/) });
        const crossCreate = await request(crossOrganization).post('/api/outcome-cases').send({
            ...createPayload,
            run_receipt_refs: ['run-cross-organization']
        }).expect(403);
        expect(crossCreate.body.details?.audit_id).toMatch(/^oca_/);
        expect(auditEntries.map((entry) => entry.action)).toEqual(['read', 'evaluate', 'create']);
        expect(JSON.stringify(auditEntries)).not.toContain('org_unson');
        expect(JSON.stringify(auditEntries)).not.toContain('org_other');

        const countBeforeConflictingClaims = await adminPool.query(
            `SELECT count(*)::int AS count FROM ${schema}.outcome_cases`
        );
        const conflictingClaims = serviceFor({ ...projectActor, tenantId: 'org_other' }, auditSink);
        for (const requestBuilder of [
            () => request(conflictingClaims).post('/api/outcome-cases').send(createPayload),
            () => request(conflictingClaims).get(`/api/outcome-cases/${created.body.case_id}`),
            () => request(conflictingClaims).post(`/api/outcome-cases/${created.body.case_id}/evaluations`).send({ evaluator: 'per_owner' })
        ]) {
            const response = await requestBuilder().expect(403);
            expect(response.body).toMatchObject({
                error: 'outcome_case_organization_access_denied',
                details: {
                    audit_event: 'outcome_case_ambiguous_tenant_denied',
                    audit_id: expect.stringMatching(/^oca_/)
                }
            });
        }
        const countAfterConflictingClaims = await adminPool.query(
            `SELECT count(*)::int AS count FROM ${schema}.outcome_cases`
        );
        expect(countAfterConflictingClaims.rows[0].count).toBe(countBeforeConflictingClaims.rows[0].count);
        expect(auditEntries.slice(-3).map((entry) => entry.action)).toEqual(['create', 'read', 'evaluate']);

        const missingOrganization = serviceFor({ ...projectActor, organizationId: '' });
        const missingOrganizationResponse = await request(missingOrganization)
            .post('/api/outcome-cases').send(createPayload).expect(403);
        expect(missingOrganizationResponse.body).toMatchObject({
            error: 'outcome_case_organization_access_denied',
            details: { audit_event: 'outcome_case_unknown_tenant_denied' }
        });
    });

    it('does not derive closure authority from an internal RACI assignment when authenticated clearance is empty', async () => {
        const noClearanceActor = { ...projectActor, clearance: [] };
        const app = serviceFor(noClearanceActor);
        const created = await request(app).post('/api/outcome-cases').send(createPayload).expect(201);
        const evaluated = await request(app)
            .post(`/api/outcome-cases/${created.body.case_id}/evaluations`)
            .send({
                technical_evidence: { status: 'confirmed', refs: ['test:empty-clearance'] },
                run_receipt_refs: ['run-empty-clearance'],
                external_readback: { status: 'confirm', ref: 'external:empty-clearance' },
                constraints_status: 'satisfied', evaluator: 'per_owner',
                observed_at: '2026-09-04T00:00:00.000Z'
            }).expect(200);

        expect(evaluated.body).toMatchObject({
            closure_status: 'waiting_human',
            authority: {
                state: 'unresolved',
                closure_authorized_person_ids: [],
                reason: 'closure_authority_not_found'
            }
        });
        expect(evaluated.body.evaluation_history[0].authority).toMatchObject({
            state: 'unresolved',
            reason: 'closure_authority_not_found'
        });
    });

    it('uses authenticated default composition to retain receipt evidence and close only confirmed evidence', async () => {
        const receipts = new Map([
            ['run-confirmed', runReceipt({ id: 'run-confirmed', evidenceState: 'confirmed' })],
            ['run-unconfirmed', runReceipt({ id: 'run-unconfirmed', evidenceState: 'unconfirmed' })],
            ['run-no-data', runReceipt({ id: 'run-no-data', evidenceState: 'no_data' })]
        ]);
        const { app, runReceiptQueryService } = defaultCompositionApp(receipts);

        await request(app).post('/api/outcome-cases').send(createPayload).expect(401);

        const confirmed = await request(app)
            .post('/api/outcome-cases').set('Authorization', 'Bearer outcome-user')
            .send({ ...createPayload, run_receipt_refs: ['run-confirmed'] }).expect(201);
        const closed = await request(app)
            .post(`/api/outcome-cases/${confirmed.body.case_id}/evaluations`)
            .set('Authorization', 'Bearer outcome-user')
            .send({
                technical_evidence: { status: 'confirmed', refs: ['test:default-composition'] },
                run_receipt_refs: [], external_readback: { status: 'confirm', ref: 'external:confirmed' },
                constraints_status: 'satisfied', evaluator: 'request-text-is-not-authority',
                observed_at: '2026-09-04T00:00:00.000Z'
            }).expect(200);
        expect(closed.body).toMatchObject({
            closure_status: 'closed',
            terminal_evaluation: {
                run_receipts: [{ ref: 'run-confirmed', evidence_state: 'confirmed' }]
            }
        });
        const closedReadback = await request(app)
            .get(`/api/outcome-cases/${confirmed.body.case_id}`)
            .set('Authorization', 'Bearer outcome-user')
            .expect(200);
        expect(closedReadback.body).toMatchObject({
            closure_status: 'closed',
            terminal_evaluation: {
                close_eligible: true,
                run_receipts: [{ ref: 'run-confirmed', evidence_state: 'confirmed' }]
            }
        });
        expect(closedReadback.body.evaluation_history[0].run_receipts).toEqual(
            expect.arrayContaining([{ ref: 'run-confirmed', evidence_state: 'confirmed' }])
        );

        const unconfirmed = await request(app)
            .post('/api/outcome-cases').set('Authorization', 'Bearer outcome-user')
            .send({ ...createPayload, run_receipt_refs: ['run-unconfirmed'] }).expect(201);
        const incomplete = await request(app)
            .post(`/api/outcome-cases/${unconfirmed.body.case_id}/evaluations`)
            .set('Authorization', 'Bearer outcome-user')
            .send({
                technical_evidence: { status: 'confirmed', refs: ['test:default-composition'] },
                run_receipt_refs: [], external_readback: { status: 'confirm', ref: 'external:unconfirmed' },
                constraints_status: 'satisfied', evaluator: 'request-text-is-not-authority',
                observed_at: '2026-09-04T00:00:00.000Z'
            }).expect(200);
        expect(incomplete.body).toMatchObject({
            closure_status: 'incomplete',
            terminal_evaluation: {
                close_eligible: false,
                run_receipts: [{ ref: 'run-unconfirmed', evidence_state: 'unconfirmed' }]
            }
        });
        expect(incomplete.body.evaluation_history[0].run_receipts).toEqual(
            expect.arrayContaining([{ ref: 'run-unconfirmed', evidence_state: 'unconfirmed' }])
        );
        const incompleteReadback = await request(app)
            .get(`/api/outcome-cases/${unconfirmed.body.case_id}`)
            .set('Authorization', 'Bearer outcome-user')
            .expect(200);
        expect(incompleteReadback.body).toMatchObject({
            closure_status: 'incomplete',
            terminal_evaluation: {
                close_eligible: false,
                run_receipts: [{ ref: 'run-unconfirmed', evidence_state: 'unconfirmed' }]
            }
        });
        expect(incompleteReadback.body.evaluation_history[0].run_receipts).toEqual(
            expect.arrayContaining([{ ref: 'run-unconfirmed', evidence_state: 'unconfirmed' }])
        );

        const noData = await request(app)
            .post('/api/outcome-cases').set('Authorization', 'Bearer outcome-user')
            .send({ ...createPayload, run_receipt_refs: ['run-no-data'] }).expect(201);
        const waiting = await request(app)
            .post(`/api/outcome-cases/${noData.body.case_id}/evaluations`)
            .set('Authorization', 'Bearer outcome-user')
            .send({
                technical_evidence: { status: 'confirmed', refs: ['test:default-composition'] },
                run_receipt_refs: [], external_readback: { status: 'confirm', ref: 'external:no-data' },
                constraints_status: 'satisfied', evaluator: 'request-text-is-not-authority',
                observed_at: '2026-09-04T00:00:00.000Z'
            }).expect(200);
        expect(waiting.body).toMatchObject({
            closure_status: 'waiting_human',
            terminal_evaluation: {
                close_eligible: false,
                run_receipts: [{ ref: 'run-no-data', evidence_state: 'no_data' }]
            }
        });
        expect(waiting.body.evaluation_history[0].run_receipts).toEqual(
            expect.arrayContaining([{ ref: 'run-no-data', evidence_state: 'no_data' }])
        );
        const waitingReadback = await request(app)
            .get(`/api/outcome-cases/${noData.body.case_id}`)
            .set('Authorization', 'Bearer outcome-user')
            .expect(200);
        expect(waitingReadback.body).toMatchObject({
            closure_status: 'waiting_human',
            terminal_evaluation: {
                close_eligible: false,
                run_receipts: [{ ref: 'run-no-data', evidence_state: 'no_data' }]
            }
        });
        expect(waitingReadback.body.evaluation_history[0].run_receipts).toEqual(
            expect.arrayContaining([{ ref: 'run-no-data', evidence_state: 'no_data' }])
        );
        expect(runReceiptQueryService.repository.getRun('run-confirmed')).toBeDefined();
        expect(runReceiptQueryService.repository.getRun('run-unconfirmed')).toBeDefined();
        expect(runReceiptQueryService.repository.getRun('run-no-data')).toBeDefined();
    });
});
