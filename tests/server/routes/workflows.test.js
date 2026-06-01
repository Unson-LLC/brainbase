import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import {
    createWorkflowHumanStepRouter,
    createWorkflowRouter,
    createWorkflowRunRouter
} from '../../../server/routes/workflows.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';
import {
    WorkflowService,
    createBrainbaseAliveWorkflow,
    createDefaultWorkflowHandlers
} from '../../../server/services/workflow/workflow-service.js';

function makeApp({ handlers = createDefaultWorkflowHandlers(), accessProjectCodes = ['general', 'sample-project'], role = 'member' } = {}) {
    const repository = new InMemoryWorkflowRepository({
        seedWorkflows: [createBrainbaseAliveWorkflow()]
    });
    const runner = new WorkflowRunner({ repository, handlers });
    const configParser = {
        async getProjects() {
            return {
                root: '/workspace',
                projects: [
                    { id: 'sample-project', session_select: true, aliases: ['sample'] },
                    { id: 'archived-project', archived: true }
                ]
            };
        }
    };
    const service = new WorkflowService({ repository, runner, configParser });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.auth = { sub: 'sato', role: 'member' };
        req.access = {
            personId: 'sato',
            projectCodes: accessProjectCodes,
            role
        };
        req.authSource = 'test';
        next();
    });
    app.use('/api/workflows', createWorkflowRouter(service));
    app.use('/api/workflow-runs', createWorkflowRunRouter(service));
    app.use('/api/workflow-human-steps', createWorkflowHumanStepRouter(service));
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || 500).json({ error: err.message });
    });
    return { app, repository };
}

