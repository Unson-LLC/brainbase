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
  const recordProjectCodes = (record) => {
    const payload = record.payload || {};
    const values = [
      record.project_id,
      record.projectId,
      record.project_code,
      record.projectCode,
      record.project_codes,
      record.projectCodes,
      record.member_of_project_codes,
      record.memberOfProjectCodes,
      payload.project_id,
      payload.projectId,
      payload.project_code,
      payload.projectCode,
      payload.project_codes,
      payload.projectCodes,
      payload.member_of_project_codes,
      payload.memberOfProjectCodes
    ].flat().filter(Boolean).map(String);
    return new Set(values);
  };
  return {
    calls,
    async listGraphEntities(access, options = {}) {
      calls.push({ access, options });
      if (fail) throw new Error('people ssot unavailable');
      const query = String(options.query || '').trim().replace(/^@+/, '').toLowerCase();
      const projectCode = String(options.projectCode || '').trim();
      const id = String(options.id || '').trim();
      return records.filter((record) => {
        const payload = record.payload || {};
        if (projectCode && !recordProjectCodes(record).has(projectCode)) return false;
        if (id) return [record.id, record.entity_id, payload.person_id, payload.id].filter(Boolean).map(String).includes(id);
        const values = [
          record.id,
          payload.name,
          payload.display_name,
          ...(Array.isArray(payload.aliases) ? payload.aliases : [])
        ].filter(Boolean).map((value) => String(value).toLowerCase());
        if (!query) return true;
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
          { id: 'sample-project', session_select: true },
          { id: 'tech-knight', session_select: true },
          { id: 'techknight', session_select: true }
        ]
      };
    }
  };
  const service = new WorkflowService({ repository, runner, configParser, infoSSOTService });
  const actor = {
    sub: 'keigo',
    person_id: 'keigo',
    role: 'admin',
    projectCodes: ['sample-project', 'tech-knight', 'techknight']
  };
  return { repository, service, actor, infoSSOTService };
}

function samplePackage({
  packageId = 'meeting-task-owner-ssot-resolution-e2e',
  orgId = 'sample-project',
  projectId = 'sample-project',
  taskCandidates = null
} = {}) {
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
        selected_owner_id: 'person_yajima_tsuyoshi',
        selected_owner: '矢島剛'
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
  const meetingIdentity = packageInput.meeting_identity || {};
  const orgId = packageInput.org_id || meetingIdentity.candidate_org_id || 'sample-project';
  const projectId = packageInput.project_id || meetingIdentity.candidate_project_id || 'sample-project';
  await service.bootstrapMeetingWorkflowPack({
    org_id: orgId,
    project_id: projectId
  }, actor);
  const result = await service.ingestMeetingReviewPackage({
    review_package: packageInput
  }, actor);
  const output = result.meeting_review_ingest.outputs.find((item) => item.type === 'task_candidates');
  return { ingest: result.meeting_review_ingest, tasks: output.payload };
}

test('story-meeting-task-owner-ssot-resolution S-001 AC-001 AC-002 AC-007 scenario_clause_e2e flow_replay resolves owner_hint from people SSOT without rewriting the hint', async () => {
  const stack = makeService({
    infoSSOTService: makeInfoSSOTPeopleService([
      { id: 'person_yajima_tsuyoshi', payload: { name: '矢島剛', display_name: '矢島剛', aliases: ['矢島様', '矢島さん'] } }
    ])
  });

  const { tasks } = await ingest(stack);

  expect(tasks[0].owner_hint, 'AC-001 owner_hint はAI抽出文字列として保存する').toBe('@矢島様');
  expect(tasks[0].selected_owner_id, 'AC-002 selected_owner_id はGraph SSOT personから一意解決した場合だけ付与する').toBe('person_yajima_tsuyoshi');
  expect(tasks[0].selected_owner, 'AC-007 owner_hint=@矢島様 がSSOT aliasに一意一致する').toBe('矢島剛');
});

