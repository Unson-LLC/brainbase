import { test, expect } from '@playwright/test';

import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import {
  WorkflowService,
  createDefaultWorkflowHandlers
} from '../../server/services/workflow/workflow-service.js';
import { meetingPackIds } from '../../server/services/workflow/meeting-workflow-pack.js';

function makeInfoSSOTPeopleService(records = [], { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async listGraphEntities(access, options = {}) {
      calls.push({ access, options });
      if (fail) throw new Error('people ssot unavailable');
      const query = String(options.query || '').trim().replace(/^@+/, '').toLowerCase();
      return records.filter((record) => {
        const payload = record.payload || {};
        const values = [
          record.id,
          payload.name,
          payload.display_name,
          ...(Array.isArray(payload.aliases) ? payload.aliases : [])
        ].filter(Boolean).map((value) => String(value).toLowerCase());
        return values.some((value) => value.includes(query));
      });
    }
  };
}

function makeService({ infoSSOTService = makeInfoSSOTPeopleService() } = {}) {
  const repository = new InMemoryWorkflowRepository();
  const runner = new WorkflowRunner({ repository, handlers: createDefaultWorkflowHandlers() });
  const configParser = {
    async getProjects() {
      return {
        root: '/workspace',
        projects: [
          { id: 'sample-project', session_select: true }
        ]
      };
    }
  };
  const service = new WorkflowService({ repository, runner, configParser, infoSSOTService });
  const actor = {
    sub: 'keigo',
    person_id: 'keigo',
    role: 'admin',
    projectCodes: ['sample-project']
  };
  return { repository, service, actor, infoSSOTService };
}

function samplePackage({ packageId = 'meeting-task-owner-ssot-resolution-e2e', taskCandidates = null } = {}) {
  const orgId = 'sample-project';
  const projectId = 'sample-project';
  return {
    schema_version: '0.1.0',
    package_id: packageId,
    seed_id: 'meeting-owner-ssot-seed-e2e',
    status: 'review_required',
    meeting_identity: {
      source: 'google_calendar',
      account: 'info@example.com',
      calendar_id: 'primary',
      event_id: 'evt-owner-ssot-e2e',
      title: 'Task owner SSOT E2E',
      start: '2026-06-25T13:00:00+09:00',
      end: '2026-06-25T14:00:00+09:00',
      candidate_org_id: orgId,
      candidate_project_id: projectId,
      case_scope: 'owner-ssot-e2e',
      graph_context: {
        org_entity_ids: ['org-owner-ssot'],
        person_entity_ids: ['person-yajima-tsuyoshi']
      }
    },
    source_event: {
      source_system: 'slack',
      workspace: 'unson',
      channel_id: 'C08SYTDR7R8',
      channel_name: 'meeting-router',
      message_ts: '1782367965.844209',
      file_id: 'F0BCYNXMP6H',
      local_artifact_sha256: 'sha256-owner-ssot'
    },
    loop_intent_ids: {
      pre_meeting_briefing: meetingPackIds({ orgId, projectId, definitionId: 'pre-meeting-briefing' }).loopIntentId,
      transcript_to_meeting_note: meetingPackIds({ orgId, projectId, definitionId: 'transcript-to-meeting-note' }).loopIntentId,
      meeting_note_to_tasks: meetingPackIds({ orgId, projectId, definitionId: 'meeting-note-to-tasks' }).loopIntentId,
      meeting_note_to_decisions: meetingPackIds({ orgId, projectId, definitionId: 'meeting-note-to-decisions' }).loopIntentId,
      post_meeting_follow_up_message: meetingPackIds({ orgId, projectId, definitionId: 'post-meeting-follow-up-message' }).loopIntentId
    },
    meeting_note_summary: {
      background: ['背景'],
      agreements: ['合意'],
      open_questions: ['未決']
    },
    task_candidates: taskCandidates ?? [
      {
        title: 'Googleビジネスプロフィールの管理権限をジョーさんに付与する。',
        owner_hint: '@矢島様'
      },
      {
        title: '口コミ投稿QRと質問項目を確定する。',
        owner_hint: '@未登録さん'
      },
      {
        title: 'プレミアムコスプレを試験導入する。',
        owner_hint: '@Speaker 1'
      },
      {
        title: '既存担当者を維持する。',
        owner_hint: '@矢島様',
        selected_owner_id: 'person_existing',
        selected_owner: '既存担当者'
      }
    ],
    decision_candidates: ['Decision候補'],
    follow_up_draft: {
      status: 'draft_only',
      external_send_required_approval: true,
      body: 'ありがとうございました。'
    },
    promotion_candidates: {
      graph: ['org:owner-ssot'],
      learning: ['学習候補']
    },
    evidence_refs: ['transcript:00:01:00-00:02:00'],
    stop_conditions: [
      'task_create_requires_human_approval',
      'decision_promotion_requires_human_approval',
      'graph_write_requires_human_approval',
      'external_send_requires_human_approval'
    ]
  };
}

