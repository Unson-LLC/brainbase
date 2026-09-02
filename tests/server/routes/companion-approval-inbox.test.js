import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { requireAuth } from '../../../server/middleware/auth.js';
import { registerApiRoutes } from '../../../server/bootstrap/register-api-routes.js';
import { createCompanionRouter } from '../../../server/routes/companion.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';
import { TestAutomationRuntime } from '../../helpers/test-automation-runtime.js';

function createAuthService({
    valid = true,
    serviceValid = true,
    personId = 'per_keigo',
    projectCodes = ['sample-project'],
    organizationId = 'org_unson'
} = {}) {
    return {
        verifyServiceToken: vi.fn(() => {
            if (!serviceValid) throw new Error('invalid service token');
            return {
                role: 'service',
                projectCodes,
                clearance: ['internal'],
                personId: 'service_api',
                organizationId,
                sub: 'service_api'
            };
        }),
        verifyToken: vi.fn(() => {
            if (!valid) throw new Error('invalid');
            return {
                role: 'gm',
                projectCodes,
                clearance: ['internal'],
                personId,
                organizationId
            };
        })
    };
}

function createTestAutomationRuntime(repository = new InMemoryWorkflowRepository()) {
    const runner = new WorkflowRunner({ repository, handlers: new Map() });
    const configParser = {
        async getProjects() {
            return {
                source: { status: 'loaded', mode: 'registry_scoped' },
                projects: [
                    { id: 'sample-project', session_select: true, aliases: ['sample'] },
                    { id: 'other-project', session_select: true }
                ]
            };
        }
    };
    return new TestAutomationRuntime({ repository, runner, configParser });
}

function makeApp({ authService = createAuthService(), infoSSOTService = null } = {}) {
    const repository = new InMemoryWorkflowRepository();
    const workflowService = createTestAutomationRuntime(repository);
    const app = express();
    app.use(express.json());
    app.use('/api/companion', createCompanionRouter({
        replyDraftService: {
            createDraft: vi.fn(),
            createContext: vi.fn()
        },
        companionApprovalInboxService: workflowService.companionApprovalInboxService,
        infoSSOTService,
        authGuard: requireAuth(authService),
        accessGuardOptions: {
            ownerPersonId: 'sato_keigo',
            ownerAliasIds: ['per_keigo']
        }
    }));
    return { app, repository };
}

function makeBootstrapApp({
    authService = createAuthService(),
    automationRuntime = createTestAutomationRuntime(),
    infoSSOTService = { getContext: vi.fn(), listGraphEntities: vi.fn() }
} = {}) {
    const app = express();
    app.use(express.json());
    registerApiRoutes(app, {
        stateStore: {},
        sessionServices: {
            runtime: {
                registry: {},
                query: {},
                reconciler: {}
            },
            workspace: {}
        },
        testMode: true,
        configParser: {},
        configService: {},
        runtimePaths: { varDir: '/tmp' },
        scheduleParser: {},
        googleCalendarService: {},
        worktreeService: {},
        conversationLinker: {},
        projectsRoot: '/tmp',
        tmuxCaptureCache: {},
        authService,
        infoSSOTService,
        learningService: { searchPersonalKgCandidates: vi.fn() },
        learningHealthService: {},
        candidateRepository: null,
        wikiService: {},
        tokenUsageService: {},
        agentControlCatalogService: automationRuntime.agentControlCatalogService,
        loopIntentService: automationRuntime.loopIntentService,
        eveSessionDispatchService: automationRuntime.eveSessionDispatchService,
        meetingAutomationService: automationRuntime.meetingAutomationService,
        automationRunService: automationRuntime.automationRunService,
        runReceiptQueryService: automationRuntime.runReceiptQueryService,
        companionApprovalInboxService: automationRuntime.companionApprovalInboxService,
        runReceiptIngestService: {},
        externalRunnerIngestService: {},
        uploadMiddleware: (_req, _res, next) => next(),
        appVersion: 'test',
        workspaceRoot: '/tmp',
        uploadsDir: '/tmp/uploads',
        runtimeInfo: {},
        brainbaseRoot: '/tmp'
    });
    return app;
}

