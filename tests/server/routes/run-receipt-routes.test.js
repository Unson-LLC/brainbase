import { createHash } from 'node:crypto';

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { requireAuth } from '../../../server/middleware/auth.js';
import { createRunReceiptRouter } from '../../../server/routes/run-receipts.js';
import {
    createWorkflowRouter,
    createWorkflowRunRouter
} from '../../../server/routes/workflows.js';
import { errorHandler } from '../../../server/middleware/error-handler.js';
import { RunReceiptIngestService } from '../../../server/services/run-receipt/ingest-service.js';
import { RoutineLivenessService } from '../../../server/services/routine-runtime/liveness-service.js';
import { RunReceiptQueryService } from '../../../server/services/run-receipt/query-service.js';
import { TestAutomationRuntime } from '../../helpers/test-automation-runtime.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';

function idempotencyKey(projectId, sourceType, externalRunId) {
    return `rr1_${createHash('sha256')
        .update(JSON.stringify([projectId, sourceType, externalRunId]))
        .digest('hex')}`;
}

function makeReceipt({
    projectId = 'brainbase',
    externalRunId = 'mana-run-1',
    sourceIdentity = 'daily-secretary',
    status = 'success',
    evidenceState = 'confirmed',
    blockerReason = null,
    actionRequired = null,
    finishedAt = '2026-07-15T00:00:00Z',
    evidenceRefs = null
} = {}) {
    const defaultEvidenceRefs = evidenceState === 'confirmed'
        ? [{ kind: 'log_ref', ref: `cloudwatch:stream/${externalRunId}` }]
        : [];
    return {
        contract_version: 'run_receipt.v1',
        source: {
            type: 'mana',
            workflow_id: sourceIdentity,
            runtime_target: 'lambda'
        },
        run: {
            project_id: projectId,
            external_run_id: externalRunId,
            status,
            evidence_state: evidenceState,
            finished_at: finishedAt,
            evidence_refs: evidenceRefs || defaultEvidenceRefs,
            ...(blockerReason ? { blocker_reason: blockerReason } : {}),
            ...(actionRequired ? { action_required: actionRequired } : {})
        },
        delivery: {
            idempotency_key: idempotencyKey(projectId, 'mana', externalRunId),
            attempt: 1
        }
    };
}

function createApp({
    authSource = 'internal',
    projectCodes = ['brainbase'],
    role = 'member',
    organizationId = 'brainbase',
    repository = new InMemoryWorkflowRepository(),
    lockAcquireTimeoutMs = 100,
    routineLivenessService = null,
    outcomeCaseService = null
} = {}) {
    const app = express();
    const ingestService = new RunReceiptIngestService({
        workflowRepository: repository,
        lockAcquireTimeoutMs,
        lockRetryMs: 1,
        outcomeCaseService
    });
    const workflowService = new TestAutomationRuntime({
        repository,
        runner: {},
        configParser: {
            async getProjects() {
                return {
                    source: { status: 'loaded', mode: 'registry_scoped' },
                    projects: [{ id: 'brainbase', session_select: true }]
                };
            }
        }
    });
    app.use(express.json());
    app.use((req, _res, next) => {
        req.authSource = authSource;
        req.auth = { sub: 'route-test', role };
        req.access = { personId: 'route-test', role, projectCodes, organizationId };
        next();
    });
    app.use('/api/run-receipts', createRunReceiptRouter({
        ingestService,
        queryService: workflowService.runReceiptQueryService,
        routineLivenessService
    }));
    app.use('/api/workflows', createWorkflowRouter({
        agentControlCatalogService: workflowService.agentControlCatalogService,
        loopIntentService: workflowService.loopIntentService,
        eveSessionDispatchService: workflowService.eveSessionDispatchService,
        meetingAutomationService: workflowService.meetingAutomationService
    }));
    app.use('/api/workflow-runs', createWorkflowRunRouter(workflowService.automationRunService));
    app.use(errorHandler);
    return { app, repository, ingestService };
}

