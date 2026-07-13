import { expect, test } from '@playwright/test';

import { EveMeetingNoteReconciler } from '../../server/services/external-runner/eve-meeting-note-reconciler.js';
import { meetingPackIds } from '../../server/services/workflow/meeting-workflow-pack.js';
import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import {
  WorkflowService,
  createDefaultWorkflowHandlers
} from '../../server/services/workflow/workflow-service.js';

const SOURCE_TEXT_HASH = 'hash-eve-candidates-owner-ssot-e2e';

function makeService({
  eveSessionClient = null,
  people = [{
    id: 'person-sato',
    payload: {
      name: '佐藤圭吾',
      display_name: '佐藤圭吾',
      aliases: ['佐藤さん'],
      project_codes: ['salestailor']
    }
  }]
} = {}) {
  const repository = new InMemoryWorkflowRepository();
  const runner = new WorkflowRunner({ repository, handlers: createDefaultWorkflowHandlers() });
  const configParser = {
    async getProjects() {
      return { root: '/workspace', projects: [{ id: 'salestailor', session_select: true }] };
    }
  };
  const infoSSOTService = {
    async listGraphEntities(_access, options = {}) {
      const query = String(options.query || '').trim().replace(/^@+/, '').toLowerCase();
      return people.filter((person) => {
        const names = [person.payload.name, person.payload.display_name, ...person.payload.aliases]
          .map((value) => value.toLowerCase());
        return names.some((value) => value.includes(query));
      });
    }
  };
  const service = new WorkflowService({
    repository,
    runner,
    configParser,
    infoSSOTService,
    eveSessionClient
  });
  const actor = {
    sub: 'keigo',
    person_id: 'keigo',
    role: 'admin',
    projectCodes: ['salestailor']
  };
  return { repository, service, actor };
}

function reviewPackage() {
  const orgId = 'salestailor';
  const projectId = 'salestailor';
  return {
    schema_version: '0.1.0',
    package_id: 'eve-candidates-owner-ssot-e2e',
    status: 'review_required',
    meeting_identity: {
      source: 'google_calendar',
      account: 'info@example.com',
      calendar_id: 'primary',
      event_id: 'evt-eve-candidates-owner-e2e',
      title: 'Eve candidates owner E2E',
      start: '2026-07-10T13:00:00+09:00',
      end: '2026-07-10T14:00:00+09:00',
      candidate_org_id: orgId,
      candidate_project_id: projectId,
      case_scope: 'eve-candidates-owner-e2e'
    },
    source_event: {
      source_system: 'slack',
      workspace: 'unson',
      channel_id: 'C08SYTDR7R8',
      message_ts: '1782367965.844209',
      file_id: 'F0BCYNXMP6H',
      local_artifact_sha256: 'sha256-eve-candidates-owner-e2e'
    },
    loop_intent_ids: {
      pre_meeting_briefing: meetingPackIds({ orgId, projectId, definitionId: 'pre-meeting-briefing' }).loopIntentId,
      transcript_to_meeting_note: meetingPackIds({ orgId, projectId, definitionId: 'transcript-to-meeting-note' }).loopIntentId,
      meeting_note_to_tasks: meetingPackIds({ orgId, projectId, definitionId: 'meeting-note-to-tasks' }).loopIntentId,
      meeting_note_to_decisions: meetingPackIds({ orgId, projectId, definitionId: 'meeting-note-to-decisions' }).loopIntentId,
      post_meeting_follow_up_message: meetingPackIds({ orgId, projectId, definitionId: 'post-meeting-follow-up-message' }).loopIntentId
    },
    meeting_note_summary: {
      title: 'Eve candidates owner E2E',
      body: '# Eve candidates owner E2E',
      generation_status: 'brainbase_source_ready',
      source_text_hash: SOURCE_TEXT_HASH,
      source_text_length: 24,
      source_transcripts: [{
        role: 'primary',
        provider: 'plaud',
        source_text_kind: 'transcript',
        transcript_hash: SOURCE_TEXT_HASH,
        text: '佐藤さんが請求書を送付する。',
        text_length: 24
      }]
    },
    task_candidates: [],
    decision_candidates: [],
    follow_up_draft: {
      status: 'draft_only',
      external_send_required_approval: true,
      body: ''
    },
    promotion_candidates: { graph: [], learning: [] },
    evidence_refs: ['transcript:00:01:00-00:02:00'],
    stop_conditions: ['external_send_requires_human_approval']
  };
}

