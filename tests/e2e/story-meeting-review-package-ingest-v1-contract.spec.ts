import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import {
  WorkflowService,
  createDefaultWorkflowHandlers
} from '../../server/services/workflow/workflow-service.js';
import { meetingPackIds } from '../../server/services/workflow/meeting-workflow-pack.js';

function makeService({ infoSSOTService = null } = {}) {
  const repository = new InMemoryWorkflowRepository();
  const runner = new WorkflowRunner({ repository, handlers: createDefaultWorkflowHandlers() });
  const configParser = {
    async getProjects() {
      return {
        root: '/workspace',
        projects: [
          { id: 'sample-project', session_select: true },
          { id: 'other-project', session_select: true },
          { id: 'tech-knight', session_select: true, aliases: ['techknight'] }
        ]
      };
    }
  };
  const service = new WorkflowService({ repository, runner, configParser, infoSSOTService });
  const actor = {
    sub: 'keigo',
    person_id: 'keigo',
    role: 'admin',
    projectCodes: ['sample-project', 'other-project']
  };
  return { repository, service, actor };
}

function makeGraphContextService() {
  const calls = [];
  return {
    calls,
    async getContext(access, options) {
      calls.push({ access, options });
      return {
        entities: {
          project: [{
            entity_id: 'project-sample',
            entity_type: 'project',
            payload: { project_code: 'sample-project', name: 'Sample Project' }
          }],
          person: [{
            entity_id: 'person-keigo',
            entity_type: 'person',
            payload: { person_id: 'keigo', display_name: '佐藤圭吾', aliases: ['King', 'キング'] }
          }],
          glossary_term: [{
            entity_id: 'term-meeting-pack',
            entity_type: 'glossary_term',
            payload: { term: 'Meeting Pack', definition: '会議前後の入力、議事録、Task、Decisionを扱うパッケージ' }
          }]
        },
        edges: [{
          from_entity_id: 'project-sample',
          to_entity_id: 'person-keigo',
          rel_type: 'has_member'
        }]
      };
    },
    async listGraphEntities() {
      return [];
    }
  };
}

function makeFailingGraphContextService() {
  const calls = [];
  return {
    calls,
    async getContext(access, options) {
      calls.push({ access, options });
      throw new Error('graph unavailable in test');
    },
    async listGraphEntities() {
      return [];
    }
  };
}