test('story-meeting-task-owner-ssot-resolution production_path_matrix workflow_flow_replay scenario_clause_e2e ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9 ac:10 ac:11 ac:12 ac:13 ac:14 ac:15 ac:16 ac:17 ac:18 ac:19 ac:20 ac:21 ac:22 real HTTP review-ingest stores owner_resolution and API reads it back', async ({ request }) => {
  const orgId = 'salestailor';
  const projectId = 'salestailor';
  const headers = {
    'x-brainbase-role': 'member',
    'x-brainbase-projects': projectId
  };
  const csrfResponse = await request.get('/api/csrf-token');
  expect(csrfResponse.ok(), 'ac:17 real server exposes CSRF token for workflow control POSTs').toBeTruthy();
  const csrfBody = await csrfResponse.json();
  const writeHeaders = { ...headers, 'x-csrf-token': csrfBody.token };

  const bootstrapResponse = await request.post('/api/workflows/control/meeting-pack/bootstrap', {
    headers: writeHeaders,
    data: { org_id: orgId, project_id: projectId }
  });
  expect(bootstrapResponse.ok(), 'ac:17 real server bootstrap path seeds Meeting Pack loop intents').toBeTruthy();

  const packageId = `meeting-owner-runtime-${Date.now()}`;
  const ingestResponse = await request.post('/api/workflows/control/meeting-pack/review-ingest', {
    headers: writeHeaders,
    data: {
      review_package: samplePackage({
        packageId,
        orgId,
        projectId,
        taskCandidates: [
          {
            title: '佐藤さんにMeeting Packの再生成結果を確認してもらう。',
            owner_hint: '@佐藤さん'
          },
          {
            title: 'Speaker表記は担当者として使わない。',
            owner_hint: '@Speaker 1'
          },
          {
            title: '既存担当者IDはpeople SSOTで検証してから維持する。',
            owner_hint: '@佐藤さん',
            selected_owner_id: 'person_runtime_unknown',
            selected_owner: 'Runtime Unknown'
          }
        ]
      })
    }
  });
  expect(ingestResponse.ok(), 'ac:5 real HTTP review package ingest succeeds and waits at human gate').toBeTruthy();
  const ingestBody = await ingestResponse.json();
  const runId = ingestBody.meeting_review_ingest.run.id;
  const workflowId = ingestBody.meeting_review_ingest.run.workflow_id;
  expect(ingestBody.meeting_review_ingest.run.status, 'ac:5 ac:13 human gate remains waiting_human on real server').toBe('waiting_human');

  const workflowResponse = await request.get(`/api/workflows/${encodeURIComponent(workflowId)}`, { headers });
  expect(workflowResponse.ok(), 'ac:18 real workflow API can read the stored meeting review workflow').toBeTruthy();
  const workflowBody = await workflowResponse.json();
  expect(workflowBody.workflow.id, 'ac:18 workflow read returns the workflow created by review ingest').toBe(workflowId);

  const runResponse = await request.get(`/api/workflow-runs/${encodeURIComponent(runId)}`, { headers });
  expect(runResponse.ok(), 'ac:19 real run API can read owner_resolution observability payload').toBeTruthy();
  const runBody = await runResponse.json();
  const taskOutput = runBody.outputs.find((output) => output.type === 'task_candidates');
  expect(taskOutput, 'ac:10 ac:14 task_candidates output is persisted before review and idempotent readback can replay it').toBeTruthy();
  const tasks = taskOutput.payload;
  expect(tasks[0].owner_hint, 'ac:1 owner_hint remains the raw AI text from the Review Package').toBe('@佐藤さん');
  expect(tasks[0].owner_resolution.source, 'ac:2 ac:7 ac:16 Graph people SSOT is the owner authority on the runtime path').toBe('graph_ssot');
  expect(['resolved', 'unresolved', 'ambiguous']).toContain(tasks[0].owner_resolution.status);
  expect(tasks[1].owner_resolution.reason, 'ac:3 ac:9 Speaker labels are not treated as people SSOT owners on the runtime path').toBe('speaker_label_is_not_people_ssot');
  expect(tasks[1].selected_owner_id, 'ac:3 ac:9 Speaker labels do not create selected_owner_id').toBeUndefined();
  expect(tasks[2].selected_owner_id, 'ac:4 ac:12 stale selected_owner_id from Review Package is not authority unless people SSOT verifies it').toBeUndefined();
  expect(['selected_owner_id_not_found_in_people_ssot', 'people_ssot_unavailable'], 'ac:6 ac:11 unavailable or missing people SSOT does not fail the ingest').toContain(tasks[2].owner_resolution.reason);
});

test('story-meeting-task-owner-ssot-resolution S-002 S-003 AC-003 AC-008 AC-009 scenario_clause_e2e flow_replay leaves missing people and speaker labels unresolved', async () => {
  const stack = makeService({
    infoSSOTService: makeInfoSSOTPeopleService([
      { id: 'person_yajima_tsuyoshi', payload: { name: '矢島剛', display_name: '矢島剛', aliases: ['矢島様'] } }
    ])
  });

  const { tasks } = await ingest(stack);

  expect(tasks[1].owner_resolution.status, 'AC-008 owner_hint=@未登録さん はowner_resolution.status=unresolved').toBe('unresolved');
  expect(tasks[1].selected_owner_id, 'AC-004 selected_owner_id を付与しない').toBeUndefined();
  expect(tasks[2].owner_resolution.status, 'AC-003 Speaker 1 などの話者ラベルは担当者personとして扱わない').toBe('ignored');
  expect(tasks[2].selected_owner_id, 'AC-009 owner_hint=@Speaker 1 は正本担当者設定に使わない').toBeUndefined();
});

