import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createExternalRunnerRouter } from '../../../server/routes/external-runner.js';
import { requireAuth } from '../../../server/middleware/auth.js';
import { csrfMiddleware } from '../../../server/middleware/csrf.js';
import { errorHandler } from '../../../server/middleware/error-handler.js';
import { ExternalRunnerIngestService } from '../../../server/services/external-runner/ingest-service.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';

function createApp() {
    const app = express();
    const repository = new InMemoryWorkflowRepository();
    const ingestService = new ExternalRunnerIngestService({ workflowRepository: repository });
    app.use(express.json());
    app.use((req, _res, next) => {
        req.access = { role: 'member', projectCodes: ['brainbase'] };
        req.authSource = 'internal';
        next();
    });
    app.use('/api/external-runner', createExternalRunnerRouter(ingestService));
    return { app, repository };
}

function createGuardedApp() {
    const app = express();
    const repository = new InMemoryWorkflowRepository();
    const ingestService = new ExternalRunnerIngestService({ workflowRepository: repository });
    const authService = {
        verifyToken(token) {
            if (token !== 'valid-token') throw new Error('invalid token');
            return { sub: 'keigo', role: 'member', projectCodes: ['brainbase'] };
        },
        verifyServiceToken(token) {
            if (token !== 'bbsvc_valid') throw new Error('invalid service token');
            return { sub: 'eve-runtime', role: 'member', projectCodes: ['brainbase'], employmentType: 'internal_service' };
        }
    };
    app.use(express.json());
    app.use('/api/external-runner', requireAuth(authService), createExternalRunnerRouter(ingestService));
    app.use(errorHandler);
    return { app, repository };
}

function makePayload() {
    return {
        contract_version: 'external_runner.v0',
        runner: {
            type: 'eve',
            external_run_id: 'eve-route-001',
            agent_id: 'marketing-agent',
            eve: { trace_ref: 'https://vercel.com/acme/eve/traces/eve-route-001' }
        },
        run: {
            org_id: 'brainbase',
            project_id: 'brainbase',
            role_agent_id: 'marketing',
            workflow_id: 'wf_marketing_post',
            status: 'completed'
        },
        loop_control: {
            owner_id: 'keigo',
            cost_owner_id: 'keigo',
            approval_owner_id: 'keigo',
            stop_conditions: ['public_post_requires_approval']
        },
        context_sources: [{
            source_type: 'graph_ssot',
            source_ref: 'project:brainbase',
            digest: 'sha256:route',
            redaction_status: 'not_required'
        }],
        rounds: [{
            round_id: 'round-1',
            status: 'completed',
            evidence_refs: ['eve://route/round-1']
        }],
        outputs: []
    };
}

function expectRunIdForExternalRun(runId, externalRunId) {
    const readable = String(externalRunId || 'unknown').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80);
    expect(runId).toMatch(new RegExp(`^run_brainbase_brainbase_eve_${readable}_[a-f0-9]{12}$`));
}

