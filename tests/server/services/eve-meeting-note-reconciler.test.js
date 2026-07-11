import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createWorkflowRouter } from '../../../server/routes/workflows.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';
import { meetingPackIds } from '../../../server/services/workflow/meeting-workflow-pack.js';
import {
    WorkflowService,
    createDefaultWorkflowHandlers
} from '../../../server/services/workflow/workflow-service.js';
import {
    EveMeetingNoteReconciler,
    classifySessionStreamPhase,
    createEveMeetingNoteReconcilerConfigFromEnv,
    extractMeetingNoteToolCalls
} from '../../../server/services/external-runner/eve-meeting-note-reconciler.js';

const SOURCE_TEXT_HASH = 'hash-reconciler-note-001';

function makeService({ eveSessionClient = null } = {}) {
    const repository = new InMemoryWorkflowRepository();
    const runner = new WorkflowRunner({ repository, handlers: createDefaultWorkflowHandlers() });
    const configParser = {
        async getProjects() {
            return {
                root: '/workspace',
                projects: [{ id: 'salestailor', session_select: true }]
            };
        }
    };
    const service = new WorkflowService({
        repository,
        runner,
        configParser,
        googleCalendarService: null,
        eveSessionClient,
        infoSSOTService: null
    });
    const actor = {
        sub: 'keigo',
        person_id: 'keigo',
        role: 'admin',
        projectCodes: ['salestailor']
    };
    return { repository, service, actor };
}

function makeEveSessionClient({
    sessionId = 'wrun_reconciler_test_001',
    streams = {},
    streamError = null
} = {}) {
    const streamCalls = [];
    return {
        streamCalls,
        isConfigured() {
            return true;
        },
        async createSession() {
            return { session_id: sessionId, continuation_token: 'cont-1', response: { ok: true } };
        },
        async readSessionStream({ sessionId: requested }) {
            streamCalls.push(requested);
            if (streamError) throw streamError;
            return streams[requested] || [];
        }
    };
}

function sampleMeetingReviewPackage({
    orgId = 'salestailor',
    projectId = 'salestailor',
    packageId = 'meeting-review-package-reconciler-test'
} = {}) {
    return {
        schema_version: '0.1.0',
        package_id: packageId,
        status: 'review_required',
        meeting_identity: {
            source: 'google_calendar',
            account: 'info@example.com',
            calendar_id: 'primary',
            event_id: 'evt-reconciler-1',
            title: '定例会議',
            start: '2026-07-10T13:00:00+09:00',
            end: '2026-07-10T14:00:00+09:00',
            candidate_org_id: orgId,
            candidate_project_id: projectId,
            case_scope: 'reconciler-test',
            graph_context: {
                org_entity_ids: ['org-reconciler'],
                person_entity_ids: ['person-reconciler']
            }
        },
        source_event: {
            source_system: 'slack',
            workspace: 'unson',
            channel_id: 'C08SYTDR7R8',
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
            title: '定例会議',
            body: '# 定例会議\n\n## Primary Transcript Excerpt\n\nSpeaker 1: 会議背景を確認します。',
            generator: 'brainbase_meeting_pack',
            generation_source: 'transcript_to_meeting_note',
            generation_status: 'brainbase_source_ready',
            provider_note_authoritative: false,
            source_text_hash: SOURCE_TEXT_HASH,
            source_text_length: 34,
            source_transcripts: [{
                role: 'primary',
                provider: 'plaud',
                source_text_kind: 'transcript',
                transcript_hash: SOURCE_TEXT_HASH,
                text: 'Speaker 1: 会議背景を確認します。\nSpeaker 2: 合意事項を記録します。',
                text_length: 34
            }]
        },
        task_candidates: ['タスク候補'],
        decision_candidates: ['意思決定候補'],
        follow_up_draft: {
            status: 'draft_only',
            external_send_required_approval: true,
            body: '本日はありがとうございました。'
        },
        promotion_candidates: { graph: [], learning: [] },
        evidence_refs: ['transcript:00:01:00-00:02:00'],
        stop_conditions: ['external_send_requires_human_approval']
    };
}

