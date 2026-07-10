import { test, expect } from '@playwright/test';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MeetingSourceMcpSyncService,
  normalizeSourceArtifact,
  transcriptSegmentsToText
} from '../../server/services/meeting-source/meeting-source-mcp-sync-service.js';
import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import {
  WorkflowService,
  createDefaultWorkflowHandlers
} from '../../server/services/workflow/workflow-service.js';
import { meetingPackIds } from '../../server/services/workflow/meeting-workflow-pack.js';

const storyId = 'story-meeting-note-generation-dag-wiring';

function makeEveSessionClient({ reject = null }: { reject?: Error | null } = {}) {
  const calls: any[] = [];
  return {
    calls,
    isConfigured() {
      return true;
    },
    async createSession(input: any) {
      calls.push(input);
      if (reject) throw reject;
      return {
        session_id: 'eve-session-note-dag-001',
        continuation_token: 'cont-note-dag-001',
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

function samplePackage({ packageId = 'meeting-note-dag-package-e2e' } = {}) {
  const orgId = 'sample-project';
  const projectId = 'sample-project';
  return {
    schema_version: '0.1.0',
    package_id: packageId,
    status: 'review_required',
    meeting_identity: {
      source: 'mcp_meeting_source',
      title: '生成DAG配線E2E',
      start: '2026-07-10T10:00:00+09:00',
      candidate_org_id: orgId,
      candidate_project_id: projectId,
      case_scope: 'note-dag-e2e',
      graph_context: { source: 'meeting_source_mcp_sync' }
    },
    source_event: {
      source_system: 'plaud',
      meeting_mode: 'offline',
      mcp_resource_uri: 'plaud:file-e2e-1',
      local_artifact_sha256: 'hash-note-dag-e2e'
    },
    loop_intent_ids: {
      pre_meeting_briefing: meetingPackIds({ orgId, projectId, definitionId: 'pre-meeting-briefing' }).loopIntentId,
      transcript_to_meeting_note: meetingPackIds({ orgId, projectId, definitionId: 'transcript-to-meeting-note' }).loopIntentId,
      meeting_note_to_tasks: meetingPackIds({ orgId, projectId, definitionId: 'meeting-note-to-tasks' }).loopIntentId,
      meeting_note_to_decisions: meetingPackIds({ orgId, projectId, definitionId: 'meeting-note-to-decisions' }).loopIntentId,
      post_meeting_follow_up_message: meetingPackIds({ orgId, projectId, definitionId: 'post-meeting-follow-up-message' }).loopIntentId
    },
    meeting_note_summary: {
      title: '生成DAG配線E2E',
      body: '# 生成DAG配線E2E\n\n## Brainbase Meeting Pack Source\n\n## Primary Transcript Excerpt\n\nSpeaker 1: お疲れ様です。',
      generator: 'brainbase_meeting_pack',
      generation_source: 'transcript_to_meeting_note',
      generation_status: 'brainbase_source_ready',
      provider_note_authoritative: false,
      source_text_hash: 'hash-note-dag-e2e'
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

async function bootstrapAndIngest({ eveSessionClient = null }: { eveSessionClient?: any } = {}) {
  const { repository, service, actor } = makeService({ eveSessionClient });
  await service.bootstrapMeetingWorkflowPack({
    org_id: 'sample-project',
    project_id: 'sample-project'
  }, actor);
  const result = await service.ingestMeetingReviewPackage({
    review_package: samplePackage()
  }, actor);
  return { repository, service, actor, ingest: result.meeting_review_ingest };
}

test(`story-meeting-note-generation-dag-wiring ac:1 ac:2 AC-001 AC-002 S-001 JSON segment transcripts are normalized to speaker text before hashing`, async () => {
  const segmentJson = JSON.stringify([
    { content: 'お疲れ様です。', start_time: 80, end_time: 1000, speaker: 'Speaker 1', original_speaker: 'Speaker 1', embeddingKey: null },
    { content: '次のアクションを決めましょう。', start_time: 1000, end_time: 4760, speaker: 'Speaker 2', original_speaker: 'Speaker 2', embeddingKey: null }
  ]);

  expect(transcriptSegmentsToText(segmentJson)).toBe(
    'Speaker 1: お疲れ様です。\nSpeaker 2: 次のアクションを決めましょう。'
  );

  const artifact = normalizeSourceArtifact({
    id: 'plaud-e2e-1',
    title: 'Offline meeting',
    transcript_text: segmentJson,
    resource_uri: 'mcp://plaud/recordings/plaud-e2e-1'
  }, 'plaud');
  expect(artifact.source_text).not.toContain('{');
  expect(artifact.source_text).not.toContain('start_time');
  expect(artifact.text_preview.startsWith('Speaker 1: お疲れ様です。')).toBe(true);

  // story-meeting-note-generation-dag-wiring ac:2 plain-text and non-segment transcripts pass through unchanged
  const plainText = 'plain transcript stays as-is';
  expect(transcriptSegmentsToText(plainText)).toBe(plainText);
  expect(transcriptSegmentsToText('[1, 2, 3]')).toBe('[1, 2, 3]');
});

test(`story-meeting-note-generation-dag-wiring ac:1 ac:2 S-001 sync worker review package body carries readable transcript text end-to-end`, async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'meeting-note-dag-e2e-'));
  const workflowService = {
    calls: [] as any[],
    async ingestMeetingReviewPackage(input: any, actor: any) {
      this.calls.push({ input, actor });
      return { ok: true };
    }
  };
  const syncService = new MeetingSourceMcpSyncService({
    stateFile: path.join(dir, 'state.json'),
    workflowService,
    clock: () => '2026-07-10T00:00:00.000Z',
    adapters: {
      plaud: {
        async poll() {
          return [{
            id: 'plaud-file-1',
            title: 'オフライン会議',
            transcript_text: JSON.stringify([
              { content: 'お疲れ様です。', speaker: 'Speaker 1' },
              { content: '議事録生成DAGを接続します。', speaker: 'Speaker 2' }
            ]),
            meeting_mode: 'offline',
            resource_uri: 'mcp://plaud/recordings/plaud-file-1',
            updated_at: '2026-07-09T03:00:00.000Z'
          }];
        }
      }
    }
  });
  await syncService.connectProvider('plaud', { account_label: 'e2e plaud', credential_ref: 'secret:plaud' });
  const preview = await syncService.previewResync({ providers: ['plaud'], updated_since: '2026-07-01T00:00:00.000Z' });
  // story-meeting-note-generation-dag-wiring ac:2 normalized transcript feeds existing hash/dedupe/cursor path unchanged
  expect(preview.expected_meeting_pack_count).toBe(1);
  const confirmed = await syncService.confirmResync({
    preview_id: preview.preview_id,
    submit: true,
    actor: { sub: 'keigo', role: 'admin', projectCodes: ['brainbase'], org_id: 'unson', project_id: 'brainbase' }
  });
  expect(confirmed).toBeTruthy();
  expect(workflowService.calls).toHaveLength(1);
  const summary = workflowService.calls[0].input.review_package.meeting_note_summary;
  expect(summary.generation_status).toBe('brainbase_source_ready');
  expect(summary.body).toContain('Speaker 1: お疲れ様です。');
  expect(summary.body).toContain('Speaker 2: 議事録生成DAGを接続します。');
  expect(summary.body).not.toContain('\\u');
  expect(summary.body).not.toContain('"content"');
  expect(summary.source_transcripts[0].text).not.toContain('{');
});

test(`story-meeting-note-generation-dag-wiring ac:3 ac:4 AC-003 AC-004 S-002 ingest without Eve records a skipped dispatch and still succeeds`, async () => {
  const { repository, ingest } = await bootstrapAndIngest();

  expect(ingest.run.status).toBe('waiting_human');
  // story-meeting-note-generation-dag-wiring ac:4 ingest succeeds with skipped dispatch when Eve is not configured
  expect(ingest.note_generation_dispatch).toEqual({
    status: 'skipped',
    reason: 'eve_not_configured',
    loop_intent_id: meetingPackIds({
      orgId: 'sample-project',
      projectId: 'sample-project',
      definitionId: 'transcript-to-meeting-note'
    }).loopIntentId
  });
  expect(repository.listAuditLogs({ targetId: ingest.run.id })).toEqual(expect.arrayContaining([
    expect.objectContaining({
      action: 'workflow.meeting_pack.note_generation.dispatch_skipped',
      after: expect.objectContaining({ reason: 'eve_not_configured' })
    })
  ]));
});

test(`story-meeting-note-generation-dag-wiring ac:5 ac:6 AC-005 AC-006 S-002 ingest with Eve dispatches the note generation loop intent best-effort`, async () => {
  const eveSessionClient = makeEveSessionClient();
  const { repository, ingest } = await bootstrapAndIngest({ eveSessionClient });

  const noteLoopIntentId = meetingPackIds({
    orgId: 'sample-project',
    projectId: 'sample-project',
    definitionId: 'transcript-to-meeting-note'
  }).loopIntentId;
  expect(ingest.note_generation_dispatch).toEqual({
    status: 'requested',
    loop_intent_id: noteLoopIntentId,
    eve_session_run_id: expect.any(String)
  });
  expect(eveSessionClient.calls).toHaveLength(1);
  expect(repository.getLoopIntent(noteLoopIntentId)).toMatchObject({ status: 'dispatched' });

  // story-meeting-note-generation-dag-wiring ac:6 dispatch failure keeps ingest successful and audited
  const failing = makeEveSessionClient({ reject: new Error('eve down') });
  const failed = await bootstrapAndIngest({ eveSessionClient: failing });
  expect(failed.ingest.run.status).toBe('waiting_human');
  expect(failed.ingest.note_generation_dispatch).toMatchObject({
    status: 'skipped',
    reason: 'dispatch_failed'
  });
});

test(`story-meeting-note-generation-dag-wiring ac:7 ac:8 ac:9 ac:10 AC-007 AC-008 AC-009 AC-010 S-003 note generation write-back updates the draft output with hash validation`, async () => {
  const { repository, service, actor, ingest } = await bootstrapAndIngest();
  const noteOutput = ingest.outputs.find((output: any) => output.metadata?.output_key === 'meeting_note_draft');
  expect(noteOutput.payload.generation_status).toBe('brainbase_source_ready');

  const recorded = await service.recordMeetingNoteGeneration({
    org_id: 'sample-project',
    project_id: 'sample-project',
    package_id: 'meeting-note-dag-package-e2e',
    source_text_hash: 'hash-note-dag-e2e',
    note: { body: '# 生成DAG配線E2E 議事録\n\n## 決定事項\n\n- DAGを接続した' },
    runner: { type: 'eve', session_id: 'eve-session-note-dag-001' }
  }, actor);

  expect(recorded.meeting_note_generation).toMatchObject({
    run_id: ingest.run.id,
    output_id: noteOutput.id,
    generation_status: 'brainbase_generated'
  });
  const updated = repository.getOutput(noteOutput.id);
  expect(updated.payload).toMatchObject({
    body: '# 生成DAG配線E2E 議事録\n\n## 決定事項\n\n- DAGを接続した',
    generator: 'brainbase_meeting_pack',
    generation_source: 'transcript_to_meeting_note',
    generation_status: 'brainbase_generated',
    provider_note_authoritative: false,
    source_text_hash: 'hash-note-dag-e2e',
    generated_by: expect.objectContaining({ type: 'eve', session_id: 'eve-session-note-dag-001' })
  });
  expect(updated.payload.body).not.toContain('Primary Transcript Excerpt');
  // story-meeting-note-generation-dag-wiring ac:7 preview is the field the review UI renders; it must reflect the generated note
  expect(String(updated.preview)).toContain('生成DAG配線E2E 議事録');
  expect(String(updated.preview)).not.toContain('Primary Transcript Excerpt');

  // story-meeting-note-generation-dag-wiring ac:8 hash-mismatched write-back is rejected with blocked_source_hash_mismatch
  await expect(service.recordMeetingNoteGeneration({
    org_id: 'sample-project',
    project_id: 'sample-project',
    package_id: 'meeting-note-dag-package-e2e',
    source_text_hash: 'hash-of-another-meeting',
    note: { body: '# 別会議の議事録' }
  }, actor)).rejects.toMatchObject({
    details: { state_transition: 'blocked_source_hash_mismatch' }
  });

  // story-meeting-note-generation-dag-wiring ac:9 unknown run or missing note output write-back is rejected
  await expect(service.recordMeetingNoteGeneration({
    org_id: 'sample-project',
    project_id: 'sample-project',
    package_id: 'unknown-package',
    source_text_hash: 'hash-note-dag-e2e',
    note: { body: '# 議事録' }
  }, actor)).rejects.toMatchObject({ statusCode: 404 });

  // story-meeting-note-generation-dag-wiring ac:10 regeneration overwrites the note without status regression
  const regenerated = await service.recordMeetingNoteGeneration({
    org_id: 'sample-project',
    project_id: 'sample-project',
    run_id: ingest.run.id,
    source_text_hash: 'hash-note-dag-e2e',
    note: { body: '# 生成DAG配線E2E 議事録 v2' },
    runner: { type: 'claude_code' }
  }, actor);
  expect(regenerated.meeting_note_generation.generation_status).toBe('brainbase_generated');
  expect(repository.getOutput(noteOutput.id).payload.body).toBe('# 生成DAG配線E2E 議事録 v2');
});

test(`story-meeting-note-generation-dag-wiring ac:11 AC-011 human steps and candidate outputs stay untouched by the wiring`, async () => {
  const { ingest } = await bootstrapAndIngest();
  expect(ingest.outputs.map((output: any) => output.type)).toEqual([
    'meeting_note_draft',
    'task_candidates',
    'decision_candidates',
    'message_draft',
    'promotion_candidates'
  ]);
  expect(ingest.human_steps).toHaveLength(5);
  expect(ingest.human_steps.every((step: any) => step.status === 'pending')).toBe(true);
  expect(ingest.run.metadata.runner).toEqual({
    type: 'codex_generated_package',
    eve_connected: false
  });
});

test(`story-meeting-note-generation-dag-wiring ac:12 AC-012 S-004 same recording converges to the existing run when the hash-derived package_id changes`, async () => {
  const { repository, service, actor } = makeService();
  await service.bootstrapMeetingWorkflowPack({ org_id: 'sample-project', project_id: 'sample-project' }, actor);
  const original = samplePackage();
  const first = await service.ingestMeetingReviewPackage({ review_package: original }, actor);
  expect(first.meeting_review_ingest.idempotent).toBe(false);

  // story-meeting-note-generation-dag-wiring ac:12 hashing-scheme change shifts package_id but the source recording is the same
  const rehashed = samplePackage({ packageId: 'meeting-note-dag-package-rehashed' });
  const replay = await service.ingestMeetingReviewPackage({ review_package: rehashed }, actor);
  expect(replay.meeting_review_ingest).toMatchObject({
    idempotent: true,
    idempotent_source: 'source_artifact_match',
    prior_package_id: 'meeting-note-dag-package-e2e',
    run: { id: first.meeting_review_ingest.run.id }
  });
  expect(repository.ledger.runs).toHaveLength(1);
  expect(repository.ledger.outputs).toHaveLength(5);
});

test(`story-meeting-note-generation-dag-wiring ac:1 ac:11 S-001 S-003 review surface renders readable draft preview and unchanged approval flow`, async ({ page }) => {
  const readablePreview = 'Speaker 1: お疲れ様です。 Speaker 2: 議事録生成DAGを接続します。';
  const run = {
    id: 'run-note-dag-ui-1',
    workflow_id: 'wf-note-dag-ui-1',
    org_id: 'sample-project',
    project_id: 'sample-project',
    status: 'waiting_human',
    closure_state: 'open',
    trigger_type: 'event',
    env: 'local',
    action_required: 'approve',
    human_waiting: true,
    message: 'Meeting Review Package is waiting for human approval',
    metadata: {
      package_id: 'meeting-note-dag-package-ui',
      runner: { type: 'codex_generated_package', eve_connected: false }
    }
  };
  const humanSteps = [
    '議事録ドラフトの公開可否を確認してください',
    'Task候補を作成してよいか確認してください',
    'Decision候補をGraph SSOTへ昇格してよいか確認してください',
    'フォローアップ文面を外部送信してよいか確認してください',
    'Graph / Learning昇格候補を次の審査へ回してよいか確認してください'
  ].map((prompt, index) => ({
    id: `human-note-dag-ui-${index + 1}`,
    workflow_run_id: run.id,
    workflow_id: run.workflow_id,
    step_type: 'approval',
    status: 'pending',
    prompt,
    metadata: { package_id: 'meeting-note-dag-package-ui', requires_human_approval: true }
  }));
  const workflow = {
    id: run.workflow_id,
    project_id: 'sample-project',
    owner_id: 'keigo',
    name: 'Meeting Review Package Ingest',
    implementation_key: 'meeting-review-package-ingest',
    context_sources: [],
    latest_run: run,
    latest_human_steps: humanSteps,
    latest_context_snapshots: []
  };
  await page.route('**/api/config/projects', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [{ id: 'sample-project', name: 'Sample Project' }] }) });
  });
  await page.route('**/api/workflows/control/**', async (route) => {
    const url = new URL(route.request().url());
    const emptyByPath: Record<string, unknown> = {
      '/api/workflows/control/role-agents': { role_agent_instances: [] },
      '/api/workflows/control/templates': { workflow_templates: [] },
      '/api/workflows/control/bindings': { workflow_bindings: [] },
      '/api/workflows/control/triggers': { workflow_triggers: [] },
      '/api/workflows/control/loop-intents': { loop_intents: [] }
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyByPath[url.pathname] || {}) });
  });
  await page.route('**/api/workflows', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflows: [workflow] }) });
  });
  await page.route(`**/api/workflows/${run.workflow_id}`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflow, context_sources: [], runs: [run] }) });
  });
  let outputPreview = readablePreview;
  let outputGenerationStatus = 'brainbase_source_ready';
  await page.route(`**/api/workflow-runs/${run.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run,
        run_steps: [],
        context_snapshots: [],
        human_steps: humanSteps,
        outputs: [{
          id: 'out-note-dag-ui',
          title: '議事録ドラフト',
          type: 'meeting_note_draft',
          preview: outputPreview,
          payload: { generation_status: outputGenerationStatus }
        }],
        audit_logs: []
      })
    });
  });

  await page.goto('/workflows');
  await expect(page.getByRole('heading', { name: 'Workflow Mission Control' })).toBeVisible();
  await page.getByText('Meeting Review Package Ingest').click();
  await page.getByText(run.id).click();
  await expect(page.getByRole('heading', { name: 'Run Trace' })).toBeVisible();
  // story-meeting-note-generation-dag-wiring ac:1 the review surface shows speaker-attributed readable text, no JSON escapes
  await expect(page.getByText('Speaker 1: お疲れ様です。', { exact: false })).toBeVisible();
  // pre-generation output is labeled 生成待ち so approvers can tell source text from generated minutes
  await expect(page.getByText('生成待ち', { exact: true })).toBeVisible();
  await expect(page.getByText('生成済み', { exact: true })).toHaveCount(0);
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toContain('\\u30');
  expect(bodyText).not.toContain('"content"');
  // story-meeting-note-generation-dag-wiring ac:11 approval flow unchanged: 5 pending approval gates
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(5);

  // story-meeting-note-generation-dag-wiring ac:7 after DAG write-back the same surface renders the generated minutes
  outputPreview = '# 生成DAG配線E2E 議事録 ## 決定事項 - DAGを接続した (brainbase_generated)';
  outputGenerationStatus = 'brainbase_generated';
  await page.goto('/workflows');
  await page.getByText('Meeting Review Package Ingest').click();
  await page.getByText(run.id).click();
  await expect(page.getByRole('heading', { name: 'Run Trace' })).toBeVisible();
  await expect(page.getByText('生成DAG配線E2E 議事録', { exact: false })).toBeVisible();
  // post-write-back output is labeled 生成済み
  await expect(page.getByText('生成済み', { exact: true })).toBeVisible();
  await expect(page.getByText('生成待ち', { exact: true })).toHaveCount(0);
  const generatedBodyText = await page.locator('body').innerText();
  expect(generatedBodyText).not.toContain('Primary Transcript Excerpt');
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(5);
});

test(`story-meeting-note-generation-dag-wiring docs contract`, async () => {
  const story = fs.readFileSync('docs/stories/story-meeting-note-generation-dag-wiring.md', 'utf8');
  expect(story).toContain('INV-note-dag-001');
  expect(story).toContain('brainbase_generated');
  const spec = fs.readFileSync('docs/specs/story-meeting-note-generation-dag-wiring-spec.md', 'utf8');
  expect(spec).toContain('note-generation');
  expect(spec).toContain('blocked_source_hash_mismatch');
});