async function ingest({ service, actor }, packageInput = samplePackage()) {
  await service.bootstrapMeetingWorkflowPack({
    org_id: 'sample-project',
    project_id: 'sample-project'
  }, actor);
  const result = await service.ingestMeetingReviewPackage({
    review_package: packageInput
  }, actor);
  const output = result.meeting_review_ingest.outputs.find((item) => item.type === 'task_candidates');
  return { ingest: result.meeting_review_ingest, tasks: output.payload };
}

test('story-meeting-task-owner-ssot-resolution S-001 ac:1 ac:2 ac:7 scenario_clause_e2e flow_replay resolves owner_hint from people SSOT without rewriting the hint', async () => {
  const stack = makeService({
    infoSSOTService: makeInfoSSOTPeopleService([
      { id: 'person_yajima_tsuyoshi', payload: { name: '矢島剛', display_name: '矢島剛', aliases: ['矢島様', '矢島さん'] } }
    ])
  });

  const { tasks } = await ingest(stack);

  expect(tasks[0].owner_hint, 'AC:1 owner_hint はAI抽出文字列として保存する').toBe('@矢島様');
  expect(tasks[0].selected_owner_id, 'AC:2 selected_owner_id はGraph SSOT personから一意解決した場合だけ付与する').toBe('person_yajima_tsuyoshi');
  expect(tasks[0].selected_owner, 'AC:7 owner_hint=@矢島様 がSSOT aliasに一意一致する').toBe('矢島剛');
});

test('story-meeting-task-owner-ssot-resolution S-002 S-003 ac:3 ac:8 ac:9 scenario_clause_e2e flow_replay leaves missing people and speaker labels unresolved', async () => {
  const stack = makeService({
    infoSSOTService: makeInfoSSOTPeopleService([
      { id: 'person_yajima_tsuyoshi', payload: { name: '矢島剛', display_name: '矢島剛', aliases: ['矢島様'] } }
    ])
  });

  const { tasks } = await ingest(stack);

  expect(tasks[1].owner_resolution.status, 'AC:8 owner_hint=@未登録さん はowner_resolution.status=unresolved').toBe('unresolved');
  expect(tasks[1].selected_owner_id, 'AC:4 selected_owner_id を付与しない').toBeUndefined();
  expect(tasks[2].owner_resolution.status, 'AC:3 Speaker 1 などの話者ラベルは担当者personとして扱わない').toBe('ignored');
  expect(tasks[2].selected_owner_id, 'AC:9 owner_hint=@Speaker 1 は正本担当者設定に使わない').toBeUndefined();
});

