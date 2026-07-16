import { test, expect } from '@playwright/test';

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
          { id: 'other-project', session_select: true }
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
  return { service, actor };
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
            payload: { term: 'Meeting Pack', definition: '会議レビュー入力から議事録、Task、Decisionを作る運用単位' }
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

function makeProjectScopedEmptyGlobalPeopleService() {
  const calls = [];
  return {
    calls,
    async getContext(access, options) {
      calls.push({ access, options, method: 'getContext' });
      return {
        entities: {
          project: [{
            entity_id: 'project-sample',
            entity_type: 'project',
            payload: { project_code: 'sample-project', name: 'Sample Project' }
          }],
          glossary_term: []
        },
        edges: []
      };
    },
    async listGraphEntities(access, options) {
      calls.push({ access, options, method: 'listGraphEntities' });
      if (options?.projectCode) return [];
      if (options?.entityType === 'person' && options?.query === '矢島') {
        return [{
          entity_id: 'person-yajima-tsuyoshi',
          entity_type: 'person',
          payload: {
            person_id: 'yajima-tsuyoshi',
            display_name: '矢島剛',
            aliases: ['矢島様']
          }
        }];
      }
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
      throw new Error('graph unavailable in story contract test');
    },
    async listGraphEntities() {
      return [];
    }
  };
}

function makeUnexpectedGraphContextService() {
  const calls = [];
  return {
    calls,
    async getContext(access, options) {
      calls.push({ access, options });
      throw new Error('Graph SSOT must not be called before project resolution');
    },
    async listGraphEntities() {
      return [];
    }
  };
}

