import { test, expect } from '@playwright/test';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import {
  WorkflowService,
  createDefaultWorkflowHandlers
} from '../../server/services/workflow/workflow-service.js';
import { meetingPackIds } from '../../server/services/workflow/meeting-workflow-pack.js';

const storyId = 'story-eve-dispatch-handoff-transcript-context';

function makeEveSessionClient({ reject = null }: { reject?: Error | null } = {}) {
  const calls: any[] = [];
  let counter = 0;
  return {
    calls,
    isConfigured() {
      return true;
    },
    async createSession(input: any) {
      calls.push(input);
      if (reject) throw reject;
      counter += 1;
      return {
        session_id: `eve-session-handoff-${counter}`,
        continuation_token: `cont-handoff-${counter}`,
        response: { ok: true }
      };
    }
  };
}

function makeService({ eveSessionClient = null }: { eveSessionClient?: any } = {}) {
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
  const service = new WorkflowService({ repository, runner, configParser, eveSessionClient });
  const actor = {
    sub: 'keigo',
    person_id: 'keigo',
    role: 'admin',
    projectCodes: ['sample-project']
  };
  return { repository, service, actor };
}

function samplePackage({ packageId = 'meeting-handoff-package-e2e' } = {}) {
  const orgId = 'sample-project';
  const projectId = 'sample-project';
  return {
    schema_version: '0.1.0',
    package_id: packageId,
    status: 'review_required',
    meeting_identity: {
      source: 'mcp_meeting_source',
      title: 'Handoff契約E2E',
      start: '2026-07-11T10:00:00+09:00',
      candidate_org_id: orgId,
      candidate_project_id: projectId,
      case_scope: 'handoff-e2e',
      graph_context: { source: 'meeting_source_mcp_sync' }
    },
    source_event: {
      source_system: 'plaud',
      meeting_mode: 'offline',
      mcp_resource_uri: 'plaud:file-handoff-e2e-1',
      local_artifact_sha256: 'hash-handoff-e2e'
    },
    loop_intent_ids: {
      pre_meeting_briefing: meetingPackIds({ orgId, projectId, definitionId: 'pre-meeting-briefing' }).loopIntentId,
      transcript_to_meeting_note: meetingPackIds({ orgId, projectId, definitionId: 'transcript-to-meeting-note' }).loopIntentId,
      meeting_note_to_tasks: meetingPackIds({ orgId, projectId, definitionId: 'meeting-note-to-tasks' }).loopIntentId,
      meeting_note_to_decisions: meetingPackIds({ orgId, projectId, definitionId: 'meeting-note-to-decisions' }).loopIntentId,
      post_meeting_follow_up_message: meetingPackIds({ orgId, projectId, definitionId: 'post-meeting-follow-up-message' }).loopIntentId
    },
    meeting_note_summary: {
      title: 'Handoff契約E2E',
      body: '# Handoff契約E2E\n\n## Brainbase Meeting Pack Source\n\n## Primary Transcript Excerpt\n\nSpeaker 1: transcriptを同梱します。',
      generator: 'brainbase_meeting_pack',
      generation_source: 'transcript_to_meeting_note',
      generation_status: 'brainbase_source_ready',
      provider_note_authoritative: false,
      source_text_hash: 'hash-handoff-e2e',
      source_text_length: 40,
      source_transcripts: [{
        role: 'primary',
        provider: 'plaud',
        source_text_kind: 'transcript',
        transcript_hash: 'hash-handoff-e2e',
        text: 'Speaker 1: transcriptを同梱します。\nSpeaker 2: 書き戻し契約も渡します。',
        text_length: 40
      }]
    },
    task_candidates: ['Task候補'],
    decision_candidates: ['Decision候補'],
    follow_up_draft: {
      status: 'draft_only',
      external_send_required_approval: true,
      body: 'ありがとうございました。'
    },
    promotion_candidates: { graph: [], learning: [] },
    evidence_refs: ['transcript:00:00:00-00:01:00'],
    stop_conditions: ['task_create_requires_human_approval']
  };
}

async function bootstrapAndIngest({ eveSessionClient = null, reviewPackage = samplePackage() }: { eveSessionClient?: any, reviewPackage?: any } = {}) {
  const { repository, service, actor } = makeService({ eveSessionClient });
  await service.bootstrapMeetingWorkflowPack({
    org_id: 'sample-project',
    project_id: 'sample-project'
  }, actor);
  const result = await service.ingestMeetingReviewPackage({
    review_package: reviewPackage
  }, actor);
  return { repository, service, actor, ingest: result.meeting_review_ingest };
}