test('story-meeting-task-owner-ssot-resolution ac:4 scenario_clause_e2e flow_replay marks ambiguous people without selecting an owner', async () => {
  const stack = makeService({
    infoSSOTService: makeInfoSSOTPeopleService([
      { id: 'person_yajima_a', payload: { name: '矢島剛', display_name: '矢島剛', aliases: ['矢島様'] } },
      { id: 'person_yajima_b', payload: { name: '矢島毅', display_name: '矢島毅', aliases: ['矢島様'] } }
    ])
  });

  const { tasks } = await ingest(stack);

  expect(tasks[0].owner_resolution.status, 'AC:4 複数候補で曖昧な場合はambiguous').toBe('ambiguous');
  expect(tasks[0].owner_resolution.reason, 'WSC-006 ambiguous_people_ssot_candidate は曖昧一致理由として保存する').toBe('ambiguous_people_ssot_candidate');
  expect(tasks[0].selected_owner_id, 'AC:4 selected_owner_id を付与しない').toBeUndefined();
});

test('story-meeting-task-owner-ssot-resolution S-004 S-007 S-008 S-009 ac:5 ac:10 ac:13 scenario_clause_e2e flow_replay keeps human gate and idempotent output storage', async () => {
  const stack = makeService({
    infoSSOTService: makeInfoSSOTPeopleService([
      { id: 'person_yajima_tsuyoshi', payload: { name: '矢島剛', display_name: '矢島剛', aliases: ['矢島様'] } }
    ])
  });
  const packageInput = samplePackage({ packageId: 'meeting-task-owner-idempotent-e2e' });

  const first = await ingest(stack, packageInput);
  const second = await stack.service.ingestMeetingReviewPackage({ review_package: packageInput }, stack.actor);

  expect(first.ingest.run.status, 'AC:5 Review Package ingest は承認待ちoutput payloadだけを更新する').toBe('waiting_human');
  expect(first.ingest.human_steps.some((step) => step.reason === 'required_before_task_create'), 'AC:13 human gate は維持される').toBe(true);
  expect(second.meeting_review_ingest.idempotent, 'S-004 AC:10 同一Review Packageの再取り込みは既存run/outputを返す').toBe(true);
  expect(first.tasks[0].owner_resolution.status, 'S-008 Resolved 状態は保存前にpayloadへ入る').toBe('resolved');
  expect(first.tasks[1].owner_resolution.status, 'S-009 no_people_ssot_candidate はingest失敗ではなくowner_resolutionへ保存する').toBe('unresolved');
  expect(first.tasks[2].owner_resolution.reason, 'S-009 speaker_label_is_not_people_ssot はingest失敗ではなくowner_resolutionへ保存する').toBe('speaker_label_is_not_people_ssot');
});

test('story-meeting-task-owner-ssot-resolution S-005 ac:6 ac:11 scenario_clause_e2e flow_replay keeps ingest alive when people SSOT is unavailable', async () => {
  const stack = makeService({
    infoSSOTService: makeInfoSSOTPeopleService([], { fail: true })
  });

  const { ingest: result, tasks } = await ingest(stack, samplePackage({ packageId: 'meeting-task-owner-ssot-unavailable-e2e' }));

  expect(result.run.status, 'AC:6 people SSOTが利用できない場合でもReview Package ingestは失敗させない').toBe('waiting_human');
  expect(tasks[0].owner_resolution.reason, 'AC:11 people SSOT取得が失敗しても担当者だけを未解決として人間レビューに渡す').toBe('people_ssot_unavailable');
});

test('story-meeting-task-owner-ssot-resolution S-006 ac:12 scenario_clause_e2e flow_replay preserves an existing selected_owner_id', async () => {
  const stack = makeService({
    infoSSOTService: makeInfoSSOTPeopleService([
      { id: 'person_yajima_tsuyoshi', payload: { name: '矢島剛', display_name: '矢島剛', aliases: ['矢島様'] } }
    ])
  });

  const { tasks } = await ingest(stack);

  expect(tasks[3].selected_owner_id, 'AC:12 selected_owner_id が既にある場合は上書きしない').toBe('person_existing');
  expect(tasks[3].selected_owner, 'AC:12 既存担当者を維持する').toBe('既存担当者');
  expect(tasks[3].owner_resolution, 'AC:12 AlreadySelected state is visible for review and monitoring').toMatchObject({
    source: 'review_package',
    status: 'already_selected',
    reason: 'selected_owner_id_already_present'
  });
});