function noteToolCallEvent({
    runId,
    sourceTextHash = SOURCE_TEXT_HASH,
    body = '# 2026-07-10 定例会議-要約\n\n生成された議事録本文。',
    title = '2026-07-10 定例会議-要約',
    callId = 'call_note_001'
}) {
    return {
        type: 'actions.requested',
        data: {
            actions: [{
                kind: 'tool-call',
                callId,
                toolName: 'record_meeting_note_generation',
                input: {
                    org_id: 'salestailor',
                    project_id: 'salestailor',
                    run_id: runId,
                    source_text_hash: sourceTextHash,
                    note: { title, body }
                }
            }],
            sequence: 10,
            stepIndex: 1,
            turnId: 'turn-1'
        }
    };
}

const PARKED_TAIL = [
    { type: 'turn.completed', data: { sequence: 90, turnId: 'turn-1' } },
    { type: 'session.waiting', data: { wait: 'next-user-message' } }
];

async function dispatchMeetingNoteRun({ service, repository, actor, eveSessionClient }) {
    await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
    const ingest = await service.ingestMeetingReviewPackage({
        review_package: sampleMeetingReviewPackage()
    }, actor);
    const ingestRunId = ingest.meeting_review_ingest.run.id;
    const loopIntentId = meetingPackIds({
        orgId: 'salestailor',
        projectId: 'salestailor',
        definitionId: 'transcript-to-meeting-note'
    }).loopIntentId;
    const dispatched = await service.dispatchLoopIntentToEve(loopIntentId, {
        meeting_note_generation: { run_id: ingestRunId }
    }, actor);
    return {
        ingestRunId,
        dispatchRunId: dispatched.eve_session_dispatch.run.id,
        sessionId: dispatched.eve_session_dispatch.run.metadata.runner.session_id
    };
}

function noteDraftOutput(repository, ingestRunId) {
    return repository.listOutputs(ingestRunId)
        .find((output) => output.metadata?.output_key === 'meeting_note_draft');
}

describe('extractMeetingNoteToolCalls', () => {
    it('collects record_meeting_note_generation tool-call inputs from actions.requested events', () => {
        const events = [
            { type: 'message.appended', data: { messageDelta: 'x' } },
            noteToolCallEvent({ runId: 'run-1' }),
            {
                type: 'actions.requested',
                data: { actions: [{ kind: 'tool-call', callId: 'c2', toolName: 'todo', input: { todos: [] } }] }
            }
        ];
        const calls = extractMeetingNoteToolCalls(events);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            call_id: 'call_note_001',
            input: expect.objectContaining({ run_id: 'run-1', source_text_hash: SOURCE_TEXT_HASH })
        });
    });

    it('ignores malformed events without throwing', () => {
        expect(extractMeetingNoteToolCalls(null)).toEqual([]);
        expect(extractMeetingNoteToolCalls([{ type: 'actions.requested' }, null, { type: 'actions.requested', data: { actions: [{ kind: 'tool-call', toolName: 'record_meeting_note_generation' }] } }])).toEqual([]);
    });
});

describe('classifySessionStreamPhase', () => {
    it('classifies parked, completed, failed, and in-progress streams', () => {
        expect(classifySessionStreamPhase([{ type: 'turn.started' }, { type: 'session.waiting' }])).toBe('parked');
        expect(classifySessionStreamPhase([{ type: 'session.completed' }])).toBe('completed');
        expect(classifySessionStreamPhase([{ type: 'turn.failed', data: {} }])).toBe('failed');
        expect(classifySessionStreamPhase([{ type: 'session.failed', data: {} }])).toBe('failed');
        expect(classifySessionStreamPhase([{ type: 'turn.started' }, { type: 'message.appended' }])).toBe('in_progress');
        expect(classifySessionStreamPhase([])).toBe('in_progress');
    });

    it('uses the terminal-most boundary event when a session resumed after parking', () => {
        expect(classifySessionStreamPhase([
            { type: 'session.waiting' },
            { type: 'turn.started' },
            { type: 'message.appended' }
        ])).toBe('in_progress');
    });
});