describe('external runner routes', () => {
    it('ingests Eve payloads through /api/external-runner/ingest', async () => {
        const { app, repository } = createApp();

        const response = await request(app)
            .post('/api/external-runner/ingest')
            .send(makePayload())
            .expect(201);

        expect(response.body.run).toMatchObject({ status: 'success' });
        expectRunIdForExternalRun(response.body.run.id, 'eve-route-001');
        expect(repository.getRun(response.body.run.id)).toMatchObject({
            workflow_id: 'wf_marketing_post'
        });
    });

    it('returns contract errors for invalid Eve trace_ref', async () => {
        const { app } = createApp();
        const payload = makePayload();
        payload.runner.eve = {};

        const response = await request(app)
            .post('/api/external-runner/ingest')
            .send(payload)
            .expect(400);

        expect(response.body).toMatchObject({
            code: 'missing_string'
        });
    });

    it('denies unauthenticated external runner ingest before persistence', async () => {
        const { app, repository } = createGuardedApp();

        const response = await request(app)
            .post('/api/external-runner/ingest')
            .send(makePayload())
            .expect(401);

        expect(response.body).toMatchObject({
            error: 'Authorization token required'
        });
        expect(repository.listRuns()).toHaveLength(0);
    });

    it('allows authenticated external runner ingest through workflowAuthGuard', async () => {
        const { app, repository } = createGuardedApp();

        const response = await request(app)
            .post('/api/external-runner/ingest')
            .set('Authorization', 'Bearer valid-token')
            .send(makePayload())
            .expect(201);

        expectRunIdForExternalRun(response.body.run.id, 'eve-route-001');
        expect(repository.getRun(response.body.run.id)).toMatchObject({
            workflow_id: 'wf_marketing_post'
        });
    });

    it('returns parse_failure for malformed JSON before persistence', async () => {
        const { app, repository } = createGuardedApp();

        const response = await request(app)
            .post('/api/external-runner/ingest')
            .set('Authorization', 'Bearer valid-token')
            .set('Content-Type', 'application/json')
            .send('{"contract_version":')
            .expect(400);

        expect(response.body).toMatchObject({
            error: 'parse_failure',
            code: 'parse_failure'
        });
        expect(repository.listRuns()).toHaveLength(0);
    });

    it('rejects bearer owner and approver spoofing before persistence', async () => {
        const { app, repository } = createGuardedApp();
        const payload = makePayload();
        payload.loop_control.owner_id = 'other-person';
        payload.loop_control.cost_owner_id = 'other-person';
        payload.loop_control.approval_owner_id = 'other-person';

        const response = await request(app)
            .post('/api/external-runner/ingest')
            .set('Authorization', 'Bearer valid-token')
            .send(payload)
            .expect(403);

        expect(response.body).toMatchObject({
            error: 'loop_control_delegation_not_allowed'
        });
        expect(repository.listRuns()).toHaveLength(0);
    });

    it('rejects bearer human step approver spoofing before persistence', async () => {
        const { app, repository } = createGuardedApp();
        const payload = makePayload();
        payload.run.status = 'approval_required';
        payload.human_steps = [{
            id: 'hs-spoofed-required-by',
            step_type: 'approval',
            prompt: 'Approve external send',
            required_by: 'other-person'
        }];

        const response = await request(app)
            .post('/api/external-runner/ingest')
            .set('Authorization', 'Bearer valid-token')
            .send(payload)
            .expect(403);

        expect(response.body).toMatchObject({
            error: 'loop_control_delegation_not_allowed'
        });
        expect(repository.listRuns()).toHaveLength(0);
    });

    it('rejects bearer learning candidate owner spoofing before persistence', async () => {
        const { app, repository } = createGuardedApp();
        const payload = makePayload();
        payload.learning_candidates = [{
            candidate_id: 'cand-spoofed-owner',
            cognitive_type: 'insight',
            body: 'External runner learned a sales follow-up heuristic.',
            owner_person_id: 'other-person',
            actor_person_id: 'other-person',
            recommended_owner_person_id: 'other-person'
        }];

        const response = await request(app)
            .post('/api/external-runner/ingest')
            .set('Authorization', 'Bearer valid-token')
            .send(payload)
            .expect(403);

        expect(response.body).toMatchObject({
            error: 'loop_control_delegation_not_allowed'
        });
        expect(repository.listRuns()).toHaveLength(0);
    });

    it('allows service-token Eve runtime ownership delegation before persistence', async () => {
        const { app, repository } = createGuardedApp();
        const payload = makePayload();
        payload.runner.external_run_id = 'eve-route-service-delegation-001';
        payload.run.status = 'approval_required';
        payload.loop_control.owner_id = 'sales-owner';
        payload.loop_control.cost_owner_id = 'finance-owner';
        payload.loop_control.approval_owner_id = 'approval-owner';
        payload.human_steps = [{
            id: 'hs-service-delegated-approver',
            step_type: 'approval',
            prompt: 'Approve external send',
            required_by: 'legal-owner'
        }];
        payload.learning_candidates = [{
            candidate_id: 'cand-service-delegated-owner',
            cognitive_type: 'insight',
            body: 'External runner learned a marketing review heuristic.',
            owner_person_id: 'knowledge-owner',
            actor_person_id: 'eve-runtime',
            recommended_owner_person_id: 'sales-owner'
        }];

        const response = await request(app)
            .post('/api/external-runner/ingest')
            .set('Authorization', 'Bearer bbsvc_valid')
            .send(payload)
            .expect(201);

        expect(response.body.run).toMatchObject({
            status: 'waiting_human',
            metadata: {
                loop_control: expect.objectContaining({
                    owner_id: 'sales-owner',
                    cost_owner_id: 'finance-owner',
                    approval_owner_id: 'approval-owner'
                })
            }
        });
        expect(response.body.workflow).toMatchObject({
            owner_id: 'sales-owner',
            default_assignee_id: 'sales-owner',
            default_approver_id: 'approval-owner'
        });
        expect(response.body.human_steps).toEqual([
            expect.objectContaining({
                id: 'hs-service-delegated-approver',
                required_by: 'legal-owner'
            })
        ]);
        expect(response.body.learning_candidates).toEqual([
            expect.objectContaining({
                candidate_id: 'cand-service-delegated-owner',
                owner_person_id: 'knowledge-owner',
                actor_person_id: 'eve-runtime'
            })
        ]);
        expect(repository.getWorkflow(response.body.workflow.id)).toMatchObject({
            owner_id: 'sales-owner',
            default_approver_id: 'approval-owner'
        });
        expect(repository.getRun(response.body.run.id).metadata.loop_control).toMatchObject({
            cost_owner_id: 'finance-owner'
        });
    });

    it('S-004e normalizes bearer learning candidate actor defaults to the authenticated person', async () => {
        const { app } = createGuardedApp();
        const payload = makePayload();
        payload.learning_candidates = [{
            candidate_id: 'cand-bearer-default-actor',
            cognitive_type: 'insight',
            body: 'External runner learned a marketing review heuristic.'
        }];

        const response = await request(app)
            .post('/api/external-runner/ingest')
            .set('Authorization', 'Bearer valid-token')
            .send(payload)
            .expect(201);

        expect(response.body.learning_candidates).toEqual([
            expect.objectContaining({
                candidate_id: 'cand-bearer-default-actor',
                owner_person_id: 'keigo',
                actor_person_id: 'keigo',
                persistence_status: 'deferred'
            })
        ]);
    });

    it('rejects cookie-authenticated external runner ingest on the CSRF-less server-to-server path', async () => {
        const { app, repository } = createGuardedApp();

        const response = await request(app)
            .post('/api/external-runner/ingest')
            .set('Cookie', 'brainbase_session=valid-token')
            .send(makePayload())
            .expect(403);

        expect(response.body).toMatchObject({
            error: 'server_to_server_auth_required'
        });
        expect(repository.listRuns()).toHaveLength(0);
    });

    it('allows bearer/service credentials without browser CSRF on the app-level external runner path', async () => {
        const previousNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const app = express();
            const repository = new InMemoryWorkflowRepository();
            const ingestService = new ExternalRunnerIngestService({ workflowRepository: repository });
            const authService = {
                verifyToken(token) {
                    if (token !== 'valid-token') throw new Error('invalid token');
                    return { sub: 'keigo', role: 'member', projectCodes: ['brainbase'] };
                },
                verifyServiceToken(token) {
                    if (token !== 'bbsvc_valid') throw new Error('invalid service token');
                    return { sub: 'eve-runtime', role: 'member', projectCodes: ['brainbase'], employmentType: 'internal_service' };
                }
            };
            app.use(express.json());
            app.use(csrfMiddleware());
            app.use('/api/external-runner', requireAuth(authService), createExternalRunnerRouter(ingestService));

            const bearerResponse = await request(app)
                .post('/api/external-runner/ingest')
                .set('Authorization', 'Bearer valid-token')
                .send(makePayload())
                .expect(201);

            const servicePayload = makePayload();
            servicePayload.runner.external_run_id = 'eve-route-service-001';
            const serviceResponse = await request(app)
                .post('/api/external-runner/ingest')
                .set('Authorization', 'Bearer bbsvc_valid')
                .send(servicePayload)
                .expect(201);

            expectRunIdForExternalRun(bearerResponse.body.run.id, 'eve-route-001');
            expectRunIdForExternalRun(serviceResponse.body.run.id, 'eve-route-service-001');
            expect(repository.getRun(bearerResponse.body.run.id)).toMatchObject({
                workflow_id: 'wf_marketing_post'
            });
            expect(repository.getRun(serviceResponse.body.run.id)).toMatchObject({
                workflow_id: 'wf_marketing_post'
            });
        } finally {
            process.env.NODE_ENV = previousNodeEnv;
        }
    });

    it('denies authenticated external runner ingest for inaccessible projects', async () => {
        const { app, repository } = createGuardedApp();
        const payload = makePayload();
        payload.run.org_id = 'salestailor';
        payload.run.project_id = 'salestailor';

        const response = await request(app)
            .post('/api/external-runner/ingest')
            .set('Authorization', 'Bearer valid-token')
            .send(payload)
            .expect(403);

        expect(response.body).toMatchObject({
            error: 'project_not_accessible'
        });
        expect(repository.listRuns()).toHaveLength(0);
    });

    it('rejects cross-project workflow_id collisions before persistence', async () => {
        const { app, repository } = createGuardedApp();
        repository.upsertWorkflow({
            id: 'wf_marketing_post',
            workspace_id: 'default',
            project_id: 'otherproject',
            name: 'Other project workflow',
            owner_id: 'owner-a',
            default_assignee_id: 'owner-a',
            default_approver_id: 'owner-a',
            execution_env: 'local',
            implementation_key: 'manual-placeholder',
            context_sources: []
        });

        const response = await request(app)
            .post('/api/external-runner/ingest')
            .set('Authorization', 'Bearer valid-token')
            .send(makePayload())
            .expect(400);

        expect(response.body).toMatchObject({
            code: 'workflow_project_mismatch',
            details: {
                workflow_id: 'wf_marketing_post',
                workflow_project_id: 'otherproject',
                run_project_id: 'brainbase'
            }
        });
        expect(repository.listRuns()).toHaveLength(0);
    });
});