function makeEveSessionClient() {
  return {
    events: [],
    calls: [],
    isConfigured() {
      return true;
    },
    async createSession(input) {
      this.calls.push(input);
      return {
        session_id: 'wrun_eve-candidates-reconciler-e2e',
        continuation_token: 'continue-e2e',
        response: { ok: true }
      };
    },
    async readSessionStream() {
      return this.events;
    }
  };
}

function noteToolCallEvent(runId) {
  return {
    type: 'actions.requested',
    data: {
      actions: [{
        kind: 'tool-call',
        callId: 'call-note-e2e',
        toolName: 'record_meeting_note_generation',
        input: {
          org_id: 'salestailor',
          project_id: 'salestailor',
          run_id: runId,
          source_text_hash: SOURCE_TEXT_HASH,
          note: { title: 'Eve candidates owner E2E', body: '# 生成済み議事録' }
        }
      }]
    }
  };
}

function candidatesToolCallEvent(runId, { sourceTextHash = SOURCE_TEXT_HASH } = {}) {
  return {
    type: 'actions.requested',
    data: {
      actions: [{
        kind: 'tool-call',
        callId: 'call-candidates-e2e',
        toolName: 'record_meeting_candidates',
        input: {
          org_id: 'salestailor',
          project_id: 'salestailor',
          run_id: runId,
          source_text_hash: sourceTextHash,
          task_candidates: [{ title: '請求書を送付する', owner_hint: '佐藤さん' }],
          decision_candidates: [{ title: '請求書を今週中に送る' }],
          follow_up_draft: { body: '本日はありがとうございました。' }
        }
      }]
    }
  };
}

const PARKED_TAIL = [
  { type: 'turn.completed', data: { turnId: 'turn-e2e' } },
  { type: 'session.waiting', data: { wait: 'next-user-message' } }
];

async function dispatchMeetingCandidateRun({ service, actor }) {
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const ingest = await service.ingestMeetingReviewPackage({ review_package: reviewPackage() }, actor);
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
    dispatchRunId: dispatched.eve_session_dispatch.run.id
  };
}

function outputByKey(repository, runId, outputKey) {
  return repository.listOutputs(runId)
    .find((output) => output.metadata?.output_key === outputKey);
}

test('story-eve-meeting-candidates-pull-reconciler AC-001 AC-002 AC-005 AC-006 AC-007 AC-008 scenario_clause_e2e flow_replay writes Eve candidates and defaults a unique People SSOT owner', async () => {
  const { repository, service, actor } = makeService();
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const ingest = await service.ingestMeetingReviewPackage({ review_package: reviewPackage() }, actor);
  const runId = ingest.meeting_review_ingest.run.id;

  const before = repository.listOutputs(runId)
    .find((output) => output.metadata?.output_key === 'task_candidates');
  expect(before?.payload, 'ac:5 ingest leaves task candidates awaiting Eve instead of deterministic transcript splitting').toEqual([]);

  await service.recordMeetingCandidates({
    org_id: 'salestailor',
    project_id: 'salestailor',
    run_id: runId,
    source_text_hash: SOURCE_TEXT_HASH,
    task_candidates: [{ title: '請求書を送付する', owner_hint: '佐藤さん' }],
    decision_candidates: [{ title: '請求書を今週中に送る' }],
    follow_up_draft: { body: '本日はありがとうございました。' },
    runner: { type: 'eve', session_id: 'sess-owner-ssot-e2e' }
  }, actor);

  const outputs = repository.listOutputs(runId);
  const task = outputs.find((output) => output.metadata?.output_key === 'task_candidates')?.payload?.[0];
  expect(task?.source, 'S-001 SCN-001 ac:1 candidate text is written back from Eve to the same ingest run').toBe('eve_meeting_agent');
  expect(task?.selected_owner_id, 'ac:7 a unique People SSOT match becomes the default owner').toBe('person-sato');
  expect(task?.selected_owner, 'S-005 SCN-005 a unique People SSOT match stores the display name').toBe('佐藤圭吾');
  expect(task?.owner_candidates?.[0], 'ac:7 the selected owner is also the first owner candidate').toMatchObject({
    person_id: 'person-sato',
    display_name: '佐藤圭吾'
  });
  expect(task?.owner_resolution, 'ac:8 owner resolution remains traceable to Graph SSOT').toMatchObject({ status: 'resolved', source: 'graph_ssot' });
  expect(task?.title, 'ac:6 the candidate preview is normalized task text, not raw transcript JSON').toBe('請求書を送付する');

  const followUp = outputs.find((output) => output.metadata?.output_key === 'follow_up_draft')?.payload;
  expect(followUp, 'ac:2 Brainbase keeps the external-send approval gate deterministic').toMatchObject({
    body: '本日はありがとうございました。',
    external_send_required_approval: true
  });
});