describe('EveMeetingNoteReconciler', () => {
    it('records the generated note from the session stream and closes the dispatch run', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId, sessionId } = await dispatchMeetingNoteRun({
            service, repository, actor, eveSessionClient
        });
        eveSessionClient.streams = {};
        eveSessionClient.readSessionStream = async () => [
            noteToolCallEvent({ runId: ingestRunId }),
            ...PARKED_TAIL
        ];

        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        const summary = await reconciler.runOnce();

        expect(summary).toMatchObject({ checked: 1, recorded: 1, blocked: 0, pending: 0, errors: [] });

        const output = noteDraftOutput(repository, ingestRunId);
        expect(output.payload.generation_status).toBe('brainbase_generated');
        expect(output.payload.body).toContain('生成された議事録本文');
        expect(output.payload.generated_by).toMatchObject({ type: 'eve', session_id: sessionId });

        const dispatchRun = repository.getRun(dispatchRunId);
        expect(dispatchRun).toMatchObject({
            status: 'success',
            closure_state: 'closed',
            action_required: 'none'
        });
        expect(dispatchRun.metadata.eve_note_reconciler).toMatchObject({ reason: 'note_reconciled', note_call_id: 'call_note_001' });

        const auditActions = repository.listAuditLogs({ targetId: dispatchRunId, limit: 100 }).map((entry) => entry.action);
        expect(auditActions).toContain('workflow.meeting_pack.note_generation.reconciled');
        const recordedAudit = repository.listAuditLogs({ targetId: ingestRunId, limit: 100 })
            .find((entry) => entry.action === 'workflow.meeting_pack.note_generation.recorded');
        expect(recordedAudit).toBeTruthy();
        expect(recordedAudit.after.generation_status).toBe('brainbase_generated');
    });

    it('rejects a note whose source_text_hash does not match the dispatch handoff', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({
            service, repository, actor, eveSessionClient
        });
        eveSessionClient.readSessionStream = async () => [
            noteToolCallEvent({ runId: ingestRunId, sourceTextHash: 'tampered-hash' }),
            ...PARKED_TAIL
        ];

        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        const summary = await reconciler.runOnce();

        expect(summary).toMatchObject({ checked: 1, recorded: 0, blocked: 1 });
        expect(noteDraftOutput(repository, ingestRunId).payload.generation_status).toBe('brainbase_source_ready');
        const dispatchRun = repository.getRun(dispatchRunId);
        expect(dispatchRun.status).toBe('blocked');
        expect(dispatchRun.metadata.eve_note_reconciler).toMatchObject({
            reason: 'session_ended_without_note',
            mismatched_note_calls: 1
        });
    });

    it('leaves in-progress sessions pending and retries on the next tick', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({
            service, repository, actor, eveSessionClient
        });
        eveSessionClient.readSessionStream = async () => [
            { type: 'turn.started', data: { sequence: 1, turnId: 'turn-1' } },
            { type: 'message.appended', data: { messageDelta: '生成中' } }
        ];

        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        const first = await reconciler.runOnce();
        expect(first).toMatchObject({ checked: 1, pending: 1, recorded: 0, blocked: 0 });
        expect(repository.getRun(dispatchRunId).status).toBe('running');

        eveSessionClient.readSessionStream = async () => [
            noteToolCallEvent({ runId: ingestRunId }),
            ...PARKED_TAIL
        ];
        const second = await reconciler.runOnce();
        expect(second).toMatchObject({ checked: 1, recorded: 1 });
        expect(repository.getRun(dispatchRunId).status).toBe('success');
    });

    it('blocks a dispatch run whose session parked without any note call', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { dispatchRunId } = await dispatchMeetingNoteRun({
            service, repository, actor, eveSessionClient
        });
        eveSessionClient.readSessionStream = async () => [
            { type: 'turn.started', data: { sequence: 1, turnId: 'turn-1' } },
            ...PARKED_TAIL
        ];

        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        const summary = await reconciler.runOnce();

        expect(summary).toMatchObject({ checked: 1, blocked: 1 });
        const dispatchRun = repository.getRun(dispatchRunId);
        expect(dispatchRun).toMatchObject({ status: 'blocked', action_required: 'operator_review_eve_session' });
        const auditActions = repository.listAuditLogs({ targetId: dispatchRunId, limit: 100 }).map((entry) => entry.action);
        expect(auditActions).toContain('workflow.meeting_pack.note_generation.reconcile_blocked');
    });

    it('closes the dispatch run without re-recording when the note was already generated', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId, sessionId } = await dispatchMeetingNoteRun({
            service, repository, actor, eveSessionClient
        });
        await service.recordMeetingNoteGeneration({
            org_id: 'salestailor',
            project_id: 'salestailor',
            run_id: ingestRunId,
            source_text_hash: SOURCE_TEXT_HASH,
            note: { title: '既存生成', body: '既に書き戻し済みの本文' },
            runner: { type: 'eve', session_id: sessionId }
        }, actor);
        let streamRead = false;
        eveSessionClient.readSessionStream = async () => {
            streamRead = true;
            return [];
        };

        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        const summary = await reconciler.runOnce();

        expect(summary).toMatchObject({ checked: 1, already_recorded: 1, recorded: 0 });
        expect(streamRead).toBe(false);
        expect(repository.getRun(dispatchRunId).status).toBe('success');
        expect(noteDraftOutput(repository, ingestRunId).payload.body).toBe('既に書き戻し済みの本文');
    });

    it('blocks the dispatch run permanently when the record contract rejects the note (hash divergence after re-ingest)', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({
            service, repository, actor, eveSessionClient
        });
        // Simulate the draft's hash diverging after dispatch: the stream note
        // still matches the dispatch metadata, but the record contract rejects it.
        const output = noteDraftOutput(repository, ingestRunId);
        repository.updateOutput(output.id, {
            payload: { ...output.payload, source_text_hash: 'diverged-after-reingest' }
        });
        eveSessionClient.readSessionStream = async () => [
            noteToolCallEvent({ runId: ingestRunId }),
            ...PARKED_TAIL
        ];

        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        const summary = await reconciler.runOnce();

        expect(summary).toMatchObject({ checked: 1, recorded: 0, blocked: 1, errors: [] });
        const dispatchRun = repository.getRun(dispatchRunId);
        expect(dispatchRun).toMatchObject({
            status: 'blocked',
            closure_state: 'open',
            human_waiting: true,
            action_required: 'operator_review_eve_session'
        });
        expect(dispatchRun.metadata.eve_note_reconciler).toMatchObject({
            reason: 'record_failed_permanent',
            record_state_transition: 'blocked_source_hash_mismatch'
        });
        // Permanent: the run does not stay in the pending pool.
        expect(reconciler.listPendingDispatchRuns()).toHaveLength(0);
    });

    it('does not clobber a run that another writer closed while the stream was being read', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({
            service, repository, actor, eveSessionClient
        });
        eveSessionClient.readSessionStream = async () => {
            // Concurrent writer closes the dispatch run mid-reconcile.
            repository.updateRun(dispatchRunId, {
                status: 'success',
                message: 'closed by external-runner ingest',
                metadata: { concurrent: true }
            });
            return [{ type: 'turn.started', data: {} }, ...PARKED_TAIL];
        };

        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        await reconciler.runOnce();

        const dispatchRun = repository.getRun(dispatchRunId);
        expect(dispatchRun.status).toBe('success');
        expect(dispatchRun.message).toBe('closed by external-runner ingest');
        expect(dispatchRun.metadata).toEqual({ concurrent: true });
    });

    it('records stream read failures as errors and keeps the run pending', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { dispatchRunId } = await dispatchMeetingNoteRun({
            service, repository, actor, eveSessionClient
        });
        eveSessionClient.readSessionStream = async () => {
            throw new Error('Eve session stream failed with HTTP 502');
        };

        const reconciler = new EveMeetingNoteReconciler({
            workflowService: service,
            eveSessionClient,
            logger: { warn() {} }
        });
        const summary = await reconciler.runOnce();

        expect(summary.errors).toHaveLength(1);
        expect(summary.errors[0]).toMatchObject({ run_id: dispatchRunId });
        expect(repository.getRun(dispatchRunId).status).toBe('running');
    });

    it('skips entirely when the eve session client is not configured', async () => {
        const { service } = makeService({ eveSessionClient: null });
        const reconciler = new EveMeetingNoteReconciler({
            workflowService: service,
            eveSessionClient: { isConfigured: () => false }
        });
        const summary = await reconciler.runOnce();
        expect(summary).toMatchObject({ configured: false, checked: 0 });
    });

    it('does not pick up non-eve or already finished runs', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({
            service, repository, actor, eveSessionClient
        });
        repository.updateRun(dispatchRunId, { status: 'success' });

        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        expect(reconciler.listPendingDispatchRuns()).toHaveLength(0);
        const summary = await reconciler.runOnce();
        expect(summary).toMatchObject({ checked: 0 });
        expect(noteDraftOutput(repository, ingestRunId).payload.generation_status).toBe('brainbase_source_ready');
    });

    it('startScheduledReconcile honors enabled/configured guards', () => {
        const eveSessionClient = makeEveSessionClient();
        const { service } = makeService({ eveSessionClient });
        const disabled = new EveMeetingNoteReconciler({
            workflowService: service,
            eveSessionClient,
            config: { enabled: false }
        });
        expect(disabled.startScheduledReconcile()).toEqual({ started: false, reason: 'disabled' });

        const unconfigured = new EveMeetingNoteReconciler({
            workflowService: service,
            eveSessionClient: { isConfigured: () => false }
        });
        expect(unconfigured.startScheduledReconcile()).toEqual({ started: false, reason: 'eve_not_configured' });

        const running = new EveMeetingNoteReconciler({
            workflowService: service,
            eveSessionClient,
            config: { interval_ms: 60000 }
        });
        expect(running.startScheduledReconcile()).toEqual({ started: true, interval_ms: 60000 });
        expect(running.startScheduledReconcile()).toEqual({ started: false, reason: 'already_started' });
        expect(running.stopScheduledReconcile()).toEqual({ stopped: true });
        expect(running.stopScheduledReconcile()).toEqual({ stopped: false, reason: 'not_started' });
    });
});

