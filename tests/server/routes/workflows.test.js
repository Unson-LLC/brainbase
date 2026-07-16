import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import {
    createWorkflowHumanStepRouter,
    createWorkflowRouter,
    createWorkflowRunRouter
} from '../../../server/routes/workflows.js';
import { errorHandler } from '../../../server/middleware/error-handler.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';
import {
    WorkflowService,
    createBrainbaseAliveWorkflow,
    createDefaultWorkflowHandlers
} from '../../../server/services/workflow/workflow-service.js';
import { meetingPackIds } from '../../../server/services/workflow/meeting-workflow-pack.js';

function makeApp({
    handlers = createDefaultWorkflowHandlers(),
    accessProjectCodes = ['general', 'sample-project'],
    role = 'member',
    googleCalendarService = null,
    eveSessionClient = null
} = {}) {
    const repository = new InMemoryWorkflowRepository({
        seedWorkflows: [createBrainbaseAliveWorkflow()]
    });
    const runner = new WorkflowRunner({ repository, handlers });
    const configParser = {
        async getProjects() {
            return {
                root: '/workspace',
                projects: [
                    { id: 'sample-project', session_select: true, aliases: ['sample', 'salestailor'] },
                    { id: 'archived-project', archived: true }
                ]
            };
        }
    };
    const service = new WorkflowService({ repository, runner, configParser, googleCalendarService, eveSessionClient });
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
    app.use((err, req, res, next) => {
        if (err?.type === 'entity.parse.failed') {
            return errorHandler(err, req, res, next);
        }
        res.status(err.statusCode || 500).json({ error: err.message });
    });
    return { app, repository, service };
}

function makeEveSessionClient({
    sessionId = 'eve-session-route-001',
    continuationToken = 'cont-route-001',
    sessions = null,
    reject = null
} = {}) {
    const calls = [];
    return {
        calls,
        isConfigured() {
            return true;
        },
        async createSession(input) {
            calls.push(input);
            if (reject) throw reject;
            const next = Array.isArray(sessions) && sessions.length
                ? sessions[Math.min(calls.length - 1, sessions.length - 1)]
                : { session_id: sessionId, continuation_token: continuationToken };
            return {
                session_id: next.session_id ?? next.sessionId ?? null,
                continuation_token: next.continuation_token ?? next.continuationToken ?? null,
                response: { ok: true }
            };
        }
    };
}

function sampleMeetingReviewPackage({
    orgId = 'sample-project',
    projectId = 'sample-project',
    packageId = 'meeting-review-package-test'
} = {}) {
    return {
        schema_version: '0.1.0',
        package_id: packageId,
        seed_id: 'meeting-loop-seed-test',
        status: 'review_required',
        meeting_identity: {
            source: 'google_calendar',
            account: 'info@example.com',
            calendar_id: 'primary',
            event_id: 'evt-1',
            title: 'Mana定例',
            start: '2026-06-25T13:00:00+09:00',
            end: '2026-06-25T14:00:00+09:00',
            candidate_org_id: orgId,
            candidate_project_id: projectId,
            case_scope: 'meeting-loop-test',
            graph_context: {
                org_entity_ids: ['org-sample'],
                person_entity_ids: ['person-sato']
            }
        },
        source_event: {
            source_system: 'slack',
            workspace: 'unson',
            channel_id: 'C08SYTDR7R8',
            channel_name: '9940-meeting-router',
            message_ts: '1782367965.844209',
            file_id: 'F0BCYNXMP6H',
            local_artifact_sha256: 'abc123'
        },
        loop_intent_ids: {
            pre_meeting_briefing: meetingPackIds({ orgId, projectId, definitionId: 'pre-meeting-briefing' }).loopIntentId,
            transcript_to_meeting_note: meetingPackIds({ orgId, projectId, definitionId: 'transcript-to-meeting-note' }).loopIntentId,
            meeting_note_to_tasks: meetingPackIds({ orgId, projectId, definitionId: 'meeting-note-to-tasks' }).loopIntentId,
            meeting_note_to_decisions: meetingPackIds({ orgId, projectId, definitionId: 'meeting-note-to-decisions' }).loopIntentId,
            post_meeting_follow_up_message: meetingPackIds({ orgId, projectId, definitionId: 'post-meeting-follow-up-message' }).loopIntentId
        },
        meeting_note_summary: {
            title: 'Mana定例',
            body: '# Mana定例\n\n## Brainbase Meeting Pack Source\n\n## Primary Transcript Excerpt\n\nSpeaker 1: 会議背景を確認します。',
            generator: 'brainbase_meeting_pack',
            generation_source: 'transcript_to_meeting_note',
            generation_status: 'brainbase_source_ready',
            provider_note_authoritative: false,
            source_text_hash: 'hash-route-note-001',
            source_text_length: 34,
            source_transcripts: [{
                role: 'primary',
                provider: 'plaud',
                source_text_kind: 'transcript',
                transcript_hash: 'hash-route-note-001',
                text: 'Speaker 1: 会議背景を確認します。\nSpeaker 2: 合意事項を記録します。',
                text_length: 34
            }]
        },
        task_candidates: ['Google Business Profileの権限申請を行う'],
        decision_candidates: ['施策軸はGoogle最適化と口コミ導線に置く'],
        follow_up_draft: {
            status: 'draft_only',
            external_send_required_approval: true,
            body: '本日はありがとうございました。'
        },
        promotion_candidates: {
            graph: ['org:sample'],
            learning: ['meeting-router channelはsource channelである']
        },
        evidence_refs: ['transcript:00:01:00-00:02:00'],
        stop_conditions: [
            'task_create_requires_human_approval',
            'decision_promotion_requires_human_approval',
            'external_send_requires_human_approval'
        ]
    };
}