const noteLoopIntentId = meetingPackIds({
  orgId: 'sample-project',
  projectId: 'sample-project',
  definitionId: 'transcript-to-meeting-note'
}).loopIntentId;

test(`story-eve-dispatch-handoff-transcript-context ac:1 ac:2 ac:3 AC-001 AC-002 AC-003 S-001 ingest auto-dispatch hands off transcript, run refs and write-back contract`, async () => {
  const eveSessionClient = makeEveSessionClient();
  const { repository, ingest } = await bootstrapAndIngest({ eveSessionClient });

  expect(ingest.note_generation_dispatch.status).toBe('requested');
  expect(eveSessionClient.calls).toHaveLength(1);
  const context = eveSessionClient.calls[0].context;
  // story-eve-dispatch-handoff-transcript-context ac:2 handoff carries run identifiers, hash, transcript body and write-back contract
  // story-eve-dispatch-handoff-transcript-context ac:3 ingest auto-dispatch passes the run reference so the handoff includes the transcript
  expect(context.meeting_note_generation).toMatchObject({
    task: 'transcript_to_meeting_note',
    run_id: ingest.run.id,
    package_id: 'meeting-handoff-package-e2e',
    source_text_hash: 'hash-handoff-e2e',
    generation_status: 'brainbase_source_ready',
    note_source: expect.objectContaining({
      body: expect.stringContaining('Primary Transcript Excerpt'),
      source_transcripts: [
        expect.objectContaining({
          role: 'primary',
          text: expect.stringContaining('Speaker 2: 書き戻し契約も渡します。')
        })
      ]
    }),
    write_back: expect.objectContaining({
      method: 'POST',
      path: '/api/workflows/control/meeting-pack/note-generation',
      payload_template: expect.objectContaining({
        org_id: 'sample-project',
        project_id: 'sample-project',
        run_id: ingest.run.id,
        source_text_hash: 'hash-handoff-e2e'
      })
    })
  });
  expect(eveSessionClient.calls[0].message).toContain('context.meeting_note_generation');
  // ac:2 server-owned secrets stay out of the handoff
  expect(JSON.stringify(context)).not.toContain('cont-handoff');
  // dispatch run records the note-generation reference for reconciliation
  const eveRun = repository.getRun(ingest.note_generation_dispatch.eve_session_run_id);
  expect(eveRun.metadata.meeting_note_generation).toEqual({
    run_id: ingest.run.id,
    package_id: 'meeting-handoff-package-e2e',
    source_text_hash: 'hash-handoff-e2e'
  });
});

test(`story-eve-dispatch-handoff-transcript-context ac:1 AC-001 S-004 manual backfill dispatch resolves the ingest run from package_id`, async () => {
  const eveSessionClient = makeEveSessionClient();
  const { service, actor, ingest } = await bootstrapAndIngest({ eveSessionClient });

  const redispatch = await service.dispatchLoopIntentToEve(noteLoopIntentId, {
    force_new_session: true,
    meeting_note_generation: { package_id: 'meeting-handoff-package-e2e' }
  }, actor);

  expect(redispatch.eve_session_dispatch.idempotent).toBe(false);
  expect(eveSessionClient.calls).toHaveLength(2);
  expect(eveSessionClient.calls[1].context.meeting_note_generation).toMatchObject({
    run_id: ingest.run.id,
    source_text_hash: 'hash-handoff-e2e'
  });
});

test(`story-eve-dispatch-handoff-transcript-context ac:4 AC-004 S-002 a dispatch whose run belongs to another loop intent is rejected before any Eve session`, async () => {
  const eveSessionClient = makeEveSessionClient();
  const { service, actor, ingest } = await bootstrapAndIngest({ eveSessionClient });
  const tasksLoopIntentId = meetingPackIds({
    orgId: 'sample-project',
    projectId: 'sample-project',
    definitionId: 'meeting-note-to-tasks'
  }).loopIntentId;
  const callsAfterIngest = eveSessionClient.calls.length;

  await expect(service.dispatchLoopIntentToEve(tasksLoopIntentId, {
    meeting_note_generation: { run_id: ingest.run.id }
  }, actor)).rejects.toMatchObject({
    details: expect.objectContaining({ state_transition: 'blocked_meeting_note_generation_scope' })
  });
  expect(eveSessionClient.calls).toHaveLength(callsAfterIngest);
});