test('story-meeting-task-owner-ssot-resolution AC-004 scenario_clause_e2e flow_replay marks ambiguous people without selecting an owner', async () => {
  const stack = makeService({
    infoSSOTService: makeInfoSSOTPeopleService([
      { id: 'person_yajima_a', payload: { name: '矢島剛', display_name: '矢島剛', aliases: ['矢島様'] } },
      { id: 'person_yajima_b', payload: { name: '矢島毅', display_name: '矢島毅', aliases: ['矢島様'] } }
    ])
  });

  const { tasks } = await ingest(stack);

  expect(tasks[0].owner_resolution.status, 'AC-004 複数候補で曖昧な場合はambiguous').toBe('ambiguous');
  expect(tasks[0].owner_resolution.reason, 'WSC-006 ambiguous_people_ssot_candidate は曖昧一致理由として保存する').toBe('ambiguous_people_ssot_candidate');
  expect(tasks[0].selected_owner_id, 'AC-004 selected_owner_id を付与しない').toBeUndefined();
});

test('story-meeting-task-owner-ssot-resolution S-004 S-007 S-008 S-009 AC-005 AC-010 AC-013 scenario_clause_e2e flow_replay keeps human gate and idempotent output storage', async () => {
  const stack = makeService({
    infoSSOTService: makeInfoSSOTPeopleService([
      { id: 'person_yajima_tsuyoshi', payload: { name: '矢島剛', display_name: '矢島剛', aliases: ['矢島様'] } }
    ])
  });
  const packageInput = samplePackage({ packageId: 'meeting-task-owner-idempotent-e2e' });

  const first = await ingest(stack, packageInput);
  const second = await stack.service.ingestMeetingReviewPackage({ review_package: packageInput }, stack.actor);

  expect(first.ingest.run.status, 'AC-005 Review Package ingest は承認待ちoutput payloadだけを更新する').toBe('waiting_human');
  expect(first.ingest.human_steps.some((step) => step.reason === 'required_before_task_create'), 'AC-013 human gate は維持される').toBe(true);
  expect(second.meeting_review_ingest.idempotent, 'S-004 AC-010 同一Review Packageの再取り込みは既存run/outputを返す').toBe(true);
  expect(first.tasks[0].owner_resolution.status, 'S-008 Resolved 状態は保存前にpayloadへ入る').toBe('resolved');
  expect(first.tasks[1].owner_resolution.status, 'S-009 no_people_ssot_candidate はingest失敗ではなくowner_resolutionへ保存する').toBe('unresolved');
  expect(first.tasks[2].owner_resolution.reason, 'S-009 speaker_label_is_not_people_ssot はingest失敗ではなくowner_resolutionへ保存する').toBe('speaker_label_is_not_people_ssot');
});

test('story-meeting-task-owner-ssot-resolution S-005 AC-006 AC-011 scenario_clause_e2e flow_replay keeps ingest alive when people SSOT is unavailable', async () => {
  const stack = makeService({
    infoSSOTService: makeInfoSSOTPeopleService([], { fail: true })
  });

  const { ingest: result, tasks } = await ingest(stack, samplePackage({ packageId: 'meeting-task-owner-ssot-unavailable-e2e' }));

  expect(result.run.status, 'AC-006 people SSOTが利用できない場合でもReview Package ingestは失敗させない').toBe('waiting_human');
  expect(tasks[0].owner_resolution.reason, 'AC-011 people SSOT取得が失敗しても担当者だけを未解決として人間レビューに渡す').toBe('people_ssot_unavailable');
});

test('story-meeting-task-owner-ssot-resolution S-006 AC-012 scenario_clause_e2e flow_replay preserves an existing selected_owner_id only when it exists in people SSOT', async () => {
  const stack = makeService({
    infoSSOTService: makeInfoSSOTPeopleService([
      { id: 'person_yajima_tsuyoshi', payload: { name: '矢島剛', display_name: '矢島剛', aliases: ['矢島様'] } }
    ])
  });

  const { tasks } = await ingest(stack);

  expect(tasks[3].selected_owner_id, 'AC-012 selected_owner_id がpeople SSOTにある場合は上書きしない').toBe('person_yajima_tsuyoshi');
  expect(tasks[3].selected_owner, 'AC-012 既存担当者を維持する').toBe('矢島剛');
  expect(tasks[3].owner_resolution, 'AC-012 AlreadySelected state is visible for review and monitoring').toMatchObject({
    source: 'graph_ssot',
    status: 'already_selected',
    reason: 'selected_owner_id_verified_in_people_ssot'
  });
});