describe('workflow routes', () => {
    it('story-mana-meeting-workflow-pack-data-v1 S-001 exposes meeting pack bootstrap under Workflow Control namespace', async () => {
        const { app, repository } = makeApp();

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(201);

        expect(res.body.meeting_workflow_pack).toMatchObject({
            pack_id: 'mana-meeting-workflow-pack-v1',
            org_id: 'sample-project',
            project_id: 'sample-project',
            role_agent_instance: expect.objectContaining({
                name: 'Meeting Ops Agent',
                role_archetype_id: 'meeting-ops'
            })
        });
        expect(res.body.loop_pack_design_review).toMatchObject({
            gate_id: 'loop_pack_design_gate.v0',
            status: 'pass',
            pack_id: 'mana-meeting-workflow-pack-v1'
        });
        expect(res.body.loop_pack_design_review.manifest_digest).toMatch(/^[a-f0-9]{64}$/);
        expect(res.body.meeting_workflow_pack.workflow_templates).toHaveLength(5);
        expect(res.body.meeting_workflow_pack.workflow_triggers).toHaveLength(10);
        expect(res.body.meeting_workflow_pack.loop_intents).toHaveLength(5);

        const templatesRes = await request(app)
            .get('/api/workflows/control/templates?project_id=sample-project&workflow_kind=meeting')
            .expect(200);
        expect(templatesRes.body.workflow_templates.map((template) => template.id)).toEqual(expect.arrayContaining([
            'wft_sample_project_sample_project_pre_meeting_briefing',
            'wft_sample_project_sample_project_meeting_note_to_decisions'
        ]));
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
        expect(repository.listAuditLogs({ targetId: 'mana-meeting-workflow-pack-v1' })[0].after.loop_pack_design_review).toMatchObject({
            status: 'pass',
            manifest_digest: res.body.loop_pack_design_review.manifest_digest
        });
    });

    it('story-loop-pack-design-gate-v0 exposes meeting pack design review without persisting control records', async () => {
        const { app, repository } = makeApp();

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/design-review')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(200);

        expect(res.body.meeting_workflow_pack_design).toMatchObject({
            pack_id: 'mana-meeting-workflow-pack-v1',
            org_id: 'sample-project',
            project_id: 'sample-project',
            loop_pack_design_review: expect.objectContaining({
                gate_id: 'loop_pack_design_gate.v0',
                status: 'pass'
            })
        });
        expect(res.body.meeting_workflow_pack_design.loop_pack_manifest).toMatchObject({
            target_business_process: '会議前後業務',
            required_trigger_classes: ['schedule', 'event', 'human']
        });
        expect(repository.listRoleAgentInstances({ orgId: 'sample-project', projectId: 'sample-project' })).toHaveLength(0);
        expect(repository.listWorkflowTemplates({ orgId: 'sample-project', projectId: 'sample-project', workflowKind: 'meeting' })).toHaveLength(0);
        expect(repository.listAuditLogs({ targetId: 'mana-meeting-workflow-pack-v1' })).toHaveLength(0);
    });

    it('story-eve-runtime-session-connection-v0 exposes Eve session dispatch under Workflow Control namespace', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { app, repository } = makeApp({ eveSessionClient });
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(201);
        const loopIntentId = meetingPackIds({
            orgId: 'sample-project',
            projectId: 'sample-project',
            definitionId: 'pre-meeting-briefing'
        }).loopIntentId;

        const res = await request(app)
            .post(`/api/workflows/control/loop-intents/${loopIntentId}/eve-session`)
            .send({})
            .expect(201);

        expect(eveSessionClient.calls).toHaveLength(1);
        expect(eveSessionClient.calls[0].context).toMatchObject({
            brainbase_handoff_version: 'eve_session_handoff.v0',
            expected_result_contract: 'external_runner.v0',
            loop_intent: expect.objectContaining({ id: loopIntentId })
        });
        expect(res.body.eve_session_dispatch).toMatchObject({
            org_id: 'sample-project',
            project_id: 'sample-project',
            loop_intent_id: loopIntentId,
            idempotent: false,
            run: expect.objectContaining({
                status: 'running',
                action_required: 'await_eve_result',
                metadata: expect.objectContaining({
                    expected_result_contract: 'external_runner.v0'
                })
            }),
            eve_session: {
                session_id: 'eve-session-route-001',
                continuation_token_present: true
            }
        });
        expect(res.body.eve_session_dispatch.run.metadata.runner.continuation_token).toBeUndefined();
        expect(JSON.stringify(res.body.eve_session_dispatch)).not.toContain('cont-route-001');
        expect(repository.getLoopIntent(loopIntentId)).toMatchObject({
            status: 'dispatched',
            metadata: {
                eve_session_ref: {
                    session_id: 'eve-session-route-001',
                    continuation_token: 'cont-route-001',
                    workflow_run_id: res.body.eve_session_dispatch.run.id
                }
            }
        });
        const loopIntentList = await request(app)
            .get('/api/workflows/control/loop-intents?org_id=sample-project&project_id=sample-project')
            .expect(200);
        const listedLoopIntent = loopIntentList.body.loop_intents.find((item) => item.id === loopIntentId);
        expect(listedLoopIntent.metadata.eve_session_ref).toMatchObject({
            session_id: 'eve-session-route-001',
            continuation_token_present: true
        });
        expect(listedLoopIntent.metadata.eve_session_ref.continuation_token).toBeUndefined();
        expect(JSON.stringify(loopIntentList.body)).not.toContain('cont-route-001');

        const runDetail = await request(app)
            .get(`/api/workflow-runs/${res.body.eve_session_dispatch.run.id}`)
            .expect(200);
        expect(runDetail.body.run.metadata.runner).toMatchObject({
            type: 'eve',
            session_id: 'eve-session-route-001',
            continuation_token_present: true
        });
        expect(runDetail.body.run.metadata.runner.continuation_token).toBeUndefined();
        expect(JSON.stringify(runDetail.body.run)).not.toContain('cont-route-001');

        const replay = await request(app)
            .post(`/api/workflows/control/loop-intents/${loopIntentId}/eve-session`)
            .send({})
            .expect(200);
        expect(replay.body.eve_session_dispatch).toMatchObject({
            idempotent: true,
            eve_session: {
                session_id: 'eve-session-route-001',
                continuation_token_present: true
            }
        });
        expect(eveSessionClient.calls).toHaveLength(1);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
    });

    it('story-eve-runtime-session-connection-v0 S-003 exposes forceNewSession without idempotent replay', async () => {
        const eveSessionClient = makeEveSessionClient({
            sessions: [
                { session_id: 'eve-session-route-001', continuation_token: 'cont-route-001' },
                { session_id: 'eve-session-route-002', continuation_token: 'cont-route-002' }
            ]
        });
        const { app, repository } = makeApp({ eveSessionClient });
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(201);
        const loopIntentId = meetingPackIds({
            orgId: 'sample-project',
            projectId: 'sample-project',
            definitionId: 'pre-meeting-briefing'
        }).loopIntentId;

        await request(app)
            .post(`/api/workflows/control/loop-intents/${loopIntentId}/eve-session`)
            .send({})
            .expect(201);
        const forced = await request(app)
            .post(`/api/workflows/control/loop-intents/${loopIntentId}/eve-session`)
            .send({ forceNewSession: true })
            .expect(201);

        expect(forced.body.eve_session_dispatch).toMatchObject({
            idempotent: false,
            eve_session: {
                session_id: 'eve-session-route-002',
                continuation_token_present: true
            }
        });
        expect(eveSessionClient.calls).toHaveLength(2);
        expect(eveSessionClient.calls[1]).toEqual(expect.objectContaining({
            message: expect.any(String),
            context: expect.objectContaining({
                expected_result_contract: 'external_runner.v0'
            })
        }));
        expect(eveSessionClient.calls[1].context.loop_intent.metadata.eve_session_ref).toMatchObject({
            session_id: 'eve-session-route-001',
            continuation_token_present: true
        });
        expect(eveSessionClient.calls[1].context.loop_intent.metadata.eve_session_ref.continuation_token).toBeUndefined();
        expect(forced.body.eve_session_dispatch.handoff.context.loop_intent.metadata.eve_session_ref.continuation_token).toBeUndefined();
        expect(forced.body.eve_session_dispatch.run.id).toContain('eve_session_route_002');
        const runDetail = await request(app)
            .get(`/api/workflow-runs/${forced.body.eve_session_dispatch.run.id}`)
            .expect(200);
        const loopIntentSnapshot = runDetail.body.context_snapshots.find((snapshot) => snapshot.source_type === 'loop_intent');
        expect(loopIntentSnapshot).toMatchObject({
            redaction_status: 'redacted',
            data: {
                metadata: {
                    eve_session_ref: {
                        session_id: 'eve-session-route-001',
                        continuation_token_present: true
                    }
                }
            }
        });
        expect(loopIntentSnapshot.data.metadata.eve_session_ref.continuation_token).toBeUndefined();
        expect(repository.getLoopIntent(loopIntentId).metadata.eve_session_ref).toMatchObject({
            session_id: 'eve-session-route-002',
            continuation_token: 'cont-route-002',
            workflow_run_id: forced.body.eve_session_dispatch.run.id
        });
    });

    it('story-eve-runtime-session-connection-v0 gate returns 400 for caller-supplied Eve continuation tokens', async () => {
        for (const body of [
            { continuation_token: 'caller-continuation-token' },
            { continuationToken: 'caller-continuation-token' }
        ]) {
            const eveSessionClient = makeEveSessionClient();
            const { app, repository } = makeApp({ eveSessionClient });
            await request(app)
                .post('/api/workflows/control/meeting-pack/bootstrap')
                .send({
                    org_id: 'sample-project',
                    project_id: 'sample-project'
                })
                .expect(201);
            const loopIntentId = meetingPackIds({
                orgId: 'sample-project',
                projectId: 'sample-project',
                definitionId: 'pre-meeting-briefing'
            }).loopIntentId;

            const res = await request(app)
                .post(`/api/workflows/control/loop-intents/${loopIntentId}/eve-session`)
                .send(body)
                .expect(400);

            expect(res.body.error).toBe('continuation_token is server-owned and cannot be supplied by clients');
            expect(eveSessionClient.calls).toHaveLength(0);
            expect(repository.listRuns()).toHaveLength(0);
            expect(repository.getLoopIntent(loopIntentId)).toMatchObject({ status: 'ready' });
            expect(repository.getLoopIntent(loopIntentId).metadata).toBeUndefined();
        }
    });

    it('story-eve-runtime-session-connection-v0 gate returns 400 for empty Eve dispatch messages', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { app, repository } = makeApp({ eveSessionClient });
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(201);
        const loopIntentId = meetingPackIds({
            orgId: 'sample-project',
            projectId: 'sample-project',
            definitionId: 'pre-meeting-briefing'
        }).loopIntentId;

        const res = await request(app)
            .post(`/api/workflows/control/loop-intents/${loopIntentId}/eve-session`)
            .send({ message: '' })
            .expect(400);

        expect(res.body).toMatchObject({
            error: 'message is required',
            state_transition: 'blocked_eve_message_required',
            details: {
                state_transition: 'blocked_eve_message_required'
            }
        });
        expect(eveSessionClient.calls).toHaveLength(0);
        expect(repository.getLoopIntent(loopIntentId)).toMatchObject({ status: 'ready' });
        expect(repository.getLoopIntent(loopIntentId).metadata).toBeUndefined();
    });

    it('story-eve-runtime-session-connection-v0 S-001 rejects invalid public Workflow Binding stop conditions', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { app, repository } = makeApp({ eveSessionClient });
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(201);
        const roleAgent = repository.listRoleAgentInstances({ orgId: 'sample-project', projectId: 'sample-project' })[0];
        const template = repository.listWorkflowTemplates({ orgId: 'sample-project', projectId: 'sample-project' })[0];

        const res = await request(app)
            .post('/api/workflows/control/bindings')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project',
                role_agent_instance_id: roleAgent.id,
                workflow_template_id: template.id,
                stop_conditions: [{}]
            })
            .expect(400);

        expect(res.body).toMatchObject({
            error: 'stop_conditions[0] must be a non-empty string'
        });
        expect(eveSessionClient.calls).toHaveLength(0);
    });

    it('story-eve-runtime-session-connection-v0 S-012 rejects generic run API for Eve dispatch workflows', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { app } = makeApp({ eveSessionClient });
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(201);
        const loopIntentId = meetingPackIds({
            orgId: 'sample-project',
            projectId: 'sample-project',
            definitionId: 'pre-meeting-briefing'
        }).loopIntentId;

        const dispatch = await request(app)
            .post(`/api/workflows/control/loop-intents/${loopIntentId}/eve-session`)
            .send({})
            .expect(201);

        await request(app)
            .post(`/api/workflows/${dispatch.body.eve_session_dispatch.workflow.id}/run`)
            .send({})
            .expect(400)
            .expect((res) => {
                expect(res.body).toEqual({
                    error: 'eve-session-dispatch workflows cannot be manually run; use /api/workflows/control/loop-intents/:loopIntentId/eve-session'
                });
            });
        await request(app)
            .post(`/api/workflow-runs/${dispatch.body.eve_session_dispatch.run.id}/rerun`)
            .send({})
            .expect(400)
            .expect((res) => {
                expect(res.body).toEqual({
                    error: 'eve-session-dispatch workflows cannot be manually run; use /api/workflows/control/loop-intents/:loopIntentId/eve-session'
                });
            });
    });

    it('story-eve-runtime-session-connection-v0 FM-002 negative_path rejects Eve create failures before route writes', async () => {
        const eveError = new Error('Eve HTTP 502');
        eveError.code = 'eve_session_create_failed';
        eveError.status = 502;
        const eveSessionClient = makeEveSessionClient({ reject: eveError });
        const { app, repository } = makeApp({ eveSessionClient });
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(201);
        const loopIntentId = meetingPackIds({
            orgId: 'sample-project',
            projectId: 'sample-project',
            definitionId: 'pre-meeting-briefing'
        }).loopIntentId;

        const res = await request(app)
            .post(`/api/workflows/control/loop-intents/${loopIntentId}/eve-session`)
            .send({})
            .expect(400);

        expect(res.body).toMatchObject({
            error: 'Eve session create failed',
            state_transition: 'blocked_eve_session_create_failed',
            details: {
                state_transition: 'blocked_eve_session_create_failed',
                loop_intent_id: loopIntentId,
                eve_error_code: 'eve_session_create_failed',
                eve_status: 502
            }
        });
        expect(eveSessionClient.calls).toHaveLength(1);
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.run_steps).toHaveLength(0);
        expect(repository.ledger.context_snapshots).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
        expect(repository.getLoopIntent(loopIntentId)).toMatchObject({ status: 'ready' });
        expect(repository.getLoopIntent(loopIntentId).metadata).toBeUndefined();
    });

    it('story-eve-runtime-session-connection-v0 S-013 returns route error shape and recovery evidence when Brainbase persistence fails', async () => {
        const eveSessionClient = makeEveSessionClient({
            sessionId: 'eve-session-route-recovery',
            continuationToken: 'cont-route-recovery'
        });
        const { app, repository } = makeApp({ eveSessionClient });
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(201);
        const loopIntentId = meetingPackIds({
            orgId: 'sample-project',
            projectId: 'sample-project',
            definitionId: 'pre-meeting-briefing'
        }).loopIntentId;
        const originalCreateContextSnapshot = repository.createContextSnapshot.bind(repository);
        let failedOnce = false;
        repository.createContextSnapshot = (snapshot) => {
            if (!failedOnce && snapshot.source_type === 'loop_intent') {
                failedOnce = true;
                throw new Error('context snapshot write failed');
            }
            return originalCreateContextSnapshot(snapshot);
        };

        const res = await request(app)
            .post(`/api/workflows/control/loop-intents/${loopIntentId}/eve-session`)
            .send({})
            .expect(400);

        expect(res.body).toMatchObject({
            error: 'Eve session dispatched but Brainbase persistence failed',
            state_transition: 'blocked_eve_dispatch_persistence_failed',
            details: {
                state_transition: 'blocked_eve_dispatch_persistence_failed',
                loop_intent_id: loopIntentId,
                eve_session_id: 'eve-session-route-recovery',
                continuation_token_present: true,
                recovery_recorded: true,
                persistence_error: 'context snapshot write failed'
            }
        });
        expect(eveSessionClient.calls).toHaveLength(1);
        const recoveryRun = repository.ledger.runs[0];
        expect(recoveryRun).toMatchObject({
            status: 'blocked',
            action_required: 'operator_reconcile_eve_session',
            metadata: {
                dispatch_persistence_failed: true,
                runner: {
                    type: 'eve',
                    session_id: 'eve-session-route-recovery',
                    continuation_token_present: true
                }
            }
        });
        expect(recoveryRun.metadata.runner.continuation_token).toBeUndefined();
        expect(repository.getLoopIntent(loopIntentId).metadata.eve_session_ref).toMatchObject({
            session_id: 'eve-session-route-recovery',
            continuation_token: 'cont-route-recovery',
            workflow_run_id: recoveryRun.id,
            persistence_recovery_required: true
        });
        expect(repository.listAuditLogs({ targetId: recoveryRun.id })[0]).toMatchObject({
            action: 'workflow.eve_session.dispatch_persistence_failed',
            after: {
                eve_session_id: 'eve-session-route-recovery',
                continuation_token_present: true,
                state_transition: 'blocked_eve_dispatch_persistence_failed'
            }
        });
        expect(JSON.stringify(res.body)).not.toContain('cont-route-recovery');
    });

    it('story-eve-runtime-session-connection-v0 FM-003 boundary_condition rejects missing Eve session id before route writes', async () => {
        const eveSessionClient = makeEveSessionClient({ sessionId: null, continuationToken: 'cont-without-session' });
        const { app, repository } = makeApp({ eveSessionClient });
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(201);
        const loopIntentId = meetingPackIds({
            orgId: 'sample-project',
            projectId: 'sample-project',
            definitionId: 'pre-meeting-briefing'
        }).loopIntentId;

        const res = await request(app)
            .post(`/api/workflows/control/loop-intents/${loopIntentId}/eve-session`)
            .send({})
            .expect(400);

        expect(res.body).toMatchObject({
            error: 'Eve session response did not include a session id',
            state_transition: 'blocked_eve_session_id_missing',
            details: {
                state_transition: 'blocked_eve_session_id_missing',
                loop_intent_id: loopIntentId
            }
        });
        expect(eveSessionClient.calls).toHaveLength(1);
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.run_steps).toHaveLength(0);
        expect(repository.ledger.context_snapshots).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
        expect(repository.getLoopIntent(loopIntentId)).toMatchObject({ status: 'ready' });
        expect(repository.getLoopIntent(loopIntentId).metadata).toBeUndefined();
    });

    it('story-mana-meeting-workflow-pack-data-v1 FM-001 auth_denied rejects meeting pack bootstrap before writes', async () => {
        const { app, repository } = makeApp({ accessProjectCodes: ['general'] });

        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(403);

        expect(repository.listRoleAgentInstances({ orgId: 'sample-project', projectId: 'sample-project' })).toHaveLength(0);
        expect(repository.listWorkflowTemplates({ orgId: 'sample-project', projectId: 'sample-project', workflowKind: 'meeting' })).toHaveLength(0);
        expect(repository.listAuditLogs({ targetId: 'mana-meeting-workflow-pack-v1' })).toHaveLength(0);
    });

    it('story-meeting-workflow-calendar-input-v1 exposes calendar input ingestion under Workflow Control namespace', async () => {
        const googleCalendarService = {
            async getAuthStatus() {
                return {
                    connected: true,
                    defaultAccount: 'k.sato@sales-tailor.jp'
                };
            },
            async listEvents() {
                return [
                    {
                        id: 'gcal:primary:evt-1',
                        calendarEventId: 'evt-1',
                        calendarId: 'primary',
                        title: 'Mana定例',
                        startDateTime: '2026-06-22T10:00:00+09:00',
                        endDateTime: '2026-06-22T11:00:00+09:00',
                        allDay: false
                    }
                ];
            }
        };
        const { app, repository } = makeApp({ googleCalendarService });

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/calendar-inputs')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project',
                from: '2026-06-22T00:00:00+09:00',
                to: '2026-06-23T00:00:00+09:00'
            })
            .expect(201);

        expect(res.body.meeting_calendar_inputs).toMatchObject({
            org_id: 'sample-project',
            project_id: 'sample-project',
            workflow_definition_id: 'pre-meeting-briefing',
            events_considered: 1
        });
        expect(res.body.meeting_calendar_inputs.loop_intents).toHaveLength(1);
        expect(res.body.meeting_calendar_inputs.loop_intents[0].input_payload.meeting_identity).toMatchObject({
            source: 'google_calendar',
            calendar_id: 'primary',
            event_id: 'evt-1',
            title: 'Mana定例'
        });
        expect(repository.listLoopIntents({ orgId: 'sample-project', projectId: 'sample-project' })).toHaveLength(1);
    });

    it('story-meeting-workflow-calendar-input-v1 FM-001 returns 400 when calendar service is not configured', async () => {
        const { app, repository } = makeApp();

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/calendar-inputs')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project',
                from: '2026-06-22T00:00:00+09:00',
                to: '2026-06-23T00:00:00+09:00'
            })
            .expect(400);

        expect(res.body).toEqual({
            error: 'google_calendar_service is not configured'
        });
        expect(repository.listRoleAgentInstances({ orgId: 'sample-project', projectId: 'sample-project' })).toHaveLength(0);
        expect(repository.listWorkflowTemplates({ orgId: 'sample-project', projectId: 'sample-project', workflowKind: 'meeting' })).toHaveLength(0);
        expect(repository.listLoopIntents({ orgId: 'sample-project', projectId: 'sample-project' })).toHaveLength(0);
    });

    it('story-meeting-review-package-ingest-v1 S-001 creates a waiting-human review run from a Codex package', async () => {
        const { app, repository } = makeApp();
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(201);

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({
                review_package: sampleMeetingReviewPackage()
            })
            .expect(201);

        expect(res.body.meeting_review_ingest).toMatchObject({
            org_id: 'sample-project',
            project_id: 'sample-project',
            case_scope: 'meeting-loop-test',
            package_id: 'meeting-review-package-test',
            idempotent: false,
            state_transitions: [
                'package_received',
                'scope_resolved',
                'loop_intents_verified',
                'run_recorded',
                'outputs_recorded',
                'human_steps_recorded',
                'waiting_human'
            ],
            run: expect.objectContaining({
                status: 'waiting_human',
                closure_state: 'open',
                action_required: 'approve',
                human_waiting: true,
                output_count: 5
            })
        });
        expect(res.body.meeting_review_ingest.outputs.map((output) => output.type)).toEqual([
            'meeting_note_draft',
            'task_candidates',
            'decision_candidates',
            'message_draft',
            'promotion_candidates'
        ]);
        expect(res.body.meeting_review_ingest.outputs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                metadata: expect.objectContaining({
                    package_id: 'meeting-review-package-test',
                    requires_human_approval: true,
                    runner_type: 'codex_generated_package',
                    evidence_refs: ['transcript:00:01:00-00:02:00']
                })
            })
        ]));
        expect(res.body.meeting_review_ingest.human_steps).toHaveLength(5);
        expect(res.body.meeting_review_ingest.human_steps.every((step) => step.status === 'pending')).toBe(true);
        expect(res.body.meeting_review_ingest.context_snapshots.map((snapshot) => snapshot.source_type)).toEqual([
            'meeting_identity',
            'meeting_source',
            'graph_ssot',
            'review_package'
        ]);
        expect(res.body.meeting_review_ingest.context_snapshots).toEqual(expect.arrayContaining([
            expect.objectContaining({
                source_type: 'meeting_source',
                content_hash: 'abc123'
            }),
            expect.objectContaining({
                source_type: 'graph_ssot',
                data: expect.objectContaining({
                    verification_status: 'candidate_from_review_package',
                    promoted_to_graph_ssot: false
                })
            })
        ]));
        expect(repository.ledger.runs).toHaveLength(1);
        expect(repository.ledger.outputs).toHaveLength(5);
        expect(repository.ledger.human_steps).toHaveLength(5);
        const decisionOutput = res.body.meeting_review_ingest.outputs.find((output) => output.type === 'decision_candidates');
        const decisionHumanStep = res.body.meeting_review_ingest.human_steps.find((step) => step.metadata?.write_back_target === 'graph_ssot_decision');
        expect(decisionOutput).toBeTruthy();
        expect(decisionHumanStep).toMatchObject({
            status: 'pending',
            metadata: expect.objectContaining({
                output_id: decisionOutput.id,
                output_key: 'decision_candidates',
                output_type: 'decision_candidates',
                approval_kind: 'decision_candidates',
                write_back_target: 'graph_ssot_decision',
                requires_human_approval: true
            })
        });
        expect(res.body.meeting_review_ingest.note_generation_dispatch).toEqual({
            status: 'skipped',
            reason: 'eve_not_configured',
            loop_intent_id: expect.any(String)
        });
        const runAuditLogs = repository.listAuditLogs({ targetId: res.body.meeting_review_ingest.run.id });
        expect(runAuditLogs).toHaveLength(2);
        expect(runAuditLogs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'workflow.meeting_review_package.ingested',
                after: expect.objectContaining({
                    runner: { type: 'codex_generated_package', eve_connected: false }
                })
            }),
            expect.objectContaining({
                action: 'workflow.meeting_pack.note_generation.dispatch_skipped',
                after: expect.objectContaining({
                    status: 'skipped',
                    reason: 'eve_not_configured'
                })
            })
        ]));

        const runRes = await request(app)
            .get(`/api/workflow-runs/${res.body.meeting_review_ingest.run.id}`)
            .expect(200);
        expect(runRes.body).toMatchObject({
            run: expect.objectContaining({
                status: 'waiting_human',
                action_required: 'approve',
                human_waiting: true
            })
        });
        expect(runRes.body.outputs).toHaveLength(5);
        expect(runRes.body.outputs.every((output) => output.metadata.loop_intent_id)).toBe(true);
        expect(runRes.body.human_steps).toHaveLength(5);
        expect(runRes.body.human_steps.every((step) => step.metadata.loop_intent_id)).toBe(true);
        expect(runRes.body.human_steps).toEqual(expect.arrayContaining([
            expect.objectContaining({
                metadata: expect.objectContaining({
                    output_id: decisionOutput.id,
                    output_type: 'decision_candidates',
                    approval_kind: 'decision_candidates'
                })
            })
        ]));
    });

    it('story-meeting-note-generation-dag-wiring AC-005 S-002 auto-dispatches transcript_to_meeting_note to Eve after review ingest', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { app, repository } = makeApp({ eveSessionClient });
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({ org_id: 'sample-project', project_id: 'sample-project' })
            .expect(201);

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: sampleMeetingReviewPackage() })
            .expect(201);

        const noteLoopIntentId = meetingPackIds({
            orgId: 'sample-project',
            projectId: 'sample-project',
            definitionId: 'transcript-to-meeting-note'
        }).loopIntentId;
        expect(res.body.meeting_review_ingest.note_generation_dispatch).toEqual({
            status: 'requested',
            loop_intent_id: noteLoopIntentId,
            eve_session_run_id: expect.any(String)
        });
        expect(eveSessionClient.calls).toHaveLength(1);
        expect(eveSessionClient.calls[0].context).toMatchObject({
            loop_intent: expect.objectContaining({ id: noteLoopIntentId })
        });
        expect(repository.getLoopIntent(noteLoopIntentId)).toMatchObject({ status: 'dispatched' });
        expect(repository.listAuditLogs({ targetId: res.body.meeting_review_ingest.run.id })).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'workflow.meeting_pack.note_generation.dispatch_requested',
                after: expect.objectContaining({
                    status: 'requested',
                    loop_intent_id: noteLoopIntentId
                })
            })
        ]));

        const replay = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: sampleMeetingReviewPackage() })
            .expect(201);
        expect(replay.body.meeting_review_ingest.idempotent).toBe(true);
        expect(replay.body.meeting_review_ingest.note_generation_dispatch).toEqual({
            status: 'skipped',
            reason: 'idempotent_replay',
            loop_intent_id: noteLoopIntentId
        });
        expect(eveSessionClient.calls).toHaveLength(1);
    });

    it('story-eve-dispatch-handoff-transcript-context AC-001 AC-002 AC-003 S-001 hands off transcript body, run refs and write-back contract to Eve', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { app, repository } = makeApp({ eveSessionClient });
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({ org_id: 'sample-project', project_id: 'sample-project' })
            .expect(201);

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: sampleMeetingReviewPackage() })
            .expect(201);

        const ingestRunId = res.body.meeting_review_ingest.run.id;
        expect(res.body.meeting_review_ingest.note_generation_dispatch.status).toBe('requested');
        expect(eveSessionClient.calls).toHaveLength(1);
        const handoffContext = eveSessionClient.calls[0].context;
        expect(handoffContext.meeting_note_generation).toMatchObject({
            task: 'transcript_to_meeting_note',
            run_id: ingestRunId,
            package_id: 'meeting-review-package-test',
            source_text_hash: 'hash-route-note-001',
            generation_status: 'brainbase_source_ready',
            note_source: expect.objectContaining({
                title: 'Mana定例',
                body: expect.stringContaining('Primary Transcript Excerpt'),
                source_transcripts: [
                    expect.objectContaining({
                        role: 'primary',
                        transcript_hash: 'hash-route-note-001',
                        text: expect.stringContaining('Speaker 2: 合意事項を記録します。')
                    })
                ]
            }),
            write_back: expect.objectContaining({
                method: 'POST',
                path: '/api/workflows/control/meeting-pack/note-generation',
                payload_template: expect.objectContaining({
                    org_id: 'sample-project',
                    project_id: 'sample-project',
                    run_id: ingestRunId,
                    source_text_hash: 'hash-route-note-001'
                })
            })
        });
        expect(eveSessionClient.calls[0].message).toContain('context.meeting_note_generation');

        const eveRunId = res.body.meeting_review_ingest.note_generation_dispatch.eve_session_run_id;
        expect(repository.getRun(eveRunId).metadata.meeting_note_generation).toEqual({
            run_id: ingestRunId,
            package_id: 'meeting-review-package-test',
            source_text_hash: 'hash-route-note-001'
        });
    });

    it('story-eve-dispatch-handoff-transcript-context AC-001 S-004 resolves the ingest run from package_id on manual backfill dispatch', async () => {
        const eveSessionClient = makeEveSessionClient({
            sessions: [
                { session_id: 'eve-session-route-001', continuation_token: 'cont-route-001' },
                { session_id: 'eve-session-route-002', continuation_token: 'cont-route-002' },
                { session_id: 'eve-session-route-003', continuation_token: 'cont-route-003' }
            ]
        });
        const { app } = makeApp({ eveSessionClient });
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({ org_id: 'sample-project', project_id: 'sample-project' })
            .expect(201);
        const ingest = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: sampleMeetingReviewPackage() })
            .expect(201);
        const noteLoopIntentId = meetingPackIds({
            orgId: 'sample-project',
            projectId: 'sample-project',
            definitionId: 'transcript-to-meeting-note'
        }).loopIntentId;

        const redispatch = await request(app)
            .post(`/api/workflows/control/loop-intents/${noteLoopIntentId}/eve-session`)
            .send({
                force_new_session: true,
                meeting_note_generation: { package_id: 'meeting-review-package-test' }
            })
            .expect(201);

        expect(redispatch.body.eve_session_dispatch.idempotent).toBe(false);
        expect(eveSessionClient.calls).toHaveLength(2);
        expect(eveSessionClient.calls[1].context.meeting_note_generation).toMatchObject({
            run_id: ingest.body.meeting_review_ingest.run.id,
            source_text_hash: 'hash-route-note-001'
        });

        // camelCase alias input resolves the same handoff context
        await request(app)
            .post(`/api/workflows/control/loop-intents/${noteLoopIntentId}/eve-session`)
            .send({
                forceNewSession: true,
                meetingNoteGeneration: { packageId: 'meeting-review-package-test' }
            })
            .expect(201);
        expect(eveSessionClient.calls).toHaveLength(3);
        expect(eveSessionClient.calls[2].context.meeting_note_generation).toMatchObject({
            run_id: ingest.body.meeting_review_ingest.run.id,
            source_text_hash: 'hash-route-note-001'
        });
    });

    it('story-eve-dispatch-handoff-transcript-context AC-003 S-001 dispatches a new Eve session for the second meeting of the same project instead of reusing the stale session', async () => {
        const eveSessionClient = makeEveSessionClient({
            sessions: [
                { session_id: 'eve-session-route-001', continuation_token: 'cont-route-001' },
                { session_id: 'eve-session-route-002', continuation_token: 'cont-route-002' }
            ]
        });
        const { app } = makeApp({ eveSessionClient });
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({ org_id: 'sample-project', project_id: 'sample-project' })
            .expect(201);
        const first = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: sampleMeetingReviewPackage() })
            .expect(201);
        expect(first.body.meeting_review_ingest.note_generation_dispatch.status).toBe('requested');

        const secondPackage = sampleMeetingReviewPackage({ packageId: 'meeting-review-package-test-2' });
        secondPackage.meeting_identity = {
            ...secondPackage.meeting_identity,
            event_id: 'evt-2',
            title: 'Mana定例 2回目'
        };
        secondPackage.source_event = {
            ...secondPackage.source_event,
            message_ts: '1782454365.844209',
            file_id: 'F0BCYNXMP7Z',
            local_artifact_sha256: 'def456'
        };
        secondPackage.meeting_note_summary = {
            ...secondPackage.meeting_note_summary,
            source_text_hash: 'hash-route-note-002',
            source_transcripts: [{
                ...secondPackage.meeting_note_summary.source_transcripts[0],
                transcript_hash: 'hash-route-note-002',
                text: 'Speaker 1: 2回目の会議です。'
            }]
        };
        const second = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: secondPackage })
            .expect(201);

        expect(second.body.meeting_review_ingest.idempotent).toBe(false);
        expect(second.body.meeting_review_ingest.note_generation_dispatch).toMatchObject({ status: 'requested' });
        expect(second.body.meeting_review_ingest.note_generation_dispatch.eve_session_run_id)
            .not.toBe(first.body.meeting_review_ingest.note_generation_dispatch.eve_session_run_id);
        expect(eveSessionClient.calls).toHaveLength(2);
        expect(eveSessionClient.calls[1].context.meeting_note_generation).toMatchObject({
            run_id: second.body.meeting_review_ingest.run.id,
            source_text_hash: 'hash-route-note-002'
        });

        // Same-run reference without force_new_session keeps the idempotent reuse
        const noteLoopIntentId = meetingPackIds({
            orgId: 'sample-project',
            projectId: 'sample-project',
            definitionId: 'transcript-to-meeting-note'
        }).loopIntentId;
        const reuse = await request(app)
            .post(`/api/workflows/control/loop-intents/${noteLoopIntentId}/eve-session`)
            .send({ meeting_note_generation: { run_id: second.body.meeting_review_ingest.run.id } })
            .expect(200);
        expect(reuse.body.eve_session_dispatch.idempotent).toBe(true);
        expect(eveSessionClient.calls).toHaveLength(2);
    });

    it('story-eve-dispatch-handoff-transcript-context AC-004 S-002 rejects a dispatch whose run belongs to another loop intent', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { app } = makeApp({ eveSessionClient });
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({ org_id: 'sample-project', project_id: 'sample-project' })
            .expect(201);
        const ingest = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: sampleMeetingReviewPackage() })
            .expect(201);
        const tasksLoopIntentId = meetingPackIds({
            orgId: 'sample-project',
            projectId: 'sample-project',
            definitionId: 'meeting-note-to-tasks'
        }).loopIntentId;

        const rejected = await request(app)
            .post(`/api/workflows/control/loop-intents/${tasksLoopIntentId}/eve-session`)
            .send({
                meeting_note_generation: { run_id: ingest.body.meeting_review_ingest.run.id }
            })
            .expect(400);

        expect(rejected.body.state_transition).toBe('blocked_meeting_note_generation_scope');
        expect(eveSessionClient.calls).toHaveLength(1);
    });

    it('story-eve-dispatch-handoff-transcript-context AC-005 AC-007 S-002 blocks transcript-less dispatch and keeps ingest best-effort', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { app } = makeApp({ eveSessionClient });
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({ org_id: 'sample-project', project_id: 'sample-project' })
            .expect(201);
        const reviewPackage = sampleMeetingReviewPackage();
        reviewPackage.meeting_note_summary = {
            background: ['会議背景'],
            agreements: ['合意事項'],
            open_questions: ['未決事項']
        };

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: reviewPackage })
            .expect(201);

        expect(res.body.meeting_review_ingest.run.status).toBe('waiting_human');
        expect(res.body.meeting_review_ingest.note_generation_dispatch).toMatchObject({
            status: 'skipped',
            reason: 'dispatch_failed',
            error: expect.stringContaining('meeting_note_draft source')
        });
        expect(eveSessionClient.calls).toHaveLength(0);

        const noteLoopIntentId = meetingPackIds({
            orgId: 'sample-project',
            projectId: 'sample-project',
            definitionId: 'transcript-to-meeting-note'
        }).loopIntentId;
        const rejected = await request(app)
            .post(`/api/workflows/control/loop-intents/${noteLoopIntentId}/eve-session`)
            .send({
                meeting_note_generation: { run_id: res.body.meeting_review_ingest.run.id }
            })
            .expect(400);
        expect(rejected.body.state_transition).toBe('blocked_meeting_note_generation_source_missing');
        expect(eveSessionClient.calls).toHaveLength(0);
    });

    it('story-eve-dispatch-handoff-transcript-context FM auth_denied rejects a referenced eve-session dispatch for inaccessible projects before any Eve call', async () => {
        const eveSessionClient = makeEveSessionClient();
        const bootstrapped = makeApp({ eveSessionClient });
        await request(bootstrapped.app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({ org_id: 'sample-project', project_id: 'sample-project' })
            .expect(201);
        const noteLoopIntentId = meetingPackIds({
            orgId: 'sample-project',
            projectId: 'sample-project',
            definitionId: 'transcript-to-meeting-note'
        }).loopIntentId;

        const denied = makeApp({ accessProjectCodes: ['general'], eveSessionClient });
        denied.repository.ledger = bootstrapped.repository.ledger;
        await request(denied.app)
            .post(`/api/workflows/control/loop-intents/${noteLoopIntentId}/eve-session`)
            .send({ meeting_note_generation: { package_id: 'meeting-review-package-test' } })
            .expect(403);
        expect(eveSessionClient.calls).toHaveLength(0);
    });

    it('story-eve-dispatch-handoff-transcript-context AC-006 S-003 keeps dispatches without a meeting_note_generation reference unchanged', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { app } = makeApp({ eveSessionClient });
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({ org_id: 'sample-project', project_id: 'sample-project' })
            .expect(201);
        const briefingLoopIntentId = meetingPackIds({
            orgId: 'sample-project',
            projectId: 'sample-project',
            definitionId: 'pre-meeting-briefing'
        }).loopIntentId;

        await request(app)
            .post(`/api/workflows/control/loop-intents/${briefingLoopIntentId}/eve-session`)
            .send({})
            .expect(201);

        expect(eveSessionClient.calls).toHaveLength(1);
        expect(eveSessionClient.calls[0].context.meeting_note_generation).toBeUndefined();
        expect(eveSessionClient.calls[0].message).not.toContain('context.meeting_note_generation');

        const invalidRef = await request(app)
            .post(`/api/workflows/control/loop-intents/${briefingLoopIntentId}/eve-session`)
            .send({ force_new_session: true, meeting_note_generation: {} })
            .expect(400);
        expect(invalidRef.body.state_transition).toBe('blocked_invalid_meeting_note_generation_ref');
    });

    it('story-meeting-note-generation-dag-wiring AC-012 S-004 dedupes re-ingest of the same recording when the hash-derived package_id changes', async () => {
        const { app, repository } = makeApp();
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({ org_id: 'sample-project', project_id: 'sample-project' })
            .expect(201);
        const original = sampleMeetingReviewPackage();
        original.source_event = {
            ...original.source_event,
            source_system: 'plaud',
            provider: 'plaud',
            mcp_resource_uri: 'plaud:file-stable-1'
        };
        const first = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: original })
            .expect(201);
        expect(first.body.meeting_review_ingest.idempotent).toBe(false);

        // 正規化仕様の変更でtranscript_hash由来のpackage_idが変わった再同期を模す
        const rehashed = sampleMeetingReviewPackage({ packageId: 'meeting-review-package-rehashed' });
        rehashed.source_event = { ...original.source_event };
        const replay = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: rehashed })
            .expect(201);

        expect(replay.body.meeting_review_ingest).toMatchObject({
            idempotent: true,
            idempotent_source: 'source_artifact_match',
            prior_package_id: 'meeting-review-package-test',
            run: { id: first.body.meeting_review_ingest.run.id }
        });
        expect(repository.ledger.runs).toHaveLength(1);
        expect(repository.ledger.outputs).toHaveLength(5);
        expect(repository.ledger.human_steps).toHaveLength(5);
    });

    it('story-meeting-note-generation-dag-wiring AC-006 S-002 keeps ingest successful when Eve dispatch fails', async () => {
        const eveSessionClient = makeEveSessionClient({ reject: new Error('eve down') });
        const { app, repository } = makeApp({ eveSessionClient });
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({ org_id: 'sample-project', project_id: 'sample-project' })
            .expect(201);

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: sampleMeetingReviewPackage() })
            .expect(201);

        expect(res.body.meeting_review_ingest.run.status).toBe('waiting_human');
        expect(res.body.meeting_review_ingest.note_generation_dispatch).toMatchObject({
            status: 'skipped',
            reason: 'dispatch_failed'
        });
        expect(repository.listAuditLogs({ targetId: res.body.meeting_review_ingest.run.id })).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'workflow.meeting_pack.note_generation.dispatch_skipped',
                after: expect.objectContaining({ reason: 'dispatch_failed' })
            })
        ]));
    });

    it('story-meeting-note-generation-dag-wiring AC-007 AC-010 S-003 records generated minutes on the meeting_note_draft output', async () => {
        const { app, repository } = makeApp();
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({ org_id: 'sample-project', project_id: 'sample-project' })
            .expect(201);
        const reviewPackage = sampleMeetingReviewPackage();
        reviewPackage.meeting_note_summary = {
            title: 'Mana定例',
            body: '# Mana定例\n\n## Brainbase Meeting Pack Source\n\n## Primary Transcript Excerpt\n\nSpeaker 1: お疲れ様です。',
            generator: 'brainbase_meeting_pack',
            generation_source: 'transcript_to_meeting_note',
            generation_status: 'brainbase_source_ready',
            provider_note_authoritative: false,
            source_text_hash: 'hash-primary-001'
        };
        const ingest = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: reviewPackage })
            .expect(201);
        const runId = ingest.body.meeting_review_ingest.run.id;

        const recorded = await request(app)
            .post('/api/workflows/control/meeting-pack/note-generation')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project',
                package_id: 'meeting-review-package-test',
                source_text_hash: 'hash-primary-001',
                note: { body: '# Mana定例 議事録\n\n## 決定事項\n\n- 生成DAGを接続する' },
                runner: { type: 'eve', session_id: 'eve-session-note-001' }
            })
            .expect(201);

        expect(recorded.body.meeting_note_generation).toMatchObject({
            run_id: runId,
            generation_status: 'brainbase_generated'
        });
        const output = repository.getOutput(recorded.body.meeting_note_generation.output_id);
        expect(output.payload).toMatchObject({
            title: 'Mana定例',
            body: '# Mana定例 議事録\n\n## 決定事項\n\n- 生成DAGを接続する',
            generator: 'brainbase_meeting_pack',
            generation_source: 'transcript_to_meeting_note',
            generation_status: 'brainbase_generated',
            provider_note_authoritative: false,
            source_text_hash: 'hash-primary-001',
            generated_by: expect.objectContaining({ type: 'eve', session_id: 'eve-session-note-001' })
        });
        expect(output.payload.body).not.toContain('Primary Transcript Excerpt');

        const regenerated = await request(app)
            .post('/api/workflows/control/meeting-pack/note-generation')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project',
                run_id: runId,
                source_text_hash: 'hash-primary-001',
                note: { body: '# Mana定例 議事録 v2' },
                runner: { type: 'claude_code' }
            })
            .expect(201);
        expect(repository.getOutput(regenerated.body.meeting_note_generation.output_id).payload.body).toBe('# Mana定例 議事録 v2');
        // Run Trace auditパネルはrun idで絞り込むため、記録はrunを対象にする
        expect(repository.listAuditLogs({ targetId: runId })).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'workflow.meeting_pack.note_generation.recorded',
                after: expect.objectContaining({
                    regenerated: true,
                    output_id: recorded.body.meeting_note_generation.output_id,
                    state_transition: 'note_generation_recorded'
                })
            })
        ]));
    });

    it('story-meeting-note-generation-dag-wiring AC-008 AC-009 rejects mismatched or misaddressed note write-backs', async () => {
        const { app } = makeApp();
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({ org_id: 'sample-project', project_id: 'sample-project' })
            .expect(201);
        const reviewPackage = sampleMeetingReviewPackage();
        reviewPackage.meeting_note_summary = {
            title: 'Mana定例',
            body: 'source pack body',
            generation_status: 'brainbase_source_ready',
            source_text_hash: 'hash-primary-001'
        };
        await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: reviewPackage })
            .expect(201);

        const mismatch = await request(app)
            .post('/api/workflows/control/meeting-pack/note-generation')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project',
                package_id: 'meeting-review-package-test',
                source_text_hash: 'hash-of-some-other-meeting',
                note: { body: '# 別会議の議事録' }
            })
            .expect(400);
        expect(mismatch.body.state_transition).toBe('blocked_source_hash_mismatch');

        await request(app)
            .post('/api/workflows/control/meeting-pack/note-generation')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project',
                package_id: 'unknown-package',
                source_text_hash: 'hash-primary-001',
                note: { body: '# 議事録' }
            })
            .expect(404);

        const missingBody = await request(app)
            .post('/api/workflows/control/meeting-pack/note-generation')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project',
                package_id: 'meeting-review-package-test',
                source_text_hash: 'hash-primary-001',
                note: { body: '   ' }
            })
            .expect(400);
        expect(missingBody.body.state_transition).toBe('blocked_invalid_note_generation');
    });

    it('story-meeting-note-generation-dag-wiring AC-012 S-004 concurrent same-recording ingests do not create duplicate runs', async () => {
        const { app, repository, service } = makeApp();
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({ org_id: 'sample-project', project_id: 'sample-project' })
            .expect(201);
        const actor = { sub: 'keigo', person_id: 'keigo', role: 'admin', projectCodes: ['sample-project'] };
        const makePkg = (packageId) => {
            const pkg = sampleMeetingReviewPackage({ packageId });
            pkg.source_event = { ...pkg.source_event, source_system: 'plaud', provider: 'plaud', mcp_resource_uri: 'plaud:file-race-1' };
            return pkg;
        };
        const [first, second] = await Promise.all([
            service.ingestMeetingReviewPackage({ review_package: makePkg('meeting-review-package-race-a') }, actor),
            service.ingestMeetingReviewPackage({ review_package: makePkg('meeting-review-package-race-b') }, actor)
        ]);
        const results = [first.meeting_review_ingest, second.meeting_review_ingest];
        expect(results.filter((r) => r.idempotent)).toHaveLength(1);
        expect(results.filter((r) => !r.idempotent)).toHaveLength(1);
        expect(repository.ledger.runs).toHaveLength(1);
        expect(repository.ledger.outputs).toHaveLength(5);
        expect(repository.ledger.human_steps).toHaveLength(5);
    });

    it('story-meeting-note-generation-dag-wiring AC-009 rejects unauthorized or malformed note-generation write-backs consistently', async () => {
        const denied = makeApp({ accessProjectCodes: [] });
        const res = await request(denied.app)
            .post('/api/workflows/control/meeting-pack/note-generation')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project',
                package_id: 'meeting-review-package-test',
                source_text_hash: 'hash-primary-001',
                note: { body: '# 議事録' }
            })
            .expect(403);
        expect(res.body.error).toContain("project 'sample-project' is not accessible");

        const { app } = makeApp();
        const missingOrg = await request(app)
            .post('/api/workflows/control/meeting-pack/note-generation')
            .send({
                project_id: 'sample-project',
                package_id: 'meeting-review-package-test',
                source_text_hash: 'hash-primary-001',
                note: { body: '# 議事録' }
            })
            .expect(400);
        expect(missingOrg.body.state_transition).toBe('blocked_invalid_note_generation');
        const missingProject = await request(app)
            .post('/api/workflows/control/meeting-pack/note-generation')
            .send({
                org_id: 'sample-project',
                package_id: 'meeting-review-package-test',
                source_text_hash: 'hash-primary-001',
                note: { body: '# 議事録' }
            })
            .expect(400);
        expect(missingProject.body.state_transition).toBe('blocked_invalid_note_generation');
    });

    it('story-meeting-review-package-ingest-v1 rejects unauthorized operator before ingest writes', async () => {
        const { app, repository, service } = makeApp({ accessProjectCodes: [] });
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'sample-project',
            project_id: 'sample-project'
        }, { sub: 'system', person_id: 'system', role: 'admin', projectCodes: ['sample-project'] });

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: sampleMeetingReviewPackage() })
            .expect(403);

        expect(res.body.error).toContain("project 'sample-project' is not accessible");
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
        expect(repository.ledger.audit_logs.some((entry) => entry.action === 'workflow.meeting_review_package.ingested')).toBe(false);
    });

    it('story-meeting-review-package-ingest-v1 parse_failure rejects malformed JSON before ingest writes', async () => {
        const { app, repository } = makeApp();

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .set('Content-Type', 'application/json')
            .send('{"review_package":')
            .expect(400);

        expect(res.body).toMatchObject({
            code: 'parse_failure',
            message: 'Malformed JSON payload'
        });
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
        expect(repository.ledger.audit_logs.some((entry) => entry.action === 'workflow.meeting_review_package.ingested')).toBe(false);
    });

    it('story-meeting-review-package-ingest-v1 keeps the review run visible after resolving one generated human approval', async () => {
        const { app, repository } = makeApp();
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(201);
        const ingestRes = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: sampleMeetingReviewPackage() })
            .expect(201);
        const runId = ingestRes.body.meeting_review_ingest.run.id;
        const stepId = ingestRes.body.meeting_review_ingest.human_steps[0].id;

        const resolveRes = await request(app)
            .post(`/api/workflow-runs/${runId}/human-steps/${stepId}/resolve`)
            .send({ resolution: 'approved' })
            .expect(200);

        expect(resolveRes.body.human_step).toMatchObject({
            id: stepId,
            status: 'approved'
        });
        expect(resolveRes.body.resumed_run).toMatchObject({
            id: runId,
            status: 'waiting_human',
            closure_state: 'open',
            action_required: 'approve',
            human_waiting: true
        });
        expect(resolveRes.body.resumed_run.message).not.toContain('No workflow handler registered');

        expect(repository.getRun(runId)).toMatchObject({
            id: runId,
            status: 'waiting_human',
            action_required: 'approve',
            human_waiting: true
        });
        expect(repository.listHumanSteps(runId).filter((humanStep) => humanStep.status === 'pending')).toHaveLength(4);
    });

    it('story-meeting-review-package-ingest-v1 cancels remaining review gates after a generated human rejection', async () => {
        const { app, repository } = makeApp();
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(201);
        const ingestRes = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: sampleMeetingReviewPackage() })
            .expect(201);
        const runId = ingestRes.body.meeting_review_ingest.run.id;
        const [rejectedStep, staleApproveStep] = ingestRes.body.meeting_review_ingest.human_steps;

        const rejectRes = await request(app)
            .post(`/api/workflow-runs/${runId}/human-steps/${rejectedStep.id}/resolve`)
            .send({ resolution: 'rejected' })
            .expect(200);

        expect(rejectRes.body.human_step).toMatchObject({
            id: rejectedStep.id,
            status: 'rejected'
        });
        expect(rejectRes.body.resumed_run).toMatchObject({
            id: runId,
            status: 'cancelled',
            closure_state: 'closed',
            action_required: 'none',
            human_waiting: false
        });
        expect(repository.listHumanSteps(runId).filter((humanStep) => humanStep.status === 'pending')).toHaveLength(0);
        expect(repository.listHumanSteps(runId).filter((humanStep) => humanStep.status === 'cancelled')).toHaveLength(4);

        const staleApproveRes = await request(app)
            .post(`/api/workflow-runs/${runId}/human-steps/${staleApproveStep.id}/resolve`)
            .send({ resolution: 'approved' })
            .expect(409);
        expect(staleApproveRes.body.error).toContain(`human step '${staleApproveStep.id}' is already cancelled`);
        expect(repository.getRun(runId)).toMatchObject({
            status: 'cancelled',
            closure_state: 'closed'
        });
    });

    it('story-meeting-review-package-ingest-v1 blocks manual run and rerun for review-ingest workflow before creating extra runs', async () => {
        const { app, repository } = makeApp();
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(201);
        const ingestRes = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: sampleMeetingReviewPackage() })
            .expect(201);
        const runId = ingestRes.body.meeting_review_ingest.run.id;
        const workflowId = ingestRes.body.meeting_review_ingest.run.workflow_id;

        const runRes = await request(app)
            .post(`/api/workflows/${workflowId}/run`)
            .send({ trigger_type: 'manual' })
            .expect(400);
        expect(runRes.body.error).toContain('meeting-review-package-ingest workflows cannot be manually run');

        const rerunRes = await request(app)
            .post(`/api/workflow-runs/${runId}/rerun`)
            .send({})
            .expect(400);
        expect(rerunRes.body.error).toContain('meeting-review-package-ingest workflows cannot be manually run');

        expect(repository.listRuns({ workflowId })).toHaveLength(1);
        expect(repository.ledger.runs).toHaveLength(1);
        expect(repository.ledger.outputs).toHaveLength(5);
        expect(repository.ledger.human_steps).toHaveLength(5);
    });

    it('story-meeting-review-package-ingest-v1 returns project access denial before manual run guard', async () => {
        const { app, repository, service } = makeApp({ accessProjectCodes: [] });
        const systemActor = { sub: 'system', person_id: 'system', role: 'admin', projectCodes: ['sample-project'] };
        await service.bootstrapMeetingWorkflowPack({
            org_id: 'sample-project',
            project_id: 'sample-project'
        }, systemActor);
        const ingestResult = await service.ingestMeetingReviewPackage({
            review_package: sampleMeetingReviewPackage()
        }, systemActor);
        const runId = ingestResult.meeting_review_ingest.run.id;
        const workflowId = ingestResult.meeting_review_ingest.run.workflow_id;

        const runRes = await request(app)
            .post(`/api/workflows/${workflowId}/run`)
            .send({ trigger_type: 'manual' })
            .expect(403);
        expect(runRes.body.error).toContain("project 'sample-project' is not accessible");

        const rerunRes = await request(app)
            .post(`/api/workflow-runs/${runId}/rerun`)
            .send({})
            .expect(403);
        expect(rerunRes.body.error).toContain("project 'sample-project' is not accessible");

        expect(repository.listRuns({ workflowId })).toHaveLength(1);
        expect(repository.ledger.runs).toHaveLength(1);
        expect(repository.ledger.outputs).toHaveLength(5);
        expect(repository.ledger.human_steps).toHaveLength(5);
    });

    it('story-meeting-review-package-ingest-v1 INV-008 keeps package ingest idempotent', async () => {
        const { app, repository } = makeApp();
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(201);
        const body = { review_package: sampleMeetingReviewPackage() };

        const first = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send(body)
            .expect(201);
        const second = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send(body)
            .expect(201);

        expect(second.body.meeting_review_ingest).toMatchObject({
            idempotent: true,
            run: { id: first.body.meeting_review_ingest.run.id }
        });
        expect(repository.ledger.runs).toHaveLength(1);
        expect(repository.ledger.outputs).toHaveLength(5);
        expect(repository.ledger.human_steps).toHaveLength(5);
    });

    it('story-meeting-review-package-ingest-v1 S-006 rejects missing loop intent before writes', async () => {
        const { app, repository } = makeApp();
        await request(app)
            .post('/api/workflows/control/meeting-pack/bootstrap')
            .send({
                org_id: 'sample-project',
                project_id: 'sample-project'
            })
            .expect(201);
        const reviewPackage = sampleMeetingReviewPackage();
        reviewPackage.loop_intent_ids = {
            ...reviewPackage.loop_intent_ids,
            transcript_to_meeting_note: 'loop_missing'
        };

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: reviewPackage })
            .expect(400);

        expect(res.body.error).toContain("loop_intent 'loop_missing' not found");
        expect(res.body.state_transition).toBe('blocked_loop_intent_mismatch');
        expect(res.body.details).toMatchObject({
            loop_intent_key: 'transcript_to_meeting_note',
            loop_intent_id: 'loop_missing'
        });
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
        expect(repository.ledger.audit_logs.some((entry) => entry.action === 'workflow.meeting_review_package.ingested')).toBe(false);
    });

    it('story-meeting-review-package-ingest-v1 rejects omitted required loop intent keys before writes', async () => {
        const { app, repository } = makeApp();
        const reviewPackage = sampleMeetingReviewPackage();
        delete reviewPackage.loop_intent_ids.post_meeting_follow_up_message;

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: reviewPackage })
            .expect(400);

        expect(res.body.error).toContain('review_package.loop_intent_ids is missing required meeting review key(s)');
        expect(res.body.state_transition).toBe('blocked_loop_intent_mismatch');
        expect(res.body.details.missing_loop_intent_keys).toEqual(['post_meeting_follow_up_message']);
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
        expect(repository.ledger.audit_logs).toHaveLength(0);
    });

    it('story-meeting-review-package-ingest-v1 rejects omitted required output payload keys before writes', async () => {
        const { app, repository } = makeApp();
        const reviewPackage = sampleMeetingReviewPackage();
        delete reviewPackage.follow_up_draft;

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: reviewPackage })
            .expect(400);

        expect(res.body.error).toContain('review_package is missing required output payload key(s)');
        expect(res.body.state_transition).toBe('blocked_invalid_review_package');
        expect(res.body.details.missing_package_keys).toEqual(['follow_up_draft']);
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
        expect(repository.ledger.audit_logs).toHaveLength(0);
    });

    it('story-meeting-review-package-ingest-v1 rejects missing package id with structured state transition before writes', async () => {
        const { app, repository } = makeApp();
        const reviewPackage = sampleMeetingReviewPackage();
        delete reviewPackage.package_id;

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: reviewPackage })
            .expect(400);

        expect(res.body.error).toContain('review_package.package_id is required');
        expect(res.body.state_transition).toBe('blocked_invalid_review_package');
        expect(res.body.details.missing_package_keys).toEqual(['package_id']);
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
    });

    it('story-meeting-review-package-ingest-v1 rejects invalid scope with structured state transition before writes', async () => {
        const { app, repository } = makeApp();
        const reviewPackage = sampleMeetingReviewPackage({ orgId: 'unknown-org', projectId: 'missing-project' });

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: reviewPackage })
            .expect(400);

        expect(res.body.state_transition).toBe('blocked_invalid_scope');
        expect(res.body.details).toMatchObject({
            org_id: 'unknown-org',
            project_id: 'missing-project'
        });
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
    });

    it('story-meeting-review-package-ingest-v1 rejects malformed loop intent map with structured state transition before writes', async () => {
        const { app, repository } = makeApp();
        const reviewPackage = sampleMeetingReviewPackage();
        reviewPackage.loop_intent_ids = null;

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/review-ingest')
            .send({ review_package: reviewPackage })
            .expect(400);

        expect(res.body.error).toContain('review_package.loop_intent_ids must be a JSON object');
        expect(res.body.state_transition).toBe('blocked_loop_intent_mismatch');
        expect(res.body.details.required_loop_intent_keys).toEqual(expect.arrayContaining([
            'transcript_to_meeting_note',
            'meeting_note_to_tasks',
            'meeting_note_to_decisions',
            'post_meeting_follow_up_message'
        ]));
        expect(repository.ledger.runs).toHaveLength(0);
        expect(repository.ledger.outputs).toHaveLength(0);
        expect(repository.ledger.human_steps).toHaveLength(0);
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

    it('exposes org role-agent control routes under the control namespace', async () => {
        const { app, repository } = makeApp();

        const agentRes = await request(app)
            .post('/api/workflows/control/role-agents')
            .send({
                id: 'rai-salestailor-sales',
                org_id: 'salestailor',
                project_id: 'sample-project',
                role_archetype_id: 'sales',
                name: 'SalesTailor Sales Agent',
                context_policy: { graph_refs: ['org:salestailor'] },
                tool_scope: { allow: ['crm.read', 'gmail.draft'], deny: ['gmail.send'] },
                workflow_constraints: { external_send_requires_approval: true }
            })
            .expect(201);
        expect(agentRes.body.role_agent_instance).toMatchObject({
            id: 'rai-salestailor-sales',
            org_id: 'salestailor',
            project_id: 'sample-project',
            role_archetype_id: 'sales',
            owner_id: 'sato',
            context_policy: { graph_refs: ['org:salestailor'] },
            tool_scope: { allow: ['crm.read', 'gmail.draft'], deny: ['gmail.send'] },
            workflow_constraints: { external_send_requires_approval: true }
        });

        await request(app)
            .post('/api/workflows/control/templates')
            .send({
                id: 'tmpl-sales-followup',
                org_id: 'salestailor',
                project_id: 'sample-project',
                name: 'Sales Followup',
                workflow_kind: 'sales',
                judgment_dag_id: 'sales-followup-v1'
            })
            .expect(201);

        const bindingRes = await request(app)
            .post('/api/workflows/control/bindings')
            .send({
                id: 'bind-salestailor-sales-followup',
                org_id: 'salestailor',
                project_id: 'sample-project',
                role_agent_instance_id: 'rai-salestailor-sales',
                workflow_template_id: 'tmpl-sales-followup',
                autonomy_level: 'approval_required',
                workflow_selection_reason: '顧客接触期限を見て営業Agentが選ぶ'
            })
            .expect(201);
        expect(bindingRes.body.workflow_binding).toMatchObject({
            org_id: 'salestailor',
            autonomy_level: 'approval_required',
            judgment_dag_id: 'sales-followup-v1',
            workflow_selection_reason: '顧客接触期限を見て営業Agentが選ぶ'
        });

        const triggerRes = await request(app)
            .post('/api/workflows/control/triggers')
            .send({
                id: 'trg-salestailor-human-sales',
                org_id: 'salestailor',
                project_id: 'sample-project',
                workflow_binding_id: 'bind-salestailor-sales-followup',
                trigger_type: 'human',
                name: 'Human sales request'
            })
            .expect(201);
        expect(triggerRes.body.workflow_trigger).toMatchObject({
            trigger_type: 'human',
            org_id: 'salestailor'
        });

        const intentRes = await request(app)
            .post('/api/workflows/control/loop-intents')
            .send({
                id: 'loop-salestailor-human-sales',
                org_id: 'salestailor',
                project_id: 'sample-project',
                workflow_binding_id: 'bind-salestailor-sales-followup',
                trigger_id: 'trg-salestailor-human-sales',
                input_summary: 'フォローアップ対象を洗い出す',
                input_payload: {
                    source: 'human',
                    customer_ids: ['cus_salestailor_001'],
                    requested_output: 'draft_followup'
                }
            })
            .expect(201);
        expect(intentRes.body.loop_intent).toMatchObject({
            org_id: 'salestailor',
            role_agent_instance_id: 'rai-salestailor-sales',
            workflow_template_id: 'tmpl-sales-followup',
            input_summary: 'フォローアップ対象を洗い出す',
            input_payload: {
                source: 'human',
                customer_ids: ['cus_salestailor_001'],
                requested_output: 'draft_followup'
            },
            selected_workflow_reason: '顧客接触期限を見て営業Agentが選ぶ',
            eligibility: {
                status: 'needs_approval',
                autonomy_level: 'approval_required',
                requires_human_approval: true
            }
        });

        const listRes = await request(app)
            .get('/api/workflows/control/role-agents?org_id=salestailor')
            .expect(200);
        expect(listRes.body.role_agent_instances).toHaveLength(1);
        expect(repository.listAuditLogs({ targetId: 'loop-salestailor-human-sales' })).toEqual([
            expect.objectContaining({ action: 'workflow.loop_intent.created', target_type: 'loop_intent' })
        ]);
    });

    it('keeps legacy Workflow Control GET aliases without generic workflow fallback', async () => {
        const { app } = makeApp();

        const legacyControlRes = await request(app)
            .get('/api/workflows/role-agents?project_id=sample-project')
            .expect(200);
        expect(legacyControlRes.body.role_agent_instances).toEqual([]);

        const canonicalControlRes = await request(app)
            .get('/api/workflows/control/role-agents?project_id=sample-project')
            .expect(200);
        expect(canonicalControlRes.body.role_agent_instances).toEqual([]);
    });

    it('keeps workflow control POST writes scoped to the canonical control namespace', async () => {
        const { app, repository } = makeApp();

        await request(app)
            .post('/api/workflows/role-agents')
            .send({
                id: 'rai-legacy-post-alias',
                org_id: 'salestailor',
                project_id: 'sample-project',
                role_archetype_id: 'sales',
                name: 'Legacy POST Alias Agent'
            })
            .expect(404);

        expect(repository.listRoleAgentInstances({ projectId: 'sample-project' })).toEqual([]);

        await request(app)
            .post('/api/workflows/control/role-agents')
            .send({
                id: 'rai-canonical-control',
                org_id: 'salestailor',
                project_id: 'sample-project',
                role_archetype_id: 'sales',
                name: 'Canonical Control Agent'
            })
            .expect(201);

        expect(repository.listRoleAgentInstances({ projectId: 'sample-project' })).toEqual([
            expect.objectContaining({ id: 'rai-canonical-control' })
        ]);
    });

    it('denies workflow template create and list paths when project grants are empty', async () => {
        const { app, repository } = makeApp({ accessProjectCodes: [] });

        await request(app)
            .post('/api/workflows/control/templates')
            .send({
                id: 'tmpl-denied-project',
                org_id: 'salestailor',
                project_id: 'sample-project',
                name: 'Denied Project Template',
                workflow_kind: 'sales'
            })
            .expect(403);

        await request(app)
            .post('/api/workflows/control/templates')
            .send({
                id: 'tmpl-denied-global',
                name: 'Denied Global Template',
                workflow_kind: 'sales'
            })
            .expect(403);

        repository.upsertWorkflowTemplate({
            id: 'tmpl-hidden-project',
            workspace_id: 'default',
            org_id: 'salestailor',
            project_id: 'sample-project',
            name: 'Hidden Project Template',
            workflow_kind: 'sales'
        });

        const res = await request(app)
            .get('/api/workflows/control/templates?org_id=salestailor')
            .expect(200);

        expect(res.body.workflow_templates).toEqual([]);
    });

    it('retires generic workflow product read, edit, and draft endpoints', async () => {
        const { app } = makeApp();

        await request(app).get('/api/workflows').expect(404);
        await request(app)
            .post('/api/workflows')
            .send({ id: 'retired-product-workflow', project_id: 'sample-project' })
            .expect(404);
        await request(app)
            .post('/api/workflows/draft')
            .send({ project_id: 'sample-project', prompt: 'retired' })
            .expect(404);
        await request(app)
            .post('/api/workflows/draft/test')
            .send({ project_id: 'sample-project' })
            .expect(404);
        await request(app).get('/api/workflows/brainbase-alive').expect(404);
        await request(app)
            .patch('/api/workflows/brainbase-alive')
            .send({ enabled: false })
            .expect(404);
    });

    it('documents workflow API auth mounting in register-api-routes', () => {
        const source = fs.readFileSync('server/bootstrap/register-api-routes.js', 'utf8');

        expect(source).toMatch(/workflowAuthGuard\s*=\s*requireAuth\(authService\)/);
        expect(source).toMatch(/app\.use\('\/api\/workflows',\s*workflowAuthGuard,/);
        expect(source).toMatch(/app\.use\('\/api\/workflow-runs',\s*workflowAuthGuard,/);
        expect(source).toMatch(/app\.use\('\/api\/workflow-human-steps',\s*workflowAuthGuard,/);
    });
});