describe('workflow routes', () => {
    it('lists the built-in brainbase-alive workflow', async () => {
        const { app } = makeApp();

        const res = await request(app)
            .get('/api/workflows')
            .expect(200);

        expect(res.body.workflows).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'brainbase-alive',
                project_id: 'general'
            })
        ]));
    });

    it('creates a project-bound workflow using the same project ids as session creation', async () => {
        const { app, repository } = makeApp();

        const res = await request(app)
            .post('/api/workflows')
            .send({
                id: 'weekly-review',
                name: 'Weekly Review',
                project_id: 'sample-project',
                owner_id: 'ignored-body-owner',
                default_assignee_id: 'ignored-body-assignee',
                default_approver_id: 'ignored-body-approver',
                context_sources: [{
                    source_type: 'project',
                    source_ref: 'sample-project',
                    required: true
                }]
            })
            .expect(201);

        expect(res.body.workflow).toMatchObject({
            id: 'weekly-review',
            project_id: 'sample-project',
            owner_id: 'sato',
            default_assignee_id: 'sato',
            default_approver_id: 'sato'
        });
        expect(repository.listAuditLogs({ targetId: 'weekly-review' })).toEqual([
            expect.objectContaining({ action: 'workflow.created', target_type: 'workflow' })
        ]);
    });

    it('rejects create when the workflow id already exists', async () => {
        const { app } = makeApp();

        const res = await request(app)
            .post('/api/workflows')
            .send({
                id: 'brainbase-alive',
                name: 'Overwrite Attempt',
                project_id: 'general'
            })
            .expect(409);

        expect(res.body.error).toContain("workflow 'brainbase-alive' already exists");
    });

    it('gets and patches a workflow through the public workflow API with audit evidence', async () => {
        const { app, repository } = makeApp();
        await request(app)
            .post('/api/workflows')
            .send({
                id: 'patchable-workflow',
                name: 'Patchable Workflow',
                project_id: 'sample-project'
            })
            .expect(201);

        const getRes = await request(app)
            .get('/api/workflows/patchable-workflow')
            .expect(200);
        expect(getRes.body.workflow).toMatchObject({
            id: 'patchable-workflow',
            project_id: 'sample-project'
        });

        const patchRes = await request(app)
            .patch('/api/workflows/patchable-workflow')
            .send({ name: 'Patched Workflow', enabled: false })
            .expect(200);

        expect(patchRes.body.workflow).toMatchObject({
            id: 'patchable-workflow',
            name: 'Patched Workflow',
            enabled: false
        });
        expect(repository.listAuditLogs({ targetId: 'patchable-workflow' })).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'workflow.created', target_type: 'workflow' }),
            expect.objectContaining({ action: 'workflow.updated', target_type: 'workflow' })
        ]));
    });

    it('rejects workflow creation for archived or hidden projects', async () => {
        const { app } = makeApp();

        const res = await request(app)
            .post('/api/workflows')
            .send({
                id: 'bad-project',
                name: 'Bad Project',
                project_id: 'archived-project'
            })
            .expect(400);

        expect(res.body.error).toContain("project 'archived-project' is not selectable");
    });

    it('rejects workflow creation without an explicit project_id', async () => {
        const { app } = makeApp();

        const res = await request(app)
            .post('/api/workflows')
            .send({
                id: 'missing-project',
                name: 'Missing Project'
            })
            .expect(400);

        expect(res.body.error).toContain('project_id is required');
    });

    it('denies protected workflow APIs when project grants are empty', async () => {
        const { app } = makeApp({ accessProjectCodes: [] });

        const listRes = await request(app)
            .get('/api/workflows')
            .expect(200);
        expect(listRes.body.workflows).toEqual([]);

        await request(app)
            .post('/api/workflows/brainbase-alive/run')
            .send({ trigger_type: 'manual' })
            .expect(403);

        await request(app)
            .post('/api/workflows')
            .send({
                id: 'denied-project',
                name: 'Denied Project',
                project_id: 'sample-project'
            })
            .expect(403);
    });

    it('accepts the same normalized project aliases used by session selection', async () => {
        const { app } = makeApp({ accessProjectCodes: ['sample'] });

        const res = await request(app)
            .post('/api/workflows')
            .send({
                id: 'alias-project',
                name: 'Alias Project',
                project_id: 'sample-project'
            })
            .expect(201);

        expect(res.body.workflow.project_id).toBe('sample-project');
    });

    it('does not allow arbitrary project-code prefixes for protected workflow APIs', async () => {
        const { app } = makeApp({ accessProjectCodes: ['sam'] });

        await request(app)
            .post('/api/workflows')
            .send({
                id: 'short-prefix-denied',
                name: 'Short Prefix Denied',
                project_id: 'sample-project'
            })
            .expect(403);
    });

    it('runs brainbase-alive and returns the run detail through workflow-runs API', async () => {
        const { app } = makeApp();

        const runRes = await request(app)
            .post('/api/workflows/brainbase-alive/run')
            .send({ actor_id: 'sato' })
            .expect(201);

        expect(runRes.body.run).toMatchObject({
            workflow_id: 'brainbase-alive',
            status: 'success',
            closure_state: 'closed'
        });

        const detailRes = await request(app)
            .get(`/api/workflow-runs/${runRes.body.run.id}`)
            .expect(200);

        expect(detailRes.body.run_steps).toHaveLength(1);
        expect(detailRes.body.context_snapshots).toHaveLength(1);
        expect(detailRes.body.outputs).toHaveLength(1);

        const listRes = await request(app)
            .get('/api/workflows')
            .expect(200);
        expect(listRes.body.workflows.find((workflow) => workflow.id === 'brainbase-alive')).toMatchObject({
            latest_context_snapshots: expect.arrayContaining([
                expect.objectContaining({ source_type: 'project' })
            ])
        });

        const rerunRes = await request(app)
            .post(`/api/workflow-runs/${runRes.body.run.id}/rerun`)
            .send({})
            .expect(201);
        expect(rerunRes.body.run).toMatchObject({
            workflow_id: 'brainbase-alive',
            parent_run_id: runRes.body.run.id,
            trigger_type: 'retry',
            status: 'success'
        });
    });

    it('prioritizes actionable workflows before healthy workflows in the Mission Control list', async () => {
        const { app, repository } = makeApp({
            handlers: {
                ...createDefaultWorkflowHandlers(),
                needsApproval: async () => ({
                    status: 'waiting_human',
                    actionRequired: 'approve',
                    message: 'Needs approval',
                    humanStep: { stepType: 'approval', prompt: 'Approve?' }
                })
            }
        });
        repository.upsertWorkflow({
            ...createBrainbaseAliveWorkflow({ projectId: 'sample-project', ownerId: 'sato' }),
            id: 'healthy-workflow',
            project_id: 'sample-project',
            implementation_key: 'brainbase-alive',
            owner_id: 'sato',
            context_sources: [{
                source_type: 'project',
                source_ref: 'sample-project',
                required: true
            }]
        });
        repository.upsertWorkflow({
            ...createBrainbaseAliveWorkflow({ projectId: 'sample-project', ownerId: 'sato' }),
            id: 'approval-first-workflow',
            project_id: 'sample-project',
            implementation_key: 'needsApproval',
            owner_id: 'sato',
            default_approver_id: 'sato',
            context_sources: [{
                source_type: 'project',
                source_ref: 'sample-project',
                required: true
            }]
        });

        await request(app).post('/api/workflows/healthy-workflow/run').send({}).expect(201);
        await request(app).post('/api/workflows/approval-first-workflow/run').send({}).expect(201);

        const res = await request(app)
            .get('/api/workflows?project_id=sample-project')
            .expect(200);

        expect(res.body.workflows.map((workflow) => workflow.id).slice(0, 2)).toEqual([
            'approval-first-workflow',
            'healthy-workflow'
        ]);
    });

    it('resolves a pending human step through the run-scoped human-step API and resumes through runWorkflow', async () => {
        const { app, repository } = makeApp({
            handlers: {
                ...createDefaultWorkflowHandlers(),
                'manual-placeholder': async (ctx) => (
                    ctx.humanStepResolution
                        ? {
                            status: 'success',
                            closureState: 'closed',
                            actionRequired: 'none',
                            message: 'Approved and resumed',
                            outputCount: 1,
                            data: { approved: true }
                        }
                        : {
                            status: 'waiting_human',
                            actionRequired: 'approve',
                            message: 'Needs approval',
                            humanStep: { stepType: 'approval', prompt: 'Approve?' }
                        }
                )
            }
        });
        repository.upsertWorkflow({
            ...createBrainbaseAliveWorkflow({ projectId: 'sample-project' }),
            id: 'approval-workflow',
            project_id: 'sample-project',
            implementation_key: 'manual-placeholder',
            owner_id: 'sato',
            default_approver_id: 'sato',
            context_sources: [{
                source_type: 'project',
                source_ref: 'sample-project',
                required: true
            }]
        });

        const runRes = await request(app)
            .post('/api/workflows/approval-workflow/run')
            .send({ actor_id: 'sato' })
            .expect(201);
        const stepId = runRes.body.humanStep.id;

        const resolveRes = await request(app)
            .post(`/api/workflow-runs/${runRes.body.run.id}/human-steps/${stepId}/resolve`)
            .send({ resolution: 'approved' })
            .expect(200);

        expect(resolveRes.body.human_step).toMatchObject({
            id: stepId,
            status: 'approved'
        });
        expect(resolveRes.body.resumed_run).toMatchObject({
            workflow_id: 'approval-workflow',
            parent_run_id: runRes.body.run.id,
            trigger_type: 'human_resume',
            status: 'success',
            closure_state: 'closed'
        });
        expect(repository.listAuditLogs({ targetId: stepId })).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'workflow.human_step.resolved',
                target_type: 'workflow_human_step'
            })
        ]));
        expect(repository.listAuditLogs({ targetId: resolveRes.body.resumed_run.id })).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'workflow.run.human_step.resumed',
                target_type: 'workflow_run'
            })
        ]));
    });

    it('denies human step resolution by another project member who is not the requester or approver', async () => {
        const { app, repository } = makeApp({
            handlers: {
                ...createDefaultWorkflowHandlers(),
                'manual-placeholder': async () => ({
                    status: 'waiting_human',
                    actionRequired: 'approve',
                    message: 'Needs approval',
                    humanStep: { stepType: 'approval', prompt: 'Approve?' }
                })
            }
        });
        repository.upsertWorkflow({
            ...createBrainbaseAliveWorkflow({ projectId: 'sample-project', ownerId: 'approver' }),
            id: 'restricted-approval-workflow',
            project_id: 'sample-project',
            implementation_key: 'manual-placeholder',
            owner_id: 'approver',
            default_approver_id: 'approver',
            context_sources: [{
                source_type: 'project',
                source_ref: 'sample-project',
                required: true
            }]
        });

        const runRes = await request(app)
            .post('/api/workflows/restricted-approval-workflow/run')
            .send({ actor_id: 'sato' })
            .expect(201);

        await request(app)
            .post(`/api/workflow-runs/${runRes.body.run.id}/human-steps/${runRes.body.humanStep.id}/resolve`)
            .send({ resolution: 'approved' })
            .expect(403);
    });

    it('does not resume a human-gated workflow when the human step is rejected', async () => {
        const { app, repository } = makeApp({
            handlers: {
                ...createDefaultWorkflowHandlers(),
                'manual-placeholder': async (ctx) => (
                    ctx.humanStepResolution
                        ? {
                            status: 'success',
                            closureState: 'closed',
                            actionRequired: 'none',
                            message: 'Should not run after rejection'
                        }
                        : {
                            status: 'waiting_human',
                            actionRequired: 'approve',
                            message: 'Needs approval',
                            humanStep: { stepType: 'approval', prompt: 'Approve?' }
                        }
                )
            }
        });
        repository.upsertWorkflow({
            ...createBrainbaseAliveWorkflow({ projectId: 'sample-project', ownerId: 'sato' }),
            id: 'reject-approval-workflow',
            project_id: 'sample-project',
            implementation_key: 'manual-placeholder',
            owner_id: 'sato',
            default_approver_id: 'sato',
            context_sources: [{
                source_type: 'project',
                source_ref: 'sample-project',
                required: true
            }]
        });

        const runRes = await request(app)
            .post('/api/workflows/reject-approval-workflow/run')
            .send({ actor_id: 'sato' })
            .expect(201);
        const resolveRes = await request(app)
            .post(`/api/workflow-runs/${runRes.body.run.id}/human-steps/${runRes.body.humanStep.id}/resolve`)
            .send({ resolution: 'rejected' })
            .expect(200);

        expect(resolveRes.body.human_step.status).toBe('rejected');
        expect(resolveRes.body.resumed_run).toMatchObject({
            id: runRes.body.run.id,
            status: 'cancelled',
            closure_state: 'closed'
        });
    });

    it('keeps the legacy human-step resolve alias behind the same approval and resume semantics', async () => {
        const { app, repository } = makeApp({
            handlers: {
                ...createDefaultWorkflowHandlers(),
                'manual-placeholder': async (ctx) => (
                    ctx.humanStepResolution
                        ? {
                            status: 'success',
                            closureState: 'closed',
                            actionRequired: 'none',
                            message: 'Approved through legacy alias',
                            outputCount: 1,
                            data: { approved: true }
                        }
                        : {
                            status: 'waiting_human',
                            actionRequired: 'approve',
                            message: 'Needs approval',
                            humanStep: { stepType: 'approval', prompt: 'Approve?' }
                        }
                )
            }
        });
        repository.upsertWorkflow({
            ...createBrainbaseAliveWorkflow({ projectId: 'sample-project', ownerId: 'sato' }),
            id: 'legacy-alias-approval-workflow',
            project_id: 'sample-project',
            implementation_key: 'manual-placeholder',
            owner_id: 'sato',
            default_approver_id: 'sato',
            context_sources: [{
                source_type: 'project',
                source_ref: 'sample-project',
                required: true
            }]
        });

        const runRes = await request(app)
            .post('/api/workflows/legacy-alias-approval-workflow/run')
            .send({ actor_id: 'sato' })
            .expect(201);
        const resolveRes = await request(app)
            .post(`/api/workflow-human-steps/${runRes.body.humanStep.id}/resolve`)
            .send({ resolution: 'approved' })
            .expect(200);

        expect(resolveRes.body.human_step.status).toBe('approved');
        expect(resolveRes.body.resumed_run).toMatchObject({
            workflow_id: 'legacy-alias-approval-workflow',
            parent_run_id: runRes.body.run.id,
            trigger_type: 'human_resume',
            status: 'success',
            closure_state: 'closed'
        });
    });

    it('documents workflow API auth mounting in register-api-routes', () => {
        const source = fs.readFileSync('server/bootstrap/register-api-routes.js', 'utf8');

        expect(source).toMatch(/workflowAuthGuard\s*=\s*requireAuth\(authService\)/);
        expect(source).toMatch(/app\.use\('\/api\/workflows',\s*workflowAuthGuard,/);
        expect(source).toMatch(/app\.use\('\/api\/workflow-runs',\s*workflowAuthGuard,/);
        expect(source).toMatch(/app\.use\('\/api\/workflow-human-steps',\s*workflowAuthGuard,/);
    });
});