function seedWorkflow(repository, { workflowId = 'wf_meeting', projectId = 'sample-project' } = {}) {
    repository.upsertWorkflow({
        id: workflowId,
        workspace_id: 'default',
        project_id: projectId,
        name: 'Meeting Review Package',
        implementation_key: 'meeting-review-package-ingest',
        default_approver_id: 'sato_keigo'
    });
}

function seedApprovalRun(repository, {
    runId = 'run_pending_old',
    workflowId = 'wf_meeting',
    projectId = 'sample-project',
    status = 'waiting_human',
    humanStepStatus = 'pending',
    createdAt = '2026-06-25T04:00:00.000Z'
} = {}) {
    repository.createRun({
        id: runId,
        workspace_id: 'default',
        project_id: projectId,
        workflow_id: workflowId,
        status,
        action_required: status === 'waiting_human' ? 'approve' : 'none',
        human_waiting: status === 'waiting_human',
        created_at: createdAt,
        metadata: {
            meeting_identity: {
                title: 'Tech Knight / United ホテルDX案件レビュー',
                case_scope: 'hotel-dx-united'
            },
            source_event: {
                permalink: 'https://unson.slack.com/archives/C08SYTDR7R8/p1782367965844209'
            },
            stop_conditions: ['human_approval_required']
        }
    });
    repository.createHumanStep({
        id: `human_${runId}`,
        workspace_id: 'default',
        project_id: projectId,
        workflow_id: workflowId,
        workflow_run_id: runId,
        step_type: 'approval',
        requested_by: 'system',
        requested_to: 'sato_keigo',
        prompt: 'Task候補を作成してよいか確認してください',
        status: humanStepStatus,
        metadata: {
            write_back_target: 'task_store',
            protects: ['task_create']
        }
    });
    repository.createContextSnapshot({
        id: `ctx_${runId}`,
        workspace_id: 'default',
        project_id: projectId,
        workflow_id: workflowId,
        workflow_run_id: runId,
        source_type: 'review_package',
        source_ref: 'pkg_united_meeting',
        source_version: '0.1.0',
        preview: 'UnitedホテルDX案件レビューの会議文脈',
        data: {
            meeting_title: 'Tech Knight / United ホテルDX案件レビュー',
            decision_scope: 'task_candidates'
        }
    });
    repository.createOutput({
        id: `out_${runId}`,
        workspace_id: 'default',
        project_id: projectId,
        workflow_id: workflowId,
        workflow_run_id: runId,
        type: 'task_candidates',
        title: 'Task候補',
        preview: '18件のTask候補',
        metadata: {
            write_back_target: 'task_store'
        },
        payload: [{ title: 'United提案の次アクション整理' }]
    });
    repository.writeAuditLog({
        id: `audit_${runId}`,
        workspace_id: 'default',
        project_id: projectId,
        action: 'workflow.run.waiting_human',
        target_type: 'workflow_run',
        target_id: runId
    });
}