test(`story-eve-dispatch-handoff-transcript-context ac:5 ac:7 AC-005 AC-007 S-002 transcript-less runs block referenced dispatch while ingest stays best-effort`, async () => {
  const eveSessionClient = makeEveSessionClient();
  const legacyPackage = samplePackage();
  legacyPackage.meeting_note_summary = {
    background: ['会議背景'],
    agreements: ['合意事項'],
    open_questions: ['未決事項']
  };
  const { repository, service, actor, ingest } = await bootstrapAndIngest({ eveSessionClient, reviewPackage: legacyPackage });

  // ac:7 ingest succeeds and the context failure is recorded as a skipped dispatch
  expect(ingest.run.status).toBe('waiting_human');
  expect(ingest.note_generation_dispatch).toMatchObject({
    status: 'skipped',
    reason: 'dispatch_failed',
    error: expect.stringContaining('meeting_note_draft source')
  });
  expect(eveSessionClient.calls).toHaveLength(0);
  expect(repository.listAuditLogs({ targetId: ingest.run.id })).toEqual(expect.arrayContaining([
    expect.objectContaining({
      action: 'workflow.meeting_pack.note_generation.dispatch_skipped',
      after: expect.objectContaining({ reason: 'dispatch_failed' })
    })
  ]));

  // ac:5 explicit referenced dispatch is blocked with a validation error
  await expect(service.dispatchLoopIntentToEve(noteLoopIntentId, {
    meeting_note_generation: { run_id: ingest.run.id }
  }, actor)).rejects.toMatchObject({
    details: expect.objectContaining({ state_transition: 'blocked_meeting_note_generation_source_missing' })
  });
  expect(eveSessionClient.calls).toHaveLength(0);
});

test(`story-eve-dispatch-handoff-transcript-context ac:6 AC-006 S-003 dispatches without a meeting_note_generation reference keep the existing handoff shape`, async () => {
  const eveSessionClient = makeEveSessionClient();
  const { service, actor } = makeService({ eveSessionClient });
  await service.bootstrapMeetingWorkflowPack({ org_id: 'sample-project', project_id: 'sample-project' }, actor);
  const briefingLoopIntentId = meetingPackIds({
    orgId: 'sample-project',
    projectId: 'sample-project',
    definitionId: 'pre-meeting-briefing'
  }).loopIntentId;

  const result = await service.dispatchLoopIntentToEve(briefingLoopIntentId, {}, actor);

  expect(result.eve_session_dispatch.idempotent).toBe(false);
  expect(eveSessionClient.calls).toHaveLength(1);
  expect(eveSessionClient.calls[0].context.meeting_note_generation).toBeUndefined();
  expect(eveSessionClient.calls[0].message).not.toContain('context.meeting_note_generation');
  expect(eveSessionClient.calls[0].context).toMatchObject({
    brainbase_handoff_version: 'eve_session_handoff.v0',
    expected_result_contract: 'external_runner.v0',
    source_of_truth: 'brainbase'
  });

  await expect(service.dispatchLoopIntentToEve(briefingLoopIntentId, {
    force_new_session: true,
    meeting_note_generation: {}
  }, actor)).rejects.toMatchObject({
    details: expect.objectContaining({ state_transition: 'blocked_invalid_meeting_note_generation_ref' })
  });
});

test(`story-eve-dispatch-handoff-transcript-context ac:7 AC-007 FM provider_failure Eve session create failure keeps ingest best-effort and audited`, async () => {
  const eveSessionClient = makeEveSessionClient({ reject: new Error('eve provider down') });
  const { repository, ingest } = await bootstrapAndIngest({ eveSessionClient });

  // provider_failure: Eve provider error must not fail the ingest transaction
  expect(ingest.run.status).toBe('waiting_human');
  expect(ingest.note_generation_dispatch).toMatchObject({
    status: 'skipped',
    reason: 'dispatch_failed'
  });
  expect(repository.listAuditLogs({ targetId: ingest.run.id })).toEqual(expect.arrayContaining([
    expect.objectContaining({
      action: 'workflow.meeting_pack.note_generation.dispatch_skipped',
      after: expect.objectContaining({ reason: 'dispatch_failed' })
    })
  ]));
});

