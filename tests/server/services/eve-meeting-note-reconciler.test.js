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
    extractMeetingCandidatesToolCalls,
    extractMeetingNoteToolCalls
} from '../../../server/services/external-runner/eve-meeting-note-reconciler.js';

const SOURCE_TEXT_HASH = 'hash-reconciler-note-001';

function makeInfoSSOTPeopleService(records = []) {
    return {
        async listGraphEntities(_access, options = {}) {
            const query = String(options.query || '').trim().replace(/^@+/, '').toLowerCase();
            return records.filter((record) => {
                const payload = record.payload || {};
                const values = [
                    record.id,
                    payload.name,
                    payload.display_name,
                    ...(Array.isArray(payload.aliases) ? payload.aliases : [])
                ].filter(Boolean).map((value) => String(value).toLowerCase());
                return !query || values.some((value) => value.includes(query));
            });
        }
    };
}

function makeService({
    eveSessionClient = null,
    infoSSOTService = null,
    repository = new InMemoryWorkflowRepository()
} = {}) {
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
        infoSSOTService
    });
    const actor = {
        sub: 'keigo',
        person_id: 'keigo',
        role: 'admin',
        projectCodes: ['salestailor']
    };
    return { repository, service, actor };
}

class CandidateOutputFailureRepository extends InMemoryWorkflowRepository {
    constructor() {
        super();
        this.failCandidateOutputKey = null;
    }