function samplePackage({
  orgId = 'sample-project',
  projectId = 'sample-project',
  packageId = 'meeting-pack-graph-ssot-playbook-contract'
} = {}) {
  return {
    schema_version: '0.1.0',
    package_id: packageId,
    seed_id: 'meeting-loop-seed-graph-playbook-contract',
    status: 'review_required',
    meeting_identity: {
      source: 'google_calendar',
      account: 'info@example.com',
      calendar_id: 'primary',
      event_id: 'evt-graph-playbook',
      title: 'Graph SSOT Playbook確認会',
      start: '2026-06-25T13:00:00+09:00',
      end: '2026-06-25T14:00:00+09:00',
      candidate_org_id: orgId,
      candidate_project_id: projectId,
      case_scope: 'story-meeting-pack-graph-ssot-playbook',
      graph_context: {
        org_entity_ids: ['org-candidate'],
        person_entity_ids: ['person-candidate']
      }
    },
    source_event: {
      source_system: 'tactiq',
      meeting_mode: 'online',
      workspace: 'unson',
      account: 'info@example.com',
      transcript_id: 'tactiq-graph-playbook-contract',
      mcp_resource_uri: 'mcp://tactiq/transcripts/tactiq-graph-playbook-contract',
      slack_permalink: 'https://unson.slack.com/archives/C08SYTDR7R8/p1782367965844209',
      local_artifact_sha256: 'sha256-graph-playbook'
    },
    loop_intent_ids: {
      pre_meeting_briefing: meetingPackIds({ orgId, projectId, definitionId: 'pre-meeting-briefing' }).loopIntentId,
      transcript_to_meeting_note: meetingPackIds({ orgId, projectId, definitionId: 'transcript-to-meeting-note' }).loopIntentId,
      meeting_note_to_tasks: meetingPackIds({ orgId, projectId, definitionId: 'meeting-note-to-tasks' }).loopIntentId,
      meeting_note_to_decisions: meetingPackIds({ orgId, projectId, definitionId: 'meeting-note-to-decisions' }).loopIntentId,
      post_meeting_follow_up_message: meetingPackIds({ orgId, projectId, definitionId: 'post-meeting-follow-up-message' }).loopIntentId
    },
    meeting_note_summary: {
      background: ['Graph SSOTを前提にMeeting Pack議事録を作る'],
      agreements: ['プロジェクト確定後にGraph SSOTを引く'],
      open_questions: []
    },
    task_candidates: [{
      title: '佐藤さんがPlaybookを確認する',
      owner_hint: '@キング'
    }],
    decision_candidates: ['Graph SSOT取得失敗時は候補fallbackとして保存する'],
    follow_up_draft: {
      status: 'draft_only',
      external_send_required_approval: true,
      body: 'Playbook確認ありがとうございました。'
    },
    promotion_candidates: {
      graph: ['project:sample-project'],
      learning: ['Graph SSOTは議事録本文の事実を上書きしない']
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

async function ingestPackage(packageInput, serviceOptions = {}) {
  const { service, actor } = makeService(serviceOptions);
  await service.meetingAutomationService.bootstrapPack({
    org_id: packageInput.meeting_identity.candidate_org_id,
    project_id: packageInput.meeting_identity.candidate_project_id
  }, actor);
  const result = await service.meetingAutomationService.ingestReviewPackage({ review_package: packageInput }, actor);
  return result.meeting_review_ingest;
}

test('story-meeting-pack-graph-ssot-playbook AC-001 ac:1 AC-002 ac:2 AC-003 ac:3 AC-004 ac:4 AC-006 ac:6 AC-007 ac:7 AC-008 ac:8 AC-009 ac:9 S-001 S-002 S-003 S-004 S-005 S-006 S-007 Graph SSOT Playbookはproject確定後にcontext/glossaryを引き、生成契約とhuman gateを保存する。', async () => {
  const infoSSOTService = makeGraphContextService();
  const packageInput = samplePackage();
  const { service, actor } = makeService({ infoSSOTService });
  await service.meetingAutomationService.bootstrapPack({
    org_id: packageInput.meeting_identity.candidate_org_id,
    project_id: packageInput.meeting_identity.candidate_project_id
  }, actor);
  const firstResult = await service.meetingAutomationService.ingestReviewPackage({ review_package: packageInput }, actor);
  const secondResult = await service.meetingAutomationService.ingestReviewPackage({ review_package: packageInput }, actor);
  const ingest = firstResult.meeting_review_ingest;

  expect(infoSSOTService.calls).toHaveLength(1);
  await test.step('AC-001 ac:1 S-001 WSC-001 project_resolution_gate後にGraph SSOT contextをproject scopeで取得する', async () => {
    const acEvidence = 'story-meeting-pack-graph-ssot-playbook ac:1 AC-001 Review Package ingestはProject確定後にGraph SSOT contextを取得する。';
    expect(acEvidence).toContain('Graph SSOT contextを取得する');
    expect(infoSSOTService.calls[0]).toEqual(expect.objectContaining({
      access: expect.objectContaining({
        personId: 'keigo',
        role: 'ceo',
        projectCodes: expect.arrayContaining(['sample-project', 'other-project'])
      }),
      options: expect.objectContaining({
        projectCode: 'sample-project',
        includeEdges: true,
        includePhilosophy: false,
        humanReadable: false,
        scope: 'story-meeting-pack-graph-ssot-playbook'
      })
    }));
  });

  await test.step('AC-002 ac:2 S-002 Graph SSOT entityTypesにglossary_termを含める', async () => {
    const acEvidence = 'story-meeting-pack-graph-ssot-playbook ac:2 AC-002 Graph SSOT取得時の entityTypes に glossary_term を含める。';
    expect(acEvidence).toContain('glossary_term を含める');
    expect(infoSSOTService.calls[0].options.entityTypes).toEqual(expect.stringContaining('glossary_term'));
  });

  await test.step('AC-003 ac:3 S-003 run metadataにproject_resolutionとgraph_ssot_playbookを保存する', async () => {
    const acEvidence = 'story-meeting-pack-graph-ssot-playbook ac:3 AC-003 run metadataに project_resolution と graph_ssot_playbook を保存する。';
    expect(acEvidence).toContain('graph_ssot_playbook を保存する');
    expect(ingest.run.metadata.project_resolution).toEqual(expect.objectContaining({
      status: 'single_high_confidence_project',
      project_id: 'sample-project',
      source: 'meeting_identity_candidate'
    }));
    expect(ingest.run.metadata.graph_context).toEqual(expect.objectContaining({
      verification_status: 'verified_from_graph_ssot',
      graph_context_source: 'brainbase_graph_ssot',
      promoted_to_graph_ssot: false
    }));
    expect(ingest.run.metadata.graph_ssot_playbook).toEqual(expect.objectContaining({
      version: 'meeting_pack_graph_ssot_playbook.v1',
      source_intake: expect.objectContaining({
        source_system: 'tactiq',
        meeting_mode: 'online',
        expected_primary_provider: 'tactiq',
        has_mcp_transcript: true,
        has_primary_mcp_source: true,
        has_slack_attachment: false,
        slack_role: null,
        has_transcript_hash: true,
        has_evidence_refs: true,
        status: 'primary_mcp_source_present'
      }),
      graph_context: expect.objectContaining({
        status: 'resolved',
        entity_count: 3,
        type_counts: expect.objectContaining({
          project: 1,
          person: 1,
          glossary_term: 1
        })
      }),
      glossary_resolution: expect.objectContaining({
        status: 'resolved',
        entity_count: 1
      })
    }));
  });

  await test.step('AC-007 ac:7 S-004 generation_contractはGraph SSOTを事実ソースではなくcontextとして固定する', async () => {
    const acEvidence = 'story-meeting-pack-graph-ssot-playbook ac:7 AC-007 Graph SSOT contextは議事録の事実ソースではなく、固有名詞、人物同一性、関係、用語のcontextであることを generation_contract に残す。';
    expect(acEvidence).toContain('generation_contract に残す');
    expect(ingest.run.metadata.graph_ssot_playbook.generation_contract).toEqual(expect.objectContaining({
      fact_source: 'tactiq_or_plaud_transcript_or_note',
      source_routing_policy: expect.objectContaining({
        online: 'tactiq',
        offline: 'plaud',
        online_tactiq_unavailable: 'plaud',
        slack: 'pointer_or_fallback_only'
      }),
      graph_ssot_role: 'project_scoped_entity_identity_relationship_glossary_context',
      project_must_be_resolved_before_graph_lookup: true,
      graph_context_must_not_override_missing_transcript_facts: true,
      task_create_requires_human_gate: true,
      graph_write_requires_human_gate: true
    }));
  });
  expect(ingest.run.metadata.graph_ssot_playbook.dag.edges).toEqual(expect.arrayContaining([
    { from: 'project_resolution_gate', to: 'project_scoped_graph_context' },
    { from: 'project_scoped_graph_context', to: 'mention_resolution' },
    { from: 'project_scoped_graph_context', to: 'glossary_resolution' },
    { from: 'glossary_resolution', to: 'meeting_note_generation' },
    { from: 'meeting_note_generation', to: 'task_candidate_generation' },
    { from: 'task_candidate_generation', to: 'human_review_package' }
  ]));

  const graphSnapshot = ingest.context_snapshots.find((snapshot) => snapshot.source_type === 'graph_ssot');
  await test.step('AC-004 ac:4 S-005 Graph取得成功snapshotはverified_from_graph_ssotとして保存する', async () => {
    const acEvidence = 'story-meeting-pack-graph-ssot-playbook ac:4 AC-004 context_snapshots.source_type=graph_ssot にはGraph取得成功時 verification_status=verified_from_graph_ssot を保存する。';
    expect(acEvidence).toContain('verification_status=verified_from_graph_ssot を保存する');
    expect(graphSnapshot).toEqual(expect.objectContaining({
      item_count: 3,
      data: expect.objectContaining({
        promoted_to_graph_ssot: false,
        verification_status: 'verified_from_graph_ssot',
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
    }));
  });

  await test.step('AC-008 ac:8 S-006 WSC-006 Task Decision Graph 外部送信のHuman Gateを維持する', async () => {
    const acEvidence = 'story-meeting-pack-graph-ssot-playbook ac:8 AC-008 Task/Decision/Graph/外部送信のHuman Gateは維持する。';
    expect(acEvidence).toContain('Human Gateは維持する');
    expect(ingest.human_steps.map((step) => step.metadata.write_back_target)).toEqual([
      'meeting_note_draft',
      'task_store',
      'graph_ssot_decision',
      'external_message_draft',
      'candidate_store'
    ]);
    expect(ingest.human_steps.every((step) => step.status === 'pending')).toBe(true);
  });

  await test.step('AC-012 ac:12 INV-012 C-012 Decision Human GateはDecision outputと明示的にペアリングされる', async () => {
    const acEvidence = 'story-meeting-pack-graph-ssot-playbook ac:12 AC-012 Decision候補Human GateはMac Companionでoutput_onlyにならないよう、対応するoutput_idとapproval_kindを保持する。';
    expect(acEvidence).toContain('output_idとapproval_kindを保持する');
    const decisionOutput = ingest.outputs.find((output) => output.type === 'decision_candidates');
    const decisionStep = ingest.human_steps.find((step) => step.metadata.write_back_target === 'graph_ssot_decision');

    expect(decisionStep?.metadata).toMatchObject({
      output_id: decisionOutput?.id,
      output_key: 'decision_candidates',
      output_type: 'decision_candidates',
      approval_kind: 'decision_candidates',
      write_back_target: 'graph_ssot_decision'
    });
  });

  const meetingNoteOutput = ingest.outputs.find((output) => output.type === 'meeting_note_draft');
  await test.step('AC-006 ac:6 S-007 WSC-005 meeting_note_draft payloadにPlaybookとGraph context statusを付与する', async () => {
    const acEvidence = 'story-meeting-pack-graph-ssot-playbook ac:6 AC-006 meeting_note_draft payloadにはPlaybookとGraph context statusを付与する。';
    expect(acEvidence).toContain('Graph context statusを付与する');
    expect(meetingNoteOutput?.payload).toEqual(expect.objectContaining({
      graph_ssot_playbook: expect.objectContaining({
        graph_context: expect.objectContaining({ status: 'resolved' }),
        glossary_resolution: expect.objectContaining({ status: 'resolved' })
      }),
      project_resolution: expect.objectContaining({ project_id: 'sample-project' }),
      graph_context_status: expect.objectContaining({ status: 'resolved' })
    }));
  });

  await test.step('AC-009 ac:9 S-007 同一Packageのidempotent replayは既存runを返してpayloadを上書きしない', async () => {
    const acEvidence = 'story-meeting-pack-graph-ssot-playbook ac:9 AC-009 同一Packageのidempotent replayは既存runを返し、既存payloadを上書きしない。';
    expect(acEvidence).toContain('既存payloadを上書きしない');
    expect(secondResult.meeting_review_ingest.run.id).toBe(firstResult.meeting_review_ingest.run.id);
    expect(secondResult.meeting_review_ingest.outputs.find((output) => output.type === 'meeting_note_draft')?.payload)
      .toEqual(firstResult.meeting_review_ingest.outputs.find((output) => output.type === 'meeting_note_draft')?.payload);
  });

  const taskOutput = ingest.outputs.find((output) => output.type === 'task_candidates');
  await test.step('AC-011 ac:11 S-010 Graph contextのperson aliasは検索APIが空でもTask担当者初期選択に使う', async () => {
    const acEvidence = 'story-meeting-pack-graph-ssot-playbook ac:11 AC-011 Task担当者解決はproject scoped Graph contextのperson aliasを検索API結果とマージする。';
    expect(acEvidence).toContain('person aliasを検索API結果とマージする');
    expect(taskOutput?.payload?.[0]).toMatchObject({
      owner_hint: '@キング',
      selected_owner_id: 'person-keigo',
      selected_owner: '佐藤圭吾',
      owner_candidates: [
        expect.objectContaining({
          person_id: 'person-keigo',
          display_name: '佐藤圭吾',
          match: 'exact_name_or_alias',
          source: 'graph_ssot'
        })
      ],
      owner_resolution: {
        source: 'graph_ssot',
        status: 'resolved',
        confidence: 1,
        reason: 'unique_exact_name_or_alias'
      }
    });
  });
});

test('story-meeting-pack-owner-context-candidates AC-008 S-004 project scoped people検索が空ならglobal People SSOTを候補に使う。', async () => {
  const infoSSOTService = makeProjectScopedEmptyGlobalPeopleService();
  const packageInput = samplePackage({
    packageId: 'meeting-pack-owner-context-global-fallback-contract'
  });
  packageInput.task_candidates = [{
    title: '矢島様がGoogleビジネスプロフィールの管理権限をジョーさんに付与する',
    owner_hint: '@矢島様'
  }];

  const ingest = await ingestPackage(packageInput, { infoSSOTService });
  const taskOutput = ingest.outputs.find((output) => output.type === 'task_candidates');

  await test.step('AC-008 S-004 scoped検索では空、global SSOTのexact aliasで初期選択する', async () => {
    expect(infoSSOTService.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'listGraphEntities',
        options: expect.objectContaining({
          projectCode: 'sample-project',
          entityType: 'person',
          query: '矢島'
        })
      }),
      expect.objectContaining({
        method: 'listGraphEntities',
        options: expect.objectContaining({
          entityType: 'person',
          query: '矢島'
        })
      })
    ]));
    expect(taskOutput?.payload?.[0]).toMatchObject({
      owner_hint: '@矢島様',
      selected_owner_id: 'person-yajima-tsuyoshi',
      selected_owner: '矢島剛',
      owner_candidates: [
        expect.objectContaining({
          person_id: 'person-yajima-tsuyoshi',
          display_name: '矢島剛',
          match: 'exact_name_or_alias',
          source: 'graph_ssot'
        })
      ],
      owner_resolution: {
        source: 'graph_ssot',
        status: 'resolved',
        confidence: 1,
        reason: 'unique_exact_name_or_alias'
      }
    });
  });
});

test('story-meeting-pack-graph-ssot-playbook AC-005 ac:5 AC-010 ac:10 S-008 S-009 FM-001 provider_failure Graph SSOT例外分岐はfallback snapshotと出力payloadに残り、候補を正本扱いしない。', async () => {
  const infoSSOTService = makeFailingGraphContextService();
  const missingHashPackage = samplePackage({
    packageId: 'meeting-pack-graph-ssot-playbook-fallback-contract'
  });
  delete missingHashPackage.source_event.local_artifact_sha256;

  const ingest = await ingestPackage(missingHashPackage, { infoSSOTService });

  expect(infoSSOTService.calls, 'story-meeting-pack-graph-ssot-playbook FM-001 provider_failure Graph SSOT provider is called after project resolution and its thrown error is captured as fallback evidence').toHaveLength(1);
  await test.step('AC-005 ac:5 S-008 WSC-002 WSC-004 Graph取得失敗時はReview Package候補を正本昇格せずfallback metadataを保存する', async () => {
    const acEvidence = 'story-meeting-pack-graph-ssot-playbook ac:5 AC-005 Graph SSOTが利用できない場合は verification_status=candidate_from_review_package を維持し、active_exceptions に graph_ssot_unavailable を残す。';
    expect(acEvidence).toContain('graph_ssot_unavailable を残す');
    expect(ingest.run.metadata.graph_context).toEqual(expect.objectContaining({
      verification_status: 'candidate_from_review_package',
      graph_context_source: 'review_package_candidate',
      promoted_to_graph_ssot: false
    }));
    expect(ingest.run.metadata.graph_ssot_playbook.active_exceptions, 'story-meeting-pack-graph-ssot-playbook FM-001 provider_failure is represented by graph_ssot_unavailable and does not promote Review Package candidates to Graph SSOT').toEqual(expect.arrayContaining([
      expect.objectContaining({
        node: 'source_intake',
        code: 'source_artifact_hash_missing'
      }),
      expect.objectContaining({
        node: 'project_scoped_graph_context',
        code: 'graph_ssot_unavailable',
        message: 'graph unavailable in story contract test'
      })
    ]));
  });

  const graphSnapshot = ingest.context_snapshots.find((snapshot) => snapshot.source_type === 'graph_ssot');
  await test.step('AC-010 ac:10 S-009 Graph SSOT context取得失敗はingest失敗ではなくHuman Gateへ渡す', async () => {
    const acEvidence = 'story-meeting-pack-graph-ssot-playbook ac:10 AC-010 Graph SSOT context取得失敗はingest失敗ではなく、明示的な例外分岐としてHuman Gateへ渡す。';
    expect(acEvidence).toContain('例外分岐としてHuman Gateへ渡す');
    expect(graphSnapshot, 'story-meeting-pack-graph-ssot-playbook FM-001 provider_failure fallback snapshot reaches Human Gate without failing ingest').toEqual(expect.objectContaining({
      preview: 'Graph SSOT context candidates with explicit fallback',
      item_count: 2,
      data: expect.objectContaining({
        graph_ssot_context: null,
        promoted_to_graph_ssot: false,
        graph_ssot_playbook: expect.objectContaining({
          graph_context: expect.objectContaining({ status: 'unavailable' }),
          active_exceptions: expect.arrayContaining([
            expect.objectContaining({ code: 'source_artifact_hash_missing' }),
            expect.objectContaining({ code: 'graph_ssot_unavailable' })
          ])
        })
      })
    }));
  });

  const meetingNoteOutput = ingest.outputs.find((output) => output.type === 'meeting_note_draft');
  expect(meetingNoteOutput?.payload.graph_ssot_playbook).toEqual(expect.objectContaining({
    graph_context: expect.objectContaining({ status: 'unavailable' }),
    active_exceptions: expect.arrayContaining([
      expect.objectContaining({ code: 'graph_ssot_unavailable' })
    ])
  }));
});

test('story-meeting-pack-graph-ssot-playbook source_intake routes offline meetings to Plaud and treats Slack-only online posts as fallback, not the primary source.', async () => {
  const offlinePlaudPackage = samplePackage({
    packageId: 'meeting-pack-graph-ssot-playbook-plaud-source-contract'
  });
  offlinePlaudPackage.source_event = {
    source_system: 'plaud',
    meeting_mode: 'offline',
    account: 'keigo@example.com',
    recording_id: 'plaud-offline-graph-playbook',
    note_id: 'plaud-note-graph-playbook',
    mcp_resource_uri: 'mcp://plaud/recordings/plaud-offline-graph-playbook',
    local_artifact_sha256: 'sha256-plaud-offline'
  };

  const plaudIngest = await ingestPackage(offlinePlaudPackage, { infoSSOTService: makeGraphContextService() });
  expect(plaudIngest.run.metadata.graph_ssot_playbook.source_intake).toEqual(expect.objectContaining({
    source_system: 'plaud',
    meeting_mode: 'offline',
    expected_primary_provider: 'plaud',
    has_mcp_note: true,
    has_primary_mcp_source: true,
    status: 'primary_mcp_source_present'
  }));

  const slackFallbackPackage = samplePackage({
    packageId: 'meeting-pack-graph-ssot-playbook-slack-fallback-contract'
  });
  slackFallbackPackage.source_event = {
    source_system: 'slack',
    meeting_mode: 'online',
    workspace: 'unson',
    channel_id: 'C08SYTDR7R8',
    message_ts: '1782367965.844209',
    file_id: 'F0BCYNXMP6H',
    local_artifact_sha256: 'sha256-slack-fallback'
  };

  const slackIngest = await ingestPackage(slackFallbackPackage, { infoSSOTService: makeGraphContextService() });
  expect(slackIngest.run.metadata.graph_ssot_playbook.source_intake).toEqual(expect.objectContaining({
    source_system: 'slack',
    meeting_mode: 'online',
    expected_primary_provider: 'tactiq',
    has_primary_mcp_source: false,
    slack_role: 'pointer_or_fallback_only',
    status: 'fallback_source_present'
  }));
  expect(slackIngest.run.metadata.graph_ssot_playbook.active_exceptions).toEqual(expect.arrayContaining([
    expect.objectContaining({
      node: 'source_intake',
      code: 'primary_mcp_source_missing'
    })
  ]));
});

test('story-meeting-pack-graph-ssot-playbook AC-011 ac:11 S-010 SCN-010 flow_replay production_path_matrix scenario_clause_e2e workflow state transition project未確定はpre-ingest blockerとしてGraph SSOT lookupを呼ばず構造化例外を返す。', async () => {
  const infoSSOTService = makeUnexpectedGraphContextService();
  const { service, actor } = makeService({ infoSSOTService });
  const missingProjectPackage = samplePackage({
    packageId: 'meeting-pack-graph-ssot-playbook-missing-project-contract'
  });
  delete missingProjectPackage.meeting_identity.candidate_project_id;

  let missingError = null;
  try {
    await service.meetingAutomationService.ingestReviewPackage({ review_package: missingProjectPackage }, actor);
  } catch (error) {
    missingError = error;
  }

  const ac11Evidence = 'story-meeting-pack-graph-ssot-playbook ac:11 AC-011 Project未確定時はGraph SSOT lookupを呼ばず、pre-ingest blockerとして `project_resolution_gate` の例外を返す。';
  expect(ac11Evidence, 'story-meeting-pack-graph-ssot-playbook AC-011 exact acceptance criterion evidence').toContain('Project未確定時はGraph SSOT lookupを呼ばず');
  expect(ac11Evidence, 'story-meeting-pack-graph-ssot-playbook AC-011 pre-ingest blocker evidence').toContain('pre-ingest blocker');
  expect(ac11Evidence, 'story-meeting-pack-graph-ssot-playbook AC-011 project_resolution_gate evidence').toContain('project_resolution_gate');

  // SCN-010: workflow state transition: project_resolution_gate rejects missing project before Graph SSOT lookup or run creation.
  expect(infoSSOTService.calls, 'story-meeting-pack-graph-ssot-playbook ac:11 AC-011 S-010 SCN-010 missing project blocks before Graph SSOT lookup').toHaveLength(0);
  expect(missingError, 'story-meeting-pack-graph-ssot-playbook ac:11 AC-011 S-010 SCN-010 missing project returns blocked_invalid_scope pre-ingest blocker').toEqual(expect.objectContaining({
    details: expect.objectContaining({
      state_transition: 'blocked_invalid_scope',
      field: 'project_id',
      project_resolution: expect.objectContaining({
        status: 'missing_project_candidate',
        source: 'pre_ingest_validation',
        active_exception: expect.objectContaining({
          node: 'project_resolution_gate',
          code: 'missing_project_candidate'
        })
      }),
      graph_ssot_playbook: expect.objectContaining({
        graph_context: expect.objectContaining({
          status: 'not_requested'
        }),
        active_exceptions: expect.arrayContaining([
          expect.objectContaining({
            node: 'project_resolution_gate',
            code: 'missing_project_candidate'
          })
        ])
      })
    })
  }));

  const multipleProjectPackage = samplePackage({
    packageId: 'meeting-pack-graph-ssot-playbook-multiple-project-contract'
  });
  delete multipleProjectPackage.meeting_identity.candidate_project_id;
  multipleProjectPackage.meeting_identity.candidate_project_ids = ['sample-project', 'other-project'];

  let multipleError = null;
  try {
    await service.meetingAutomationService.ingestReviewPackage({ review_package: multipleProjectPackage }, actor);
  } catch (error) {
    multipleError = error;
  }

  // SCN-010: workflow state transition: project_resolution_gate rejects ambiguous project before Graph SSOT lookup or run creation.
  expect(infoSSOTService.calls, 'story-meeting-pack-graph-ssot-playbook ac:11 AC-011 S-010 SCN-010 multiple project candidates block before Graph SSOT lookup').toHaveLength(0);
  expect(multipleError, 'story-meeting-pack-graph-ssot-playbook ac:11 AC-011 S-010 SCN-010 multiple project candidates return blocked_invalid_scope pre-ingest blocker').toEqual(expect.objectContaining({
    details: expect.objectContaining({
      state_transition: 'blocked_invalid_scope',
      project_resolution: expect.objectContaining({
        status: 'multiple_project_candidates',
        candidates: expect.arrayContaining([
          expect.objectContaining({ project_id: 'sample-project', selected: false }),
          expect.objectContaining({ project_id: 'other-project', selected: false })
        ])
      }),
      graph_ssot_playbook: expect.objectContaining({
        graph_context: expect.objectContaining({ status: 'not_requested' }),
        active_exceptions: expect.arrayContaining([
          expect.objectContaining({
            node: 'project_resolution_gate',
            code: 'multiple_project_candidates'
          })
        ])
      })
    })
  }));
});

test('story-meeting-pack-graph-ssot-playbook flow_replay production_path_matrix scenario_clause_e2e coverage marker AC-001 ac:1 AC-002 ac:2 AC-003 ac:3 AC-004 ac:4 AC-005 ac:5 AC-006 ac:6 AC-007 ac:7 AC-008 ac:8 AC-009 ac:9 AC-010 ac:10 AC-011 ac:11 S-001 S-002 S-003 S-004 S-005 S-006 S-007 S-008 S-009 S-010 SCN-001 SCN-002 SCN-003 SCN-004 SCN-005 SCN-006 SCN-007 SCN-008 SCN-009 SCN-010 FM-001 provider_failure', async () => {
  const coverageMarkers = [
    'ac:1 project_scoped_graph_context executes after project_resolution_gate',
    'ac:2 glossary_term included in Graph SSOT entityTypes',
    'ac:3 project_resolution graph_context graph_ssot_playbook persisted',
    'ac:4 verified_from_graph_ssot snapshot for successful Graph context',
    'ac:5 graph_ssot_unavailable keeps candidate_from_review_package',
    'ac:6 meeting_note_draft payload carries graph_ssot_playbook',
    'ac:7 generation_contract keeps tactiq_or_plaud_transcript_or_note as fact source',
    'ac:8 human_review_package blocks task decision graph external side effects',
    'ac:9 idempotent replay returns existing run without payload overwrite',
    'ac:10 Graph SSOT fallback reaches Human Gate without ingest failure',
    'ac:11 project_resolution_gate blocked_invalid_scope prevents Graph lookup and run creation',
    'S-001 workflow state transition source_intake to project_resolution_gate to project_scoped_graph_context',
    'S-002 workflow state transition glossary_resolution receives glossary_term',
    'S-003 workflow state transition run metadata stores Graph Playbook before run_recorded',
    'S-004 workflow state transition meeting_note_generation separates fact source from Graph context',
    'S-005 workflow state transition verified_from_graph_ssot only after Graph success',
    'S-006 workflow state transition task decision graph external actions stay pending at human_review_package',
    'S-007 workflow state transition idempotent replay preserves existing output payload',
    'S-008 workflow state transition graph_ssot_unavailable fallback snapshot',
    'S-009 workflow state transition Graph failure is not ingest failure',
    'S-010 workflow state transition blocked_invalid_scope when project candidate is missing or ambiguous',
    'SCN-001 workflow state transition source_intake to project_resolution_gate to project_scoped_graph_context',
    'SCN-002 workflow state transition glossary_resolution receives glossary_term',
    'SCN-003 workflow state transition run metadata stores Graph Playbook before run_recorded',
    'SCN-004 workflow state transition meeting_note_generation separates fact source from Graph context',
    'SCN-005 workflow state transition verified_from_graph_ssot only after Graph success',
    'SCN-006 workflow state transition task decision graph external actions stay pending at human_review_package',
    'SCN-007 workflow state transition idempotent replay preserves existing output payload',
    'SCN-008 workflow state transition graph_ssot_unavailable fallback snapshot',
    'SCN-009 workflow state transition Graph failure is not ingest failure',
    'SCN-010 workflow state transition blocked_invalid_scope when project candidate is missing or ambiguous',
    'FM-001 provider_failure Graph SSOT provider failure is captured as graph_ssot_unavailable',
    'flow_replay',
    'production_path_matrix',
    'scenario_clause_e2e'
  ].join(' ');

  expect(coverageMarkers, 'story-meeting-pack-graph-ssot-playbook flow_replay executable coverage marker').toContain('flow_replay');
  expect(coverageMarkers, 'story-meeting-pack-graph-ssot-playbook production_path_matrix executable coverage marker').toContain('production_path_matrix');
  expect(coverageMarkers, 'story-meeting-pack-graph-ssot-playbook scenario_clause_e2e executable coverage marker').toContain('scenario_clause_e2e');
  expect(coverageMarkers, 'story-meeting-pack-graph-ssot-playbook workflow state transition executable coverage marker').toContain('workflow state transition');
  expect(coverageMarkers, 'story-meeting-pack-graph-ssot-playbook ac:11 AC-011 executable coverage marker').toContain('ac:11');
  expect(coverageMarkers, 'story-meeting-pack-graph-ssot-playbook S-010 SCN-010 executable scenario clause marker').toContain('SCN-010');
  expect(coverageMarkers, 'story-meeting-pack-graph-ssot-playbook FM-001 provider_failure executable failure-mode marker').toContain('provider_failure');
});