test(`story-eve-dispatch-handoff-transcript-context ac:6 AC-006 FM schema_failure malformed meeting_note_generation input is rejected by schema validation`, async () => {
  const eveSessionClient = makeEveSessionClient();
  const { service, actor } = await bootstrapAndIngest({ eveSessionClient });
  const callsAfterIngest = eveSessionClient.calls.length;

  // schema_failure: non-object refs and empty refs are blocked before any Eve call
  await expect(service.dispatchLoopIntentToEve(noteLoopIntentId, {
    force_new_session: true,
    meeting_note_generation: 'not-an-object'
  }, actor)).rejects.toMatchObject({
    details: expect.objectContaining({ state_transition: 'blocked_invalid_meeting_note_generation_ref' })
  });
  await expect(service.dispatchLoopIntentToEve(noteLoopIntentId, {
    force_new_session: true,
    meeting_note_generation: { note: 'no run reference' }
  }, actor)).rejects.toMatchObject({
    details: expect.objectContaining({ state_transition: 'blocked_invalid_meeting_note_generation_ref' })
  });
  expect(eveSessionClient.calls).toHaveLength(callsAfterIngest);
});

test(`story-eve-dispatch-handoff-transcript-context ac:8 AC-008 S-004 backfill script lists brainbase_source_ready runs from the ledger in dry-run`, async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eve-backfill-e2e-'));
  const ledgerPath = path.join(dir, 'workflow-ledger.json');
  await fs.promises.writeFile(ledgerPath, JSON.stringify({
    outputs: [
      {
        id: 'out_ready_1',
        workflow_run_id: 'run_ready_1',
        org_id: 'sample-project',
        project_id: 'sample-project',
        metadata: {
          output_key: 'meeting_note_draft',
          package_id: 'pkg-ready-1',
          loop_intent_id: noteLoopIntentId
        },
        payload: {
          generation_status: 'brainbase_source_ready',
          source_text_hash: 'hash-ready-1',
          title: '未生成会議1'
        }
      },
      {
        id: 'out_generated_1',
        workflow_run_id: 'run_generated_1',
        org_id: 'sample-project',
        project_id: 'sample-project',
        metadata: { output_key: 'meeting_note_draft', package_id: 'pkg-generated-1', loop_intent_id: noteLoopIntentId },
        payload: { generation_status: 'brainbase_generated', source_text_hash: 'hash-generated-1' }
      },
      {
        id: 'out_no_hash_1',
        workflow_run_id: 'run_no_hash_1',
        org_id: 'sample-project',
        project_id: 'sample-project',
        metadata: { output_key: 'meeting_note_draft', package_id: 'pkg-no-hash-1', loop_intent_id: noteLoopIntentId },
        payload: { generation_status: 'brainbase_source_ready' }
      }
    ]
  }));

  const stdout = execFileSync('node', [
    'script/backfill-eve-meeting-note-dispatch.mjs',
    '--ledger', ledgerPath
  ], { encoding: 'utf8' });

  // story-eve-dispatch-handoff-transcript-context S-007 backfill: brainbase_source_ready runs are enumerated for manual dispatch (workflow state transition backfill)
  expect(stdout).toContain('backfill candidates: 2');
  expect(stdout).toContain('run=run_ready_1');
  expect(stdout).not.toContain('run=run_generated_1');
  expect(stdout).toContain('run=run_no_hash_1');
  expect(stdout).toContain('skip: source_text_hash missing');
  expect(stdout).toContain('dry-run (use --execute to dispatch)');
});

test(`story-eve-dispatch-handoff-transcript-context ac:8 AC-008 docs contract: backfill runbook prescribes force_new_session and the dispatch API`, async () => {
  const runbook = await fs.promises.readFile('docs/runbooks/eve-meeting-note-backfill.md', 'utf8');
  expect(runbook).toContain('/api/workflows/control/loop-intents/:loopIntentId/eve-session');
  expect(runbook).toContain('force_new_session');
  expect(runbook).toContain('meeting_note_generation');
  expect(runbook).toContain('brainbase_source_ready');

  const story = await fs.promises.readFile(`docs/stories/${storyId}.md`, 'utf8');
  expect(story).toContain('docs/runbooks/eve-meeting-note-backfill.md');
});