test('story-eve-meeting-candidates-pull-reconciler AC-003 ac:3 source hash mismatch rejects candidate writes', async () => {
  const { repository, service, actor } = makeService();
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const ingest = await service.ingestMeetingReviewPackage({ review_package: reviewPackage() }, actor);
  const runId = ingest.meeting_review_ingest.run.id;

  await expect(service.recordMeetingCandidates({
    org_id: 'salestailor',
    project_id: 'salestailor',
    run_id: runId,
    source_text_hash: 'hash-for-another-meeting',
    task_candidates: [{ title: '別会議のタスク', owner_hint: '佐藤さん' }],
    decision_candidates: [],
    follow_up_draft: { body: '' },
    runner: { type: 'eve', session_id: 'sess-hash-mismatch-e2e' }
  }, actor), 'ac:3 a mismatched source_text_hash is rejected before candidate output mutation')
    .rejects.toMatchObject({ statusCode: 400 });

  const taskOutput = repository.listOutputs(runId)
    .find((output) => output.metadata?.output_key === 'task_candidates');
  expect(taskOutput?.payload, 'FM-004 rejected candidates leave the awaiting-Eve placeholder unchanged').toEqual([]);
});

test('story-eve-meeting-candidates-pull-reconciler AC-007 ambiguous People SSOT matches stay unassigned', async () => {
  const { repository, service, actor } = makeService({
    people: [
      {
        id: 'person-sato-keigo',
        payload: { name: '佐藤圭吾', display_name: '佐藤圭吾', aliases: ['佐藤さん'], project_codes: ['salestailor'] }
      },
      {
        id: 'person-sato-taro',
        payload: { name: '佐藤太郎', display_name: '佐藤太郎', aliases: ['佐藤さん'], project_codes: ['salestailor'] }
      }
    ]
  });
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const ingest = await service.ingestMeetingReviewPackage({ review_package: reviewPackage() }, actor);
  const runId = ingest.meeting_review_ingest.run.id;

  await service.recordMeetingCandidates({
    org_id: 'salestailor',
    project_id: 'salestailor',
    run_id: runId,
    source_text_hash: SOURCE_TEXT_HASH,
    task_candidates: [{ title: '請求書を送付する', owner_hint: '佐藤さん' }],
    decision_candidates: [],
    follow_up_draft: { body: '' },
    runner: { type: 'eve', session_id: 'sess-owner-ambiguous-e2e' }
  }, actor);

  const task = repository.listOutputs(runId)
    .find((output) => output.metadata?.output_key === 'task_candidates')?.payload?.[0];
  expect(task?.owner_candidates, 'S-006 SCN-006 ambiguous matches remain visible for human selection').toHaveLength(2);
  expect(task?.selected_owner_id, 'ac:7 ambiguity must not pick a default owner').toBeUndefined();
  expect(task?.selected_owner, 'S-006 ambiguity must not display an AI-selected owner').toBeUndefined();
  expect(task?.owner_resolution, 'SCN-006 ambiguity is explicit and auditable').toMatchObject({
    status: 'ambiguous',
    reason: 'ambiguous_people_ssot_candidate'
  });
});