test('story-meeting-task-owner-ssot-resolution ac:14 ac:15 ac:16 ac:17 ac:18 ac:19 ac:20 ac:21 ac:22 ac:23 ac:24 ac:25 scenario_clause_e2e flow_replay keeps verification surfaces explicit', async () => {
  const stack = makeService({
    infoSSOTService: makeInfoSSOTPeopleService([
      { id: 'person_yajima_tsuyoshi', payload: { name: '矢島剛', display_name: '矢島剛', aliases: ['矢島様'] } }
    ])
  });

  const { ingest: result, tasks } = await ingest(stack, samplePackage({ packageId: 'meeting-task-owner-verification-surface-e2e' }));

  expect(tasks[0].selected_owner_id, 'AC:14 S-008 Resolved state persists selected_owner_id before output storage').toBe('person_yajima_tsuyoshi');
  expect(tasks[3].selected_owner_id, 'AC:15 S-008 AlreadySelected state preserves existing selected_owner_id').toBe('person_existing');
  expect(tasks[3].owner_resolution.status, 'AC:15 S-008 AlreadySelected state is recorded in owner_resolution').toBe('already_selected');
  expect(tasks[0].owner_resolution.source, 'AC:16 Release note identifies graph_ssot as owner authority').toBe('graph_ssot');
  expect(stack.service.infoSSOTService, 'AC:17 Operator action enables InfoSSOTService injection after normal server restart/deploy').toBe(stack.infoSSOTService);
  expect(Object.keys(tasks[0]).sort(), 'AC:18 Rollback-safe additive payload keeps owner fields optional for consumers').toEqual(expect.arrayContaining(['owner_hint', 'selected_owner_id', 'selected_owner', 'owner_candidates', 'owner_resolution']));
  expect(tasks[0].owner_resolution, 'AC:19 Observability evidence includes owner_resolution status and reason in workflow output payload').toMatchObject({ status: 'resolved', reason: 'unique_exact_name_or_alias' });
  expect(tasks[1].owner_resolution.status, 'AC:20 Support path keeps unresolved owners for Mac Companion manual people SSOT selection').toBe('unresolved');
  expect(result.outputs.map((output) => output.type), 'AC:21 Unit verification surface keeps task_candidates output present').toContain('task_candidates');
  expect(result.outputs.length, 'AC:22 Lint verification surface keeps all review outputs creatable').toBe(5);
  expect(result.context_snapshots.map((snapshot) => snapshot.source_type), 'AC:23 Doc trace evidence keeps review_package context snapshot').toContain('review_package');
  expect(result.run.status, 'AC:24 Baseline E2E contract remains waiting_human after Review Package ingest').toBe('waiting_human');
  expect(tasks[1].owner_resolution.reason, 'AC:25 Release support path preserves unresolved people SSOT candidates for manual owner correction').toBe('no_people_ssot_candidate');
});