test('story-meeting-task-owner-ssot-resolution AC-014 AC-015 AC-016 AC-017 AC-018 AC-019 AC-020 scenario_clause_e2e flow_replay keeps verification surfaces explicit', async () => {
  const stack = makeService({
    infoSSOTService: makeInfoSSOTPeopleService([
      { id: 'person_yajima_tsuyoshi', payload: { name: '矢島剛', display_name: '矢島剛', aliases: ['矢島様'] } }
    ])
  });

  const { ingest: result, tasks } = await ingest(stack, samplePackage({ packageId: 'meeting-task-owner-verification-surface-e2e' }));

  expect(tasks[0].selected_owner_id, 'AC-014 S-008 Resolved state persists selected_owner_id before output storage').toBe('person_yajima_tsuyoshi');
  expect(tasks[3].selected_owner_id, 'ac:15 AC-015 S-008 AlreadySelected state preserves SSOT-verified selected_owner_id').toBe('person_yajima_tsuyoshi');
  expect(tasks[3].owner_resolution.status, 'ac:15 AC-015 S-008 AlreadySelected state is recorded in owner_resolution').toBe('already_selected');
  expect(tasks[0].owner_resolution.source, 'AC-016 Release note identifies graph_ssot as owner authority').toBe('graph_ssot');
  expect(stack.service.infoSSOTService, 'ac:17 AC-017 Operator action enables InfoSSOTService injection after normal server restart/deploy').toBe(stack.infoSSOTService);
  expect(Object.keys(tasks[0]).sort(), 'AC-018 Rollback-safe additive payload keeps owner fields optional for consumers').toEqual(expect.arrayContaining(['owner_hint', 'selected_owner_id', 'selected_owner', 'owner_candidates', 'owner_resolution']));
  expect(tasks[0].owner_resolution, 'AC-019 Observability evidence includes owner_resolution status and reason in workflow output payload').toMatchObject({ status: 'resolved', reason: 'unique_exact_name_or_alias' });
  expect(tasks[1].owner_resolution.status, 'AC-020 Support path keeps unresolved owners for Mac Companion manual people SSOT selection').toBe('unresolved');
  expect(result.run.status, 'S-007 human gate remains waiting_human after Review Package ingest').toBe('waiting_human');
});

test('story-meeting-task-owner-ssot-resolution AC-021 AC-022 scenario_clause_e2e flow_replay ranks surname and given-name owner hints with people SSOT context', async () => {
  const stack = makeService({
    infoSSOTService: makeInfoSSOTPeopleService([
      {
        id: 'person_sato_keigo',
        payload: {
          name: '佐藤 圭吾',
          display_name: '佐藤 圭吾',
          aliases: ['佐藤圭吾', '佐藤さん', 'Keigo Sato', 'ksato', 'さとけい', 'King', 'キング'],
          member_of_project_codes: ['sample-project']
        }
      },
      {
        id: 'person_sato_noriyuki',
        payload: {
          name: '佐藤 紀征',
          display_name: '佐藤 紀征',
          aliases: ['佐藤さん', 'ガル浦和代表'],
          member_of_project_codes: ['garu-urawa']
        }
      },
      {
        id: 'person_hori_shiori',
        payload: {
          name: '堀 汐里',
          display_name: '堀 汐里',
          aliases: ['堀汐里', '堀', 'Shiori Hori'],
          member_of_project_codes: ['sample-project']
        }
      }
    ])
  });
  const packageInput = samplePackage({
    packageId: 'meeting-task-owner-context-ranked-e2e',
    taskCandidates: [
      {
        title: '佐藤さんにMeeting Packの再生成結果を確認してもらう。',
        owner_hint: '@佐藤さん'
      },
      {
        title: '汐里さんにSalesTailor向け確認事項を共有する。',
        owner_hint: '@汐里さん'
      },
      {
        title: 'キングにpeople SSOT aliasの反映状態を確認してもらう。',
        owner_hint: '@キング'
      }
    ]
  });

  const { tasks } = await ingest(stack, packageInput);

  expect(tasks[0].selected_owner_id, 'ac:21 @佐藤さん はproject contextに一致する佐藤 圭吾を第一候補にする').toBe('person_sato_keigo');
  expect(tasks[0].owner_candidates.map((candidate) => candidate.person_id), 'ac:21 他の佐藤候補もowner_candidatesに残す').toEqual(['person_sato_keigo', 'person_sato_noriyuki']);
  expect(tasks[1].selected_owner_id, 'ac:22 @汐里さん は部分一致で堀 汐里を候補解決する').toBe('person_hori_shiori');
  expect(tasks[1].owner_resolution.reason, 'ac:22 名だけの部分一致は一意候補なら初期選択する').toBe('unique_partial_name_or_alias');
  expect(tasks[2].selected_owner_id, 'ac:2 ac:7 @キング は佐藤 圭吾のpeople SSOT aliasで一意解決する').toBe('person_sato_keigo');
  expect(tasks[2].owner_resolution.reason, 'ac:2 ac:7 alias exact match uses people SSOT aliases').toBe('unique_exact_name_or_alias');
});