test('story-eve-meeting-candidates-pull-reconciler S-002 SCN-002 AC-004 ac:4 production_path_matrix note-only closes successfully with an empty awaiting-Eve candidate output', async () => {
  const eveSessionClient = makeEveSessionClient();
  const { repository, service, actor } = makeService({ eveSessionClient });
  const { ingestRunId, dispatchRunId } = await dispatchMeetingCandidateRun({ service, actor });
  expect(eveSessionClient.calls[0]?.context?.meeting_note_generation?.candidates_write_back, 'candidate handoff requires the exact dispatch run instead of advertising a package fallback').toMatchObject({
    required_fields: ['org_id', 'project_id', 'run_id', 'source_text_hash'],
    payload_template: {
      org_id: 'salestailor',
      project_id: 'salestailor',
      run_id: ingestRunId,
      source_text_hash: SOURCE_TEXT_HASH
    }
  });
  expect(eveSessionClient.calls[0]?.context?.meeting_note_generation?.candidates_write_back?.payload_template).not.toHaveProperty('package_id');
  eveSessionClient.events = [noteToolCallEvent(ingestRunId), ...PARKED_TAIL];

  const summary = await new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient }).runOnce();

  expect(summary, 'S-002 note is the primary success gate even without candidates').toMatchObject({
    checked: 1,
    recorded: 1,
    blocked: 0,
    errors: []
  });
  expect(outputByKey(repository, ingestRunId, 'task_candidates')?.payload, 'SCN-002 candidate placeholder remains awaiting Eve').toEqual([]);
  expect(repository.getRun(dispatchRunId), 'AC-004 ac4 note-only completion is visible on the dispatch run').toMatchObject({
    status: 'success',
    closure_state: 'closed',
    action_required: 'none',
    metadata: {
      eve_note_reconciler: {
        candidates: { status: 'no_candidate_call', mismatched_candidate_calls: 0 }
      }
    }
  });
});

test('story-eve-meeting-candidates-pull-reconciler S-003 SCN-003 FM-002 flow_replay delayed candidates keep the run open and are recorded on the next poll', async () => {
  const eveSessionClient = makeEveSessionClient();
  const { repository, service, actor } = makeService({ eveSessionClient });
  const { ingestRunId, dispatchRunId } = await dispatchMeetingCandidateRun({ service, actor });
  eveSessionClient.events = [
    noteToolCallEvent(ingestRunId),
    { type: 'turn.started', data: { turnId: 'turn-e2e' } }
  ];
  const reconciler = new EveMeetingNoteReconciler({ workflowService: service, eveSessionClient });

  const first = await reconciler.runOnce();
  expect(first, 'FM-002 active session remains eligible for a later poll').toMatchObject({
    checked: 1,
    pending: 1,
    recorded: 0,
    errors: []
  });
  expect(repository.getRun(dispatchRunId), 'S-003 operator-facing run state explains why it is still running').toMatchObject({
    status: 'running',
    closure_state: 'open',
    metadata: {
      eve_note_reconciler: {
        reason: 'awaiting_candidates_after_note',
        candidates: { status: 'no_candidate_call' }
      }
    }
  });
  expect(outputByKey(repository, ingestRunId, 'task_candidates')?.payload).toEqual([]);

  eveSessionClient.events = [
    noteToolCallEvent(ingestRunId),
    candidatesToolCallEvent(ingestRunId, { sourceTextHash: 'excluded-mismatch-hash' }),
    candidatesToolCallEvent(ingestRunId),
    ...PARKED_TAIL
  ];
  const second = await reconciler.runOnce();
  expect(second, 'SCN-003 next poll consumes the delayed candidate call').toMatchObject({ checked: 1, errors: [] });
  expect(repository.getRun(dispatchRunId), 'delayed candidate recovery closes the same dispatch run').toMatchObject({
    status: 'success',
    closure_state: 'closed',
    metadata: {
      eve_note_reconciler: {
        candidates: { status: 'recorded', mismatched_candidate_calls: 1 }
      }
    }
  });
  expect(outputByKey(repository, ingestRunId, 'task_candidates')?.payload?.[0]).toMatchObject({
    title: '請求書を送付する',
    selected_owner_id: 'person-sato',
    source: 'eve_meeting_agent'
  });
});

