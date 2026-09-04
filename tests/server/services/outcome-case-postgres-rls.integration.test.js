import express from 'express';
import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import pg from 'pg';
import request from 'supertest';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createOutcomeCaseService } from '../../../server/bootstrap/core-services.js';
import { registerApiRoutes, registerJudgmentResolutionApiRoute, registerVibeproHandoffApiRoute } from '../../../server/bootstrap/register-api-routes.js';
import { JudgmentReceiptPostgresRepository } from '../../../server/services/judgment-receipt/judgment-receipt-postgres-repository.js';
import { JudgmentResolutionService, canonicalJson, computeRequestDigest } from '../../../server/services/judgment-resolution-service.js';
import { createOutcomeCaseRouter } from '../../../server/routes/outcome-cases.js';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';
import { OutcomeCasePostgresRepository } from '../../../server/services/outcome-case/outcome-case-postgres-repository.js';
import { createOutcomeCaseClosureAuthorityResolver } from '../../../server/services/outcome-case/outcome-case-reference-resolver.js';
import { OutcomeCaseService } from '../../../server/services/outcome-case/outcome-case-service.js';
import { RunReceiptQueryService } from '../../../server/services/run-receipt/query-service.js';
import { createVibeproHandoffRuntime } from '../../../server/services/outcome-case/vibepro-handoff-runtime.js';

// VibePro traceability: story-outcome-case-v1:ac:db-rls-api-roundtrip.
// This is opt-in because it applies an isolated schema to a real PostgreSQL
// instance. The local Docker launcher is
// scripts/verify-outcome-case-postgres-rls-integration.sh.
const databaseUrl = process.env.OUTCOME_CASE_DATABASE_URL || '';
const describeWithPostgres = process.env.RUN_OUTCOME_CASE_DB_TESTS === '1' && databaseUrl ? describe : describe.skip;
// This must name the read-only VibePro checkout's actual consumer module.
// Without it, the cross-repository acceptance suite is explicitly skipped;
// a supplied but invalid path fails during the test rather than falling back.
const vibeproBindingModule = (process.env.VIBEPRO_OUTCOME_CASE_BINDING_MODULE || '').trim();
const describeWithVibeproConsumer = vibeproBindingModule ? describeWithPostgres : describeWithPostgres.skip;
const { Pool } = pg;
const execFileAsync = promisify(execFile);
const APP_PASSWORD = 'outcome-case-it';
const VIBEPRO_STORY_ID = 'story-outcome-vibepro-producer-contract';
const VIBEPRO_SIGNING_KEY = 'outcome-case-vibepro-e2e-signing-key-0123456789';
const VIBEPRO_KEY_ID = 'outcome-case-vibepro-e2e-key';
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