describe('run receipt routes', () => {
    it('POST ingest_createdは201、exact replayは200 duplicateを返す', async () => {
        const { app, repository } = createApp();

        const created = await request(app)
            .post('/api/run-receipts/ingest')
            .send(makeReceipt())
            .expect(201);
        const duplicate = await request(app)
            .post('/api/run-receipts/ingest')
            .send(makeReceipt())
            .expect(200);

        expect(created.body.status).toBe('created');
        expect(duplicate.body.status).toBe('duplicate');
        expect(repository.listRuns({ limit: null })).toHaveLength(1);
    });

    it('POST ingestはManaのOutcomeCase refをlinkerへ渡し、評価を自動起動しない', async () => {
        const outcomeCaseService = {
            linkRunReceipt: vi.fn(async () => ({ status: 'linked' })),
            evaluate: vi.fn()
        };
        const { app } = createApp({ outcomeCaseService });
        const response = await request(app)
            .post('/api/run-receipts/ingest')
            .send(makeReceipt({ evidenceRefs: [{ kind: 'artifact_ref', ref: 'outcome_case:oc_01' }] }))
            .expect(201);

        expect(outcomeCaseService.linkRunReceipt).toHaveBeenCalledWith({
            caseId: 'oc_01',
            runReceiptRef: response.body.run.id,
            projectCode: 'brainbase',
            organizationId: null
        }, expect.objectContaining({
            person_id: 'route-test',
            projectCodes: ['brainbase'],
            organizationId: 'brainbase'
        }));
        expect(response.body.outcome_case_links).toEqual([{
            case_id: 'oc_01',
            run_receipt_ref: response.body.run.id,
            evaluation_required: true,
            status: 'linked'
        }]);
        expect(response.body.run.closure_state).toBe('closed');
        expect(outcomeCaseService.evaluate).not.toHaveBeenCalled();
    });

    it('POST ingestはOutcomeCase link失敗を503で返し、同一receiptのduplicate replayでlinkを再試行する', async () => {
        const outcomeCaseService = {
            linkRunReceipt: vi.fn()
                .mockRejectedValueOnce(Object.assign(new Error('OutcomeCase is not ready'), {
                    code: 'outcome_case_not_found'
                }))
                .mockResolvedValueOnce({ status: 'linked' }),
            evaluate: vi.fn()
        };
        const { app, repository } = createApp({ outcomeCaseService });
        const receipt = makeReceipt({
            evidenceRefs: [{ kind: 'artifact_ref', ref: 'outcome_case:oc_01' }]
        });

        const failed = await request(app)
            .post('/api/run-receipts/ingest')
            .send(receipt)
            .expect(503);

        expect(failed.headers['retry-after']).toBe('1');
        expect(failed.body).toMatchObject({
            error: 'RunReceipt was persisted, but one or more OutcomeCase references could not be linked; retry the exact receipt to retry linking',
            code: 'outcome_case_receipt_link_failed',
            retryable: true,
            details: {
                outcome_case_links: [{
                    case_id: 'oc_01',
                    run_receipt_ref: expect.stringMatching(/^run_receipt_run_/),
                    evaluation_required: true,
                    status: 'unresolved',
                    error_code: 'outcome_case_not_found'
                }]
            }
        });
        expect(repository.listRuns({ limit: null })).toHaveLength(1);

        const replay = await request(app)
            .post('/api/run-receipts/ingest')
            .send(receipt)
            .expect(200);

        expect(replay.body.status).toBe('duplicate');
        expect(replay.body.outcome_case_links).toEqual([{
            case_id: 'oc_01',
            run_receipt_ref: replay.body.run.id,
            evaluation_required: true,
            status: 'linked'
        }]);
        expect(outcomeCaseService.linkRunReceipt).toHaveBeenCalledTimes(2);
        expect(outcomeCaseService.evaluate).not.toHaveBeenCalled();
    });

    it('POST ingest_cookie/session-only authは保存前に403で拒否する', async () => {
        const { app, repository } = createApp({ authSource: 'cookie' });

        const response = await request(app)
            .post('/api/run-receipts/ingest')
            .send(makeReceipt())
            .expect(403);

        expect(response.body.error).toBe('server_to_server_auth_required');
        expect(repository.listRuns({ limit: null })).toHaveLength(0);
    });

    it('POST ingest_productionではinsecure-headerを保存前に403で拒否する', async () => {
        const previousNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const { app, repository } = createApp({ authSource: 'insecure-header' });

            const response = await request(app)
                .post('/api/run-receipts/ingest')
                .send(makeReceipt())
                .expect(403);

            expect(response.body.error).toBe('server_to_server_auth_required');
            expect(repository.listRuns({ limit: null })).toHaveLength(0);
        } finally {
            if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = previousNodeEnv;
        }
    });

    it('POST ingest_requireAuth経由のhuman JWTはBearerでもcookieでも拒否しservice tokenだけ受理する', async () => {
        const repository = new InMemoryWorkflowRepository();
        const ingestService = new RunReceiptIngestService({ workflowRepository: repository });
        const workflowService = new TestAutomationRuntime({ repository, runner: {}, configParser: null });
        const app = express();
        app.use(express.json());
        app.use(requireAuth({
            verifyToken: () => ({
                sub: 'human-operator',
                role: 'member',
                projectCodes: ['brainbase']
            }),
            verifyServiceToken: () => ({
                sub: 'connector-service',
                role: 'member',
                projectCodes: ['brainbase']
            })
        }));
        app.use('/api/run-receipts', createRunReceiptRouter({
            ingestService,
            queryService: workflowService.runReceiptQueryService
        }));
        app.use(errorHandler);

        await request(app)
            .post('/api/run-receipts/ingest')
            .set('Authorization', 'Bearer human-jwt')
            .send(makeReceipt({ externalRunId: 'human-bearer-run' }))
            .expect(403);
        await request(app)
            .post('/api/run-receipts/ingest')
            .set('Cookie', 'brainbase_session=human-jwt')
            .send(makeReceipt({ externalRunId: 'human-cookie-run' }))
            .expect(403);
        await request(app)
            .post('/api/run-receipts/ingest')
            .set('Authorization', 'Bearer bbsvc_connector-token')
            .send(makeReceipt({ externalRunId: 'service-token-run' }))
            .expect(201);

        const storedRuns = repository.listRuns({ limit: null });
        expect(storedRuns).toHaveLength(1);
        expect(storedRuns[0].metadata.run_receipt.source_external_run_id).toBe('service-token-run');
    });

    it('POST ingest_access外projectは保存前に403で拒否する', async () => {
        const { app, repository } = createApp({ authSource: 'service-token', projectCodes: ['brainbase'] });

        const response = await request(app)
            .post('/api/run-receipts/ingest')
            .send(makeReceipt({ projectId: 'mana' }))
            .expect(403);

        expect(response.body.error).toBe('project_not_accessible');
        expect(repository.listRuns({ limit: null })).toHaveLength(0);
    });

    it('POST ingest_contract conflictを400で返し原本を保持する', async () => {
        const { app, repository } = createApp();
        await request(app).post('/api/run-receipts/ingest').send(makeReceipt()).expect(201);
        const changed = makeReceipt();
        changed.run.status = 'cancelled';

        const response = await request(app)
            .post('/api/run-receipts/ingest')
            .send(changed)
            .expect(400);

        expect(response.body.code).toBe('run_receipt_conflict');
        expect(repository.listRuns({ limit: null })).toHaveLength(1);
    });

    it('POST ingest_identity lock timeoutはretryable 503で返し書き込まない', async () => {
        const repository = new InMemoryWorkflowRepository();
        const { app, ingestService } = createApp({
            repository,
            lockAcquireTimeoutMs: 5
        });
        const normalized = ingestService.normalize(makeReceipt());
        repository.acquireWorkflowLock({
            ...normalized.lock,
            locked_by: 'other-owner',
            ttl_ms: 60000
        });

        const response = await request(app)
            .post('/api/run-receipts/ingest')
            .send(makeReceipt())
            .expect(503);

        expect(response.headers['retry-after']).toBe('1');
        expect(response.body.code).toBe('run_receipt_lock_timeout');
        expect(repository.listRuns({ limit: null })).toHaveLength(0);
        expect(repository.listAuditLogs()).toHaveLength(0);
    });

    it('GET inboxはqueryをserviceへ渡しoperatorのproject境界を保つ', async () => {
        const repository = new InMemoryWorkflowRepository();
        const { app: ingestApp } = createApp({ repository, authSource: 'internal' });
        await request(ingestApp).post('/api/run-receipts/ingest').send(makeReceipt()).expect(201);
        const { app } = createApp({ repository, authSource: 'bearer', projectCodes: ['brainbase'] });

        const response = await request(app)
            .get('/api/run-receipts/inbox')
            .query({ project_id: 'brainbase', source_type: 'mana', run_status: 'success', evidence_state: 'confirmed', limit: 1 })
            .expect(200);

        expect(response.body).toMatchObject({ count: 1, has_more: false, omitted_count: 0 });
        expect(response.body.items[0]).toMatchObject({
            project_id: 'brainbase',
            source_status: 'success',
            evidence_state: 'confirmed',
            priority: 6
        });
    });

    it('GET inbox_access外projectは403で返す', async () => {
        const { app } = createApp({ authSource: 'bearer', projectCodes: ['brainbase'] });

        await request(app)
            .get('/api/run-receipts/inbox')
            .query({ project_id: 'mana' })
            .expect(403);
    });

    it('GET inbox_invalid filterは空成功へ丸めず400を返す', async () => {
        const { app } = createApp();

        const response = await request(app)
            .get('/api/run-receipts/inbox')
            .query({ evidence_state: 'unknown' })
            .expect(400);

        expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('GET historyはsource identity単位の全Runを新しい順で返す', async () => {
        const repository = new InMemoryWorkflowRepository();
        const { app } = createApp({ repository, authSource: 'internal' });
        await request(app).post('/api/run-receipts/ingest').send(makeReceipt({
            externalRunId: 'mana-run-old',
            finishedAt: '2026-07-14T00:00:00Z'
        })).expect(201);
        await request(app).post('/api/run-receipts/ingest').send(makeReceipt({
            externalRunId: 'mana-run-new',
            status: 'blocked',
            evidenceState: 'no_data',
            blockerReason: 'authentication_failed',
            actionRequired: 'reauthorize',
            finishedAt: '2026-07-16T00:00:00Z'
        })).expect(201);

        const response = await request(app)
            .get('/api/run-receipts/history')
            .query({
                project_id: 'brainbase',
                source_type: 'mana',
                source_identity: 'daily-secretary',
                limit: 10
            })
            .expect(200);

        expect(response.body).toMatchObject({
            source: { type: 'mana', identity: 'daily-secretary' },
            count: 2,
            has_more: false,
            omitted_count: 0
        });
        expect(response.body.items.map((item) => item.external_run_id)).toEqual([
            'mana-run-new',
            'mana-run-old'
        ]);
    });

    it('GET diagnosisはfailureとevidence不足を成功扱いせず構造化する', async () => {
        const { app } = createApp({ authSource: 'internal' });
        const created = await request(app).post('/api/run-receipts/ingest').send(makeReceipt({
            externalRunId: 'mana-run-blocked',
            status: 'blocked',
            evidenceState: 'no_data',
            blockerReason: 'authentication_failed',
            actionRequired: 'reauthorize'
        })).expect(201);

        const response = await request(app)
            .get(`/api/run-receipts/${created.body.run.id}/diagnosis`)
            .query({ project_id: 'brainbase' })
            .expect(200);

        expect(response.body.receipt).toMatchObject({
            run_id: created.body.run.id,
            project_id: 'brainbase',
            source_status: 'blocked',
            evidence_state: 'no_data',
            blocker_reason: 'authentication_failed'
        });
        expect(response.body.diagnosis).toEqual({
            state: 'action_required',
            issue_codes: ['source_blocked', 'evidence_missing'],
            recommended_action: 'reauthorize'
        });
    });

    it('GET historyとdiagnosisはproject境界と必須identityを強制する', async () => {
        const { app } = createApp({ authSource: 'bearer', projectCodes: ['brainbase'] });

        await request(app)
            .get('/api/run-receipts/history')
            .query({ project_id: 'brainbase', source_type: 'mana' })
            .expect(400);
        await request(app)
            .get('/api/run-receipts/history')
            .query({ project_id: 'mana', source_type: 'mana', source_identity: 'daily-secretary' })
            .expect(403);
        await request(app)
            .get('/api/run-receipts/missing-run/diagnosis')
            .query({ project_id: 'mana' })
            .expect(403);
    });

    it('GET routine-exceptionsは固定上限3でliveness serviceへ委譲する', async () => {
        const routineLivenessService = {
            listExceptions: vi.fn(async () => [{
                code: 'missing_receipt',
                automation_id: 'brainbase-ohayo'
            }])
        };
        const { app } = createApp({ routineLivenessService });

        const response = await request(app)
            .get('/api/run-receipts/routine-exceptions')
            .expect(200);

        expect(routineLivenessService.listExceptions).toHaveBeenCalledOnce();
        expect(routineLivenessService.listExceptions).toHaveBeenCalledWith({ limit: 3 }, expect.objectContaining({
            person_id: 'route-test', projectCodes: ['brainbase'], organizationId: 'brainbase'
        }));
        expect(response.body).toEqual({
            count: 1,
            items: [{ code: 'missing_receipt', automation_id: 'brainbase-ohayo' }]
        });
    });

    it('routine-exceptions carries the authenticated member through the actual liveness query', async () => {
        const repository = new InMemoryWorkflowRepository();
        const query = new RunReceiptQueryService({ repository,
            assertProjectAccess(project, actor) {
                if (!actor?.projectCodes?.includes(project)) throw Object.assign(new Error('forbidden'), { status: 403 });
            }
        });
        const liveness = new RoutineLivenessService({
            expectations: [{ routine: 'ohayo', automation_id: 'brainbase-ohayo',
                source_type: 'codex_automations', project_id: 'brainbase', timezone: 'Asia/Tokyo',
                schedule: { kind: 'daily', hour: 6, minute: 0 }, grace_minutes: 20,
                required_artifacts: ['routine_summary'] }],
            runReceiptQueryService: query, now: () => new Date('2026-09-16T00:00:00Z')
        });
        const { app } = createApp({ authSource: 'session', routineLivenessService: liveness });
        const response = await request(app).get('/api/run-receipts/routine-exceptions').expect(200);
        expect(response.body.items).toEqual([expect.objectContaining({ code: 'missing_receipt' })]);
    });

    it('run receiptは廃止済みWorkflow製品APIと互換実行APIへ露出しない', async () => {
        const { app, repository } = createApp();
        await request(app).post('/api/run-receipts/ingest').send(makeReceipt()).expect(201);
        const [receiptRun] = repository.listRuns({ limit: null });
        const receiptWorkflow = repository.getWorkflow(receiptRun.workflow_id);

        await request(app).get('/api/workflows').expect(404);
        await request(app).get(`/api/workflows/${receiptWorkflow.id}`).expect(404);
        await request(app)
            .patch(`/api/workflows/${receiptWorkflow.id}`)
            .send({ name: 'legacy mutation must not apply' })
            .expect(404);
        await request(app)
            .post(`/api/workflows/${receiptWorkflow.id}/run`)
            .send({})
            .expect(404);
        await request(app).get(`/api/workflow-runs/${receiptRun.id}`).expect(404);
        await request(app)
            .post(`/api/workflow-runs/${receiptRun.id}/rerun`)
            .send({})
            .expect(404);

        expect(repository.listRuns({ limit: null })).toHaveLength(1);
        expect(repository.getWorkflow(receiptWorkflow.id).name).toBe(receiptWorkflow.name);
    });
});