test('story-eve-meeting-candidates-pull-reconciler S-004 SCN-004 FM-003 artifact_replay matching candidate write failure blocks with an operator action', async () => {
  const eveSessionClient = makeEveSessionClient();
  const { repository, service, actor } = makeService({ eveSessionClient });
  const { ingestRunId, dispatchRunId } = await dispatchMeetingCandidateRun({ service, actor });
  eveSessionClient.events = [
    noteToolCallEvent(ingestRunId),
    candidatesToolCallEvent(ingestRunId),
    ...PARKED_TAIL
  ];
  service.recordMeetingCandidates = async () => {
    throw new Error('candidate database unavailable');
  };

  const summary = await new EveMeetingNoteReconciler({
    workflowService: service,
    eveSessionClient,
    logger: { warn() {} }
  }).runOnce();

  expect(summary, 'FM-003 a failed matching write must not report success').toMatchObject({
    checked: 1,
    recorded: 0,
    blocked: 1,
    errors: []
  });
  expect(outputByKey(repository, ingestRunId, 'meeting_note_draft')?.payload, 'S-004 generated note remains available for recovery').toMatchObject({
    generation_status: 'brainbase_generated'
  });
  expect(outputByKey(repository, ingestRunId, 'task_candidates')?.payload, 'failed candidate write leaves the awaiting-Eve output intact').toEqual([]);
  expect(repository.getRun(dispatchRunId), 'SCN-004 the persisted run exposes the required operator recovery action').toMatchObject({
    status: 'blocked',
    closure_state: 'open',
    human_waiting: true,
    action_required: 'operator_review_eve_candidates',
    metadata: {
      eve_note_reconciler: {
        reason: 'candidate_writeback_failed',
        candidates: { status: 'failed', error: 'candidate database unavailable' }
      }
    }
  });
  const auditActions = repository.listAuditLogs({ targetId: dispatchRunId, limit: 100 })
    .map((entry) => entry.action);
  expect(auditActions, 'SCN-004 failure evidence is auditable after the reconciler tick').toContain('workflow.meeting_pack.candidates.reconcile_blocked');
});