test('story-meeting-task-owner-ssot-resolution AC-023 AC-024 AC-025 scenario_clause_e2e flow_replay auto-selects only safe people SSOT owner candidates', async () => {
  const stack = makeService({
    infoSSOTService: makeInfoSSOTPeopleService([
      {
        id: 'person_hori_shiori',
        payload: {
          name: '堀 汐里',
          display_name: '堀 汐里',
          aliases: ['堀汐里', 'Shiori Hori'],
          member_of_project_codes: ['salestailor']
        }
      },
      {
        id: 'person_hori_shiori_duplicate',
        payload: {
          name: '堀 汐里',
          display_name: '堀 汐里',
          aliases: ['堀汐里', 'Shiori Hori'],
          member_of_project_codes: ['salestailor']
        }
      },
      {
        id: 'person_sato_keigo',
        payload: {
          name: '佐藤 圭吾',
          display_name: '佐藤 圭吾',
          aliases: ['佐藤圭吾', 'Keigo Sato', 'ksato', 'King', 'キング'],
          member_of_project_codes: ['techknight']
        }
      }
    ])
  });
  const packageInput = samplePackage({
    packageId: 'meeting-task-owner-safe-autoselect-e2e',
    orgId: 'tech-knight',
    projectId: 'tech-knight',
    taskCandidates: [
      {
        title: '汐里さんにSalesTailor向け確認事項を共有する。',
        owner_hint: '@汐里さん'
      },
      {
        title: 'King氏に担当者SSOTの別名解決を確認してもらう。',
        owner_hint: '@King氏'
      },
      {
        title: '担当者に次回定例までの資料整理を依頼する。',
        owner_hint: '@担当者'
      }
    ]
  });

  const { tasks } = await ingest(stack, packageInput);

  expect(tasks[0].selected_owner_id, 'AC-023 duplicate SSOT rows for the same person are folded before safe partial auto-selection').toBe('person_hori_shiori');
  expect(tasks[0].owner_candidates).toHaveLength(1);
  expect(tasks[0].owner_resolution.reason).toBe('unique_partial_name_or_alias');
  expect(tasks[1].selected_owner_id, 'AC-024 project code variants allow tech-knight package to resolve techknight people aliases').toBe('person_sato_keigo');
  expect(tasks[1].owner_resolution.reason).toBe('unique_exact_name_or_alias');
  expect(stack.infoSSOTService.calls.some((call) => call.options.projectCode === 'techknight' && call.options.query === 'king')).toBe(true);
  expect(tasks[2].selected_owner_id, 'AC-025 generic owner hint must not become a 神設定 owner').toBeUndefined();
  expect(tasks[2].owner_candidates).toEqual([]);
  expect(tasks[2].owner_resolution.reason).toBe('generic_owner_hint_requires_human_selection');
});

test('story-meeting-task-owner-ssot-resolution S-008 S-009 AC-019 AC-020 scenario_clause_e2e ui_replay shows owner resolution states in Workflow Mission Control', async ({ page }) => {
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
  await expect(page.getByText(/口コミ投稿QR.*担当者: 担当者未設定.*状態: 未解決.*people SSOTを更新するか、Mac Companionで担当者を選択してください/), 'ac:8 ac:20 unresolved owners remain visible for manual Mac Companion selection').toBeVisible();
  await expect(page.getByText(/プレミアムコスプレ.*状態: 対象外.*Speaker表記は担当者として使わない.*必要なら実名担当者を選択してください/)).toBeVisible();
  await expect(page.getByText(/客室内導線整備.*状態: 要選択.*候補から正しいpeople SSOT担当者を選択してください.*people候補: 矢島剛 \(person_yajima_tsuyoshi\) \/ 矢島毅 \(person_yajima_takeshi\)/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
});