    updateOutput(outputId, patch) {
        const output = this.getOutput(outputId);
        if (this.failCandidateOutputKey === output?.metadata?.output_key) {
            this.failCandidateOutputKey = null;
            throw new Error(`injected ${output.metadata.output_key} update failure`);
        }
        return super.updateOutput(outputId, patch);
    }
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
    packageId = 'meeting-review-package-reconciler-test',
    taskCandidates = ['タスク候補'],
    decisionCandidates = ['意思決定候補']
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
        task_candidates: taskCandidates,
        decision_candidates: decisionCandidates,
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

function candidatesToolCallEvent({
    runId,
    orgId = 'salestailor',
    projectId = 'salestailor',
    sourceTextHash = SOURCE_TEXT_HASH,
    taskCandidates = [{ title: '請求書を送付する', owner_hint: '佐藤さん', source_excerpt: 'Speaker 1: 請求書を送ります。' }],
    decisionCandidates = [{ title: 'PMSはSTAYEで進める', decision_type: 'meeting_decision' }],
    followUpDraft = { body: '本日はありがとうございました。次アクションをまとめました。' },
    callId = 'call_candidates_001'
}) {
    return {
        type: 'actions.requested',
        data: {
            actions: [{
                kind: 'tool-call',
                callId,
                toolName: 'record_meeting_candidates',
                input: {
                    org_id: orgId,
                    project_id: projectId,
                    run_id: runId,
                    source_text_hash: sourceTextHash,
                    task_candidates: taskCandidates,
                    decision_candidates: decisionCandidates,
                    follow_up_draft: followUpDraft
                }
            }],
            sequence: 20,
            stepIndex: 2,
            turnId: 'turn-1'
        }
    };
}

function outputByKey(repository, ingestRunId, outputKey) {
    return repository.listOutputs(ingestRunId)
        .find((output) => output.metadata?.output_key === outputKey);
}

const PARKED_TAIL = [
    { type: 'turn.completed', data: { sequence: 90, turnId: 'turn-1' } },
    { type: 'session.waiting', data: { wait: 'next-user-message' } }
];

async function dispatchMeetingNoteRun({ service, repository, actor, eveSessionClient }) {
    await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
    const ingest = await service.ingestMeetingReviewPackage({
        review_package: sampleMeetingReviewPackage({
            taskCandidates: [],
            decisionCandidates: []
        })
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

describe('extractMeetingCandidatesToolCalls', () => {
    it('collects only record_meeting_candidates tool-call inputs, ignoring note calls', () => {
        const events = [
            noteToolCallEvent({ runId: 'run-1' }),
            candidatesToolCallEvent({ runId: 'run-1' }),
            { type: 'actions.requested', data: { actions: [{ kind: 'tool-call', callId: 'c9', toolName: 'todo', input: {} }] } }
        ];
        const calls = extractMeetingCandidatesToolCalls(events);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            call_id: 'call_candidates_001',
            input: expect.objectContaining({ run_id: 'run-1', source_text_hash: SOURCE_TEXT_HASH })
        });
        expect(calls[0].input.task_candidates[0].title).toBe('請求書を送付する');
    });

    it('ignores malformed events without throwing', () => {
        expect(extractMeetingCandidatesToolCalls(null)).toEqual([]);
        expect(extractMeetingCandidatesToolCalls([{ type: 'actions.requested', data: { actions: [{ kind: 'tool-call', toolName: 'record_meeting_candidates' }] } }])).toEqual([]);
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
            return PARKED_TAIL;
        };

        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        const summary = await reconciler.runOnce();

        expect(summary).toMatchObject({ checked: 1, already_recorded: 1, recorded: 0 });
        expect(streamRead).toBe(true);
        expect(repository.getRun(dispatchRunId)).toMatchObject({
            status: 'success',
            metadata: {
                eve_note_reconciler: {
                    candidates: { status: 'no_candidate_call', mismatched_candidate_calls: 0 }
                }
            }
        });
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

    it('preserves stream failure diagnostics when the recovery poll closes the run', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({
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
        expect(repository.getRun(dispatchRunId)).toMatchObject({
            status: 'running',
            message: expect.stringContaining('retrying automatically'),
            metadata: {
                eve_note_reconciler: {
                    status: 'retrying',
                    reason: 'session_stream_read_failed',
                    last_poll_error: 'Eve session stream failed with HTTP 502',
                    poll_failure_count: 1
                }
            }
        });
        expect(repository.listAuditLogs({ targetId: dispatchRunId, limit: 100 })
            .map((entry) => entry.action))
            .toContain('workflow.meeting_pack.eve_session_stream.read_failed');

        eveSessionClient.readSessionStream = async () => [
            noteToolCallEvent({ runId: ingestRunId }),
            ...PARKED_TAIL
        ];
        const recovered = await reconciler.runOnce();

        expect(recovered).toMatchObject({ checked: 1, recorded: 1, errors: [] });
        expect(repository.getRun(dispatchRunId)).toMatchObject({
            status: 'success',
            metadata: {
                eve_note_reconciler: {
                    reason: 'note_reconciled',
                    last_poll_error: 'Eve session stream failed with HTTP 502',
                    poll_failure_count: 1,
                    last_poll_recovered_at: expect.any(String)
                }
            }
        });
        expect(repository.listAuditLogs({ targetId: dispatchRunId, limit: 100 })
            .map((entry) => entry.action))
            .toContain('workflow.meeting_pack.eve_session_stream.recovered');
    });

    it('classifies a transient note write failure separately from stream polling', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({
            service, repository, actor, eveSessionClient
        });
        eveSessionClient.readSessionStream = async () => [
            noteToolCallEvent({ runId: ingestRunId }),
            ...PARKED_TAIL
        ];
        const recordMeetingNoteGeneration = service.recordMeetingNoteGeneration.bind(service);
        let shouldFail = true;
        service.recordMeetingNoteGeneration = async (...args) => {
            if (shouldFail) {
                shouldFail = false;
                throw new Error('meeting note database unavailable');
            }
            return recordMeetingNoteGeneration(...args);
        };

        const reconciler = new EveMeetingNoteReconciler({
            workflowService: service,
            eveSessionClient,
            logger: { warn() {} }
        });
        const failed = await reconciler.runOnce();

        expect(failed.errors).toHaveLength(1);
        expect(repository.getRun(dispatchRunId)).toMatchObject({
            status: 'running',
            metadata: {
                eve_note_reconciler: {
                    status: 'retrying',
                    reason: 'reconcile_runtime_failed',
                    last_runtime_error: 'meeting note database unavailable',
                    runtime_failure_count: 1
                }
            }
        });
        expect(repository.getRun(dispatchRunId).metadata.eve_note_reconciler).not.toHaveProperty('last_poll_error');
        const failedActions = repository.listAuditLogs({ targetId: dispatchRunId, limit: 100 })
            .map((entry) => entry.action);
        expect(failedActions).toContain('workflow.meeting_pack.eve_reconcile.failed');
        expect(failedActions).not.toContain('workflow.meeting_pack.eve_session_stream.read_failed');

        const recovered = await reconciler.runOnce();

        expect(recovered).toMatchObject({ checked: 1, recorded: 1, errors: [] });
        expect(repository.getRun(dispatchRunId)).toMatchObject({
            status: 'success',
            metadata: {
                eve_note_reconciler: {
                    reason: 'note_reconciled',
                    last_runtime_error: 'meeting note database unavailable',
                    runtime_failure_count: 1,
                    last_runtime_recovered_at: expect.any(String)
                }
            }
        });
        const recoveredActions = repository.listAuditLogs({ targetId: dispatchRunId, limit: 100 })
            .map((entry) => entry.action);
        expect(recoveredActions).toContain('workflow.meeting_pack.eve_reconcile.recovered');
        expect(recoveredActions).not.toContain('workflow.meeting_pack.eve_session_stream.recovered');
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

describe('WorkflowService.recordMeetingCandidates', () => {
    it('normalizes and writes Eve candidates onto the sibling outputs when the hash matches', async () => {
        const infoSSOTService = makeInfoSSOTPeopleService([{
            id: 'person-sato',
            payload: {
                name: '佐藤圭吾',
                display_name: '佐藤圭吾',
                aliases: ['佐藤さん'],
                project_codes: ['salestailor']
            }
        }]);
        const { repository, service, actor } = makeService({ infoSSOTService });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const ingest = await service.ingestMeetingReviewPackage({ review_package: sampleMeetingReviewPackage() }, actor);
        const ingestRunId = ingest.meeting_review_ingest.run.id;

        const result = await service.recordMeetingCandidates({
            org_id: 'salestailor',
            project_id: 'salestailor',
            run_id: ingestRunId,
            source_text_hash: SOURCE_TEXT_HASH,
            task_candidates: [
                { title: '請求書を送付する', owner_hint: '佐藤さん', due_hint: '2026-07-15', source_excerpt: '請求書を送ります' }
            ],
            decision_candidates: [{ title: 'PMSはSTAYEで進める' }],
            follow_up_draft: { body: '本日はありがとうございました。', external_send_required_approval: false },
            runner: { type: 'eve', session_id: 'sess-cand-1' }
        }, actor);

        expect(result.meeting_candidates.run_id).toBe(ingestRunId);

        const taskOutput = outputByKey(repository, ingestRunId, 'task_candidates');
        expect(Array.isArray(taskOutput.payload)).toBe(true);
        expect(taskOutput.payload).toHaveLength(1);
        expect(taskOutput.payload[0]).toMatchObject({
            title: '請求書を送付する',
            status: 'candidate',
            source: 'eve_meeting_agent',
            owner_hint: '佐藤さん',
            selected_owner_id: 'person-sato',
            selected_owner: '佐藤圭吾',
            due_hint: '2026-07-15',
            case_scope: 'reconciler-test',
            evidence_refs: ['transcript:00:01:00-00:02:00']
        });
        expect(taskOutput.payload[0].owner_candidates[0]).toMatchObject({
            person_id: 'person-sato',
            display_name: '佐藤圭吾'
        });
        expect(taskOutput.payload[0].owner_resolution).toMatchObject({ status: 'resolved' });
        expect(typeof taskOutput.payload[0].id).toBe('string');
        expect(taskOutput.payload[0].id.startsWith('task_candidate_')).toBe(true);

        const decisionOutput = outputByKey(repository, ingestRunId, 'decision_candidates');
        expect(decisionOutput.payload[0]).toMatchObject({
            title: 'PMSはSTAYEで進める',
            status: 'candidate',
            source: 'eve_meeting_agent',
            decision_type: 'meeting_decision'
        });

        const followUpOutput = outputByKey(repository, ingestRunId, 'follow_up_draft');
        // The external-send approval flag is forced true regardless of model input.
        expect(followUpOutput.payload).toMatchObject({
            status: 'draft_only',
            external_send_required_approval: true,
            body: '本日はありがとうございました。'
        });

        const audit = repository.listAuditLogs({ targetId: ingestRunId, limit: 100 })
            .find((entry) => entry.action === 'workflow.meeting_pack.candidates.recorded');
        expect(audit).toBeTruthy();
        expect(audit.after).toMatchObject({
            task_candidate_count: 1,
            decision_candidate_count: 1,
            follow_up_recorded: true,
            runner_type: 'eve'
        });
    });

    it('rejects candidates whose source_text_hash does not match the meeting_note_draft output', async () => {
        const { repository, service, actor } = makeService();
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const ingest = await service.ingestMeetingReviewPackage({ review_package: sampleMeetingReviewPackage() }, actor);
        const ingestRunId = ingest.meeting_review_ingest.run.id;

        await expect(service.recordMeetingCandidates({
            org_id: 'salestailor',
            project_id: 'salestailor',
            run_id: ingestRunId,
            source_text_hash: 'tampered-hash',
            task_candidates: [{ title: 'x' }]
        }, actor)).rejects.toMatchObject({ details: { state_transition: 'blocked_source_hash_mismatch' } });

        // The pre-existing candidate outputs are left untouched on rejection.
        const taskOutput = outputByKey(repository, ingestRunId, 'task_candidates');
        expect(taskOutput.payload).toEqual(['タスク候補']);
    });

    it('rejects malformed candidate payloads before changing any output or audit history', async () => {
        const { repository, service, actor } = makeService();
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const ingest = await service.ingestMeetingReviewPackage({ review_package: sampleMeetingReviewPackage() }, actor);
        const ingestRunId = ingest.meeting_review_ingest.run.id;
        const outputKeys = ['task_candidates', 'decision_candidates', 'follow_up_draft'];
        const beforeOutputs = Object.fromEntries(outputKeys.map((key) => [
            key,
            outputByKey(repository, ingestRunId, key)
        ]));
        const beforeAudit = repository.listAuditLogs({ targetId: ingestRunId, limit: 100 });

        const invalidCandidateInputs = [
            {
                task_candidates: [{ title: '既存候補を消してはいけない' }],
                decision_candidates: 'not-an-array',
                follow_up_draft: { body: '送信しない' }
            },
            {
                task_candidates: [{ title: '   ' }],
                decision_candidates: [],
                follow_up_draft: { body: '送信しない' }
            },
            {
                task_candidates: Array.from({ length: 6 }, (_, index) => ({ title: `候補${index + 1}` })),
                decision_candidates: [],
                follow_up_draft: { body: '送信しない' }
            },
            {
                task_candidates: [{ title: 'x'.repeat(501) }],
                decision_candidates: [],
                follow_up_draft: { body: '送信しない' }
            },
            {
                task_candidates: [{ title: '候補', owner_hint: 'x'.repeat(201) }],
                decision_candidates: [],
                follow_up_draft: { body: '送信しない' }
            },
            {
                task_candidates: [{ title: '候補', due_hint: 'x'.repeat(201) }],
                decision_candidates: [],
                follow_up_draft: { body: '送信しない' }
            },
            {
                task_candidates: [{ title: '候補', source_excerpt: 'x'.repeat(2_001) }],
                decision_candidates: [],
                follow_up_draft: { body: '送信しない' }
            },
            {
                task_candidates: [],
                decision_candidates: [{ title: '決定', decision_type: 'x'.repeat(101) }],
                follow_up_draft: { body: '送信しない' }
            },
            {
                task_candidates: [],
                decision_candidates: [],
                follow_up_draft: { body: 'x'.repeat(10_001) }
            }
        ];

        for (const invalidCandidateInput of invalidCandidateInputs) {
            await expect(service.recordMeetingCandidates({
                org_id: 'salestailor',
                project_id: 'salestailor',
                run_id: ingestRunId,
                source_text_hash: SOURCE_TEXT_HASH,
                ...invalidCandidateInput
            }, actor)).rejects.toMatchObject({ details: { state_transition: 'blocked_invalid_candidates' } });
        }

        for (const outputKey of outputKeys) {
            expect(outputByKey(repository, ingestRunId, outputKey)).toEqual(beforeOutputs[outputKey]);
        }
        expect(repository.listAuditLogs({ targetId: ingestRunId, limit: 100 })).toEqual(beforeAudit);
    });

    it('rolls back all candidate outputs and audit history when a mid-write update fails', async () => {
        const repository = new CandidateOutputFailureRepository();
        const { service, actor } = makeService({ repository });
        await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
        const ingest = await service.ingestMeetingReviewPackage({ review_package: sampleMeetingReviewPackage() }, actor);
        const ingestRunId = ingest.meeting_review_ingest.run.id;
        const outputKeys = ['task_candidates', 'decision_candidates', 'follow_up_draft'];
        const beforeOutputs = Object.fromEntries(outputKeys.map((key) => [
            key,
            outputByKey(repository, ingestRunId, key)
        ]));
        const beforeAudit = repository.listAuditLogs({ targetId: ingestRunId, limit: 100 });
        repository.failCandidateOutputKey = 'decision_candidates';

        await expect(service.recordMeetingCandidates({
            org_id: 'salestailor',
            project_id: 'salestailor',
            run_id: ingestRunId,
            source_text_hash: SOURCE_TEXT_HASH,
            task_candidates: [{ title: '更新されないタスク候補' }],
            decision_candidates: [{ title: '失敗する意思決定候補' }],
            follow_up_draft: { body: '更新されないフォローアップ' }
        }, actor)).rejects.toThrow('injected decision_candidates update failure');

        for (const outputKey of outputKeys) {
            expect(outputByKey(repository, ingestRunId, outputKey)).toEqual(beforeOutputs[outputKey]);
        }
        const afterAudit = repository.listAuditLogs({ targetId: ingestRunId, limit: 100 });
        expect(afterAudit).toEqual(beforeAudit);
        expect(afterAudit.some((entry) => entry.action === 'workflow.meeting_pack.candidates.recorded')).toBe(false);
    });
});

describe('EveMeetingNoteReconciler candidate write-back', () => {
    it('records LLM candidates from the same session after the note and closes on the note', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({ service, repository, actor, eveSessionClient });
        eveSessionClient.readSessionStream = async () => [
            noteToolCallEvent({ runId: ingestRunId }),
            candidatesToolCallEvent({ runId: ingestRunId }),
            ...PARKED_TAIL
        ];

        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        const summary = await reconciler.runOnce();
        expect(summary).toMatchObject({ checked: 1, recorded: 1, errors: [] });

        expect(outputByKey(repository, ingestRunId, 'meeting_note_draft').payload.generation_status).toBe('brainbase_generated');
        const taskOutput = outputByKey(repository, ingestRunId, 'task_candidates');
        expect(taskOutput.payload[0]).toMatchObject({ title: '請求書を送付する', source: 'eve_meeting_agent' });
        const followUp = outputByKey(repository, ingestRunId, 'follow_up_draft');
        expect(followUp.payload).toMatchObject({ status: 'draft_only', external_send_required_approval: true });
        expect(repository.getRun(dispatchRunId).status).toBe('success');

        const candidatesAudit = repository.listAuditLogs({ targetId: ingestRunId, limit: 100 })
            .some((entry) => entry.action === 'workflow.meeting_pack.candidates.recorded');
        expect(candidatesAudit).toBe(true);
    });

    it('keeps an Eve candidate unassigned when People SSOT has multiple matching owners', async () => {
        const eveSessionClient = makeEveSessionClient();
        const infoSSOTService = makeInfoSSOTPeopleService([
            {
                id: 'person-sato-keigo',
                payload: {
                    name: '佐藤圭吾',
                    display_name: '佐藤圭吾',
                    aliases: ['佐藤さん'],
                    project_codes: ['salestailor']
                }
            },
            {
                id: 'person-sato-taro',
                payload: {
                    name: '佐藤太郎',
                    display_name: '佐藤太郎',
                    aliases: ['佐藤さん'],
                    project_codes: ['salestailor']
                }
            }
        ]);
        const { repository, service, actor } = makeService({ eveSessionClient, infoSSOTService });
        const { ingestRunId } = await dispatchMeetingNoteRun({ service, repository, actor, eveSessionClient });
        eveSessionClient.readSessionStream = async () => [
            noteToolCallEvent({ runId: ingestRunId }),
            candidatesToolCallEvent({ runId: ingestRunId }),
            ...PARKED_TAIL
        ];

        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        const summary = await reconciler.runOnce();

        expect(summary).toMatchObject({ checked: 1, recorded: 1, errors: [] });
        const candidate = outputByKey(repository, ingestRunId, 'task_candidates').payload[0];
        expect(candidate.selected_owner_id).toBeUndefined();
        expect(candidate.selected_owner).toBeUndefined();
        expect(candidate.owner_candidates).toHaveLength(2);
        expect(candidate.owner_resolution).toMatchObject({
            status: 'ambiguous',
            reason: 'ambiguous_people_ssot_candidate'
        });
    });

    it('closes on the note even when no candidate tool-call is present (candidates are best-effort)', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({ service, repository, actor, eveSessionClient });
        eveSessionClient.readSessionStream = async () => [
            noteToolCallEvent({ runId: ingestRunId }),
            ...PARKED_TAIL
        ];

        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        const summary = await reconciler.runOnce();
        expect(summary).toMatchObject({ checked: 1, recorded: 1, errors: [] });
        expect(repository.getRun(dispatchRunId)).toMatchObject({
            status: 'success',
            metadata: {
                eve_note_reconciler: {
                    candidates: { status: 'no_candidate_call', mismatched_candidate_calls: 0 }
                }
            }
        });
        // The real awaiting-Eve placeholder stays empty; note still reconciles.
        expect(outputByKey(repository, ingestRunId, 'task_candidates').payload).toEqual([]);
    });

    it('does not block the dispatch run when a candidate write-back is rejected (hash mismatch)', async () => {
        const eveSessionClient = makeEveSessionClient();
        const warnings = [];
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({ service, repository, actor, eveSessionClient });
        eveSessionClient.readSessionStream = async () => [
            noteToolCallEvent({ runId: ingestRunId }),
            candidatesToolCallEvent({ runId: ingestRunId, sourceTextHash: 'tampered-candidate-hash' }),
            ...PARKED_TAIL
        ];

        const reconciler = new EveMeetingNoteReconciler({
            workflowService: service,
            eveSessionClient,
            logger: { warn: (message) => warnings.push(message) }
        });
        const summary = await reconciler.runOnce();
        // The mismatched candidate call does not match on hash, so it is skipped
        // entirely (no_candidate_call); the note still records and the run closes.
        expect(summary).toMatchObject({ checked: 1, recorded: 1, blocked: 0, errors: [] });
        expect(repository.getRun(dispatchRunId)).toMatchObject({
            status: 'success',
            metadata: {
                eve_note_reconciler: {
                    candidates: { status: 'no_candidate_call', mismatched_candidate_calls: 1 }
                }
            }
        });
        expect(outputByKey(repository, ingestRunId, 'task_candidates').payload).toEqual([]);
    });

    it('rejects candidate calls outside the exact org, project, and run scope', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({ service, repository, actor, eveSessionClient });
        eveSessionClient.readSessionStream = async () => [
            noteToolCallEvent({ runId: ingestRunId }),
            candidatesToolCallEvent({ runId: undefined, callId: 'call_missing_run' }),
            candidatesToolCallEvent({ runId: 'other-run', callId: 'call_other_run' }),
            candidatesToolCallEvent({ runId: ingestRunId, orgId: 'other-org', callId: 'call_other_org' }),
            candidatesToolCallEvent({ runId: ingestRunId, projectId: 'other-project', callId: 'call_other_project' }),
            ...PARKED_TAIL
        ];

        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        const summary = await reconciler.runOnce();

        expect(summary).toMatchObject({ checked: 1, recorded: 1, blocked: 0, errors: [] });
        expect(repository.getRun(dispatchRunId)).toMatchObject({
            status: 'success',
            metadata: {
                eve_note_reconciler: {
                    candidates: { status: 'no_candidate_call', mismatched_candidate_calls: 4 }
                }
            }
        });
        expect(outputByKey(repository, ingestRunId, 'task_candidates').payload).toEqual([]);
    });

    it('preserves the excluded candidate count when a matching call is also recorded', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({ service, repository, actor, eveSessionClient });
        eveSessionClient.readSessionStream = async () => [
            noteToolCallEvent({ runId: ingestRunId }),
            candidatesToolCallEvent({ runId: ingestRunId, sourceTextHash: 'other-hash', callId: 'call_mismatch' }),
            candidatesToolCallEvent({ runId: ingestRunId, callId: 'call_match' }),
            ...PARKED_TAIL
        ];

        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        const summary = await reconciler.runOnce();

        expect(summary).toMatchObject({ checked: 1, recorded: 1, blocked: 0, errors: [] });
        expect(repository.getRun(dispatchRunId)).toMatchObject({
            status: 'success',
            metadata: {
                eve_note_reconciler: {
                    candidates: {
                        status: 'recorded',
                        call_id: 'call_match',
                        mismatched_candidate_calls: 1
                    }
                }
            }
        });
        expect(outputByKey(repository, ingestRunId, 'task_candidates').payload[0]).toMatchObject({
            title: '請求書を送付する'
        });
    });

    it('blocks for operator recovery when a matching candidate write-back throws', async () => {
        const eveSessionClient = makeEveSessionClient();
        const warnings = [];
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({ service, repository, actor, eveSessionClient });
        eveSessionClient.readSessionStream = async () => [
            noteToolCallEvent({ runId: ingestRunId }),
            candidatesToolCallEvent({ runId: ingestRunId }),
            ...PARKED_TAIL
        ];
        service.recordMeetingCandidates = async () => {
            throw new Error('candidate database unavailable');
        };

        const reconciler = new EveMeetingNoteReconciler({
            workflowService: service,
            eveSessionClient,
            logger: { warn: (message) => warnings.push(message) }
        });
        const summary = await reconciler.runOnce();

        expect(summary).toMatchObject({ checked: 1, recorded: 0, blocked: 1, errors: [] });
        expect(noteDraftOutput(repository, ingestRunId).payload.generation_status).toBe('brainbase_generated');
        expect(repository.getRun(dispatchRunId)).toMatchObject({
            status: 'blocked',
            closure_state: 'open',
            human_waiting: true,
            action_required: 'operator_review_eve_candidates',
            metadata: {
                eve_note_reconciler: {
                    reason: 'candidate_writeback_failed',
                    candidates: {
                        status: 'failed',
                        error: 'candidate database unavailable'
                    }
                }
            }
        });
        expect(warnings).toHaveLength(1);
        const blockedAudit = repository.listAuditLogs({ targetId: dispatchRunId, limit: 100 })
            .find((entry) => entry.action === 'workflow.meeting_pack.candidates.reconcile_blocked');
        expect(blockedAudit).toBeTruthy();
    });

    it('recovers candidates when the meeting note was already recorded before reconciliation', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({ service, repository, actor, eveSessionClient });
        await service.recordMeetingNoteGeneration({
            org_id: 'salestailor',
            project_id: 'salestailor',
            run_id: ingestRunId,
            source_text_hash: SOURCE_TEXT_HASH,
            note: { title: '先に保存済み', body: '議事録本文' },
            runner: { type: 'eve', session_id: 'sess-cand-1' }
        }, actor);
        eveSessionClient.readSessionStream = async () => [
            candidatesToolCallEvent({ runId: ingestRunId }),
            ...PARKED_TAIL
        ];

        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        const summary = await reconciler.runOnce();

        expect(summary).toMatchObject({ checked: 1, already_recorded: 1, errors: [] });
        expect(outputByKey(repository, ingestRunId, 'task_candidates').payload[0]).toMatchObject({
            title: '請求書を送付する',
            source: 'eve_meeting_agent'
        });
        expect(repository.getRun(dispatchRunId)).toMatchObject({
            status: 'success',
            metadata: {
                eve_note_reconciler: {
                    reason: 'already_recorded',
                    candidates: { status: 'recorded' }
                }
            }
        });
    });

    it('keeps polling when the note arrives before candidates in an active session', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({ service, repository, actor, eveSessionClient });
        let readCount = 0;
        eveSessionClient.readSessionStream = async () => {
            readCount += 1;
            if (readCount === 1) {
                return [noteToolCallEvent({ runId: ingestRunId }), { type: 'turn.started' }];
            }
            return [
                noteToolCallEvent({ runId: ingestRunId }),
                candidatesToolCallEvent({ runId: ingestRunId }),
                ...PARKED_TAIL
            ];
        };

        const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });
        const first = await reconciler.runOnce();
        expect(first).toMatchObject({ checked: 1, pending: 1, recorded: 0, errors: [] });
        expect(repository.getRun(dispatchRunId)).toMatchObject({
            status: 'running',
            metadata: {
                eve_note_reconciler: {
                    reason: 'awaiting_candidates_after_note',
                    candidates: { status: 'no_candidate_call' }
                }
            }
        });
        expect(noteDraftOutput(repository, ingestRunId).payload.generation_status).toBe('brainbase_generated');

        const second = await reconciler.runOnce();
        expect(second).toMatchObject({ checked: 1, already_recorded: 1, errors: [] });
        expect(repository.getRun(dispatchRunId)).toMatchObject({
            status: 'success',
            metadata: { eve_note_reconciler: { candidates: { status: 'recorded' } } }
        });
        expect(outputByKey(repository, ingestRunId, 'task_candidates').payload[0]).toMatchObject({
            title: '請求書を送付する',
            source: 'eve_meeting_agent'
        });
    });