describe('POST /api/workflows/control/meeting-pack/eve-note-reconcile', () => {
    function makeRouteApp({ eveMeetingNoteReconciler = null, service }) {
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.auth = { sub: 'sato', role: 'admin' };
            req.access = { personId: 'sato', projectCodes: ['salestailor'], role: 'admin' };
            req.authSource = 'test';
            next();
        });
        app.use('/api/workflows', createWorkflowRouter(service, { eveMeetingNoteReconciler }));
        app.use((err, _req, res, _next) => {
            res.status(err.statusCode || 500).json({ error: err.message });
        });
        return app;
    }

    it('runs the reconciler once and returns the summary', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId } = await dispatchMeetingNoteRun({ service, repository, actor, eveSessionClient });
        eveSessionClient.readSessionStream = async () => [
            noteToolCallEvent({ runId: ingestRunId }),
            ...PARKED_TAIL
        ];
        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        const app = makeRouteApp({ eveMeetingNoteReconciler: reconciler, service });

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/eve-note-reconcile')
            .expect(200);

        expect(res.body).toMatchObject({ checked: 1, recorded: 1 });
        expect(noteDraftOutput(repository, ingestRunId).payload.generation_status).toBe('brainbase_generated');
    });

    it('rejects non-global-operator actors with 403', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { service } = makeService({ eveSessionClient });
        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.auth = { sub: 'member-user', role: 'member' };
            req.access = { personId: 'member-user', projectCodes: ['salestailor'], role: 'member' };
            req.authSource = 'session';
            next();
        });
        app.use('/api/workflows', createWorkflowRouter(service, { eveMeetingNoteReconciler: reconciler }));

        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/eve-note-reconcile')
            .expect(403);
        expect(res.body).toEqual({ error: 'eve_note_reconcile_requires_global_operator' });
    });

    it('returns 503 when the reconciler is not wired', async () => {
        const { service } = makeService({});
        const app = makeRouteApp({ service });
        const res = await request(app)
            .post('/api/workflows/control/meeting-pack/eve-note-reconcile')
            .expect(503);
        expect(res.body).toEqual({ error: 'eve_note_reconciler_unavailable' });
    });
});

describe('createEveMeetingNoteReconcilerConfigFromEnv', () => {
    it('defaults to enabled and reads interval/immediate overrides', () => {
        expect(createEveMeetingNoteReconcilerConfigFromEnv({})).toEqual({
            enabled: true,
            interval_ms: undefined,
            immediate: false
        });
        expect(createEveMeetingNoteReconcilerConfigFromEnv({
            BRAINBASE_EVE_NOTE_RECONCILER_ENABLED: '0',
            BRAINBASE_EVE_NOTE_RECONCILER_INTERVAL_MS: '60000',
            BRAINBASE_EVE_NOTE_RECONCILER_IMMEDIATE: '1'
        })).toEqual({
            enabled: false,
            interval_ms: '60000',
            immediate: true
        });
    });
});