function seedDecisionApprovalRun(repository, {
    runId = 'run_decision_pending',
    workflowId = 'wf_meeting',
    projectId = 'sample-project',
    status = 'waiting_human',
    humanStepStatus = 'pending',
    createdAt = '2026-06-25T04:10:00.000Z'
} = {}) {
    repository.createRun({
        id: runId,
        workspace_id: 'default',
        project_id: projectId,
        workflow_id: workflowId,
        status,
        action_required: status === 'waiting_human' ? 'approve' : 'none',
        human_waiting: status === 'waiting_human',
        created_at: createdAt,
        metadata: {
            meeting_identity: {
                title: 'Graph SSOT Playbook判断レビュー',
                case_scope: 'graph-ssot-playbook'
            },
            source_event: {
                permalink: 'https://unson.slack.com/archives/C08SYTDR7R8/p1782367965844210'
            },
            stop_conditions: ['human_approval_required']
        }
    });
    repository.createHumanStep({
        id: `human_${runId}`,
        workspace_id: 'default',
        project_id: projectId,
        workflow_id: workflowId,
        workflow_run_id: runId,
        step_type: 'approval',
        requested_by: 'system',
        requested_to: 'sato_keigo',
        prompt: 'Decision候補をGraph SSOTへ登録してよいか確認してください',
        status: humanStepStatus,
        metadata: {
            write_back_target: 'graph_ssot_decision',
            output_id: `out_${runId}`,
            output_key: 'decision_candidates',
            output_type: 'decision_candidates',
            approval_kind: 'decision_candidates',
            protects: ['graph_ssot_decision']
        }
    });
    repository.createContextSnapshot({
        id: `ctx_${runId}`,
        workspace_id: 'default',
        project_id: projectId,
        workflow_id: workflowId,
        workflow_run_id: runId,
        source_type: 'review_package',
        source_ref: 'pkg_graph_ssot_playbook',
        source_version: '0.1.0',
        preview: 'Graph SSOT Playbook判断レビューの会議文脈',
        data: {
            meeting_title: 'Graph SSOT Playbook判断レビュー',
            decision_scope: 'decision_candidates'
        }
    });
    repository.createOutput({
        id: `out_${runId}`,
        workspace_id: 'default',
        project_id: projectId,
        workflow_id: workflowId,
        workflow_run_id: runId,
        type: 'decision_candidates',
        title: 'Decision候補',
        preview: '2件のDecision候補',
        metadata: {
            write_back_target: 'graph_ssot_decision',
            output_key: 'decision_candidates'
        },
        payload: [{ title: 'Graph SSOTから担当者候補を確定する' }]
    });
    repository.writeAuditLog({
        id: `audit_${runId}`,
        workspace_id: 'default',
        project_id: projectId,
        action: 'workflow.run.waiting_human',
        target_type: 'workflow_run',
        target_id: runId
    });
}