    it('FM-002 workflow_state_regression retries candidate write-back while the Eve session is active', async () => {
        const eveSessionClient = makeEveSessionClient();
        const { repository, service, actor } = makeService({ eveSessionClient });
        const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({ service, repository, actor, eveSessionClient });
        eveSessionClient.readSessionStream = async () => [
            noteToolCallEvent({ runId: ingestRunId }),
            candidatesToolCallEvent({ runId: ingestRunId }),
            { type: 'turn.started' }
        ];
        const recordMeetingCandidates = service.recordMeetingCandidates.bind(service);
        let writeAttempts = 0;
        service.recordMeetingCandidates = async (...args) => {
            writeAttempts += 1;
            if (writeAttempts === 1) {
                throw new Error('candidate database temporarily unavailable');
            }
            return recordMeetingCandidates(...args);
        };

        const reconciler = new EveMeetingNoteReconciler({
            workflowService: service,
            eveSessionClient,
            logger: { warn: () => {} }
        });
        const first = await reconciler.runOnce();

        expect(first).toMatchObject({ checked: 1, pending: 1, recorded: 0, blocked: 0, errors: [] });
        expect(repository.getRun(dispatchRunId)).toMatchObject({
            status: 'running',
            closure_state: 'open',
            metadata: {
                eve_note_reconciler: {
                    reason: 'awaiting_candidates_after_note',
                    candidates: {
                        status: 'failed',
                        error: 'candidate database temporarily unavailable'
                    }
                }
            }
        });
        expect(noteDraftOutput(repository, ingestRunId).payload.generation_status).toBe('brainbase_generated');

        const second = await reconciler.runOnce();

        expect(writeAttempts).toBe(2);
        expect(second).toMatchObject({ checked: 1, already_recorded: 1, blocked: 0, errors: [] });
        expect(repository.getRun(dispatchRunId)).toMatchObject({
            status: 'success',
            metadata: { eve_note_reconciler: { candidates: { status: 'recorded' } } }
        });
        expect(outputByKey(repository, ingestRunId, 'task_candidates').payload[0]).toMatchObject({
            title: '請求書を送付する',
            source: 'eve_meeting_agent'
        });
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