function samplePackage({
  orgId = 'sample-project',
  projectId = 'sample-project',
  packageId = 'meeting-review-package-e2e'
} = {}) {
  return {
    schema_version: '0.1.0',
    package_id: packageId,
    seed_id: 'meeting-loop-seed-e2e',
    status: 'review_required',
    meeting_identity: {
      source: 'google_calendar',
      account: 'info@example.com',
      calendar_id: 'primary',
      event_id: 'evt-e2e',
      title: '会議レビューE2E',
      start: '2026-06-25T13:00:00+09:00',
      end: '2026-06-25T14:00:00+09:00',
      candidate_org_id: orgId,
      candidate_project_id: projectId,
      case_scope: 'e2e-loop-test',
      graph_context: {
        org_entity_ids: ['org-e2e'],
        person_entity_ids: ['person-e2e']
      }
    },
    source_event: {
      source_system: 'slack',
      workspace: 'unson',
      channel_id: 'C08SYTDR7R8',
      channel_name: '9940-meeting-router',
      message_ts: '1782367965.844209',
      file_id: 'F0BCYNXMP6H',
      local_artifact_sha256: 'sha256-e2e'
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
    task_candidates: ['Task候補'],
    decision_candidates: ['Decision候補'],
    follow_up_draft: {
      status: 'draft_only',
      external_send_required_approval: true,
      body: 'ありがとうございました。'
    },
    promotion_candidates: {
      graph: ['org:e2e'],
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

function unitedHotelDxPackage() {
  return JSON.parse(readFileSync('tests/fixtures/meeting-review-package-united-hotel-dx.json', 'utf8'));
}

async function ingestSamplePackage(packageInput = samplePackage(), serviceOptions = {}) {
  const { repository, service, actor } = makeService(serviceOptions);
  await service.bootstrapMeetingWorkflowPack({
    org_id: packageInput.meeting_identity.candidate_org_id,
    project_id: packageInput.meeting_identity.candidate_project_id
  }, actor);
  const result = await service.ingestMeetingReviewPackage({
    review_package: packageInput
  }, actor);
  return { repository, service, actor, ingest: result.meeting_review_ingest };
}

test('story-meeting-review-package-ingest-v1 ac:1 Review Package ingest API は、許可された `org_id` / `project_id` の operator だけが呼び出せる。', async () => {
  const { repository, service, actor } = makeService();
  await service.bootstrapMeetingWorkflowPack({
    org_id: 'sample-project',
    project_id: 'sample-project'
  }, actor);

  await expect(service.ingestMeetingReviewPackage({
    review_package: samplePackage()
  }, { ...actor, role: 'member', projectCodes: [] })).rejects.toThrow("project 'sample-project' is not accessible");

  expect({ operator_rejected_run_count: repository.ledger.runs.length }).toEqual({ operator_rejected_run_count: 0 });
});

test('story-meeting-review-package-ingest-v1 ac:2 `org_id` / `project_id` は明示入力を優先し、なければ `meeting_identity.candidate_org_id` / `candidate_project_id` から補う。', async () => {
  const { service, actor } = makeService();
  await service.bootstrapMeetingWorkflowPack({
    org_id: 'other-project',
    project_id: 'other-project'
  }, actor);
  const packageInput = samplePackage({ orgId: 'other-project', projectId: 'other-project', packageId: 'explicit-scope-e2e' });
  packageInput.meeting_identity.candidate_org_id = 'sample-project';
  packageInput.meeting_identity.candidate_project_id = 'sample-project';

  const result = await service.ingestMeetingReviewPackage({
    org_id: 'other-project',
    project_id: 'other-project',
    review_package: packageInput
  }, actor);

  expect({ org_id: result.meeting_review_ingest.org_id, project_id: result.meeting_review_ingest.project_id }).toEqual({ org_id: 'other-project', project_id: 'other-project' });
  expect({ meeting_identity_candidate_org_id: packageInput.meeting_identity.candidate_org_id, candidate_project_id: packageInput.meeting_identity.candidate_project_id, explicit_org_id: result.meeting_review_ingest.org_id }).toEqual({ meeting_identity_candidate_org_id: 'sample-project', candidate_project_id: 'sample-project', explicit_org_id: 'other-project' });
});

test('story-meeting-review-package-ingest-v1 ac:3 `case_scope`、Calendar event、Slack source、Graph context、transcript hash は run metadata と context snapshot に残る。', async () => {
  const { ingest } = await ingestSamplePackage();

  expect(ingest.run.metadata.case_scope).toBe('e2e-loop-test');
  expect(ingest.run.metadata.meeting_identity.event_id).toBe('evt-e2e');
  expect(ingest.run.metadata.source_event.file_id).toBe('F0BCYNXMP6H');
  expect(ingest.run.metadata.source_event.local_artifact_sha256).toBe('sha256-e2e');
  expect(ingest.run.metadata.graph_context.org_entity_ids).toEqual(['org-e2e']);
  expect(ingest.context_snapshots.map((snapshot) => snapshot.source_type)).toEqual([
    'meeting_identity',
    'meeting_source',
    'graph_ssot',
    'review_package'
  ]);
  expect(ingest.context_snapshots).toEqual(expect.arrayContaining([
    expect.objectContaining({
      source_type: 'meeting_source',
      content_hash: 'sha256-e2e'
    }),
    expect.objectContaining({
      source_type: 'graph_ssot',
      data: expect.objectContaining({
        verification_status: 'candidate_from_review_package',
        promoted_to_graph_ssot: false
      })
    })
  ]));
});

test('story-meeting-pack-graph-ssot-playbook ac:1 Project確定後にGraph SSOTから用語集を含むproject scoped contextを取得しPlaybookへ保存する。', async () => {
  const infoSSOTService = makeGraphContextService();
  const { ingest } = await ingestSamplePackage(samplePackage({
    packageId: 'meeting-review-package-graph-playbook-e2e'
  }), { infoSSOTService });

  expect(infoSSOTService.calls).toHaveLength(1);
  expect(infoSSOTService.calls[0].options).toEqual(expect.objectContaining({
    projectCode: 'sample-project',
    includeEdges: true,
    includePhilosophy: false
  }));
  expect(infoSSOTService.calls[0].options.entityTypes).toContain('glossary_term');
  expect(ingest.run.metadata.project_resolution).toEqual(expect.objectContaining({
    status: 'single_high_confidence_project',
    project_id: 'sample-project'
  }));
  expect(ingest.run.metadata.graph_context).toEqual(expect.objectContaining({
    verification_status: 'verified_from_graph_ssot',
    graph_context_source: 'brainbase_graph_ssot'
  }));
  expect(ingest.run.metadata.graph_ssot_playbook).toEqual(expect.objectContaining({
    version: 'meeting_pack_graph_ssot_playbook.v1',
    generation_contract: expect.objectContaining({
      fact_source: 'transcript_and_slack_attachment',
      graph_ssot_role: 'project_scoped_entity_identity_relationship_glossary_context',
      project_must_be_resolved_before_graph_lookup: true,
      graph_context_must_not_override_missing_transcript_facts: true
    })
  }));
  expect(ingest.run.metadata.graph_ssot_playbook.dag.edges).toEqual(expect.arrayContaining([
    { from: 'project_resolution_gate', to: 'project_scoped_graph_context' },
    { from: 'project_scoped_graph_context', to: 'glossary_resolution' }
  ]));
  expect(ingest.context_snapshots).toEqual(expect.arrayContaining([
    expect.objectContaining({
      source_type: 'graph_ssot',
      item_count: 3,
      data: expect.objectContaining({
        graph_ssot_context: expect.objectContaining({
          entities: expect.objectContaining({
            glossary_term: [
              expect.objectContaining({
                payload: expect.objectContaining({ term: 'Meeting Pack' })
              })
            ]
          })
        })
      })
    })
  ]));
  const meetingNoteOutput = ingest.outputs.find((output) => output.type === 'meeting_note_draft');
  expect(meetingNoteOutput?.payload).toEqual(expect.objectContaining({
    graph_ssot_playbook: expect.objectContaining({
      graph_context: expect.objectContaining({
        status: 'resolved',
        type_counts: expect.objectContaining({ glossary_term: 1 })
      }),
      glossary_resolution: expect.objectContaining({ status: 'resolved', entity_count: 1 })
    })
  }));
});

test('story-meeting-pack-graph-ssot-playbook ac:5 ac:10 Graph SSOT取得失敗は候補fallbackと例外分岐として保存される。', async () => {
  const infoSSOTService = makeFailingGraphContextService();
  const { ingest } = await ingestSamplePackage(samplePackage({
    packageId: 'meeting-review-package-graph-unavailable-e2e'
  }), { infoSSOTService });

  expect(infoSSOTService.calls).toHaveLength(1);
  expect(ingest.run.metadata.graph_context).toEqual(expect.objectContaining({
    verification_status: 'candidate_from_review_package',
    graph_context_source: 'review_package_candidate',
    promoted_to_graph_ssot: false
  }));
  expect(ingest.run.metadata.graph_ssot_playbook).toEqual(expect.objectContaining({
    graph_context: expect.objectContaining({
      status: 'unavailable',
      error: 'graph unavailable in test'
    }),
    active_exceptions: expect.arrayContaining([
      expect.objectContaining({
        node: 'project_scoped_graph_context',
        code: 'graph_ssot_unavailable',
        message: 'graph unavailable in test'
      })
    ])
  }));
  expect(ingest.context_snapshots).toEqual(expect.arrayContaining([
    expect.objectContaining({
      source_type: 'graph_ssot',
      preview: 'Graph SSOT context candidates with explicit fallback',
      data: expect.objectContaining({
        verification_status: 'candidate_from_review_package',
        graph_context_source: 'review_package_candidate',
        graph_ssot_context: null,
        graph_ssot_playbook: expect.objectContaining({
          active_exceptions: expect.arrayContaining([
            expect.objectContaining({ code: 'graph_ssot_unavailable' })
          ])
        })
      })
    })
  ]));
  const meetingNoteOutput = ingest.outputs.find((output) => output.type === 'meeting_note_draft');
  expect(meetingNoteOutput?.payload.graph_ssot_playbook).toEqual(expect.objectContaining({
    graph_context: expect.objectContaining({ status: 'unavailable' }),
    active_exceptions: expect.arrayContaining([
      expect.objectContaining({ code: 'graph_ssot_unavailable' })
    ])
  }));
});

test('story-meeting-review-package-ingest-v1 ac:4 `loop_intent_ids` は既存 Loop Intent と照合され、project mismatch や missing は書き込み前に拒否される。', async () => {
  const { repository, service, actor } = makeService();
  await service.bootstrapMeetingWorkflowPack({
    org_id: 'sample-project',
    project_id: 'sample-project'
  }, actor);
  const invalidPackage = samplePackage();
  delete invalidPackage.loop_intent_ids.meeting_note_to_tasks;

  await expect(service.ingestMeetingReviewPackage({
    review_package: invalidPackage
  }, actor)).rejects.toThrow('review_package.loop_intent_ids is missing required meeting review key(s)');

  expect({ loop_intent_ids_rejected_run_count: repository.ledger.runs.length, output_count: repository.ledger.outputs.length, human_step_count: repository.ledger.human_steps.length }).toEqual({ loop_intent_ids_rejected_run_count: 0, output_count: 0, human_step_count: 0 });
});

test('story-meeting-review-package-ingest-v1 S-001 ac:5 取り込み run は `status=waiting_human`、`closure_state=open`、`action_required=approve`、`human_waiting=true` になる。', async () => {
  const { ingest } = await ingestSamplePackage();

  expect({ status: ingest.run.status, closure_state: ingest.run.closure_state, action_required: ingest.run.action_required, human_waiting: ingest.run.human_waiting }).toMatchObject({
    status: 'waiting_human',
    closure_state: 'open',
    action_required: 'approve',
    human_waiting: true
  });
});

test('story-meeting-review-package-ingest-v1 ac:6 `workflow_outputs` には議事録ドラフト、Task 候補、Decision 候補、フォローアップ文面、Graph / Learning 昇格候補が保存される。', async () => {
  const { ingest } = await ingestSamplePackage();

  expect({ workflow_outputs: ingest.outputs.map((output) => output.type) }).toEqual({ workflow_outputs: [
    'meeting_note_draft',
    'task_candidates',
    'decision_candidates',
    'message_draft',
    'promotion_candidates'
  ] });
  expect({ workflow_outputs_議事録ドラフト_task_decision_follow_up_graph_learning: ingest.outputs.map((output) => output.title) }).toEqual({ workflow_outputs_議事録ドラフト_task_decision_follow_up_graph_learning: ['議事録ドラフト', 'Task候補', 'Decision候補', 'フォローアップ文面ドラフト', 'Graph / Learning昇格候補'] });
});

test('story-meeting-review-package-ingest-v1 ac:7 各 output は `package_id`、`loop_intent_id`、`write_back_target`、`evidence_refs`、`requires_human_approval=true` を持つ。', async () => {
  const { ingest } = await ingestSamplePackage();

  for (const output of ingest.outputs) {
    expect(output.metadata.package_id).toBe('meeting-review-package-e2e');
    expect(output.metadata.loop_intent_id).toMatch(/^loop_sample_project_sample_project_/);
    expect(output.metadata.write_back_target).toBeTruthy();
    expect(output.metadata.evidence_refs).toEqual(['transcript:00:01:00-00:02:00']);
    expect(output.metadata.requires_human_approval).toBe(true);
  }
});

test('story-meeting-review-package-ingest-v1 ac:8 `workflow_human_steps` には meeting note publish、task create、decision / graph promotion、follow-up external send、learning / promotion confirmation の pending step が作られる。', async () => {
  const { ingest } = await ingestSamplePackage();

  expect({ workflow_human_steps: ingest.human_steps.map((step) => step.metadata.write_back_target), pending_step_count: ingest.human_steps.filter((step) => step.status === 'pending').length }).toEqual({ workflow_human_steps: [
    'meeting_note_draft',
    'task_store',
    'graph_ssot_decision',
    'external_message_draft',
    'candidate_store'
  ], pending_step_count: 5 });
});

test('story-meeting-review-package-ingest-v1 AC-012 ac:12 INV-012 C-012 Decision候補のHuman Gateは対応output_idとapproval_kindを保持しMac Companionでoutput_onlyにしない。', async () => {
  const { ingest } = await ingestSamplePackage();
  const outputsByTarget = new Map(ingest.outputs.map((output) => [output.metadata.write_back_target, output]));

  for (const step of ingest.human_steps) {
    const protectedOutput = outputsByTarget.get(step.metadata.write_back_target);
    expect(protectedOutput, `protected output for ${step.metadata.write_back_target}`).toBeTruthy();
    expect(step.metadata).toMatchObject({
      output_id: protectedOutput.id,
      output_key: protectedOutput.metadata.output_key,
      output_type: protectedOutput.type,
      approval_kind: protectedOutput.type
    });
  }

  const decisionStep = ingest.human_steps.find((step) => step.metadata.write_back_target === 'graph_ssot_decision');
  const decisionOutput = ingest.outputs.find((output) => output.type === 'decision_candidates');

  expect(decisionStep?.metadata).toMatchObject({
    output_id: decisionOutput.id,
    output_key: 'decision_candidates',
    output_type: 'decision_candidates',
    approval_kind: 'decision_candidates',
    write_back_target: 'graph_ssot_decision'
  });
});

test('story-meeting-review-package-ingest-v1 S-003 ac:9 取り込みは `package_id + org_id + project_id` で冪等になり、再実行しても run / output / human step を重複作成しない。', async () => {
  const { repository, service, actor, ingest } = await ingestSamplePackage();

  const replay = await service.ingestMeetingReviewPackage({
    review_package: samplePackage()
  }, actor);

  expect({ package_id_org_id_project_id_idempotent: replay.meeting_review_ingest.idempotent }).toEqual({ package_id_org_id_project_id_idempotent: true });
  expect(replay.meeting_review_ingest.run.id).toBe(ingest.run.id);
  expect(repository.ledger.runs).toHaveLength(1);
  expect(repository.ledger.outputs).toHaveLength(5);
  expect(repository.ledger.human_steps).toHaveLength(5);
});

test('story-meeting-review-package-ingest-v1 ac:10 Audit log は ingest した package、run、output、human step、loop intent、runner type、state transition を記録する。', async () => {
  const { repository, ingest } = await ingestSamplePackage();

  expect(repository.listAuditLogs({ targetId: ingest.run.id })).toEqual([
    expect.objectContaining({
      action: 'workflow.meeting_review_package.ingested',
      after: expect.objectContaining({
        package_id: 'meeting-review-package-e2e',
        run_id: ingest.run.id,
        output_ids: ingest.outputs.map((output) => output.id),
        human_step_ids: ingest.human_steps.map((step) => step.id),
        loop_intent_ids: ingest.loop_intents.map((intent) => intent.id),
        runner: { type: 'codex_generated_package', eve_connected: false },
        state_transitions: ingest.state_transitions
      })
    })
  ]);
});

test('story-meeting-review-package-ingest-v1 ac:11 Eve 接続は後続 Story とし、この Story では Eve 成功や外部runner実行済みを名乗らない。', async () => {
  const { ingest } = await ingestSamplePackage();

  expect(ingest.run.metadata.runner).toEqual({
    type: 'codex_generated_package',
    eve_connected: false
  });
});

test('story-meeting-review-package-ingest-v1 S-008 ac12 ac:12 1件承認では承認待ちを維持し、全Human Gate承認後だけrunを閉じる。', async () => {
  const { repository, service, actor, ingest } = await ingestSamplePackage();

  const firstResolution = await service.resolveHumanStep(ingest.human_steps[0].id, {
    run_id: ingest.run.id,
    resolution: 'approved'
  }, actor);

  expect(firstResolution.resumed_run).toMatchObject({
    id: ingest.run.id,
    status: 'waiting_human',
    closure_state: 'open',
    action_required: 'approve',
    human_waiting: true
  });
  expect(repository.listHumanSteps(ingest.run.id).filter((step) => step.status === 'pending')).toHaveLength(4);
  expect(repository.listRuns({ workflowId: ingest.run.workflow_id })).toHaveLength(1);
  expect({
    ac12_run_status_after_one_approval: firstResolution.resumed_run.status,
    ac12_pending_after_one_approval: repository.listHumanSteps(ingest.run.id).filter((step) => step.status === 'pending').length
  }).toEqual({
    ac12_run_status_after_one_approval: 'waiting_human',
    ac12_pending_after_one_approval: 4
  });

  let finalResolution = firstResolution;
  for (const step of ingest.human_steps.slice(1)) {
    finalResolution = await service.resolveHumanStep(step.id, {
      run_id: ingest.run.id,
      resolution: 'approved'
    }, actor);
  }

  expect(finalResolution.resumed_run).toMatchObject({
    id: ingest.run.id,
    status: 'success',
    closure_state: 'closed',
    action_required: 'none',
    human_waiting: false
  });
  expect(repository.listHumanSteps(ingest.run.id).filter((step) => step.status === 'pending')).toHaveLength(0);
});

test('story-meeting-review-package-ingest-v1 S-009 ac:15 RejectされたReview Package runは後続Approveでsuccessに戻らない。', async () => {
  const { repository, service, actor, ingest } = await ingestSamplePackage(samplePackage({
    packageId: 'meeting-review-package-e2e-reject'
  }));
  const [rejectedStep, staleApproveStep] = ingest.human_steps;

  const rejected = await service.resolveHumanStep(rejectedStep.id, {
    run_id: ingest.run.id,
    resolution: 'rejected'
  }, actor);

  expect(rejected.resumed_run).toMatchObject({
    id: ingest.run.id,
    status: 'cancelled',
    closure_state: 'closed',
    action_required: 'none',
    human_waiting: false
  });
  expect(repository.listHumanSteps(ingest.run.id).filter((step) => step.status === 'pending')).toHaveLength(0);
  expect(repository.listHumanSteps(ingest.run.id).filter((step) => step.status === 'cancelled')).toHaveLength(4);

  await expect(service.resolveHumanStep(staleApproveStep.id, {
    run_id: ingest.run.id,
    resolution: 'approved'
  }, actor)).rejects.toThrow(`human step '${staleApproveStep.id}' is already cancelled`);
  expect(repository.getRun(ingest.run.id)).toMatchObject({
    status: 'cancelled',
    closure_state: 'closed'
  });
});

test('story-meeting-review-package-ingest-v1 S-006 ac:13 preview smoke UnitedホテルDX packageを再実行可能なfixtureから取り込める', async () => {
  const { repository, service, actor } = makeService();
  const packageInput = unitedHotelDxPackage();
  await service.bootstrapMeetingWorkflowPack({
    org_id: 'tech-knight',
    project_id: 'tech-knight'
  }, { ...actor, projectCodes: ['tech-knight'] });

  const result = await service.ingestMeetingReviewPackage({
    review_package: packageInput
  }, { ...actor, projectCodes: ['tech-knight'] });
  const ingest = result.meeting_review_ingest;

  expect(ingest).toMatchObject({
    org_id: 'tech-knight',
    project_id: 'tech-knight',
    case_scope: 'hotel-dx-united',
    package_id: 'meeting-review-package-2026-06-25-united-hotel-dx'
  });
  expect(ingest.run).toMatchObject({
    status: 'waiting_human',
    action_required: 'approve',
    human_waiting: true,
    metadata: expect.objectContaining({
      runner: { type: 'codex_generated_package', eve_connected: false },
      source_event: expect.objectContaining({
        local_artifact_sha256: 'sha256-united-hotel-dx-review-package'
      })
    })
  });
  expect(ingest.outputs).toHaveLength(5);
  expect(ingest.human_steps.filter((step) => step.status === 'pending')).toHaveLength(5);
  expect(ingest.context_snapshots).toEqual(expect.arrayContaining([
    expect.objectContaining({
      source_type: 'meeting_source',
      content_hash: 'sha256-united-hotel-dx-review-package'
    }),
    expect.objectContaining({
      source_type: 'graph_ssot',
      data: expect.objectContaining({
        promoted_to_graph_ssot: false
      })
    })
  ]));
  expect(repository.listAuditLogs({ targetId: ingest.run.id })).toEqual(expect.arrayContaining([
    expect.objectContaining({
      action: 'workflow.meeting_review_package.ingested'
    })
  ]));
});

test('story-meeting-review-package-ingest-v1 S-007 ac:13 /workflows Mission ControlでReview Package runの承認待ちとReject動線を確認できる', async ({ page }) => {
  const run = {
    id: 'run-tech-knight-united-review',
    workflow_id: 'wf-tech-knight-united-review',
    org_id: 'tech-knight',
    project_id: 'tech-knight',
    status: 'waiting_human',
    closure_state: 'open',
    trigger_type: 'event',
    env: 'local',
    action_required: 'approve',
    human_waiting: true,
    message: 'Meeting Review Package is waiting for human approval',
    metadata: {
      package_id: 'meeting-review-package-2026-06-25-united-hotel-dx',
      case_scope: 'hotel-dx-united',
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
    id: `human-tech-knight-united-${index + 1}`,
    workflow_run_id: run.id,
    workflow_id: run.workflow_id,
    step_type: 'approval',
    status: 'pending',
    prompt,
    metadata: {
      package_id: 'meeting-review-package-2026-06-25-united-hotel-dx',
      requires_human_approval: true
    }
  }));
  const workflow = {
    id: run.workflow_id,
    project_id: 'tech-knight',
    owner_id: 'keigo',
    name: 'Meeting Review Package Ingest',
    implementation_key: 'meeting-review-package-ingest',
    context_sources: [],
    latest_run: run,
    latest_human_steps: humanSteps,
    latest_context_snapshots: []
  };
  const runDetails = () => ({
    run,
    run_steps: [{
      id: 'step-ingest',
      step_name: 'Review Package Ingest',
      status: run.status,
      message: run.status === 'cancelled'
        ? 'Review Package was rejected by Human Gate'
        : 'Review Package outputs recorded and waiting for Human Gate'
    }],
    context_snapshots: [{
      id: 'ctx-source',
      source_type: 'meeting_source',
      source_ref: 'slack:techknight:C08SYTDR7R8:1782367965.844209',
      preview: 'hotel-dx-united'
    }],
    human_steps: humanSteps,
    outputs: [{
      id: 'out-meeting-note',
      title: '議事録ドラフト',
      preview: 'UnitedホテルDX案件レビュー'
    }],
    audit_logs: []
  });
  let resolveRequests = 0;

  await page.route('**/api/config/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [{ id: 'tech-knight', name: 'Tech Knight' }] })
    });
  });
  await page.route('**/api/workflows/control/**', async (route) => {
    const url = new URL(route.request().url());
    const emptyByPath = {
      '/api/workflows/control/role-agents': { role_agent_instances: [] },
      '/api/workflows/control/templates': { workflow_templates: [] },
      '/api/workflows/control/bindings': { workflow_bindings: [] },
      '/api/workflows/control/triggers': { workflow_triggers: [] },
      '/api/workflows/control/loop-intents': { loop_intents: [] }
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyByPath[url.pathname] || {})
    });
  });
  await page.route('**/api/workflows', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ workflows: [workflow] })
    });
  });
  await page.route(`**/api/workflows/${run.workflow_id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ workflow, context_sources: [], runs: [run] })
    });
  });
  await page.route(`**/api/workflow-runs/${run.id}/human-steps/*/resolve`, async (route) => {
    resolveRequests += 1;
    const requestBody = route.request().postDataJSON();
    expect(requestBody).toMatchObject({ resolution: 'rejected' });
    const rejectedStep = humanSteps[0];
    rejectedStep.status = 'rejected';
    for (const step of humanSteps.slice(1)) {
      step.status = 'cancelled';
    }
    Object.assign(run, {
      status: 'cancelled',
      closure_state: 'closed',
      action_required: 'none',
      human_waiting: false,
      message: 'Review Package rejected by Human Gate'
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        human_step: rejectedStep,
        resumed_run: run
      })
    });
  });
  await page.route(`**/api/workflow-runs/${run.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(runDetails())
    });
  });

  await page.goto('/workflows');
  await expect(page.getByRole('heading', { name: 'Workflow Mission Control' })).toBeVisible();
  await expect(page.getByText('Meeting Review Package Ingest')).toBeVisible();
  await expect(page.getByText('Action: approve · Human waiting: yes')).toBeVisible();
  await expect(page.getByText('waiting_human').first()).toBeVisible();

  await page.getByText('Meeting Review Package Ingest').click();
  await expect(page.getByRole('button', { name: /実行/ })).toHaveCount(0);
  await page.getByText(run.id).click();
  await expect(page.getByRole('heading', { name: 'Run Trace' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Rerun/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(5);

  await page.getByRole('button', { name: 'Reject' }).first().click();
  await expect.poll(() => resolveRequests).toBe(1);
  await expect(page.getByText('Review Package rejected by Human Gate')).toBeVisible();
  await expect(page.getByText('cancelled').first()).toBeVisible();
  await expect(page.getByText('rejected · 議事録ドラフトの公開可否を確認してください')).toBeVisible();
  await expect(page.getByText('cancelled · Task候補を作成してよいか確認してください')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(0);
});

test('story-meeting-review-package-ingest-v1 S-001 S-003 ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9 ac:10 ac:11 docs and ingest contract', async () => {
  const story = readFileSync('docs/stories/story-meeting-review-package-ingest-v1.md', 'utf8');
  const architecture = readFileSync('docs/architecture/meeting-review-package-ingest-architecture.md', 'utf8');
  const spec = readFileSync('docs/specs/story-meeting-review-package-ingest-v1-spec.md', 'utf8');

  expect(story).toContain('POST /api/workflows/control/meeting-pack/review-ingest');
  expect(story).toContain('runner.type=codex_generated_package');
  expect(architecture).toContain('| `status` | `waiting_human` |');
  expect(architecture).toContain('承認まで実行しない');
  expect(spec).toContain('INV-004: `loop_intent_ids` は必要keyが揃っていることを確認し、書き込み前に既存 `loop_intents` と照合する。');
  expect(spec).toContain('INV-010: Graph SSOT / Task Store / 外部送信 / Learning promotion はこの Story では候補の保存までで止める。');

  const { repository, service, actor } = makeService();
  // story-meeting-review-package-ingest-v1 ac:1 許可されたoperatorだけが呼び出せる。
  await service.bootstrapMeetingWorkflowPack({
    org_id: 'sample-project',
    project_id: 'sample-project'
  }, actor);

  // story-meeting-review-package-ingest-v1 ac:2 org/projectはmeeting_identity候補から補完される。
  const first = await service.ingestMeetingReviewPackage({
    review_package: samplePackage()
  }, actor);
  const ingest = first.meeting_review_ingest;

  expect(ingest).toMatchObject({
    org_id: 'sample-project',
    project_id: 'sample-project',
    case_scope: 'e2e-loop-test',
    package_id: 'meeting-review-package-e2e',
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
  // story-meeting-review-package-ingest-v1 ac:3 case_scope、Calendar、Slack、Graph contextはmetadata/snapshotsに残る。
  expect(ingest.run.metadata).toMatchObject({
    package_id: 'meeting-review-package-e2e',
    case_scope: 'e2e-loop-test',
    runner: {
      type: 'codex_generated_package',
      eve_connected: false
    }
  });
  expect(ingest.context_snapshots.map((snapshot) => snapshot.source_type)).toEqual([
    'meeting_identity',
    'meeting_source',
    'graph_ssot',
    'review_package'
  ]);
  // story-meeting-review-package-ingest-v1 ac:5 waiting_human runとして停止する。
  expect(ingest.run.status).toBe('waiting_human');
  expect(ingest.run.action_required).toBe('approve');
  expect(ingest.run.human_waiting).toBe(true);
  // story-meeting-review-package-ingest-v1 ac:6 5種類のworkflow_outputsを保存する。
  expect(ingest.outputs.map((output) => output.type)).toEqual([
    'meeting_note_draft',
    'task_candidates',
    'decision_candidates',
    'message_draft',
    'promotion_candidates'
  ]);
  // story-meeting-review-package-ingest-v1 ac:7 各outputは証跡、loop_intent、承認要求を持つ。
  for (const output of ingest.outputs) {
    expect(output.metadata).toMatchObject({
      package_id: 'meeting-review-package-e2e',
      requires_human_approval: true,
      runner_type: 'codex_generated_package',
      evidence_refs: ['transcript:00:01:00-00:02:00']
    });
    expect(output.metadata.loop_intent_id).toMatch(/^loop_sample_project_sample_project_/);
    expect(output.metadata.write_back_target).toBeTruthy();
  }
  // story-meeting-review-package-ingest-v1 ac:8 5つのHuman Gateをpendingで作成する。
  expect(ingest.human_steps).toHaveLength(5);
  expect(ingest.human_steps.every((step) => step.status === 'pending')).toBe(true);
  expect(ingest.human_steps.map((step) => step.metadata.write_back_target)).toEqual([
    'meeting_note_draft',
    'task_store',
    'graph_ssot_decision',
    'external_message_draft',
    'candidate_store'
  ]);
  expect(repository.ledger.runs).toHaveLength(1);
  expect(repository.ledger.outputs).toHaveLength(5);
  expect(repository.ledger.human_steps).toHaveLength(5);
  // story-meeting-review-package-ingest-v1 ac:10 Audit logにrunner typeとstate transitionを残す。
  expect(repository.listAuditLogs({ targetId: ingest.run.id })).toEqual([
    expect.objectContaining({
      action: 'workflow.meeting_review_package.ingested',
      after: expect.objectContaining({
        package_id: 'meeting-review-package-e2e',
        state_transitions: ingest.state_transitions
      })
    })
  ]);

  // story-meeting-review-package-ingest-v1 ac:9 package_id + org_id + project_idで冪等にする。
  const replay = await service.ingestMeetingReviewPackage({
    review_package: samplePackage()
  }, actor);
  expect(replay.meeting_review_ingest).toMatchObject({
    idempotent: true,
    run: { id: ingest.run.id }
  });
  expect(repository.ledger.runs).toHaveLength(1);
  expect(repository.ledger.outputs).toHaveLength(5);
  expect(repository.ledger.human_steps).toHaveLength(5);
  // story-meeting-review-package-ingest-v1 ac:11 Eve接続済みとは扱わない。
  expect(ingest.run.metadata.runner).toEqual({
    type: 'codex_generated_package',
    eve_connected: false
  });
});

test('story-meeting-review-package-ingest-v1 S-005 missing output payload key writes no run output or human step', async () => {
  const { repository, service, actor } = makeService();
  await service.bootstrapMeetingWorkflowPack({
    org_id: 'sample-project',
    project_id: 'sample-project'
  }, actor);
  const invalidPackage = samplePackage({ packageId: 'missing-output-payload-e2e' });
  delete invalidPackage.follow_up_draft;

  await expect(service.ingestMeetingReviewPackage({
    review_package: invalidPackage
  }, actor)).rejects.toThrow('review_package is missing required output payload key(s)');

  expect(repository.ledger.runs).toHaveLength(0);
  expect(repository.ledger.outputs).toHaveLength(0);
  expect(repository.ledger.human_steps).toHaveLength(0);
  expect(repository.ledger.audit_logs.some((entry) => entry.action === 'workflow.meeting_review_package.ingested')).toBe(false);
});

test('story-meeting-review-package-ingest-v1 S-004 S-014 manual run and rerun cannot bypass Review Package ingest contract', async () => {
  const { repository, service, actor, ingest } = await ingestSamplePackage();
  const workflowId = ingest.run.workflow_id;
  const runId = ingest.run.id;

  await expect(service.runWorkflow(workflowId, {
    actorId: actor.person_id,
    projectCodes: actor.projectCodes,
    role: actor.role,
    triggerType: 'manual'
  })).rejects.toThrow('meeting-review-package-ingest workflows cannot be manually run');

  await expect(service.rerun(runId, {}, actor)).rejects.toThrow('meeting-review-package-ingest workflows cannot be manually run');

  expect(repository.listRuns({ workflowId })).toHaveLength(1);
  expect(repository.ledger.outputs).toHaveLength(5);
  expect(repository.ledger.human_steps).toHaveLength(5);
});

test('story-meeting-review-package-ingest-v1 blocked_loop_intent_mismatch writes no run output or human step', async () => {
  const { repository, service, actor } = makeService();
  await service.bootstrapMeetingWorkflowPack({
    org_id: 'sample-project',
    project_id: 'sample-project'
  }, actor);
  const invalidPackage = samplePackage();
  invalidPackage.loop_intent_ids.meeting_note_to_tasks = 'loop_missing';

  // story-meeting-review-package-ingest-v1 ac:4 loop_intent_idsは書き込み前に既存Loop Intentと照合する。
  await expect(service.ingestMeetingReviewPackage({
    review_package: invalidPackage
  }, actor)).rejects.toThrow("loop_intent 'loop_missing' not found");

  expect(repository.ledger.runs).toHaveLength(0);
  expect(repository.ledger.outputs).toHaveLength(0);
  expect(repository.ledger.human_steps).toHaveLength(0);
  expect(repository.ledger.audit_logs.some((entry) => entry.action === 'workflow.meeting_review_package.ingested')).toBe(false);
});