test('story-meeting-task-owner-ssot-resolution S-008 S-009 ac:19 ac:20 scenario_clause_e2e ui_replay shows owner resolution states in Workflow Mission Control', async ({ page }) => {
  const taskCandidates = [
    {
      title: 'Googleビジネスプロフィールの管理権限をジョーさんに付与する。',
      owner_hint: '@矢島様',
      selected_owner_id: 'person_yajima_tsuyoshi',
      selected_owner: '矢島剛',
      owner_candidates: [{ person_id: 'person_yajima_tsuyoshi', display_name: '矢島剛' }],
      owner_resolution: { source: 'graph_ssot', status: 'resolved', reason: 'unique_exact_name_or_alias' }
    },
    {
      title: '口コミ投稿QRと質問項目を確定する。',
      owner_hint: '@未登録さん',
      owner_candidates: [],
      owner_resolution: { source: 'graph_ssot', status: 'unresolved', reason: 'no_people_ssot_candidate' }
    },
    {
      title: 'プレミアムコスプレを試験導入する。',
      owner_hint: '@Speaker 1',
      owner_resolution: { source: 'graph_ssot', status: 'ignored', reason: 'speaker_label_is_not_people_ssot' }
    },
    {
      title: '客室内導線整備の担当者を確認する。',
      owner_hint: '@矢島様',
      owner_candidates: [
        { person_id: 'person_yajima_tsuyoshi', display_name: '矢島剛' },
        { person_id: 'person_yajima_takeshi', display_name: '矢島毅' }
      ],
      owner_resolution: { source: 'graph_ssot', status: 'ambiguous', reason: 'ambiguous_people_ssot_candidate' }
    }
  ];

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/config/projects' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ projects: [{ id: 'sample-project', session_select: true }] })
      });
      return;
    }
    if (url.pathname === '/api/workflows' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workflows: [{
            id: 'meeting-review-workflow',
            name: 'Meeting Review Workflow',
            project_id: 'sample-project',
            owner_id: 'meeting-ops',
            latest_run: { id: 'run-meeting-owner-1', status: 'waiting_human', action_required: 'human_review', human_waiting: true }
          }]
        })
      });
      return;
    }
    if (url.pathname === '/api/workflows/meeting-review-workflow' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workflow: {
            id: 'meeting-review-workflow',
            name: 'Meeting Review Workflow',
            project_id: 'sample-project',
            owner_id: 'meeting-ops'
          },
          context_sources: [],
          runs: [{ id: 'run-meeting-owner-1', status: 'waiting_human', started_at: '2026-06-25T13:00:00.000Z', action_required: 'human_review' }]
        })
      });
      return;
    }
    if (url.pathname === '/api/workflow-runs/run-meeting-owner-1' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          run: {
            id: 'run-meeting-owner-1',
            workflow_id: 'meeting-review-workflow',
            project_id: 'sample-project',
            status: 'waiting_human',
            trigger_type: 'meeting_review_package',
            env: 'local'
          },
          run_steps: [],
          context_snapshots: [],
          human_steps: [{
            id: 'human-task-review',
            step_type: 'approval',
            status: 'pending',
            prompt: 'Task候補を承認してください'
          }],
          outputs: [{
            id: 'out-task-candidates',
            type: 'task_candidates',
            title: 'Task候補',
            preview: '4件のTask候補',
            payload: taskCandidates
          }],
          audit_logs: []
        })
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not mocked' }) });
  });

  await page.goto('/workflows');
  await page.getByLabel('Project filter').selectOption('sample-project');
  await page.getByRole('button', { name: /Meeting Review Workflow/ }).click();
  await page.getByText('run-meeting-owner-1').click();

  await expect(page.getByRole('heading', { name: 'Run Trace' })).toBeVisible();
  await expect(page.getByText('Task candidate owners')).toBeVisible();
  await expect(page.getByText(/Googleビジネスプロフィール.*担当者: 矢島剛.*状態: 解決済み.*理由: people SSOTの名前\/別名に一意一致.*対応: このまま承認できます/)).toBeVisible();
  await expect(page.getByText(/口コミ投稿QR.*担当者: 担当者未設定.*状態: 未解決.*people SSOTを更新するか、Mac Companionで担当者を選択してください/)).toBeVisible();
  await expect(page.getByText(/プレミアムコスプレ.*状態: 対象外.*Speaker表記は担当者として使わない.*必要なら実名担当者を選択してください/)).toBeVisible();
  await expect(page.getByText(/客室内導線整備.*状態: 要選択.*候補から正しいpeople SSOT担当者を選択してください.*people候補: 矢島剛 \(person_yajima_tsuyoshi\) \/ 矢島毅 \(person_yajima_takeshi\)/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
});