async function writeJson(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function git(repoRoot, args) {
    return execFileAsync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

async function loadVibeproConsumer() {
    const bindingModulePath = path.resolve(vibeproBindingModule);
    const vibeproRoot = path.dirname(path.dirname(bindingModulePath));
    const nativeImport = createRequire(import.meta.url)('./helpers/native-import.cjs');
    const [integration, workspace, stories, prManager] = await Promise.all([
        nativeImport(pathToFileURL(bindingModulePath).href),
        nativeImport(pathToFileURL(path.join(vibeproRoot, 'src', 'workspace.js')).href),
        nativeImport(pathToFileURL(path.join(vibeproRoot, 'src', 'story-manager.js')).href),
        nativeImport(pathToFileURL(path.join(vibeproRoot, 'src', 'pr-manager.js')).href)
    ]);
    return { ...integration, ...workspace, ...stories, ...prManager };
}

async function createVibeproConsumerFixture(consumer) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainbase-vibepro-e2e-'));
    try {
        await writeFile(path.join(root, 'index.js'), 'export const value = 1;\n');
        await git(root, ['init']);
        await git(root, ['config', 'user.name', 'Brainbase E2E Test']);
        await git(root, ['config', 'user.email', 'brainbase-e2e@example.invalid']);
        await git(root, ['remote', 'add', 'origin', 'https://github.com/Unson-LLC/example.git']);
        await git(root, ['add', 'index.js']);
        await git(root, ['commit', '-m', 'consumer fixture']);
        const baseSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
        await consumer.initWorkspace(root);
        await consumer.addStory(root, { story_id: VIBEPRO_STORY_ID, title: 'Brainbase adoption acceptance' });
        const configPath = path.join(root, '.vibepro', 'config.json');
        const config = JSON.parse(await readFile(configPath, 'utf8'));
        config.brainbase = {
            ...(config.brainbase ?? {}),
            managed: true,
            project_code: 'brainbase',
            repository: 'github://Unson-LLC/example',
            handoff_hmac_key_id: VIBEPRO_KEY_ID,
            handoff_hmac_key_file: '.vibepro/integrations/brainbase/handoff-hmac.key'
        };
        await writeJson(configPath, config);
        const keyPath = path.join(root, '.vibepro', 'integrations', 'brainbase', 'handoff-hmac.key');
        await mkdir(path.dirname(keyPath), { recursive: true });
        await writeFile(keyPath, VIBEPRO_SIGNING_KEY, { mode: 0o600 });
        return { root, baseSha, config };
    } catch (error) {
        await rm(root, { recursive: true, force: true });
        throw error;
    }
}

function serviceFor(actor, auditSink = null) {
    const infoSSOTService = new InfoSSOTService({ pool: appPool });
    const repository = new OutcomeCasePostgresRepository({ pool: appPool, infoSSOTService });
    const service = new OutcomeCaseService({
        repository,
        readRunReceipt: async () => ({
            source_status: 'success', evidence_state: 'confirmed', action_required: 'none',
            issue_codes: [], recommended_action: null,
            diagnostics: { state: 'healthy', issue_codes: [], recommended_action: null }
        }),
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

function runReceipt({ id, evidenceState, sourceStatus = 'success', actionRequired = 'none', sourceAction = null }) {
    return {
        id,
        workflow_id: `workflow-${id}`,
        project_id: 'brainbase',
        action_required: actionRequired,
        created_at: '2026-09-04T00:00:00.000Z',
        finished_at: '2026-09-04T00:00:00.000Z',
        metadata: {
            run_receipt: {
                source: { type: 'mana', workflow_id: `workflow-${id}` },
                source_status: sourceStatus,
                source_action: sourceAction,
                source_action_required: actionRequired !== 'none',
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
        await applySql('judgment-receipt-schema.sql');
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

    it('commits the actual server receipt before the authenticated resolve response and reads it only for its author', async () => {
        const repository = new JudgmentReceiptPostgresRepository({ pool: appPool, infoSSOTService: new InfoSSOTService({ pool: appPool }) });
        const now = new Date('2026-09-04T00:00:00.000Z');
        const secret = 'local-judgment-test-secret';
        const text = '文章の意味を説明して';
        const context = {
            schema_version: 'brainbase-conversation-context-v1', session_ref: 'a'.repeat(64),
            messages: [{ sequence: 0, turn_id: 'turn-pg', role: 'user', phase: null, text }],
            prior_receipts: [], instruction_bindings: [], completeness: 'complete',
            runtime: { host: 'codex', model: 'gpt-5', permission_mode: 'workspace-write', project_binding: 'brainbase' }
        };
        const payload = {
            request: text, turn_id: 'turn-pg', project_code: 'brainbase',
            conversation_context: { ...context, source_digest: computeRequestDigest(context) }
        };
        const digest = computeRequestDigest(payload);
        const app = express();
        app.use(express.json());
        registerJudgmentResolutionApiRoute(app, {
            authService: { verifyToken: (token) => {
                if (token !== 'local-test') throw new Error('invalid token');
                return { ...projectActor, sub: projectActor.personId };
            } },
            service: new JudgmentResolutionService({ now: () => now, id: () => 'jr_pg_route' }),
            bindingSecret: secret, now: () => now, receiptWriter: repository
        });
        const headers = {
            authorization: 'Bearer local-test',
            'x-brainbase-judgment-adapter': 'brainbase-mcp', 'x-brainbase-judgment-version': '1',
            'x-brainbase-judgment-issued-at': now.toISOString(), 'x-brainbase-judgment-request-digest': digest,
            'x-brainbase-judgment-signature': createHmac('sha256', secret).update(canonicalJson([
                'brainbase-judgment-binding-v1', 'brainbase-mcp', '1', payload.turn_id, now.toISOString(), digest
            ])).digest('hex')
        };
        await request(app).post('/api/judgment/resolve').set({ ...headers, authorization: 'Bearer bad' }).send(payload).expect(401);
        expect(await repository.findByResolutionId('jr_pg_route', projectActor)).toBeNull();
        const response = await request(app).post('/api/judgment/resolve').set(headers).send(payload).expect(200);
        expect((await repository.findByResolutionId('jr_pg_route', projectActor)).receipt).toEqual(response.body);
        for (const actor of [
            { ...projectActor, personId: 'per_other' },
            { ...projectActor, organizationId: 'org_other' },
            { ...projectActor, projectCodes: ['vibepro'] }
        ]) expect(await repository.findByResolutionId('jr_pg_route', actor)).toBeNull();
        await expect(repository.findByResolutionId('jr_pg_route', { ...projectActor, tenantId: 'org_other' }))
            .rejects.toMatchObject({ status: 403 });
    });

    it('protects raw receipt contents and ownership in direct SQL and rejects missing binding fields', async () => {
        const info = new InfoSSOTService({ pool: appPool });
        const repository = new JudgmentReceiptPostgresRepository({ pool: appPool, infoSSOTService: info });
        const receipt = { resolution_id: 'jr_pg_immutable', turn_id: 'turn-immutable', project_code: 'brainbase', status: 'resolved' };
        await repository.record(receipt, projectActor);
        const ownerQuery = (sql, values = []) => info.withAccessContext(projectActor, async (client) => {
            await client.query("SELECT set_config('app.judgment_receipt_owner_id', $1, true)", [projectActor.personId]);
            return client.query(sql, values);
        }, { requireCanonicalTenant: true });
        for (const assignment of ["receipt = '{}'::jsonb", "owner_person_id = 'per_other'", "organization_id = 'org_other'", "project_code = 'vibepro'"]) {
            await expect(ownerQuery(`UPDATE judgment_receipts SET ${assignment} WHERE resolution_id = $1`, [receipt.resolution_id]))
                .rejects.toThrow('JUDGMENT_RECEIPTS_IMMUTABLE');
        }
        await expect(ownerQuery('DELETE FROM judgment_receipts WHERE resolution_id = $1', [receipt.resolution_id]))
            .rejects.toThrow('JUDGMENT_RECEIPTS_IMMUTABLE');
        await expect(repository.record({ ...receipt, status: 'forged' }, projectActor))
            .rejects.toMatchObject({ status: 409 });
        expect((await repository.findByResolutionId(receipt.resolution_id, projectActor)).receipt).toEqual(receipt);
        const insert = `INSERT INTO judgment_receipts (organization_id, project_code, owner_person_id, resolution_id, turn_id, receipt)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)`;
        await expect(ownerQuery(insert, ['org_unson', 'brainbase', 'per_other', 'jr_other', 'turn-other', JSON.stringify({
            resolution_id: 'jr_other', turn_id: 'turn-other', project_code: 'brainbase'
        })])).rejects.toMatchObject({ code: '42501' });
        // SQL CHECK must reject NULL/missing JSON fields, not accept UNKNOWN.
        await expect(ownerQuery(insert, ['org_unson', 'brainbase', 'per_owner', 'jr_missing', 'turn-missing', '{}']))
            .rejects.toMatchObject({ code: '23514' });
        const persisted = await adminPool.query(`SELECT receipt FROM ${schema}.judgment_receipts WHERE resolution_id = $1`, [receipt.resolution_id]);
        expect(persisted.rows).toEqual([{ receipt }]);
    });

    it('adopts and issues only the author-owned projection with a dedicated grant, not ordinary RACI', async () => {
        const info = new InfoSSOTService({ pool: appPool });
        const rawRepository = new JudgmentReceiptPostgresRepository({ pool: appPool, infoSSOTService: info });
        const created = await request(serviceFor(projectActor)).post('/api/outcome-cases').send({
            ...createPayload,
            run_receipt_refs: ['run-handoff-adoption']
        }).expect(201);
        const resolutionId = `jr_handoff_${Date.now()}`;
        await rawRepository.record({
            resolution_id: resolutionId,
            turn_id: 'turn-handoff-adoption',
            project_code: 'brainbase',
            status: 'resolved',
            personal_judgment: 'raw judgment must never be copied to VibePro'
        }, projectActor);
        await adminPool.query(`
            INSERT INTO ${schema}.people (id, name) VALUES ('per_raci_only', 'RACI only') ON CONFLICT DO NOTHING;
            INSERT INTO ${schema}.raci_assignments
                (id, project_id, person_id, role_code, authority_scope, sensitivity_min, sensitivity)
            VALUES
                ('raci_handoff_close', 'project_brainbase', 'per_raci_only', 'outcome_case:close', '', 'member', 'internal'),
                ('raci_handoff_gm', 'project_brainbase', 'per_raci_only', 'vibepro_handoff:adopt', '', 'member', 'internal')
            ON CONFLICT DO NOTHING;
            INSERT INTO ${schema}.vibepro_handoff_adoption_grants (organization_id, project_code, person_id)
            VALUES ('org_unson', 'brainbase', 'per_owner');
        `);

        const outcomeCaseService = new OutcomeCaseService({
            repository: new OutcomeCasePostgresRepository({ pool: appPool, infoSSOTService: info }),
            readRunReceipt: async () => null,
            resolveOutcomeReferences: async () => ({ project: { state: 'confirmed' }, capability: { state: 'confirmed' } }),
            resolveClosureAuthority: async () => ({ state: 'unresolved', reason: 'not-used-for-read' })
        });
        const runtime = createVibeproHandoffRuntime({
            pool: appPool,
            infoSSOTService: info,
            outcomeCaseService,
            signingKey: 'outcome-case-handoff-integration-signing-key-32-chars',
            keyId: 'handoff-integration-key',
            clock: () => new Date('2026-09-04T00:00:00.000Z')
        });
        const adoptionInput = {
            caseId: created.body.case_id,
            resolutionId,
            expectedRevision: created.body.revision,
            target: {
                repository: 'https://github.com/Unson-LLC/example.git', repository_root: '.',
                base_sha: 'a'.repeat(40), story_id: 'story-outcome-vibepro-producer-contract'
            },
            technicalAcceptance: [{ id: 'TA-adopt', criterion: '保存済みsnapshotを読戻せる' }],
            productionProbe: { id: 'probe-adopt', procedure: 'ローカルDBのsnapshotを読戻す' }
        };
        const handoffApp = express();
        handoffApp.use(express.json());
        registerVibeproHandoffApiRoute(handoffApp, {
            authService: { verifyToken: () => ({ ...projectActor, sub: projectActor.personId }) },
            runtime
        });
        const adopted = await request(handoffApp)
            .post('/api/vibepro-handoffs/adoptions').set('Authorization', 'Bearer handoff-owner').send(adoptionInput).expect(201);
        expect(adopted.body).toMatchObject({
            status: 'adopted', owner_person_id: 'per_owner', case_id: created.body.case_id,
            resolution_id: resolutionId, outcome_case_revision: created.body.revision,
            decision: { turn_id: 'turn-handoff-adoption', judgment_receipt_ref: `brainbase://judgment-receipts/${resolutionId}` }
        });
        expect(JSON.stringify(adopted.body)).not.toContain('raw judgment');
        const issued = await request(handoffApp)
            .post('/api/vibepro-handoffs/issue').set('Authorization', 'Bearer handoff-owner')
            .send({ caseId: created.body.case_id, resolutionId }).expect(200);
        expect(issued.body).toMatchObject({ authorized: false, graph_promotion_allowed: false, resolution_id: resolutionId });

        await expect(runtime.adopt({ ...adoptionInput, expectedRevision: created.body.revision + 1 }, projectActor))
            .rejects.toMatchObject({ code: 'vibepro_handoff_adoption_revision_conflict', status: 409 });
        await expect(runtime.adopt(adoptionInput, projectActor))
            .rejects.toMatchObject({ code: 'vibepro_handoff_adoption_conflict', status: 409 });

        const raciOnlyActor = { ...projectActor, personId: 'per_raci_only' };
        await rawRepository.record({
            resolution_id: resolutionId,
            turn_id: 'turn-raci-only',
            project_code: 'brainbase',
            status: 'resolved'
        }, raciOnlyActor);
        await expect(runtime.adopt(adoptionInput, raciOnlyActor))
            .rejects.toMatchObject({ code: 'vibepro_handoff_adoption_denied', status: 403 });
        expect(await runtime.store.readAdoptedHandoff({
            caseId: created.body.case_id, resolutionId, organizationId: 'org_unson', projectCode: 'brainbase', actor: raciOnlyActor
        })).toBeNull();

        const directGrantMutation = (sql, values = []) => info.withAccessContext(projectActor, async (client) => {
            await client.query("SELECT set_config('app.judgment_receipt_owner_id', $1, true)", [projectActor.personId]);
            await client.query("SELECT set_config('app.vibepro_handoff_adoption_owner_id', $1, true)", [projectActor.personId]);
            return client.query(sql, values);
        }, { requireCanonicalTenant: true });
        await expect(directGrantMutation(
            `INSERT INTO vibepro_handoff_adoption_grants (organization_id, project_code, person_id) VALUES ('org_unson', 'brainbase', 'per_raci_only')`
        )).rejects.toMatchObject({ code: '42501' });
        expect((await directGrantMutation(
            `UPDATE vibepro_handoff_adoption_grants SET person_id = 'per_other' WHERE person_id = 'per_owner'`
        )).rowCount).toBe(0);
        expect((await directGrantMutation(
            `DELETE FROM vibepro_handoff_adoption_grants WHERE person_id = 'per_owner'`
        )).rowCount).toBe(0);

        const insertSnapshot = `INSERT INTO vibepro_handoff_adoptions (
            organization_id, project_code, owner_person_id, case_id, resolution_id,
            outcome_case_revision, decision, target, technical_acceptance, production_probe
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)`;
        const snapshotTarget = {
            ...adoptionInput.target, case_id: created.body.case_id, project_code: 'brainbase'
        };
        const insertValuesFor = (mismatchResolutionId, decision) => [
            'org_unson', 'brainbase', 'per_owner', created.body.case_id, mismatchResolutionId,
            created.body.revision, JSON.stringify(decision), JSON.stringify(snapshotTarget),
            JSON.stringify(adoptionInput.technicalAcceptance), JSON.stringify(adoptionInput.productionProbe)
        ];
        const directPositiveResolutionId = `jr_handoff_positive_${Date.now()}`;
        await rawRepository.record({
            resolution_id: directPositiveResolutionId, turn_id: 'turn-positive', project_code: 'brainbase', status: 'resolved'
        }, projectActor);
        await expect(directGrantMutation(insertSnapshot, insertValuesFor(directPositiveResolutionId, {
            case_id: created.body.case_id, project_code: 'brainbase', resolution_id: directPositiveResolutionId,
            turn_id: 'turn-positive', judgment_receipt_ref: `brainbase://judgment-receipts/${directPositiveResolutionId}`
        }))).resolves.toMatchObject({ rowCount: 1 });
        const turnMismatchResolutionId = `jr_handoff_turn_mismatch_${Date.now()}`;
        await rawRepository.record({
            resolution_id: turnMismatchResolutionId, turn_id: 'turn-real', project_code: 'brainbase', status: 'resolved'
        }, projectActor);
        await expect(directGrantMutation(insertSnapshot, insertValuesFor(turnMismatchResolutionId, {
            case_id: created.body.case_id, project_code: 'brainbase', resolution_id: turnMismatchResolutionId,
            turn_id: 'turn-forged', judgment_receipt_ref: `brainbase://judgment-receipts/${turnMismatchResolutionId}`
        }))).rejects.toMatchObject({ code: '42501' });
        const refMismatchResolutionId = `jr_handoff_ref_mismatch_${Date.now()}`;
        await rawRepository.record({
            resolution_id: refMismatchResolutionId, turn_id: 'turn-ref-real', project_code: 'brainbase', status: 'resolved'
        }, projectActor);
        await expect(directGrantMutation(insertSnapshot, insertValuesFor(refMismatchResolutionId, {
            case_id: created.body.case_id, project_code: 'brainbase', resolution_id: refMismatchResolutionId,
            turn_id: 'turn-ref-real', judgment_receipt_ref: 'brainbase://judgment-receipts/forged'
        }))).rejects.toMatchObject({ code: '23514' });
        expect((await directGrantMutation(
            `UPDATE vibepro_handoff_adoptions SET decision = '{}'::jsonb WHERE case_id = $1`, [created.body.case_id]
        )).rowCount).toBe(0);
        expect((await directGrantMutation(
            `DELETE FROM vibepro_handoff_adoptions WHERE case_id = $1`, [created.body.case_id]
        )).rowCount).toBe(0);
        await expect(adminPool.query(
            `UPDATE ${schema}.vibepro_handoff_adoptions SET decision = '{}'::jsonb WHERE case_id = $1`, [created.body.case_id]
        )).rejects.toThrow('VIBEPRO_HANDOFF_ADOPTIONS_IMMUTABLE');
        await expect(adminPool.query(
            `DELETE FROM ${schema}.vibepro_handoff_adoptions WHERE case_id = $1`, [created.body.case_id]
        )).rejects.toThrow('VIBEPRO_HANDOFF_ADOPTIONS_IMMUTABLE');

        expect(await runtime.store.readAdoptedHandoff({
            caseId: created.body.case_id, resolutionId, organizationId: 'org_other', projectCode: 'brainbase',
            actor: { ...projectActor, organizationId: 'org_other', tenantId: 'org_other' }
        })).toBeNull();
        expect(await runtime.store.readAdoptedHandoff({
            caseId: created.body.case_id, resolutionId, organizationId: 'org_unson', projectCode: 'vibepro',
            actor: { ...projectActor, projectCodes: ['vibepro'] }
        })).toBeNull();

        const evaluatedAfterAdoption = await request(serviceFor(projectActor))
            .post(`/api/outcome-cases/${created.body.case_id}/evaluations`)
            .send({
                technical_evidence: { status: 'confirmed', refs: ['test:handoff-stale-revision'] },
                run_receipt_refs: ['run-handoff-adoption'],
                external_readback: { status: 'confirm', ref: 'external:handoff-stale-revision' },
                constraints_status: 'satisfied', evaluator: 'authenticated-evaluator',
                observed_at: '2026-09-04T00:01:00.000Z'
            }).expect(200);
        expect(evaluatedAfterAdoption.body.revision).toBe(Number(created.body.revision) + 1);
        await expect(runtime.issue({ caseId: created.body.case_id, resolutionId }, projectActor))
            .rejects.toMatchObject({ code: 'vibepro_handoff_source_incoherent', status: 409 });
    });

    it('does not retain author or tenant context after commit or rollback on a reused connection', async () => {
        const pool = new Pool({ connectionString: connectionUrl({ role: appRole, password: APP_PASSWORD, searchPath: schema }), max: 1 });
        try {
            const info = new InfoSSOTService({ pool });
            const repository = new JudgmentReceiptPostgresRepository({ pool, infoSSOTService: info });
            const receipt = { resolution_id: 'jr_pg_context', turn_id: 'turn-context', project_code: 'brainbase' };
            await repository.record(receipt, projectActor);
            const assertNoContext = async () => {
                const result = await pool.query(`SELECT current_setting('app.organization_id', true) AS org,
                    current_setting('app.judgment_receipt_owner_id', true) AS owner,
                    current_setting('app.vibepro_handoff_adoption_owner_id', true) AS handoff_owner`);
                expect(result.rows[0].org || '').toBe('');
                expect(result.rows[0].owner || '').toBe('');
                expect(result.rows[0].handoff_owner || '').toBe('');
                expect((await pool.query('SELECT * FROM judgment_receipts')).rows).toEqual([]);
            };
            await assertNoContext();
            await info.withAccessContext(projectActor, async (client) => {
                await client.query("SELECT set_config('app.vibepro_handoff_adoption_owner_id', $1, true)", [projectActor.personId]);
            }, { requireCanonicalTenant: true });
            await assertNoContext();
            await expect(repository.record(receipt, projectActor)).rejects.toMatchObject({ status: 409 });
            await assertNoContext();
            expect(await repository.findByResolutionId(receipt.resolution_id, { ...projectActor, personId: 'per_other' })).toBeNull();
        } finally {
            await pool.end();
        }
    });

    describeWithVibeproConsumer('authenticated adoption to VibePro consumer acceptance', () => {
        it('persists an unmodified issued payload, binds its seven-field projection, and rejects a tampered fresh inbox', async () => {
            const consumer = await loadVibeproConsumer();
            const fixture = await createVibeproConsumerFixture(consumer);
            try {
                const info = new InfoSSOTService({ pool: appPool });
                const rawRepository = new JudgmentReceiptPostgresRepository({ pool: appPool, infoSSOTService: info });
                const created = await request(serviceFor(projectActor)).post('/api/outcome-cases').send({
                    ...createPayload,
                    run_receipt_refs: ['run-vibepro-e2e']
                }).expect(201);
                const resolutionId = `jr_vibepro_e2e_${Date.now()}`;
                await rawRepository.record({
                    resolution_id: resolutionId,
                    turn_id: 'turn-vibepro-e2e',
                    project_code: 'brainbase',
                    status: 'resolved',
                    personal_judgment: 'must not cross the adopted snapshot boundary'
                }, projectActor);
                await adminPool.query(`
                    INSERT INTO ${schema}.vibepro_handoff_adoption_grants (organization_id, project_code, person_id)
                    VALUES ('org_unson', 'brainbase', 'per_owner') ON CONFLICT DO NOTHING;
                `);
                const outcomeCaseService = new OutcomeCaseService({
                    repository: new OutcomeCasePostgresRepository({ pool: appPool, infoSSOTService: info }),
                    readRunReceipt: async () => null,
                    resolveOutcomeReferences: async () => ({ project: { state: 'confirmed' }, capability: { state: 'confirmed' } }),
                    resolveClosureAuthority: async () => ({ state: 'unresolved', reason: 'not-used-for-handoff' })
                });
                const before = await outcomeCaseService.read(created.body.case_id, projectActor);
                const runtime = createVibeproHandoffRuntime({
                    pool: appPool,
                    infoSSOTService: info,
                    outcomeCaseService,
                    signingKey: VIBEPRO_SIGNING_KEY,
                    keyId: VIBEPRO_KEY_ID,
                    clock: () => new Date('2026-09-04T00:00:00.000Z')
                });
                const handoffApp = express();
                handoffApp.use(express.json());
                registerVibeproHandoffApiRoute(handoffApp, {
                    authService: { verifyToken: () => ({ ...projectActor, sub: projectActor.personId }) },
                    runtime
                });
                const adoptionInput = {
                    caseId: created.body.case_id,
                    resolutionId,
                    expectedRevision: created.body.revision,
                    target: {
                        repository: 'https://github.com/Unson-LLC/example.git', repository_root: '.',
                        base_sha: fixture.baseSha, story_id: VIBEPRO_STORY_ID
                    },
                    technicalAcceptance: [{ id: 'TA-vibepro-e2e', criterion: '保存済み採用snapshotをVibeProが読戻す' }],
                    productionProbe: { id: 'probe-vibepro-e2e', procedure: 'VibePro保存投影を読戻す' }
                };
                await request(handoffApp)
                    .post('/api/vibepro-handoffs/adoptions').set('Authorization', 'Bearer handoff-owner')
                    .send(adoptionInput).expect(201);
                const issued = await request(handoffApp)
                    .post('/api/vibepro-handoffs/issue').set('Authorization', 'Bearer handoff-owner')
                    .send({ caseId: created.body.case_id, resolutionId }).expect(200);
                expect(issued.body).toMatchObject({
                    schema_version: 'brainbase-vibepro-managed-handoff.v2',
                    authorized: false,
                    graph_promotion_allowed: false,
                    resolution_id: resolutionId,
                    turn_id: 'turn-vibepro-e2e',
                    outcome_case: { case_id: created.body.case_id, judgment_receipt_ref: `brainbase://judgment-receipts/${resolutionId}` }
                });
                expect(Object.keys(issued.body.outcome_case).sort()).toEqual([
                    'case_id', 'decision_digest', 'judgment_receipt_ref', 'outcome_case_ref',
                    'production_probe', 'technical_acceptance', 'user_observable_outcome'
                ]);

                const inbox = '.vibepro/integrations/brainbase/inbox/handoff.json';
                const tamperedInbox = '.vibepro/integrations/brainbase/inbox/tampered.json';
                const configPath = path.join(fixture.root, '.vibepro', 'config.json');
                const beforeConfig = await readFile(configPath, 'utf8');
                await writeJson(path.join(fixture.root, tamperedInbox), {
                    ...issued.body,
                    outcome_case: { ...issued.body.outcome_case, user_observable_outcome: '署名後の改ざん' }
                });
                await expect(consumer.bindBrainbaseContext(fixture.root, {
                    storyId: VIBEPRO_STORY_ID, input: tamperedInbox, config: fixture.config,
                    now: () => new Date('2026-09-04T00:00:02.000Z')
                })).rejects.toThrow(/digest|HMAC|signature/i);
                expect(await readFile(configPath, 'utf8')).toBe(beforeConfig);
                for (const artifact of [
                    `.vibepro/integrations/brainbase/${VIBEPRO_STORY_ID}/context.json`,
                    `.vibepro/integrations/brainbase/${VIBEPRO_STORY_ID}/bind-receipt.json`,
                    '.vibepro/integrations/brainbase/handoff-consumption-ledger.json'
                ]) await expect(readFile(path.join(fixture.root, artifact), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

                // Preserve the actual HTTP response bytes, without reconstructing fields.
                await writeFile(path.join(fixture.root, inbox), issued.text);
                expect(JSON.parse(await readFile(path.join(fixture.root, inbox), 'utf8'))).toEqual(issued.body);
                const bound = await consumer.bindBrainbaseContext(fixture.root, {
                    storyId: VIBEPRO_STORY_ID, input: inbox, config: fixture.config,
                    now: () => new Date('2026-09-04T00:00:02.000Z')
                });
                expect(bound).toMatchObject({ status: 'bound', outcome_case: issued.body.outcome_case });
                const context = JSON.parse(await readFile(path.join(fixture.root, bound.artifact), 'utf8'));
                const bindReceipt = JSON.parse(await readFile(path.join(fixture.root, bound.bind_receipt_artifact), 'utf8'));
                const ledger = JSON.parse(await readFile(path.join(fixture.root, bound.consumption_ledger_artifact), 'utf8'));
                const storedConfig = JSON.parse(await readFile(configPath, 'utf8'));
                const projectedStory = storedConfig.brainbase.stories.find((story) => story.story_id === VIBEPRO_STORY_ID);
                expect(context.outcome_case).toEqual(issued.body.outcome_case);
                expect(projectedStory.outcome_case).toEqual(issued.body.outcome_case);
                expect(bindReceipt.managed_handoff).toEqual(issued.body);
                expect(bindReceipt.receipt_digest).toBe(issued.body.receipt_digest);
                expect(ledger.entries).toContainEqual(expect.objectContaining({
                    story_id: VIBEPRO_STORY_ID, resolution_id: resolutionId, receipt_digest: issued.body.receipt_digest
                }));
                const inspection = await consumer.inspectManagedV2OutcomeCaseProjection(
                    fixture.root, VIBEPRO_STORY_ID, projectedStory.outcome_case,
                    { now: () => new Date('2026-09-04T00:00:02.000Z') }
                );
                expect(inspection.status).toBe('trusted');
                expect(projectedStory.outcome_case).not.toHaveProperty('technical_complete');
                // Source-checkout acceptance is not authority to produce a PR
                // judgment. Exercise the real guard without changing runtime mode.
                await expect(consumer.preparePullRequest(fixture.root, {
                    storyId: VIBEPRO_STORY_ID, baseRef: 'HEAD', env: {},
                    now: () => new Date('2026-09-04T00:00:02.000Z')
                })).rejects.toMatchObject({ code: 'runtime_mismatch' });
                expect(await outcomeCaseService.read(created.body.case_id, projectActor)).toEqual(before);
                expect(before.closure_status).not.toBe('closed');
            } finally {
                await rm(fixture.root, { recursive: true, force: true });
            }
        });
    });

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

    it('hides and protects an OutcomeCase whose stored organization disagrees with the owning project', async () => {
        const caseId = `oc_project_owner_mismatch_${Date.now()}`;
        await adminPool.query(`
            INSERT INTO ${schema}.projects (id, code, name, organization_id)
            VALUES ('project_foreign', 'foreign-project', 'Foreign project', 'org_other')
        `);
        await adminPool.query(`
            INSERT INTO ${schema}.outcome_cases (
                case_id, organization_id, project_code, capability_id, user_observable_outcome,
                protected_constraints, non_goals, authority, selected_domain_pack,
                closure_status, current_external_state, technical_story_refs, run_receipt_refs,
                prior_attempt_refs, revision
            ) VALUES (
                $1, 'org_unson', 'foreign-project', 'cap_outcome_control', 'must remain invisible',
                '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, 'delivery-control/v1',
                'open', 'unknown', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 1
            )
        `, [caseId]);

        const scopedInfoSSOT = new InfoSSOTService({ pool: appPool });
        const mismatchedScope = { ...projectActor, projectCodes: ['foreign-project'] };
        const selected = await scopedInfoSSOT.withAccessContext(mismatchedScope, (client) => client.query(
            'SELECT case_id FROM outcome_cases WHERE case_id=$1',
            [caseId]
        ));
        expect(selected.rows).toEqual([]);

        const updated = await scopedInfoSSOT.withAccessContext(mismatchedScope, (client) => client.query(
            'UPDATE outcome_cases SET updated_at=NOW() WHERE case_id=$1 RETURNING case_id',
            [caseId]
        ));
        expect(updated.rows).toEqual([]);

        const deleted = await scopedInfoSSOT.withAccessContext(mismatchedScope, (client) => client.query(
            'DELETE FROM outcome_cases WHERE case_id=$1 RETURNING case_id',
            [caseId]
        ));
        expect(deleted.rows).toEqual([]);

        const retained = await adminPool.query(
            `SELECT case_id FROM ${schema}.outcome_cases WHERE case_id=$1`,
            [caseId]
        );
        expect(retained.rows).toEqual([{ case_id: caseId }]);
    });

    it('uses authenticated default composition to retain receipt evidence and close only confirmed evidence', async () => {
        const receipts = new Map([
            ['run-confirmed', runReceipt({ id: 'run-confirmed', evidenceState: 'confirmed' })],
            ['run-unconfirmed', runReceipt({ id: 'run-unconfirmed', evidenceState: 'unconfirmed' })],
            ['run-no-data', runReceipt({ id: 'run-no-data', evidenceState: 'no_data' })],
            ['run-waiting', runReceipt({
                id: 'run-waiting', evidenceState: 'confirmed', sourceStatus: 'waiting_human',
                actionRequired: 'approve', sourceAction: 'approve'
            })],
            ['run-failed', runReceipt({ id: 'run-failed', evidenceState: 'confirmed', sourceStatus: 'failed' })],
            ['run-blocked', runReceipt({ id: 'run-blocked', evidenceState: 'confirmed', sourceStatus: 'blocked' })],
            ['run-cancelled', runReceipt({ id: 'run-cancelled', evidenceState: 'confirmed', sourceStatus: 'cancelled' })]
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
            expect.arrayContaining([expect.objectContaining({ ref: 'run-confirmed', evidence_state: 'confirmed' })])
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
            closure_status: 'waiting_human',
            terminal_evaluation: {
                close_eligible: false,
                run_receipts: [{ ref: 'run-unconfirmed', evidence_state: 'unconfirmed' }]
            }
        });
        expect(incomplete.body.evaluation_history[0].run_receipts).toEqual(
            expect.arrayContaining([expect.objectContaining({ ref: 'run-unconfirmed', evidence_state: 'unconfirmed' })])
        );
        const incompleteReadback = await request(app)
            .get(`/api/outcome-cases/${unconfirmed.body.case_id}`)
            .set('Authorization', 'Bearer outcome-user')
            .expect(200);
        expect(incompleteReadback.body).toMatchObject({
            closure_status: 'waiting_human',
            terminal_evaluation: {
                close_eligible: false,
                run_receipts: [{ ref: 'run-unconfirmed', evidence_state: 'unconfirmed' }]
            }
        });
        expect(incompleteReadback.body.evaluation_history[0].run_receipts).toEqual(
            expect.arrayContaining([expect.objectContaining({ ref: 'run-unconfirmed', evidence_state: 'unconfirmed' })])
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
            expect.arrayContaining([expect.objectContaining({ ref: 'run-no-data', evidence_state: 'no_data' })])
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
            expect.arrayContaining([expect.objectContaining({ ref: 'run-no-data', evidence_state: 'no_data' })])
        );

        for (const [runId, expectedClosure, expectedIssueCodes, expectedAction] of [
            ['run-waiting', 'waiting_human', ['human_action_required'], 'approve'],
            ['run-failed', 'incomplete', ['source_failed'], null],
            ['run-blocked', 'incomplete', ['source_blocked'], null],
            ['run-cancelled', 'incomplete', [], null]
        ]) {
            const created = await request(app)
                .post('/api/outcome-cases').set('Authorization', 'Bearer outcome-user')
                .send({ ...createPayload, run_receipt_refs: [runId] }).expect(201);
            const evaluated = await request(app)
                .post(`/api/outcome-cases/${created.body.case_id}/evaluations`)
                .set('Authorization', 'Bearer outcome-user')
                .send({
                    technical_evidence: { status: 'confirmed', refs: ['test:default-composition-source-status'] },
                    run_receipt_refs: [], external_readback: { status: 'confirm', ref: `external:${runId}` },
                    constraints_status: 'satisfied', evaluator: 'request-text-is-not-authority',
                    observed_at: '2026-09-04T00:00:00.000Z'
                }).expect(200);
            const expectedSnapshot = {
                ref: runId,
                source_status: runId === 'run-waiting' ? 'waiting_human' : runId.replace('run-', ''),
                evidence_state: 'confirmed',
                action_required: expectedAction || 'none',
                issue_codes: expectedIssueCodes,
                recommended_action: expectedAction,
                diagnostics: {
                    state: expectedIssueCodes.length > 0 || expectedAction ? 'action_required' : 'healthy',
                    issue_codes: expectedIssueCodes,
                    recommended_action: expectedAction
                }
            };
            expect(evaluated.body).toMatchObject({
                closure_status: expectedClosure,
                terminal_evaluation: { close_eligible: false, run_receipts: [expectedSnapshot] },
                evaluation_history: [{ run_receipts: [expectedSnapshot] }]
            });
            const persisted = await request(app)
                .get(`/api/outcome-cases/${created.body.case_id}`)
                .set('Authorization', 'Bearer outcome-user').expect(200);
            expect(persisted.body).toEqual(evaluated.body);
        }
        expect(runReceiptQueryService.repository.getRun('run-confirmed')).toBeDefined();
        expect(runReceiptQueryService.repository.getRun('run-unconfirmed')).toBeDefined();
        expect(runReceiptQueryService.repository.getRun('run-no-data')).toBeDefined();
    });
});