describe('companion approval inbox route', () => {
    it('returns pending workflow approvals with outputs and audit refs', async () => {
        const { app, repository } = makeApp();
        seedWorkflow(repository);
        seedApprovalRun(repository);

        const res = await request(app)
            .get('/api/companion/approval-inbox')
            .set('Authorization', 'Bearer user-token')
            .expect(200);

        expect(res.body.count).toBe(1);
        expect(res.body.items[0]).toMatchObject({
            id: 'approval_run_pending_old',
            kind: 'workflow_approval',
            title: 'Tech Knight / United ホテルDX案件レビュー',
            priority: 'high',
            owner_id: 'sato_keigo',
            action_kind: 'task_candidates',
            workflow_id: 'wf_meeting',
            run_id: 'run_pending_old',
            api_path: '/api/workflow-runs/run_pending_old',
            project_id: 'sample-project',
            status: 'waiting_human',
            action_required: 'approve',
            source_url: 'https://unson.slack.com/archives/C08SYTDR7R8/p1782367965844209',
            pending_human_steps: [
                expect.objectContaining({
                    id: 'human_run_pending_old',
                    prompt: 'Task候補を作成してよいか確認してください',
                    status: 'pending',
                    requested_by: 'system',
                    requested_to: 'sato_keigo',
                    write_back_target: 'task_store',
                    approval_kind: 'approval',
                    metadata: expect.objectContaining({
                        write_back_target: 'task_store'
                    })
                })
            ],
            context: [
                expect.objectContaining({
                    id: 'ctx_run_pending_old',
                    source_type: 'review_package',
                    source_ref: 'pkg_united_meeting',
                    summary: 'UnitedホテルDX案件レビューの会議文脈',
                    payload: expect.objectContaining({
                        decision_scope: 'task_candidates'
                    })
                })
            ],
            outputs: [
                expect.objectContaining({
                    id: 'out_run_pending_old',
                    output_type: 'task_candidates',
                    title: 'Task候補',
                    summary: '18件のTask候補',
                    payload: [{ title: 'United提案の次アクション整理' }],
                    metadata: expect.objectContaining({
                        write_back_target: 'task_store'
                    })
                })
            ],
            audit_refs: ['audit_run_pending_old'],
            evidence: [
                expect.objectContaining({
                    id: 'audit_run_pending_old',
                    action: 'workflow.run.waiting_human',
                    target_id: 'run_pending_old'
                })
            ]
        });
    });

    it('exposes Decision candidate output as an actionable human gate instead of output_only', async () => {
        const { app, repository } = makeApp();
        seedWorkflow(repository);
        seedDecisionApprovalRun(repository);

        const res = await request(app)
            .get('/api/companion/approval-inbox')
            .set('Authorization', 'Bearer user-token')
            .expect(200);

        expect(res.body.count).toBe(1);
        const item = res.body.items[0];
        expect(item).toMatchObject({
            id: 'approval_run_decision_pending',
            kind: 'workflow_approval',
            title: 'Graph SSOT Playbook判断レビュー',
            action_kind: 'decision_candidates',
            workflow_id: 'wf_meeting',
            run_id: 'run_decision_pending',
            pending_human_steps: [
                expect.objectContaining({
                    id: 'human_run_decision_pending',
                    prompt: 'Decision候補をGraph SSOTへ登録してよいか確認してください',
                    write_back_target: 'graph_ssot_decision',
                    approval_kind: 'decision_candidates',
                    metadata: expect.objectContaining({
                        write_back_target: 'graph_ssot_decision',
                        output_id: 'out_run_decision_pending',
                        output_key: 'decision_candidates',
                        output_type: 'decision_candidates',
                        approval_kind: 'decision_candidates'
                    })
                })
            ],
            outputs: [
                expect.objectContaining({
                    id: 'out_run_decision_pending',
                    output_type: 'decision_candidates',
                    title: 'Decision候補',
                    summary: '2件のDecision候補',
                    payload: [{ title: 'Graph SSOTから担当者候補を確定する' }],
                    metadata: expect.objectContaining({
                        write_back_target: 'graph_ssot_decision',
                        output_key: 'decision_candidates'
                    })
                })
            ],
            audit_refs: ['audit_run_decision_pending']
        });
        expect(item.pending_human_steps[0].metadata.output_id).toBe(item.outputs[0].id);
        expect(JSON.stringify(item)).not.toContain('output_only');
    });

    it('does not hide an older pending run behind a newer successful run', async () => {
        const { app, repository } = makeApp();
        seedWorkflow(repository);
        seedApprovalRun(repository, { runId: 'run_pending_old', createdAt: '2026-06-25T04:00:00.000Z' });
        seedApprovalRun(repository, {
            runId: 'run_success_new',
            status: 'success',
            humanStepStatus: 'approved',
            createdAt: '2026-06-26T04:00:00.000Z'
        });

        const res = await request(app)
            .get('/api/companion/approval-inbox')
            .set('Authorization', 'Bearer user-token')
            .expect(200);

        expect(res.body.items.map((item) => item.run_id)).toEqual(['run_pending_old']);
    });

    it('does not silently drop an old pending run outside the first 1000 newer non-pending runs', async () => {
        const { app, repository } = makeApp();
        seedWorkflow(repository);
        seedApprovalRun(repository, { runId: 'run_pending_very_old', createdAt: '2026-06-25T04:00:00.000Z' });

        for (let index = 0; index < 1001; index += 1) {
            seedApprovalRun(repository, {
                runId: `run_success_new_${index}`,
                status: 'success',
                humanStepStatus: 'approved',
                createdAt: new Date(Date.UTC(2026, 5, 26, 4, 0, index)).toISOString()
            });
        }

        const res = await request(app)
            .get('/api/companion/approval-inbox')
            .set('Authorization', 'Bearer user-token')
            .expect(200);

        expect(res.body.items.map((item) => item.run_id)).toEqual(['run_pending_very_old']);
    });

    it('omits terminal runs even when a stale pending human step remains', async () => {
        const { app, repository } = makeApp();
        seedWorkflow(repository);
        seedApprovalRun(repository, {
            runId: 'run_success_stale_pending',
            status: 'success',
            humanStepStatus: 'pending',
            createdAt: '2026-06-26T04:00:00.000Z'
        });
        seedApprovalRun(repository, {
            runId: 'run_cancelled_stale_pending',
            status: 'cancelled',
            humanStepStatus: 'pending',
            createdAt: '2026-06-26T05:00:00.000Z'
        });
        seedApprovalRun(repository, {
            runId: 'run_resolved_stale_pending',
            status: 'resolved',
            humanStepStatus: 'pending',
            createdAt: '2026-06-26T05:15:00.000Z'
        });
        seedApprovalRun(repository, {
            runId: 'run_status_closed_stale_pending',
            status: 'closed',
            humanStepStatus: 'pending',
            createdAt: '2026-06-26T05:30:00.000Z'
        });
        seedApprovalRun(repository, {
            runId: 'run_closed_stale_pending',
            humanStepStatus: 'pending',
            createdAt: '2026-06-26T06:00:00.000Z'
        });
        repository.updateRun('run_closed_stale_pending', {
            closure_state: 'closed',
            human_waiting: false,
            action_required: 'none'
        });

        const res = await request(app)
            .get('/api/companion/approval-inbox')
            .set('Authorization', 'Bearer user-token')
            .expect(200);

        expect(res.body).toMatchObject({
            count: 0,
            has_more: false,
            omitted_count: 0
        });
    });

    it('returns has_more and omitted_count when pending approvals exceed the response limit', async () => {
        const { app, repository } = makeApp();
        seedWorkflow(repository);
        seedApprovalRun(repository, { runId: 'run_pending_1', createdAt: '2026-06-26T04:00:00.000Z' });
        seedApprovalRun(repository, { runId: 'run_pending_2', createdAt: '2026-06-26T05:00:00.000Z' });
        seedApprovalRun(repository, { runId: 'run_pending_3', createdAt: '2026-06-26T06:00:00.000Z' });
        seedApprovalRun(repository, { runId: 'run_pending_4', createdAt: '2026-06-26T07:00:00.000Z' });
        seedApprovalRun(repository, { runId: 'run_pending_5', createdAt: '2026-06-26T08:00:00.000Z' });

        const res = await request(app)
            .get('/api/companion/approval-inbox?limit=2')
            .set('Authorization', 'Bearer user-token')
            .expect(200);

        expect(res.body.items.map((item) => item.run_id)).toHaveLength(2);
        expect(res.body).toMatchObject({
            count: 2,
            has_more: true,
            omitted_count: 3
        });
    });

    it('does not mark has_more when pending approvals exactly match the response limit', async () => {
        const { app, repository } = makeApp();
        seedWorkflow(repository);
        seedApprovalRun(repository, { runId: 'run_pending_1', createdAt: '2026-06-26T04:00:00.000Z' });
        seedApprovalRun(repository, { runId: 'run_pending_2', createdAt: '2026-06-26T05:00:00.000Z' });

        const res = await request(app)
            .get('/api/companion/approval-inbox?limit=2')
            .set('Authorization', 'Bearer user-token')
            .expect(200);

        expect(res.body.items.map((item) => item.run_id)).toHaveLength(2);
        expect(res.body).toMatchObject({
            count: 2,
            has_more: false,
            omitted_count: 0
        });
    });

    it('rejects missing auth before listing approvals', async () => {
        const { app, repository } = makeApp();
        seedWorkflow(repository);
        seedApprovalRun(repository);

        await request(app)
            .get('/api/companion/approval-inbox')
            .expect(401);
    });

    it('rejects cookie-only auth on the native approval inbox path before workflow scan', async () => {
        const { app, repository } = makeApp();
        const listRunsSpy = vi.spyOn(repository, 'listRuns');
        seedWorkflow(repository);
        seedApprovalRun(repository);

        const res = await request(app)
            .get('/api/companion/approval-inbox')
            .set('Cookie', 'brainbase_session=user-token')
            .expect(403);

        expect(res.body).toMatchObject({
            error: 'server_to_server_auth_required',
            code: 'server_to_server_auth_required'
        });
        expect(listRunsSpy).not.toHaveBeenCalled();
    });

    it('rejects non-owner bearer auth on the approval inbox path before workflow scan', async () => {
        const { app, repository } = makeApp({
            authService: createAuthService({ personId: 'per_other' })
        });
        const listRunsSpy = vi.spyOn(repository, 'listRuns');
        seedWorkflow(repository);
        seedApprovalRun(repository);

        const res = await request(app)
            .get('/api/companion/approval-inbox')
            .set('Authorization', 'Bearer other-user-token')
            .expect(403);

        expect(res.body).toMatchObject({
            error: 'personal_kg_owner_required',
            code: 'personal_kg_owner_required'
        });
        expect(listRunsSpy).not.toHaveBeenCalled();
    });

    it('allows service-token auth on the native approval inbox path', async () => {
        const { app, repository } = makeApp();
        seedWorkflow(repository);
        seedApprovalRun(repository);

        const res = await request(app)
            .get('/api/companion/approval-inbox')
            .set('Authorization', 'Bearer bbsvc_test-token')
            .expect(200);

        expect(res.body.items.map((item) => item.run_id)).toEqual(['run_pending_old']);
    });

    it('rejects invalid service-token auth before workflow scan', async () => {
        const { app, repository } = makeApp({
            authService: createAuthService({ serviceValid: false })
        });
        const listRunsSpy = vi.spyOn(repository, 'listRuns');
        seedWorkflow(repository);
        seedApprovalRun(repository);

        await request(app)
            .get('/api/companion/approval-inbox')
            .set('Authorization', 'Bearer bbsvc_invalid-token')
            .expect(401);

        expect(listRunsSpy).not.toHaveBeenCalled();
    });

    it('allows internal api key auth on the native approval inbox path', async () => {
        const previousSecret = process.env.INTERNAL_API_SECRET;
        process.env.INTERNAL_API_SECRET = 'internal-test-secret';
        try {
            const { app, repository } = makeApp();
            seedWorkflow(repository);
            seedApprovalRun(repository);

            const res = await request(app)
                .get('/api/companion/approval-inbox')
                .set('x-internal-api-key', 'internal-test-secret')
                .expect(200);

            expect(res.body.items.map((item) => item.run_id)).toEqual(['run_pending_old']);
        } finally {
            if (previousSecret === undefined) delete process.env.INTERNAL_API_SECRET;
            else process.env.INTERNAL_API_SECRET = previousSecret;
        }
    });

    it('rejects project grant denied before workflow scan', async () => {
        const { app, repository } = makeApp({
            authService: createAuthService({ projectCodes: ['sample-project'] })
        });
        const listRunsSpy = vi.spyOn(repository, 'listRuns');
        seedWorkflow(repository);
        seedWorkflow(repository, { workflowId: 'wf_other', projectId: 'other-project' });
        seedApprovalRun(repository, { workflowId: 'wf_other', projectId: 'other-project', runId: 'run_other_project' });

        const res = await request(app)
            .get('/api/companion/approval-inbox?project_id=other-project')
            .set('Authorization', 'Bearer user-token')
            .expect(403);

        expect(res.body.code).toBe('FORBIDDEN');
        expect(listRunsSpy).not.toHaveBeenCalled();
    });

    it('INV-people-ssot-1 exposes assignee people from Graph SSOT through the native companion API', async () => {
        const infoSSOTService = {
            listGraphEntities: vi.fn(async () => [
                {
                    id: 'person_yajima',
                    entity_type: 'person',
                    payload: {
                        name: '矢島様',
                        aliases: ['矢島さん', 'yajima'],
                        email: 'yajima@example.com',
                        org: 'Hotel Client',
                        status: 'active'
                    }
                },
                {
                    id: 'person_speaker_1',
                    entity_type: 'person',
                    payload: {
                        name: 'Speaker 1'
                    }
                }
            ])
        };
        const { app } = makeApp({ infoSSOTService });

        const res = await request(app)
            .get('/api/companion/people?source=graph_ssot&type=person')
            .set('Authorization', 'Bearer user-token')
            .expect(200);

        expect(infoSSOTService.listGraphEntities).toHaveBeenCalledWith(
            expect.objectContaining({
                role: 'gm',
                projectCodes: ['sample-project'],
                clearance: ['internal'],
                personId: 'per_keigo'
            }),
            expect.objectContaining({
                entityType: 'person',
                limit: 500
            })
        );
        expect(res.body).toMatchObject({
            source: 'graph_ssot',
            type: 'person',
            count: 1,
            people: [
                {
                    id: 'person_yajima',
                    entity_id: 'person_yajima',
                    person_id: 'person_yajima',
                    display_name: '矢島様',
                    name: '矢島様',
                    aliases: ['矢島さん', 'yajima'],
                    email: 'yajima@example.com',
                    org: 'Hotel Client',
                    status: 'active',
                    source: 'graph_ssot'
                }
            ]
        });
        expect(res.body.people.map((person) => person.display_name)).not.toContain('Speaker 1');
    });

    it('INV-people-ssot-5 filters assignee people by query before returning candidates', async () => {
        const infoSSOTService = {
            listGraphEntities: vi.fn(async () => [
                {
                    id: 'person_yajima_tsuyoshi',
                    entity_type: 'person',
                    payload: {
                        name: '矢島剛',
                        aliases: ['矢島さん', '矢島様', 'Tsuyoshi Yajima'],
                        status: 'active'
                    }
                },
                {
                    id: 'person_sato_keigo',
                    entity_type: 'person',
                    payload: {
                        name: '佐藤圭吾',
                        aliases: ['佐藤さん'],
                        status: 'active'
                    }
                }
            ])
        };
        const { app } = makeApp({ infoSSOTService });

        const res = await request(app)
            .get('/api/companion/people?source=graph_ssot&type=person&query=%E7%9F%A2%E5%B3%B6&limit=20')
            .set('Authorization', 'Bearer user-token')
            .expect(200);

        expect(infoSSOTService.listGraphEntities).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                entityType: 'person',
                query: '矢島',
                limit: 20
            })
        );
        expect(res.body).toMatchObject({
            count: 1,
            people: [
                {
                    id: 'person_yajima_tsuyoshi',
                    display_name: '矢島剛',
                    aliases: ['矢島さん', '矢島様', 'Tsuyoshi Yajima']
                }
            ]
        });
    });

    it('INV-people-ssot-4 registers an assignee person into Graph SSOT through the native companion API', async () => {
        const infoSSOTService = {
            createOrUpdatePerson: vi.fn(async () => ({
                entity_id: 'person_yajima_tsuyoshi',
                person_id: 'person_yajima_tsuyoshi',
                name: '矢島剛',
                display_name: '矢島剛',
                aliases: ['矢島さん'],
                email: 'yajima@example.com',
                org: 'Hotel Client',
                role: '営業',
                status: 'active',
                guard_status: 'inactive_no_current',
                ontology_version: null
            }))
        };
        const { app } = makeApp({ infoSSOTService });

        const res = await request(app)
            .post('/api/companion/people')
            .set('Authorization', 'Bearer user-token')
            .send({
                source: 'graph_ssot',
                type: 'person',
                name: '矢島剛',
                aliases: ['矢島さん'],
                email: 'yajima@example.com',
                org: 'Hotel Client',
                role: '営業'
            })
            .expect(201);

        expect(infoSSOTService.createOrUpdatePerson).toHaveBeenCalledWith(
            expect.objectContaining({
                role: 'gm',
                projectCodes: ['sample-project'],
                clearance: ['internal'],
                personId: 'per_keigo'
            }),
            expect.objectContaining({
                name: '矢島剛',
                aliases: ['矢島さん']
            })
        );
        expect(res.body).toMatchObject({
            source: 'graph_ssot',
            type: 'person',
            guard_status: 'inactive_no_current',
            ontology_version: null,
            person: {
                id: 'person_yajima_tsuyoshi',
                entity_id: 'person_yajima_tsuyoshi',
                person_id: 'person_yajima_tsuyoshi',
                display_name: '矢島剛',
                name: '矢島剛',
                aliases: ['矢島さん'],
                email: 'yajima@example.com',
                org: 'Hotel Client',
                role: '営業',
                status: 'active',
                source: 'graph_ssot'
            }
        });
    });

    it('INV-people-ssot-2 rejects non Graph SSOT assignee sources', async () => {
        const infoSSOTService = { listGraphEntities: vi.fn(async () => []) };
        const { app } = makeApp({ infoSSOTService });

        const res = await request(app)
            .get('/api/companion/people?source=ai_hint&type=person')
            .set('Authorization', 'Bearer user-token')
            .expect(400);

        expect(res.body.code).toBe('unsupported_people_source');
        expect(infoSSOTService.listGraphEntities).not.toHaveBeenCalled();
    });

    it('INV-people-ssot-3 applies native companion auth guard before reading people', async () => {
        const infoSSOTService = { listGraphEntities: vi.fn(async () => []) };
        const { app } = makeApp({ infoSSOTService });

        const res = await request(app)
            .get('/api/companion/people?source=graph_ssot&type=person')
            .set('Cookie', 'brainbase_session=user-token')
            .expect(403);

        expect(res.body.code).toBe('server_to_server_auth_required');
        expect(infoSSOTService.listGraphEntities).not.toHaveBeenCalled();
    });

    it('registers approval inbox through the production bootstrap with its dedicated service', async () => {
        const { repository } = makeApp();
        const runner = new WorkflowRunner({ repository, handlers: new Map() });
        const configParser = {
            async getProjects() {
                return {
                    source: { status: 'loaded', mode: 'registry_scoped' },
                    projects: [
                        { id: 'sample-project', session_select: true, aliases: ['sample'] },
                        { id: 'other-project', session_select: true }
                    ]
                };
            }
        };
        const automationRuntime = new TestAutomationRuntime({ repository, runner, configParser });
        const app = makeBootstrapApp({
            authService: createAuthService({ personId: 'sato_keigo' }),
            automationRuntime
        });
        seedWorkflow(repository);
        seedApprovalRun(repository);

        const res = await request(app)
            .get('/api/companion/approval-inbox')
            .set('Authorization', 'Bearer user-token')
            .expect(200);

        expect(res.status).not.toBe(404);
        expect(res.body.items.map((item) => item.run_id)).toEqual(['run_pending_old']);
    });

    it('registers /api/info with strict bearer authentication', async () => {
        const infoSSOTService = {
            listGraphEntities: vi.fn(async () => [])
        };
        const app = makeBootstrapApp({ infoSSOTService });

        await request(app)
            .get('/api/info/graph/entities?project=brainbase')
            .set('x-brainbase-role', 'ceo')
            .set('x-brainbase-projects', 'brainbase')
            .set('x-brainbase-clearance', 'restricted')
            .expect(401);

        expect(infoSSOTService.listGraphEntities).not.toHaveBeenCalled();
    });

    it('passes verified bearer claims to /api/info instead of spoofed headers', async () => {
        const infoSSOTService = {
            listGraphEntities: vi.fn(async () => [])
        };
        const app = makeBootstrapApp({
            authService: createAuthService({ personId: 'per_verified', projectCodes: ['sample-project'] }),
            infoSSOTService
        });

        await request(app)
            .get('/api/info/graph/entities?project=sample-project')
            .set('Authorization', 'Bearer verified-token')
            .set('x-brainbase-role', 'ceo')
            .set('x-brainbase-projects', 'all-projects')
            .set('x-brainbase-clearance', 'restricted')
            .expect(200);

        expect(infoSSOTService.listGraphEntities).toHaveBeenCalledWith(
            expect.objectContaining({
                role: 'gm',
                projectCodes: ['sample-project'],
                personId: 'per_verified'
            }),
            expect.objectContaining({
                projectCode: 'sample-project',
                entityType: null
            })
        );
    });

    it('does not write default workflows during read-only approval inbox projection', async () => {
        const { app, repository } = makeApp();
        seedWorkflow(repository);
        seedApprovalRun(repository);
        const upsertSpy = vi.spyOn(repository, 'upsertWorkflow');
        const createRunSpy = vi.spyOn(repository, 'createRun');
        const updateRunSpy = vi.spyOn(repository, 'updateRun');
        const createContextSnapshotSpy = vi.spyOn(repository, 'createContextSnapshot');
        const updateHumanStepSpy = vi.spyOn(repository, 'updateHumanStep');
        const createOutputSpy = vi.spyOn(repository, 'createOutput');
        const writeAuditLogSpy = vi.spyOn(repository, 'writeAuditLog');

        await request(app)
            .get('/api/companion/approval-inbox')
            .set('Authorization', 'Bearer user-token')
            .expect(200);

        expect(upsertSpy).not.toHaveBeenCalled();
        expect(createRunSpy).not.toHaveBeenCalled();
        expect(updateRunSpy).not.toHaveBeenCalled();
        expect(createContextSnapshotSpy).not.toHaveBeenCalled();
        expect(updateHumanStepSpy).not.toHaveBeenCalled();
        expect(createOutputSpy).not.toHaveBeenCalled();
        expect(writeAuditLogSpy).not.toHaveBeenCalled();
    });
});
