import { test, expect } from '@playwright/test';
import express from 'express';
import request from 'supertest';

import { createWorkflowRouter } from '../../server/routes/workflows.js';
import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import {
  WorkflowService,
  createDefaultWorkflowHandlers
} from '../../server/services/workflow/workflow-service.js';
import { meetingPackIds } from '../../server/services/workflow/meeting-workflow-pack.js';
import {
  EveMeetingNoteReconciler
} from '../../server/services/external-runner/eve-meeting-note-reconciler.js';

const storyId = 'story-eve-meeting-note-pull-reconciler';
const SOURCE_TEXT_HASH = 'hash-contract-reconciler-001';

function makeEveSessionClient() {
  const state: { stream: any[] } = { stream: [] };
  return {
    state,
    isConfigured() {
      return true;
    },
    async createSession() {
      return {
        session_id: 'wrun_contract_reconciler_001',
        continuation_token: 'cont-contract-1',
        response: { ok: true }
      };
    },
    async readSessionStream() {
      return state.stream;
    }
  };
}

function makeService({ eveSessionClient }: { eveSessionClient: any }) {
  const repository = new InMemoryWorkflowRepository();
  const runner = new WorkflowRunner({ repository, handlers: createDefaultWorkflowHandlers() });
  const configParser = {
    async getProjects() {
      return {
        root: '/workspace',
        projects: [{ id: 'sample-project', session_select: true }]
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
  const actor = { sub: 'keigo', person_id: 'keigo', role: 'admin', projectCodes: ['sample-project'] };
  return { repository, service, actor };
}

function sampleMeetingReviewPackage() {
  const orgId = 'sample-project';
  const projectId = 'sample-project';
  return {
    schema_version: '0.1.0',
    package_id: 'meeting-review-package-reconciler-contract',
    status: 'review_required',
    meeting_identity: {
      source: 'google_calendar',
      account: 'info@example.com',
      calendar_id: 'primary',
      event_id: 'evt-contract-1',
      title: '定例会議',
      start: '2026-07-10T13:00:00+09:00',
      end: '2026-07-10T14:00:00+09:00',
      candidate_org_id: orgId,
      candidate_project_id: projectId,
      case_scope: 'reconciler-contract',
      graph_context: { org_entity_ids: ['org-1'], person_entity_ids: ['person-1'] }
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
    task_candidates: [],
    decision_candidates: [],
    follow_up_draft: { status: 'draft_only', external_send_required_approval: true, body: 'ありがとうございました。' },
    promotion_candidates: { graph: [], learning: [] },
    evidence_refs: ['transcript:00:01:00-00:02:00'],
    stop_conditions: ['external_send_requires_human_approval']
  };
}

async function dispatchMeetingNoteRun({ service, actor }: { service: any; actor: any }) {
  await service.meetingAutomationService.bootstrapPack({ org_id: 'sample-project', project_id: 'sample-project' }, actor);
  const ingest = await service.meetingAutomationService.ingestReviewPackage({ review_package: sampleMeetingReviewPackage() }, actor);
  const ingestRunId = ingest.meeting_review_ingest.run.id;
  const loopIntentId = meetingPackIds({
    orgId: 'sample-project',
    projectId: 'sample-project',
    definitionId: 'transcript-to-meeting-note'
  }).loopIntentId;
  const dispatched = await service.dispatchLoopIntentToEve(loopIntentId, {
    meeting_note_generation: { run_id: ingestRunId }
  }, actor);
  return { ingestRunId, dispatchRunId: dispatched.eve_session_dispatch.run.id };
}

function noteToolCallEvent({ runId, sourceTextHash = SOURCE_TEXT_HASH }: { runId: string; sourceTextHash?: string }) {
  return {
    type: 'actions.requested',
    data: {
      actions: [{
        kind: 'tool-call',
        callId: 'call_contract_note_1',
        toolName: 'record_meeting_note_generation',
        input: {
          org_id: 'sample-project',
          project_id: 'sample-project',
          run_id: runId,
          source_text_hash: sourceTextHash,
          note: { title: '2026-07-10 定例会議-要約', body: '# 2026-07-10 定例会議-要約\n\n生成された議事録本文。' }
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

function noteDraftOutput(repository: any, ingestRunId: string) {
  return repository.listOutputs(ingestRunId)
    .find((output: any) => output.metadata?.output_key === 'meeting_note_draft');
}

test.describe(`${storyId} contract`, () => {
  test('story-eve-meeting-note-pull-reconciler ac:1 ac:2 AC-001 AC-002 S-001 pulls the generated note from the session stream and records it locally', async () => {
    const eveSessionClient = makeEveSessionClient();
    const { repository, service, actor } = makeService({ eveSessionClient });
    const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({ service, actor });
    eveSessionClient.state.stream = [noteToolCallEvent({ runId: ingestRunId }), ...PARKED_TAIL];

    const reconciler = new EveMeetingNoteReconciler({ meetingAutomationService: service.meetingAutomationService, eveSessionClient });
    const summary = await reconciler.runOnce();

    expect(summary).toMatchObject({ checked: 1, recorded: 1, errors: [] });
    expect(noteDraftOutput(repository, ingestRunId).payload.generation_status).toBe('brainbase_generated');
    // story-eve-meeting-note-pull-reconciler ac:2 the dispatch run closes success/closed and both audit actions are written
    expect(repository.getRun(dispatchRunId)).toMatchObject({ status: 'success', closure_state: 'closed' });
    const dispatchAudit = repository.listAuditLogs({ targetId: dispatchRunId, limit: 100 })
      .map((entry: any) => entry.action);
    expect(dispatchAudit).toContain('workflow.meeting_pack.note_generation.reconciled');
    const ingestAudit = repository.listAuditLogs({ targetId: ingestRunId, limit: 100 })
      .map((entry: any) => entry.action);
    expect(ingestAudit).toContain('workflow.meeting_pack.note_generation.recorded');
  });

  test('story-eve-meeting-note-pull-reconciler ac:3 AC-003 S-002 a mismatched source_text_hash is rejected and the run is blocked at session end', async () => {
    const eveSessionClient = makeEveSessionClient();
    const { repository, service, actor } = makeService({ eveSessionClient });
    const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({ service, actor });
    eveSessionClient.state.stream = [
      noteToolCallEvent({ runId: ingestRunId, sourceTextHash: 'tampered-hash' }),
      ...PARKED_TAIL
    ];

    const reconciler = new EveMeetingNoteReconciler({ meetingAutomationService: service.meetingAutomationService, eveSessionClient });
    const summary = await reconciler.runOnce();

    expect(summary).toMatchObject({ checked: 1, recorded: 0, blocked: 1 });
    expect(noteDraftOutput(repository, ingestRunId).payload.generation_status).toBe('brainbase_source_ready');
    expect(repository.getRun(dispatchRunId).status).toBe('blocked');
  });

  test('story-eve-meeting-note-pull-reconciler ac:4 AC-004 S-003 in-progress sessions stay pending and reconcile on a later tick', async () => {
    const eveSessionClient = makeEveSessionClient();
    const { repository, service, actor } = makeService({ eveSessionClient });
    const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({ service, actor });
    eveSessionClient.state.stream = [
      { type: 'turn.started', data: { sequence: 1, turnId: 'turn-1' } },
      { type: 'message.appended', data: { messageDelta: '生成中' } }
    ];

    const reconciler = new EveMeetingNoteReconciler({ meetingAutomationService: service.meetingAutomationService, eveSessionClient });
    expect(await reconciler.runOnce()).toMatchObject({ checked: 1, pending: 1 });
    expect(repository.getRun(dispatchRunId).status).toBe('running');

    eveSessionClient.state.stream = [noteToolCallEvent({ runId: ingestRunId }), ...PARKED_TAIL];
    expect(await reconciler.runOnce()).toMatchObject({ checked: 1, recorded: 1 });
    expect(noteDraftOutput(repository, ingestRunId).payload.generation_status).toBe('brainbase_generated');
  });

  test('story-eve-meeting-note-pull-reconciler ac:5 ac:6 AC-005 AC-006 S-004 note-less terminal sessions block; already-generated targets close idempotently', async () => {
    const eveSessionClient = makeEveSessionClient();
    const { repository, service, actor } = makeService({ eveSessionClient });
    const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({ service, actor });
    eveSessionClient.state.stream = [
      { type: 'turn.started', data: { sequence: 1, turnId: 'turn-1' } },
      ...PARKED_TAIL
    ];

    const reconciler = new EveMeetingNoteReconciler({ meetingAutomationService: service.meetingAutomationService, eveSessionClient });
    expect(await reconciler.runOnce()).toMatchObject({ checked: 1, blocked: 1 });
    expect(repository.getRun(dispatchRunId)).toMatchObject({
      status: 'blocked',
      action_required: 'operator_review_eve_session'
    });

    // story-eve-meeting-note-pull-reconciler ac:6 already-generated targets close idempotently without re-writing the note
    await service.meetingAutomationService.recordNoteGeneration({
      org_id: 'sample-project',
      project_id: 'sample-project',
      run_id: ingestRunId,
      source_text_hash: SOURCE_TEXT_HASH,
      note: { title: '既存生成', body: '既に書き戻し済みの本文' },
      runner: { type: 'eve', session_id: 'wrun_contract_reconciler_001' }
    }, actor);
    repository.updateRun(dispatchRunId, { status: 'running' });
    expect(await reconciler.runOnce()).toMatchObject({ checked: 1, already_recorded: 1, recorded: 0 });
    expect(noteDraftOutput(repository, ingestRunId).payload.body).toBe('既に書き戻し済みの本文');
  });

  test('story-eve-meeting-note-pull-reconciler ac:7 AC-007 S-003 transient stream failures are recorded as errors and leave the run pending for retry', async () => {
    const eveSessionClient = makeEveSessionClient();
    const { repository, service, actor } = makeService({ eveSessionClient });
    const { ingestRunId, dispatchRunId } = await dispatchMeetingNoteRun({ service, actor });
    (eveSessionClient as any).readSessionStream = async () => {
      throw new Error('Eve session stream failed with HTTP 502');
    };

    const reconciler = new EveMeetingNoteReconciler({
      meetingAutomationService: service.meetingAutomationService,
      eveSessionClient,
      logger: { warn() {} }
    });
    const summary = await reconciler.runOnce();

    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toMatchObject({ run_id: dispatchRunId });
    expect(repository.getRun(dispatchRunId).status).toBe('running');

    (eveSessionClient as any).readSessionStream = async () => [
      noteToolCallEvent({ runId: ingestRunId }),
      ...PARKED_TAIL
    ];
    expect(await reconciler.runOnce()).toMatchObject({ checked: 1, recorded: 1 });
    expect(noteDraftOutput(repository, ingestRunId).payload.generation_status).toBe('brainbase_generated');
  });

  test('story-eve-meeting-note-pull-reconciler ac:8 AC-008 S-005 manual control API runs the reconciler once and returns the summary; 503 when unwired', async () => {
    const eveSessionClient = makeEveSessionClient();
    const { repository, service, actor } = makeService({ eveSessionClient });
    const { ingestRunId } = await dispatchMeetingNoteRun({ service, actor });
    eveSessionClient.state.stream = [noteToolCallEvent({ runId: ingestRunId }), ...PARKED_TAIL];
    const reconciler = new EveMeetingNoteReconciler({ meetingAutomationService: service.meetingAutomationService, eveSessionClient });

    const makeRouteApp = (wiredReconciler: any) => {
      const app = express();
      app.use(express.json());
      app.use((req: any, _res: any, next: any) => {
        req.auth = { sub: 'sato', role: 'admin' };
        req.access = { personId: 'sato', projectCodes: ['sample-project'], role: 'admin' };
        req.authSource = 'test';
        next();
      });
      app.use('/api/workflows', createWorkflowRouter(service, {
        eveMeetingNoteReconciler: wiredReconciler,
        meetingAutomationService: service.meetingAutomationService
      }));
      app.use((err: any, _req: any, res: any, _next: any) => {
        res.status(err.statusCode || 500).json({ error: err.message });
      });
      return app;
    };

    const res = await request(makeRouteApp(reconciler))
      .post('/api/workflows/control/meeting-pack/eve-note-reconcile')
      .expect(200);
    expect(res.body).toMatchObject({ checked: 1, recorded: 1 });
    expect(noteDraftOutput(repository, ingestRunId).payload.generation_status).toBe('brainbase_generated');

    const unwired = await request(makeRouteApp(null))
      .post('/api/workflows/control/meeting-pack/eve-note-reconcile')
      .expect(503);
    expect(unwired.body).toEqual({ error: 'eve_note_reconciler_unavailable' });
  });

  test('story-eve-meeting-note-pull-reconciler ac:9 AC-009 S-005 scheduler guards (disabled / unconfigured / lifecycle)', async () => {
    const eveSessionClient = makeEveSessionClient();
    const { service } = makeService({ eveSessionClient });

    const disabled = new EveMeetingNoteReconciler({
      meetingAutomationService: service.meetingAutomationService,
      eveSessionClient,
      config: { enabled: false }
    });
    expect(disabled.startScheduledReconcile()).toEqual({ started: false, reason: 'disabled' });

    const unconfigured = new EveMeetingNoteReconciler({
      meetingAutomationService: service.meetingAutomationService,
      eveSessionClient: { isConfigured: () => false }
    });
    expect(unconfigured.startScheduledReconcile()).toEqual({ started: false, reason: 'eve_not_configured' });

    const running = new EveMeetingNoteReconciler({
      meetingAutomationService: service.meetingAutomationService,
      eveSessionClient,
      config: { interval_ms: 60000 }
    });
    expect(running.startScheduledReconcile()).toEqual({ started: true, interval_ms: 60000 });
    expect(running.stopScheduledReconcile()).toEqual({ stopped: true });
  });
});