test('story-eve-meeting-candidates-pull-reconciler S-002 S-003 S-004 e2e_ux exposes reconciliation, polling errors, owner, retry, and blocking in Mission Control', async ({ page }) => {
  let active = makeService();
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    if (url.pathname === '/api/workflows') {
      const projectId = url.searchParams.get('project_id') || url.searchParams.get('projectId');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(await active.service.listWorkflows({ projectId }, active.actor))
      });
      return;
    }
    const workflowMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)$/);
    if (workflowMatch) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(await active.service.getWorkflow(decodeURIComponent(workflowMatch[1]), active.actor))
      });
      return;
    }
    const runMatch = url.pathname.match(/^\/api\/workflow-runs\/([^/]+)$/);
    if (runMatch) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(await active.service.getRun(decodeURIComponent(runMatch[1]), active.actor))
      });
      return;
    }
    await route.continue();
  });

  const pollFailureClient = makeEveSessionClient();
  active = makeService({ eveSessionClient: pollFailureClient });
  const pollFailureIds = await dispatchMeetingCandidateRun(active);
  pollFailureClient.readSessionStream = async () => {
    throw new Error('Eve session stream failed with HTTP 502');
  };
  const pollFailureReconciler = new EveMeetingNoteReconciler({
    workflowService: active.service,
    eveSessionClient: pollFailureClient,
    logger: { warn() {} }
  });
  await pollFailureReconciler.runOnce();

  await page.goto('/workflows');
  await page.locator(`[data-workflow-id="${active.repository.getRun(pollFailureIds.dispatchRunId).workflow_id}"]`).click();
  await page.locator(`[data-run-id="${pollFailureIds.dispatchRunId}"]`).click();
  await expect(page.getByText('Eve Reconciler Status', { exact: true }).locator('..')).toContainText('再試行中');
  await expect(page.getByText('retrying', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Eve Poll Error', { exact: true }).locator('..')).toContainText('HTTP 502');

  pollFailureClient.readSessionStream = async () => [
    noteToolCallEvent(pollFailureIds.ingestRunId),
    ...PARKED_TAIL
  ];
  await pollFailureReconciler.runOnce();

  await page.goto('/workflows');
  await page.locator(`[data-workflow-id="${active.repository.getRun(pollFailureIds.dispatchRunId).workflow_id}"]`).click();
  await page.locator(`[data-run-id="${pollFailureIds.dispatchRunId}"]`).click();
  await expect(page.getByText('Eve Reconciliation', { exact: true }).locator('..')).toContainText('議事録を取得済み');
  await expect(page.getByText('note_reconciled', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Eve Poll Error', { exact: true }).locator('..')).toContainText('HTTP 502');
  await expect(page.getByText('Eve Poll Failed At', { exact: true }).locator('..')).not.toHaveText('Eve Poll Failed At');
  await expect(page.getByText('Eve Poll Failure Count', { exact: true }).locator('..')).toContainText('1');
  await expect(page.getByText('Eve Poll Recovered At', { exact: true }).locator('..')).not.toHaveText('Eve Poll Recovered At');

  const runtimeFailureClient = makeEveSessionClient();
  active = makeService({ eveSessionClient: runtimeFailureClient });
  const runtimeFailureIds = await dispatchMeetingCandidateRun(active);
  runtimeFailureClient.events = [noteToolCallEvent(runtimeFailureIds.ingestRunId), ...PARKED_TAIL];
  const recordMeetingNoteGeneration = active.service.recordMeetingNoteGeneration.bind(active.service);
  let shouldFailRuntimeWrite = true;
  active.service.recordMeetingNoteGeneration = async (...args) => {
    if (shouldFailRuntimeWrite) {
      shouldFailRuntimeWrite = false;
      throw new Error('meeting note database unavailable');
    }
    return recordMeetingNoteGeneration(...args);
  };
  const runtimeFailureReconciler = new EveMeetingNoteReconciler({
    workflowService: active.service,
    eveSessionClient: runtimeFailureClient,
    logger: { warn() {} }
  });
  await runtimeFailureReconciler.runOnce();

  await page.goto('/workflows');
  await page.locator(`[data-workflow-id="${active.repository.getRun(runtimeFailureIds.dispatchRunId).workflow_id}"]`).click();
  await page.locator(`[data-run-id="${runtimeFailureIds.dispatchRunId}"]`).click();
  await expect(page.getByText('Eve Reconciliation', { exact: true }).locator('..')).toContainText('照合処理に失敗');
  await expect(page.getByText('reconcile_runtime_failed', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Eve Runtime Error', { exact: true }).locator('..')).toContainText('meeting note database unavailable');
  await expect(page.getByText('Eve Runtime Failure Count', { exact: true }).locator('..')).toContainText('1');
  await expect(page.getByText('Eve Poll Error', { exact: true })).toHaveCount(0);

  await runtimeFailureReconciler.runOnce();

  await page.goto('/workflows');
  await page.locator(`[data-workflow-id="${active.repository.getRun(runtimeFailureIds.dispatchRunId).workflow_id}"]`).click();
  await page.locator(`[data-run-id="${runtimeFailureIds.dispatchRunId}"]`).click();
  await expect(page.getByText('Eve Reconciliation', { exact: true }).locator('..')).toContainText('議事録を取得済み');
  await expect(page.getByText('note_reconciled', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Eve Runtime Recovered At', { exact: true }).locator('..')).not.toHaveText('Eve Runtime Recovered At');
  await expect(page.getByText('Eve Poll Error', { exact: true })).toHaveCount(0);

  const noteOnlyClient = makeEveSessionClient();
  active = makeService({ eveSessionClient: noteOnlyClient });
  const noteOnlyIds = await dispatchMeetingCandidateRun(active);
  noteOnlyClient.events = [noteToolCallEvent(noteOnlyIds.ingestRunId), ...PARKED_TAIL];
  await new EveMeetingNoteReconciler({ workflowService: active.service, eveSessionClient: noteOnlyClient }).runOnce();
  const noteOnlyRun = active.repository.getRun(noteOnlyIds.dispatchRunId);

  await page.goto('/workflows');
  const noteOnlyCard = page.locator(`[data-workflow-id="${noteOnlyRun.workflow_id}"]`);
  await expect(noteOnlyCard, 'S-002 note-only completion is visible as closed success').toContainText('success');
  await expect(noteOnlyCard).toContainText('Action: none · Human waiting: no');
  await noteOnlyCard.click();
  await page.locator(`[data-run-id="${noteOnlyIds.dispatchRunId}"]`).click();
  await expect(page.getByText('Eve Candidates', { exact: true })).toBeVisible();
  await expect(page.getByText('Task候補なし', { exact: true })).toBeVisible();
  await expect(page.getByText('no_candidate_call', { exact: true })).toHaveCount(0);

  const endedWithoutNoteClient = makeEveSessionClient();
  active = makeService({ eveSessionClient: endedWithoutNoteClient });
  const endedWithoutNoteIds = await dispatchMeetingCandidateRun(active);
  const mismatchedNoteEvent = noteToolCallEvent(endedWithoutNoteIds.ingestRunId);
  mismatchedNoteEvent.data.actions[0].input.source_text_hash = 'mismatched-note-hash';
  endedWithoutNoteClient.events = [mismatchedNoteEvent, ...PARKED_TAIL];
  await new EveMeetingNoteReconciler({
    workflowService: active.service,
    eveSessionClient: endedWithoutNoteClient
  }).runOnce();
  const endedWithoutNoteRun = active.repository.getRun(endedWithoutNoteIds.dispatchRunId);

  await page.goto('/workflows');
  const endedWithoutNoteCard = page.locator(`[data-workflow-id="${endedWithoutNoteRun.workflow_id}"]`);
  await expect(endedWithoutNoteCard).toContainText('blocked');
  await endedWithoutNoteCard.click();
  await page.locator(`[data-run-id="${endedWithoutNoteIds.dispatchRunId}"]`).click();
  await expect(page.getByText('Eveセッションが議事録なしで終了', { exact: true })).toBeVisible();
  await expect(page.getByText('session_ended_without_note', { exact: true })).toHaveCount(0);

  const mismatchClient = makeEveSessionClient();
  active = makeService({ eveSessionClient: mismatchClient });
  const mismatchIds = await dispatchMeetingCandidateRun(active);
  mismatchClient.events = [
    noteToolCallEvent(mismatchIds.ingestRunId),
    candidatesToolCallEvent('another-ingest-run'),
    ...PARKED_TAIL
  ];
  await new EveMeetingNoteReconciler({ workflowService: active.service, eveSessionClient: mismatchClient }).runOnce();
  const mismatchRun = active.repository.getRun(mismatchIds.dispatchRunId);

  await page.goto('/workflows');
  const mismatchCard = page.locator(`[data-workflow-id="${mismatchRun.workflow_id}"]`);
  await mismatchCard.click();
  await page.locator(`[data-run-id="${mismatchIds.dispatchRunId}"]`).click();
  const scopeMismatchTrace = page.getByText('Eve Candidate Scope Mismatches', { exact: true }).locator('..');
  await expect(scopeMismatchTrace).toContainText('1');

  const delayedClient = makeEveSessionClient();
  active = makeService({ eveSessionClient: delayedClient });
  const delayedIds = await dispatchMeetingCandidateRun(active);
  delayedClient.events = [noteToolCallEvent(delayedIds.ingestRunId), { type: 'turn.started', data: { turnId: 'turn-e2e-ux' } }];
  const delayedReconciler = new EveMeetingNoteReconciler({ workflowService: active.service, eveSessionClient: delayedClient });
  await delayedReconciler.runOnce();
  const delayedRun = active.repository.getRun(delayedIds.dispatchRunId);

  await page.goto('/workflows');
  const delayedCard = page.locator(`[data-workflow-id="${delayedRun.workflow_id}"]`);
  await expect(delayedCard, 'S-003 active Eve session remains visibly running').toContainText('running');
  await delayedCard.click();
  await page.locator(`[data-run-id="${delayedIds.dispatchRunId}"]`).click();
  await expect(page.getByText('Eve Reconciliation', { exact: true })).toBeVisible();
  await expect(page.getByText('議事録を取得済み・Task候補を待機中', { exact: true })).toBeVisible();
  await expect(page.getByText('awaiting_candidates_after_note', { exact: true })).toHaveCount(0);

  delayedClient.events = [noteToolCallEvent(delayedIds.ingestRunId), candidatesToolCallEvent(delayedIds.ingestRunId), ...PARKED_TAIL];
  await delayedReconciler.runOnce();
  const ingestRun = active.repository.getRun(delayedIds.ingestRunId);
  await page.goto('/workflows');
  const ingestCard = page.locator(`[data-workflow-id="${ingestRun.workflow_id}"]`);
  await ingestCard.click();
  await page.locator(`[data-run-id="${delayedIds.ingestRunId}"]`).click();
  await expect(page.getByText('Task candidate owners', { exact: true })).toBeVisible();
  await expect(page.getByText(/担当者: 佐藤圭吾/)).toBeVisible();
  await expect(page.getByText(/people SSOTの名前\/別名に一意一致/)).toBeVisible();

  const ambiguousClient = makeEveSessionClient();
  active = makeService({
    eveSessionClient: ambiguousClient,
    people: [
      {
        id: 'person-sato-keigo',
        payload: { name: '佐藤圭吾', display_name: '佐藤圭吾', aliases: ['佐藤さん'], project_codes: ['salestailor'] }
      },
      {
        id: 'person-sato-taro',
        payload: { name: '佐藤太郎', display_name: '佐藤太郎', aliases: ['佐藤さん'], project_codes: ['salestailor'] }
      }
    ]
  });
  const ambiguousIds = await dispatchMeetingCandidateRun(active);
  ambiguousClient.events = [
    noteToolCallEvent(ambiguousIds.ingestRunId),
    candidatesToolCallEvent(ambiguousIds.ingestRunId),
    ...PARKED_TAIL
  ];
  await new EveMeetingNoteReconciler({ workflowService: active.service, eveSessionClient: ambiguousClient }).runOnce();
  const ambiguousIngestRun = active.repository.getRun(ambiguousIds.ingestRunId);

  await page.goto('/workflows');
  await page.locator(`[data-workflow-id="${ambiguousIngestRun.workflow_id}"]`).click();
  await page.locator(`[data-run-id="${ambiguousIds.ingestRunId}"]`).click();
  const ambiguousOwnerSummary = page.locator('.trace-item').filter({ hasText: 'Task candidate owners' });
  await expect(ambiguousOwnerSummary, 'AC-007 ambiguity stays visibly unassigned for operator selection').toContainText('担当者: 担当者未設定');
  await expect(ambiguousOwnerSummary).toContainText('状態: 要選択');
  await expect(ambiguousOwnerSummary).toContainText('people SSOTに複数候補あり');
  await expect(ambiguousOwnerSummary).toContainText('候補から正しいpeople SSOT担当者を選択してください');
  await expect(ambiguousOwnerSummary).toContainText('佐藤圭吾 (person-sato-keigo)');
  await expect(ambiguousOwnerSummary).toContainText('佐藤太郎 (person-sato-taro)');

  const invalidPayloadClient = makeEveSessionClient();
  active = makeService({ eveSessionClient: invalidPayloadClient });
  const invalidPayloadIds = await dispatchMeetingCandidateRun(active);
  const invalidPayloadEvent = candidatesToolCallEvent(invalidPayloadIds.ingestRunId);
  invalidPayloadEvent.data.actions[0].input.task_candidates = [{ title: 'x'.repeat(501) }];
  invalidPayloadClient.events = [
    noteToolCallEvent(invalidPayloadIds.ingestRunId),
    invalidPayloadEvent,
    ...PARKED_TAIL
  ];
  await new EveMeetingNoteReconciler({
    workflowService: active.service,
    eveSessionClient: invalidPayloadClient,
    logger: { warn() {} }
  }).runOnce();
  const invalidPayloadRun = active.repository.getRun(invalidPayloadIds.dispatchRunId);

  await page.goto('/workflows');
  const invalidPayloadCard = page.locator(`[data-workflow-id="${invalidPayloadRun.workflow_id}"]`);
  await expect(invalidPayloadCard, 'FM-006 invalid candidate payload is visibly blocked for operator recovery').toContainText('blocked');
  await expect(invalidPayloadCard).toContainText('Action: operator_review_eve_candidates · Human waiting: yes');
  await invalidPayloadCard.click();
  await page.locator(`[data-run-id="${invalidPayloadIds.dispatchRunId}"]`).click();
  await expect(page.getByText('Task候補の書き戻しに失敗', { exact: true })).toBeVisible();
  await expect(page.getByText('candidate_writeback_failed', { exact: true })).toHaveCount(0);
  await expect(page.getByText('task_candidates[0].title must be at most 500 characters', { exact: true })).toBeVisible();

  const failureClient = makeEveSessionClient();
  active = makeService({ eveSessionClient: failureClient });
  const failureIds = await dispatchMeetingCandidateRun(active);
  failureClient.events = [noteToolCallEvent(failureIds.ingestRunId), candidatesToolCallEvent(failureIds.ingestRunId), ...PARKED_TAIL];
  active.service.recordMeetingCandidates = async () => {
    throw new Error('candidate database unavailable');
  };
  await new EveMeetingNoteReconciler({
    workflowService: active.service,
    eveSessionClient: failureClient,
    logger: { warn() {} }
  }).runOnce();
  const failureRun = active.repository.getRun(failureIds.dispatchRunId);

  await page.goto('/workflows');
  const failureCard = page.locator(`[data-workflow-id="${failureRun.workflow_id}"]`);
  await expect(failureCard, 'S-004 write-back failure is visibly blocked for operator recovery').toContainText('blocked');
  await expect(failureCard).toContainText('Action: operator_review_eve_candidates · Human waiting: yes');
  await failureCard.click();
  await page.locator(`[data-run-id="${failureIds.dispatchRunId}"]`).click();
  await expect(page.getByText('Task候補の書き戻しに失敗', { exact: true })).toBeVisible();
  await expect(page.getByText('candidate_writeback_failed', { exact: true })).toHaveCount(0);
  await expect(page.getByText('candidate database unavailable', { exact: true })).toBeVisible();
});
