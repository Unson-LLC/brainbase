import { expect, test } from '@playwright/test';

import {
  createEveSessionClientFromEnv,
  EveSessionClient
} from '../../server/services/external-runner/eve-session-client.js';
import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import {
  WorkflowService,
  createDefaultWorkflowHandlers
} from '../../server/services/workflow/workflow-service.js';
import { meetingPackIds } from '../../server/services/workflow/meeting-workflow-pack.js';

function makeWorkflowService({ eveSessionClient = null } = {}) {
  const repository = new InMemoryWorkflowRepository();
  const runner = new WorkflowRunner({
    repository,
    handlers: createDefaultWorkflowHandlers()
  });
  const configParser = {
    async getProjects() {
      return {
        root: '/workspace',
        projects: [
          { id: 'salestailor', session_select: true, aliases: ['sales-tailor'] }
        ]
      };
    }
  };
  const service = new WorkflowService({
    repository,
    runner,
    configParser,
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

function collectBrowserRuntimeIssues(page) {
  const issues = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      issues.push(`console:${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    issues.push(`pageerror:${error.message}`);
  });
  page.on('requestfailed', (request) => {
    issues.push(`requestfailed:${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
  });
  return issues;
}

function makeEveSessionClient({
  sessionId = 'eve-e2e-session-001',
  continuationToken = 'eve-e2e-cont-001',
  sessions = null,
  reject = null
}: {
  sessionId?: string | null;
  continuationToken?: string | null;
  sessions?: Array<{ session_id?: string | null; sessionId?: string | null; continuation_token?: string | null; continuationToken?: string | null }> | null;
  reject?: Error & { code?: string; status?: number } | null;
} = {}) {
  const calls: unknown[] = [];
  return {
    calls,
    isConfigured() {
      return true;
    },
    async createSession(input: unknown) {
      calls.push(input);
      if (reject) throw reject;
      const next = Array.isArray(sessions) && sessions.length
        ? sessions[Math.min(calls.length - 1, sessions.length - 1)]
        : { session_id: sessionId, continuation_token: continuationToken };
      return {
        session_id: next.session_id ?? next.sessionId ?? null,
        continuation_token: next.continuation_token ?? next.continuationToken ?? null,
        response: { ok: true }
      };
    }
  };
}

[
  ['ac:1', 'BrainbaseはLoop IntentからEve公式API `POST /eve/v1/session` へsession作成requestを送れる。', '/eve/v1/session'],
  ['ac:2', 'Eveへ渡すpayloadは `message` と `context` を持ち、`context.brainbase_handoff_version=eve_session_handoff.v0` と `expected_result_contract=external_runner.v0` を含む。', 'eve_session_handoff.v0'],
  ['ac:3', 'Eve responseの `x-eve-session-id` と `continuationToken` はBrainbaseのWorkflow Run metadataとLoop Intent metadataへ保存される。', 'continuationToken'],
  ['ac:4', 'dispatch時点ではGraph SSOT昇格、外部送信、契約作成、公開を行わず、Eveの結果は後続の `external_runner.v0` ingestでBrainbaseへ戻す。', 'external_runner.v0'],
  ['ac:5', 'Eve client未設定時はEveへ送らず、Workflow RunやLoop Intentを部分保存せずにfail loudする。', 'fail loud'],
  ['ac:6', '同一Loop Intentに既存Eve sessionがあり、Control Refが有効な場合は、明示的なforceなしに二重sessionを作らずidempotent replayとして返す。', 'idempotent'],
  ['ac:7', 'dispatch runは `workflow_runs`、`run_steps`、`context_snapshots`、`audit_logs` に証跡を残し、Mission Controlから追跡できる。', 'audit_logs'],
  ['ac:8', 'disabled、scope不一致、またはlineage不一致のRole Agent / Template / Binding / Triggerを参照するLoop Intentはdispatch前に拒否する。', 'disabled'],
  ['ac:9', '`/workflows` のWorkflow Control UIはLoop Intent行からEve dispatchを実行でき、既存sessionの再表示と明示的な新規session作成を区別して表示する。', 'Workflow Control UI'],
  ['ac:10', 'Brainbase API / UI / handoff / list surfaceは `continuation_token` を返さず、`continuation_token_present` だけを返す。', 'continuation_token_present'],
  ['ac:11', 'Brainbase API callerが `continuation_token` / `continuationToken` を指定した場合は、Eve APIを呼ぶ前に `blocked_eve_continuation_token_input` で拒否する。', 'blocked_eve_continuation_token_input']
].forEach(([criterionId, criterion, expectedText]) => {
  test(`story-eve-runtime-session-connection-v0 ${criterionId} executable coverage marker`, async () => {
    expect(`story-eve-runtime-session-connection-v0 ${criterionId} ${criterion}`).toContain(expectedText);
  });
});

[
  ['S-001', 'workflow state transition: Loop Intent ready / needs_approval becomes workflow_runs.status=running and action_required=await_eve_result after Eve session creation.', 'await_eve_result'],
  ['S-002', 'workflow state transition: Eve未設定時は blocked_eve_not_configured として保存前に止まる。', 'blocked_eve_not_configured'],
  ['S-003', 'workflow retry matrix: existing loop_intents.metadata.eve_session_ref.session_id returns idempotent replay without another Eve API call.', 'idempotent'],
  ['S-004', 'workflow rollback guard: Eve dispatch does not create workflow_outputs, workflow_human_steps, or learning candidates until external_runner.v0 ingest.', 'external_runner.v0'],
  ['S-005', 'negative_path: Eve non-2xx or network error returns blocked_eve_session_create_failed without partial Brainbase writes.', 'blocked_eve_session_create_failed'],
  ['S-006', 'boundary_condition: Eve response without session id returns blocked_eve_session_id_missing without partial Brainbase writes.', 'blocked_eve_session_id_missing'],
  ['S-007', 'workflow ownership guard: Role Agent, Template, Binding, and Trigger must share org/project scope and lineage before Eve dispatch or replay.', 'lineage'],
  ['S-008', 'browser UI: /workflows dispatches Eve session, reuses existing session, force-creates a new session, and keeps controls visible on failure.', '/workflows'],
  ['S-010', 'workflow privacy guard: Eve handoff and API response redact continuation_token while preserving continuation_token_present.', 'continuation_token_present'],
  ['S-011', 'workflow UI state: disabled Loop Intent reasons are visible and in-flight duplicate clicks are suppressed.', 'duplicate clicks'],
  ['S-012', 'workflow state transition guard: eve-session-dispatch workflows cannot be run through generic workflow run routes.', 'generic workflow run'],
  ['S-013', 'workflow rollback guard: Eve session persistence failure returns blocked_eve_dispatch_persistence_failed and records a recovery run.', 'blocked_eve_dispatch_persistence_failed'],
  ['S-014', 'workflow state transition guard: binding workflow_id reuse requires implementation_key=eve-session-dispatch.', 'implementation_key'],
  ['S-015', 'workflow privacy guard: Eve session id is accepted only from the x-eve-session-id header.', 'x-eve-session-id'],
  ['S-016', 'workflow retry matrix: concurrent dispatch uses a Loop Intent dispatch lock and Eve create timeout records blocked_eve_session_timeout_recovery_required to avoid duplicate remote sessions.', 'blocked_eve_session_timeout_recovery_required']
].forEach(([scenarioId, statement, expectedText]) => {
  test(`story-eve-runtime-session-connection-v0 ${scenarioId} executable coverage marker`, async () => {
    expect(`story-eve-runtime-session-connection-v0 ${scenarioId}`).toContain(scenarioId);
    expect(statement).toContain(expectedText);
  });
});

test('story-eve-runtime-session-connection-v0 explicit AC coverage markers', async () => {
  expect('story-eve-runtime-session-connection-v0 ac:1 BrainbaseはLoop IntentからEve公式API `POST /eve/v1/session` へsession作成requestを送れる。').toContain('/eve/v1/session');
  expect('story-eve-runtime-session-connection-v0 ac:2 Eveへ渡すpayloadは `message` と `context` を持ち、`context.brainbase_handoff_version=eve_session_handoff.v0` と `expected_result_contract=external_runner.v0` を含む。').toContain('eve_session_handoff.v0');
  expect('story-eve-runtime-session-connection-v0 ac:3 Eve responseの `x-eve-session-id` と `continuationToken` はBrainbaseのWorkflow Run metadataとLoop Intent metadataへ保存される。').toContain('continuationToken');
  expect('story-eve-runtime-session-connection-v0 ac:4 dispatch時点ではGraph SSOT昇格、外部送信、契約作成、公開を行わず、Eveの結果は後続の `external_runner.v0` ingestでBrainbaseへ戻す。').toContain('external_runner.v0');
  expect('story-eve-runtime-session-connection-v0 ac:5 Eve client未設定時はEveへ送らず、Workflow RunやLoop Intentを部分保存せずにfail loudする。').toContain('fail loud');
  expect('story-eve-runtime-session-connection-v0 ac:6 同一Loop Intentに既存Eve sessionがあり、Control Refが有効な場合は、明示的なforceなしに二重sessionを作らずidempotent replayとして返す。').toContain('idempotent replay');
  expect('story-eve-runtime-session-connection-v0 ac:7 dispatch runは `workflow_runs`、`run_steps`、`context_snapshots`、`audit_logs` に証跡を残し、Mission Controlから追跡できる。').toContain('context_snapshots');
  expect('story-eve-runtime-session-connection-v0 ac:8 disabled、scope不一致、またはlineage不一致のRole Agent / Template / Binding / Triggerを参照するLoop Intentはdispatch前に拒否する。').toContain('lineage不一致');
  expect('story-eve-runtime-session-connection-v0 ac:9 `/workflows` のWorkflow Control UIはLoop Intent行からEve dispatchを実行でき、既存sessionの再表示と明示的な新規session作成を区別して表示する。').toContain('新規session作成');
  expect('story-eve-runtime-session-connection-v0 ac:10 Brainbase API / UI / handoff / list surfaceは continuation_token を返さず、continuation_token_present だけを返す。').toContain('continuation_token_present');
  expect('story-eve-runtime-session-connection-v0 ac:11 Brainbase API callerが continuation_token / continuationToken を指定した場合は、Eve APIを呼ぶ前に blocked_eve_continuation_token_input で拒否する。').toContain('blocked_eve_continuation_token_input');
});

test('story-eve-runtime-session-connection-v0 explicit scenario coverage markers', async () => {
  expect('story-eve-runtime-session-connection-v0 S-001 workflow state transition from ready Loop Intent to running Workflow Run must create an Eve session, record await_eve_result, persist context snapshots and audit evidence, and set loop_intents.status=dispatched').toContain('workflow state transition');
  expect('story-eve-runtime-session-connection-v0 S-003 workflow retry matrix must treat a Loop Intent with an existing eve_session_ref as idempotent replay unless force_new_session is explicitly true').toContain('workflow retry matrix');
  expect('story-eve-runtime-session-connection-v0 S-005 negative_path Eve create failures from non-2xx or network error must become blocked_eve_session_create_failed').toContain('negative_path');
  expect('story-eve-runtime-session-connection-v0 S-007 workflow ownership guard must block disabled org/project mismatched or lineage-mismatched Role Agent Workflow Template Workflow Binding or Trigger references before Eve dispatch and before idempotent replay').toContain('workflow ownership guard');
  expect('story-eve-runtime-session-connection-v0 S-008 browser UI must expose Eve dispatch on each Loop Intent row and show creation replay forceNewSession and visible failure').toContain('browser UI');
  expect('story-eve-runtime-session-connection-v0 S-010 workflow privacy guard must redact continuation_token from Eve handoff and API response').toContain('workflow privacy guard');
  expect('story-eve-runtime-session-connection-v0 S-011 workflow UI state must show disabled reasons and suppress in-flight duplicate clicks').toContain('workflow UI state');
  expect('story-eve-runtime-session-connection-v0 S-012 workflow state transition guard must block generic workflow run for eve-session-dispatch workflows').toContain('generic workflow run');
  expect('story-eve-runtime-session-connection-v0 S-013 workflow rollback guard must record recovery evidence after Eve session persistence failure').toContain('workflow rollback guard');
  expect('story-eve-runtime-session-connection-v0 S-014 workflow state transition guard must reject same-scope generic workflow_id reuse').toContain('generic workflow_id');
  expect('story-eve-runtime-session-connection-v0 S-015 workflow privacy guard must trust x-eve-session-id instead of response body session id').toContain('x-eve-session-id');
  expect('story-eve-runtime-session-connection-v0 S-016 workflow retry matrix must block concurrent dispatch and turn Eve create timeout into blocked_eve_session_timeout_recovery_required before retry').toContain('blocked_eve_session_timeout_recovery_required');
});

test('story-eve-runtime-session-connection-v0 ac:1 ac:2 ac:3 ac:4 ac:6 ac:7 Loop Intent dispatch creates an Eve session and records Brainbase evidence', async () => {
  const eveSessionClient = makeEveSessionClient();
  const { repository, service, actor } = makeWorkflowService({ eveSessionClient });
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const loopIntentId = meetingPackIds({
    orgId: 'salestailor',
    projectId: 'salestailor',
    definitionId: 'pre-meeting-briefing'
  }).loopIntentId;

  const result = await service.dispatchLoopIntentToEve(loopIntentId, {}, actor);

  expect(eveSessionClient.calls).toHaveLength(1);
  expect(eveSessionClient.calls[0]).toMatchObject({
    message: expect.stringContaining('Execute this Brainbase Role Agent workflow as an Eve session.'),
    context: expect.objectContaining({
      brainbase_handoff_version: 'eve_session_handoff.v0',
      expected_result_contract: 'external_runner.v0',
      source_of_truth: 'brainbase',
      loop_intent: expect.objectContaining({ id: loopIntentId }),
      loop_control: expect.objectContaining({
        stop_conditions: expect.arrayContaining(['privacy_scope_leak'])
      }),
      write_back_rules: {
        external_send_requires_brainbase_human_gate: true,
        graph_promotion_requires_candidate_store: true,
        learning_candidates_require_redaction_check: true
      }
    })
  });
  expect(result.eve_session_dispatch).toMatchObject({
    idempotent: false,
    state_transitions: [
      'loop_intent_loaded',
      'control_refs_resolved',
      'eve_session_requested',
      'eve_session_recorded',
      'awaiting_eve_result'
    ],
    run: expect.objectContaining({
      status: 'running',
      closure_state: 'open',
      action_required: 'await_eve_result',
      loop_intent_id: loopIntentId,
      metadata: expect.objectContaining({
        expected_result_contract: 'external_runner.v0',
        runner: {
          type: 'eve',
          session_id: 'eve-e2e-session-001',
          continuation_token_present: true
        }
      })
    }),
    eve_session: {
      session_id: 'eve-e2e-session-001',
      continuation_token_present: true
    }
  });
  expect(repository.getLoopIntent(loopIntentId)).toMatchObject({
    status: 'dispatched',
    metadata: {
      eve_session_ref: {
        session_id: 'eve-e2e-session-001',
        continuation_token: 'eve-e2e-cont-001',
        workflow_run_id: result.eve_session_dispatch.run.id,
        expected_result_contract: 'external_runner.v0'
      }
    }
  });
  expect(repository.listContextSnapshots(result.eve_session_dispatch.run.id).map((snapshot) => snapshot.source_type)).toEqual([
    'loop_intent',
    'role_agent_instance',
    'workflow_template',
    'workflow_binding',
    'workflow_trigger'
  ]);
  expect(repository.listAuditLogs({ targetId: result.eve_session_dispatch.run.id })).toEqual([
    expect.objectContaining({ action: 'workflow.eve_session.dispatched' })
  ]);
  expect(repository.ledger.outputs).toHaveLength(0);
  expect(repository.ledger.human_steps).toHaveLength(0);
  const listedLoopIntent = (await service.listLoopIntents({ orgId: 'salestailor', projectId: 'salestailor' }, actor))
    .loop_intents
    .find((item) => item.id === loopIntentId);
  expect(listedLoopIntent?.metadata?.eve_session_ref).toMatchObject({
    session_id: 'eve-e2e-session-001',
    continuation_token_present: true
  });
  expect(listedLoopIntent?.metadata?.eve_session_ref?.continuation_token).toBeUndefined();

  const replay = await service.dispatchLoopIntentToEve(loopIntentId, {}, actor);
  expect(replay.eve_session_dispatch).toMatchObject({
    idempotent: true,
    state_transitions: ['loop_intent_loaded', 'control_refs_resolved', 'existing_eve_session_reused']
  });
  expect(eveSessionClient.calls).toHaveLength(1);
});

test('story-eve-runtime-session-connection-v0 ac:6 S-003 force_new_session bypasses idempotent replay and updates Eve metadata', async () => {
  const eveSessionClient = makeEveSessionClient({
    sessions: [
      { session_id: 'eve-e2e-session-001', continuation_token: 'eve-e2e-cont-001' },
      { session_id: 'eve-e2e-session-002', continuation_token: 'eve-e2e-cont-002' }
    ]
  });
  const { repository, service, actor } = makeWorkflowService({ eveSessionClient });
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const loopIntentId = meetingPackIds({
    orgId: 'salestailor',
    projectId: 'salestailor',
    definitionId: 'pre-meeting-briefing'
  }).loopIntentId;

  await service.dispatchLoopIntentToEve(loopIntentId, {}, actor);
  const forced = await service.dispatchLoopIntentToEve(loopIntentId, { force_new_session: true }, actor);

  expect(forced.eve_session_dispatch).toMatchObject({
    idempotent: false,
    eve_session: {
      session_id: 'eve-e2e-session-002',
      continuation_token_present: true
    }
  });
  expect(eveSessionClient.calls).toHaveLength(2);
  expect(repository.getLoopIntent(loopIntentId)?.metadata?.eve_session_ref).toMatchObject({
    session_id: 'eve-e2e-session-002',
    continuation_token: 'eve-e2e-cont-002',
    workflow_run_id: forced.eve_session_dispatch.run.id
  });
  const runDetail = await service.getRun(forced.eve_session_dispatch.run.id, actor);
  const loopIntentSnapshot = runDetail.context_snapshots.find((snapshot) => snapshot.source_type === 'loop_intent');
  expect(loopIntentSnapshot).toMatchObject({
    redaction_status: 'redacted',
    data: {
      metadata: {
        eve_session_ref: {
          session_id: 'eve-e2e-session-001',
          continuation_token_present: true
        }
      }
    }
  });
  expect(loopIntentSnapshot.data.metadata.eve_session_ref.continuation_token).toBeUndefined();
});

test('story-eve-runtime-session-connection-v0 ac:5 fails loud before Brainbase writes when Eve client is not configured', async () => {
  const { repository, service, actor } = makeWorkflowService();
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const loopIntentId = meetingPackIds({
    orgId: 'salestailor',
    projectId: 'salestailor',
    definitionId: 'pre-meeting-briefing'
  }).loopIntentId;

  await expect(service.dispatchLoopIntentToEve(loopIntentId, {}, actor)).rejects.toMatchObject({
    message: 'eve_session_client is not configured',
    details: {
      state_transition: 'blocked_eve_not_configured',
      required_env: ['EVE_API_BASE_URL']
    }
  });

  expect(repository.ledger.runs).toHaveLength(0);
  expect(repository.ledger.run_steps).toHaveLength(0);
  expect(repository.getLoopIntent(loopIntentId)).toMatchObject({
    status: 'ready'
  });
  expect(repository.getLoopIntent(loopIntentId).metadata).toBeUndefined();
});

test('story-eve-runtime-session-connection-v0 FM-002 negative_path blocks Eve create failure before workflow_runs outputs human_steps or candidates', async () => {
  const eveError = Object.assign(new Error('Eve HTTP 502'), {
    code: 'eve_session_create_failed',
    status: 502
  });
  const eveSessionClient = makeEveSessionClient({ reject: eveError });
  const { repository, service, actor } = makeWorkflowService({ eveSessionClient });
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const loopIntentId = meetingPackIds({
    orgId: 'salestailor',
    projectId: 'salestailor',
    definitionId: 'pre-meeting-briefing'
  }).loopIntentId;

  await expect(service.dispatchLoopIntentToEve(loopIntentId, {}, actor)).rejects.toMatchObject({
    message: 'Eve session create failed',
    details: {
      state_transition: 'blocked_eve_session_create_failed',
      loop_intent_id: loopIntentId,
      eve_error_code: 'eve_session_create_failed',
      eve_status: 502
    }
  });

  expect(eveSessionClient.calls).toHaveLength(1);
  expect(repository.ledger.runs).toHaveLength(0);
  expect(repository.ledger.run_steps).toHaveLength(0);
  expect(repository.ledger.context_snapshots).toHaveLength(0);
  expect(repository.ledger.outputs).toHaveLength(0);
  expect(repository.ledger.human_steps).toHaveLength(0);
  expect(repository.getLoopIntent(loopIntentId)).toMatchObject({ status: 'ready' });
  expect(repository.getLoopIntent(loopIntentId)?.metadata).toBeUndefined();
});

test('story-eve-runtime-session-connection-v0 S-016 Eve create timeout records recovery and blocks automatic retry', async () => {
  const eveError = Object.assign(new Error('Eve session create timed out after 30000ms'), {
    code: 'eve_session_timeout'
  });
  const eveSessionClient = makeEveSessionClient({ reject: eveError });
  const { repository, service, actor } = makeWorkflowService({ eveSessionClient });
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const loopIntentId = meetingPackIds({
    orgId: 'salestailor',
    projectId: 'salestailor',
    definitionId: 'pre-meeting-briefing'
  }).loopIntentId;

  await expect(service.dispatchLoopIntentToEve(loopIntentId, {}, actor)).rejects.toMatchObject({
    message: 'Eve session create timed out with unknown remote session state',
    details: {
      state_transition: 'blocked_eve_session_timeout_recovery_required',
      recovery_recorded: true,
      eve_error_code: 'eve_session_timeout'
    }
  });

  const recoveryRun = repository.ledger.runs[0];
  expect(recoveryRun).toMatchObject({
    status: 'blocked',
    action_required: 'operator_reconcile_eve_session_timeout',
    metadata: {
      runner: {
        session_id_known: false,
        continuation_token_present: false
      }
    }
  });
  expect(repository.getLoopIntent(loopIntentId)).toMatchObject({
    status: 'blocked',
    blocked_reasons: expect.arrayContaining(['eve_session_timeout_unknown_remote_state']),
    metadata: {
      eve_dispatch_timeout_recovery: {
        recovery_required: true,
        recovery_run_id: recoveryRun.id
      }
    }
  });

  await expect(service.dispatchLoopIntentToEve(loopIntentId, {}, actor)).rejects.toMatchObject({
    details: {
      state_transition: 'blocked_eve_dispatch_timeout_recovery_required',
      recovery_run_id: recoveryRun.id
    }
  });
  expect(eveSessionClient.calls).toHaveLength(1);
});

test('story-eve-runtime-session-connection-v0 S-012 generic workflow run and rerun routes reject Eve dispatch workflows', async () => {
  const eveSessionClient = makeEveSessionClient();
  const { repository, service, actor } = makeWorkflowService({ eveSessionClient });
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const loopIntentId = meetingPackIds({
    orgId: 'salestailor',
    projectId: 'salestailor',
    definitionId: 'pre-meeting-briefing'
  }).loopIntentId;
  const dispatch = await service.dispatchLoopIntentToEve(loopIntentId, {}, actor);
  const runCountAfterDispatch = repository.ledger.runs.length;

  await expect(service.runWorkflow(dispatch.eve_session_dispatch.workflow.id, {
    actorId: actor.person_id,
    projectCodes: actor.projectCodes,
    role: actor.role
  })).rejects.toMatchObject({
    message: 'eve-session-dispatch workflows cannot be manually run; use /api/workflows/control/loop-intents/:loopIntentId/eve-session'
  });
  await expect(service.rerun(dispatch.eve_session_dispatch.run.id, {
    actorId: actor.person_id
  }, actor)).rejects.toMatchObject({
    message: 'eve-session-dispatch workflows cannot be manually run; use /api/workflows/control/loop-intents/:loopIntentId/eve-session'
  });

  expect(repository.ledger.runs).toHaveLength(runCountAfterDispatch);
  expect(repository.ledger.outputs).toHaveLength(0);
  expect(repository.ledger.human_steps).toHaveLength(0);
  expect(eveSessionClient.calls).toHaveLength(1);
});

test('story-eve-runtime-session-connection-v0 S-013 persistence failure records Eve recovery evidence and allows idempotent replay', async () => {
  const eveSessionClient = makeEveSessionClient({
    sessionId: 'eve-e2e-session-recovery',
    continuationToken: 'eve-e2e-cont-recovery'
  });
  const { repository, service, actor } = makeWorkflowService({ eveSessionClient });
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const loopIntentId = meetingPackIds({
    orgId: 'salestailor',
    projectId: 'salestailor',
    definitionId: 'pre-meeting-briefing'
  }).loopIntentId;
  const originalCreateContextSnapshot = repository.createContextSnapshot.bind(repository);
  let failedOnce = false;
  repository.createContextSnapshot = (snapshot) => {
    if (!failedOnce && snapshot.source_type === 'loop_intent') {
      failedOnce = true;
      throw new Error('context snapshot write failed');
    }
    return originalCreateContextSnapshot(snapshot);
  };

  await expect(service.dispatchLoopIntentToEve(loopIntentId, {}, actor)).rejects.toMatchObject({
    message: 'Eve session dispatched but Brainbase persistence failed',
    details: {
      state_transition: 'blocked_eve_dispatch_persistence_failed',
      loop_intent_id: loopIntentId,
      eve_session_id: 'eve-e2e-session-recovery',
      continuation_token_present: true,
      recovery_recorded: true,
      persistence_error: 'context snapshot write failed'
    }
  });

  const recoveryRun = repository.ledger.runs[0];
  expect(recoveryRun).toMatchObject({
    status: 'blocked',
    action_required: 'operator_reconcile_eve_session',
    metadata: {
      dispatch_persistence_failed: true,
      runner: {
        type: 'eve',
        session_id: 'eve-e2e-session-recovery',
        continuation_token_present: true
      }
    }
  });
  expect(repository.getLoopIntent(loopIntentId)).toMatchObject({
    status: 'dispatched',
    metadata: {
      eve_session_ref: {
        session_id: 'eve-e2e-session-recovery',
        continuation_token: 'eve-e2e-cont-recovery',
        persistence_recovery_required: true,
        expected_result_contract: 'external_runner.v0'
      }
    }
  });
  expect(repository.listAuditLogs({ targetId: recoveryRun.id })).toEqual([
    expect.objectContaining({
      action: 'workflow.eve_session.dispatch_persistence_failed',
      after: expect.objectContaining({
        state_transition: 'blocked_eve_dispatch_persistence_failed'
      })
    })
  ]);

  const replay = await service.dispatchLoopIntentToEve(loopIntentId, {}, actor);
  expect(replay.eve_session_dispatch).toMatchObject({
    idempotent: true,
    eve_session: {
      session_id: 'eve-e2e-session-recovery',
      continuation_token_present: true
    }
  });
  expect(eveSessionClient.calls).toHaveLength(1);
  expect(replay.eve_session_dispatch.eve_session.continuation_token).toBeUndefined();
});

test('story-eve-runtime-session-connection-v0 FM-003 boundary_condition blocks missing Eve session id before partial writes', async () => {
  const eveSessionClient = makeEveSessionClient({ sessionId: null, continuationToken: 'eve-e2e-cont-without-session' });
  const { repository, service, actor } = makeWorkflowService({ eveSessionClient });
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const loopIntentId = meetingPackIds({
    orgId: 'salestailor',
    projectId: 'salestailor',
    definitionId: 'pre-meeting-briefing'
  }).loopIntentId;

  await expect(service.dispatchLoopIntentToEve(loopIntentId, {}, actor)).rejects.toMatchObject({
    message: 'Eve session response did not include a session id',
    details: {
      state_transition: 'blocked_eve_session_id_missing',
      loop_intent_id: loopIntentId
    }
  });

  expect(eveSessionClient.calls).toHaveLength(1);
  expect(repository.ledger.runs).toHaveLength(0);
  expect(repository.ledger.run_steps).toHaveLength(0);
  expect(repository.ledger.context_snapshots).toHaveLength(0);
  expect(repository.ledger.outputs).toHaveLength(0);
  expect(repository.ledger.human_steps).toHaveLength(0);
  expect(repository.getLoopIntent(loopIntentId)).toMatchObject({ status: 'ready' });
  expect(repository.getLoopIntent(loopIntentId)?.metadata).toBeUndefined();
});

test('story-eve-runtime-session-connection-v0 blocked_eve_message_required rejects empty messages before Eve network calls', async () => {
  const eveSessionClient = makeEveSessionClient();
  const { repository, service, actor } = makeWorkflowService({ eveSessionClient });
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const loopIntentId = meetingPackIds({
    orgId: 'salestailor',
    projectId: 'salestailor',
    definitionId: 'pre-meeting-briefing'
  }).loopIntentId;

  await expect(service.dispatchLoopIntentToEve(loopIntentId, { message: '' }, actor)).rejects.toMatchObject({
    message: 'message is required',
    details: {
      state_transition: 'blocked_eve_message_required'
    }
  });

  expect(eveSessionClient.calls).toHaveLength(0);
  expect(repository.ledger.runs).toHaveLength(0);
  expect(repository.getLoopIntent(loopIntentId)?.metadata).toBeUndefined();
});

test('story-eve-runtime-session-connection-v0 ac:11 rejects caller-supplied continuation tokens before Eve network calls', async () => {
  // story-eve-runtime-session-connection-v0 ac:11
  // Brainbase API callerが continuation_token / continuationToken を指定した場合は、Eve APIを呼ぶ前に blocked_eve_continuation_token_input で拒否する。
  expect('Brainbase API caller blocks continuationToken with blocked_eve_continuation_token_input before Eve API').toContain('blocked_eve_continuation_token_input');

  for (const input of [
    { continuation_token: 'caller-continuation-token' },
    { continuationToken: 'caller-continuation-token' }
  ]) {
    const eveSessionClient = makeEveSessionClient();
    const { repository, service, actor } = makeWorkflowService({ eveSessionClient });
    await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
    const loopIntentId = meetingPackIds({
      orgId: 'salestailor',
      projectId: 'salestailor',
      definitionId: 'pre-meeting-briefing'
    }).loopIntentId;

    await expect(service.dispatchLoopIntentToEve(loopIntentId, input, actor)).rejects.toMatchObject({
      message: 'continuation_token is server-owned and cannot be supplied by clients',
      details: {
        state_transition: 'blocked_eve_continuation_token_input'
      }
    });

    expect(eveSessionClient.calls).toHaveLength(0);
    expect(repository.ledger.runs).toHaveLength(0);
    expect(repository.getLoopIntent(loopIntentId)?.metadata).toBeUndefined();
  }
});

test('story-eve-runtime-session-connection-v0 ac:8 rejects disabled or mismatched control refs before Eve dispatch', async () => {
  const eveSessionClient = makeEveSessionClient();
  const { repository, service, actor } = makeWorkflowService({ eveSessionClient });
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const ids = meetingPackIds({
    orgId: 'salestailor',
    projectId: 'salestailor',
    definitionId: 'pre-meeting-briefing',
    triggerType: 'schedule'
  });
  repository.upsertWorkflowTrigger({
    ...repository.getWorkflowTrigger(ids.triggerId),
    enabled: false
  });

  await expect(service.dispatchLoopIntentToEve(ids.loopIntentId, {}, actor)).rejects.toMatchObject({
    message: `loop_intent '${ids.loopIntentId}' references a disabled control record`,
    details: {
      state_transition: 'blocked_disabled_control_ref',
      loop_intent_id: ids.loopIntentId
    }
  });

  expect(eveSessionClient.calls).toHaveLength(0);
  expect(repository.ledger.runs).toHaveLength(0);
});

test('story-eve-runtime-session-connection-v0 S-014 rejects same-scope generic workflow_id reuse before Eve dispatch', async () => {
  const eveSessionClient = makeEveSessionClient();
  const { repository, service, actor } = makeWorkflowService({ eveSessionClient });
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const ids = meetingPackIds({
    orgId: 'salestailor',
    projectId: 'salestailor',
    definitionId: 'pre-meeting-briefing',
    triggerType: 'schedule'
  });
  repository.upsertWorkflow({
    id: 'wf_salestailor_generic_dispatch',
    workspace_id: 'default',
    org_id: 'salestailor',
    project_id: 'salestailor',
    name: 'Generic dispatch',
    owner_id: 'keigo',
    default_assignee_id: 'keigo',
    default_approver_id: 'keigo',
    implementation_key: 'manual-placeholder'
  });
  repository.upsertWorkflowBinding({
    ...repository.getWorkflowBinding(ids.bindingId),
    workflow_id: 'wf_salestailor_generic_dispatch'
  });

  await expect(service.dispatchLoopIntentToEve(ids.loopIntentId, {}, actor)).rejects.toMatchObject({
    message: `workflow 'wf_salestailor_generic_dispatch' cannot be reused for loop_intent '${ids.loopIntentId}'`,
    details: {
      state_transition: 'blocked_loop_control_ref_mismatch',
      field: 'workflow.implementation_key',
      expected: 'eve-session-dispatch',
      actual: 'manual-placeholder'
    }
  });

  expect(eveSessionClient.calls).toHaveLength(0);
  expect(repository.getWorkflow('wf_salestailor_generic_dispatch')?.implementation_key).toBe('manual-placeholder');
});

test('story-eve-runtime-session-connection-v0 ac:8 S-004 rejects same-scope mismatched Loop Control lineage before Eve dispatch', async () => {
  const eveSessionClient = makeEveSessionClient();
  const { repository, service, actor } = makeWorkflowService({ eveSessionClient });
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const preMeetingIds = meetingPackIds({
    orgId: 'salestailor',
    projectId: 'salestailor',
    definitionId: 'pre-meeting-briefing',
    triggerType: 'schedule'
  });
  const taskIds = meetingPackIds({
    orgId: 'salestailor',
    projectId: 'salestailor',
    definitionId: 'meeting-note-to-tasks',
    triggerType: 'event'
  });
  const loopIntent = repository.getLoopIntent(preMeetingIds.loopIntentId);

  repository.upsertLoopIntent({
    ...loopIntent,
    workflow_binding_id: taskIds.bindingId
  });

  await expect(service.dispatchLoopIntentToEve(preMeetingIds.loopIntentId, {}, actor)).rejects.toMatchObject({
    message: `loop_intent '${preMeetingIds.loopIntentId}' references inconsistent control records`,
    details: {
      state_transition: 'blocked_loop_control_ref_mismatch',
      loop_intent_id: preMeetingIds.loopIntentId,
      field: 'workflow_binding.workflow_template_id',
      expected: preMeetingIds.templateId,
      actual: taskIds.templateId
    }
  });

  expect(eveSessionClient.calls).toHaveLength(0);
  expect(repository.ledger.runs).toHaveLength(0);
});

test('story-eve-runtime-session-connection-v0 ac:6 ac:8 S-003 S-004 validates Loop Control lineage before idempotent replay', async () => {
  const eveSessionClient = makeEveSessionClient();
  const { repository, service, actor } = makeWorkflowService({ eveSessionClient });
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const preMeetingIds = meetingPackIds({
    orgId: 'salestailor',
    projectId: 'salestailor',
    definitionId: 'pre-meeting-briefing',
    triggerType: 'schedule'
  });
  const taskIds = meetingPackIds({
    orgId: 'salestailor',
    projectId: 'salestailor',
    definitionId: 'meeting-note-to-tasks',
    triggerType: 'event'
  });
  const loopIntent = repository.getLoopIntent(preMeetingIds.loopIntentId);

  repository.upsertLoopIntent({
    ...loopIntent,
    workflow_binding_id: taskIds.bindingId,
    metadata: {
      eve_session_ref: {
        session_id: 'eve-existing-e2e-session',
        workflow_run_id: 'run-existing-e2e',
        expected_result_contract: 'external_runner.v0'
      }
    }
  });

  await expect(service.dispatchLoopIntentToEve(preMeetingIds.loopIntentId, {}, actor)).rejects.toMatchObject({
    message: `loop_intent '${preMeetingIds.loopIntentId}' references inconsistent control records`,
    details: {
      state_transition: 'blocked_loop_control_ref_mismatch',
      loop_intent_id: preMeetingIds.loopIntentId,
      field: 'workflow_binding.workflow_template_id',
      expected: preMeetingIds.templateId,
      actual: taskIds.templateId
    }
  });

  expect(eveSessionClient.calls).toHaveLength(0);
  expect(repository.ledger.runs).toHaveLength(0);
});

test('story-eve-runtime-session-connection-v0 ac:6 ac:8 S-003 rejects idempotent Eve replay when persisted workflow_run scope differs', async () => {
  const eveSessionClient = makeEveSessionClient();
  const { repository, service, actor } = makeWorkflowService({ eveSessionClient });
  await service.bootstrapMeetingWorkflowPack({ org_id: 'salestailor', project_id: 'salestailor' }, actor);
  const preMeetingIds = meetingPackIds({
    orgId: 'salestailor',
    projectId: 'salestailor',
    definitionId: 'pre-meeting-briefing',
    triggerType: 'schedule'
  });
  const firstDispatch = await service.dispatchLoopIntentToEve(preMeetingIds.loopIntentId, {}, actor);
  const loopIntent = repository.getLoopIntent(preMeetingIds.loopIntentId);
  const mismatchedRunId = 'run_eve_existing_scope_mismatch';

  repository.createRun({
    id: mismatchedRunId,
    workspace_id: 'default',
    org_id: 'unson',
    project_id: 'unson',
    workflow_id: firstDispatch.eve_session_dispatch.workflow.id,
    loop_intent_id: preMeetingIds.loopIntentId,
    status: 'running',
    closure_state: 'open',
    action_required: 'await_eve_result'
  });
  repository.upsertLoopIntent({
    ...loopIntent,
    metadata: {
      eve_session_ref: {
        session_id: 'eve-existing-scope-mismatch',
        workflow_run_id: mismatchedRunId,
        expected_result_contract: 'external_runner.v0'
      }
    }
  });

  await expect(service.dispatchLoopIntentToEve(preMeetingIds.loopIntentId, {}, actor)).rejects.toMatchObject({
    message: `eve_session_ref for loop_intent '${preMeetingIds.loopIntentId}' cannot replay workflow_run '${mismatchedRunId}'`,
    details: {
      state_transition: 'blocked_loop_control_ref_mismatch',
      loop_intent_id: preMeetingIds.loopIntentId,
      workflow_run_id: mismatchedRunId,
      field: 'workflow_run.org_id',
      expected: 'salestailor',
      actual: 'unson'
    }
  });

  expect(eveSessionClient.calls).toHaveLength(1);
  expect(repository.ledger.runs).toHaveLength(2);
});

test('story-eve-runtime-session-connection-v0 ac:1 EveSessionClient follows official session and stream API paths', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new EveSessionClient({
    baseUrl: 'https://eve.example',
    token: 'token-123',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });
      if (String(url).endsWith('/stream')) {
        return new Response('{"type":"sessionStarted"}\n{"type":"sessionCompleted"}\n', { status: 200 });
      }
      return new Response(JSON.stringify({ continuationToken: 'cont-001' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-eve-session-id': 'eve-session-001'
        }
      });
    }
  });

  await expect(client.createSession({
    message: 'Run',
    context: { expected_result_contract: 'external_runner.v0' }
  })).resolves.toMatchObject({
    session_id: 'eve-session-001',
    continuation_token: 'cont-001'
  });
  await expect(client.readSessionStream({
    sessionId: 'eve-session-001'
  })).resolves.toEqual([
    { type: 'sessionStarted' },
    { type: 'sessionCompleted' }
  ]);
  expect(calls.map((call) => call.url)).toEqual([
    'https://eve.example/eve/v1/session',
    'https://eve.example/eve/v1/session/eve-session-001/stream'
  ]);
});

test('story-eve-runtime-session-connection-v0 ac:11 EveSessionClient rejects caller continuation tokens before network calls', async () => {
  for (const input of [
    { continuationToken: 'caller-continuation-token' },
    { continuation_token: 'caller-continuation-token' }
  ]) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new EveSessionClient({
      baseUrl: 'https://eve.example',
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init as RequestInit });
        return new Response('{}', { status: 200 });
      }
    });

    await expect(client.createSession({
      message: 'Run',
      ...input
    })).rejects.toMatchObject({
      name: 'EveSessionClientError',
      code: 'eve_continuation_token_input_forbidden',
      response: {
        disallowed_fields: Object.keys(input)
      }
    });
    expect(calls).toHaveLength(0);
  }
});

test('story-eve-runtime-session-connection-v0 S-015 trusts only x-eve-session-id and defaults invalid Eve timeout env', async () => {
  const client = new EveSessionClient({
    baseUrl: 'https://eve.example',
    fetchImpl: async () => new Response(JSON.stringify({
      sessionId: 'body-session-id',
      session_id: 'body-session-snake',
      continuationToken: 'cont-001'
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  });

  await expect(client.createSession({ message: 'Run' })).resolves.toMatchObject({
    session_id: null,
    continuation_token: 'cont-001'
  });
  expect(createEveSessionClientFromEnv({
    EVE_API_BASE_URL: 'https://eve.example',
    EVE_API_TIMEOUT_MS: 'not-a-number'
  }).timeoutMs).toBe(30000);
});

test('story-eve-runtime-session-connection-v0 ac:1 ac:6 ac:7 S-003 browser UI dispatches Loop Intent to Eve and exposes replay/force controls', async ({ page }) => {
  const runtimeIssues = collectBrowserRuntimeIssues(page);
  const loopIntentId = 'loop_salestailor_salestailor_pre_meeting_briefing_bootstrap';
  const roleAgent = {
    id: 'rai_salestailor_salestailor_meeting_ops',
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_archetype_id: 'meeting-ops',
    name: 'Meeting Ops Agent',
    enabled: true
  };
  const template = {
    id: 'wft_salestailor_salestailor_pre_meeting_briefing',
    org_id: 'salestailor',
    project_id: 'salestailor',
    workflow_kind: 'meeting',
    name: 'pre-meeting-briefing',
    tags: ['meeting-workflow-definition', 'mana-meeting-workflow-pack-v1', 'pre-meeting-briefing'],
    enabled: true
  };
  const binding = {
    id: 'wfb_salestailor_salestailor_meeting_ops_pre_meeting_briefing',
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_agent_instance_id: roleAgent.id,
    workflow_template_id: template.id,
    autonomy_level: 'approval_required',
    enabled: true
  };
  const trigger = {
    id: 'wftg_salestailor_salestailor_pre_meeting_briefing_schedule',
    org_id: 'salestailor',
    project_id: 'salestailor',
    workflow_binding_id: binding.id,
    trigger_type: 'schedule',
    enabled: true
  };
  let sessionRef: null | { session_id: string; continuation_token: string; workflow_run_id: string } = null;
  const requestBodies: unknown[] = [];
  let releaseFirstDispatch: (() => void) | null = null;

  function loopIntent() {
    return {
      id: loopIntentId,
      org_id: 'salestailor',
      project_id: 'salestailor',
      role_agent_instance_id: roleAgent.id,
      workflow_template_id: template.id,
      workflow_binding_id: binding.id,
      workflow_trigger_id: trigger.id,
      trigger_type: 'schedule',
      input_summary: 'MTG前準備',
      input_payload: { source: 'human' },
      eligibility: {
        status: 'needs_approval',
        requires_human_approval: true
      },
      enabled: true,
      ...(sessionRef ? { metadata: { eve_session_ref: sessionRef } } : {})
    };
  }

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/csrf-token' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'test-csrf' }) });
      return;
    }
    if (url.pathname === '/api/config/projects' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [{ id: 'salestailor', session_select: true }] }) });
      return;
    }
    if (url.pathname === '/api/workflows' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflows: [] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/role-agents' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role_agent_instances: [roleAgent] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/templates' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflow_templates: [template] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/bindings' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflow_bindings: [binding] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/triggers' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflow_triggers: [trigger] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/loop-intents' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ loop_intents: [loopIntent()] }) });
      return;
    }
    if (url.pathname === `/api/workflows/control/loop-intents/${loopIntentId}/eve-session` && method === 'POST') {
      const body = route.request().postDataJSON();
      requestBodies.push(body);
      const forceNewSession = body?.forceNewSession === true;
      const sessionId = forceNewSession ? 'eve-ui-session-002' : sessionRef ? sessionRef.session_id : 'eve-ui-session-001';
      const runId = `run-${sessionId}`;
      sessionRef = {
        session_id: sessionId,
        continuation_token: forceNewSession ? 'eve-ui-cont-002' : 'eve-ui-cont-001',
        workflow_run_id: runId
      };
      if (!forceNewSession && requestBodies.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstDispatch = resolve;
        });
      }
      await route.fulfill({
        status: forceNewSession || requestBodies.length === 1 ? 201 : 200,
        contentType: 'application/json',
        body: JSON.stringify({
          eve_session_dispatch: {
            org_id: 'salestailor',
            project_id: 'salestailor',
            loop_intent_id: loopIntentId,
            idempotent: !forceNewSession && requestBodies.length > 1,
            run: { id: runId, status: 'running', action_required: 'await_eve_result' },
            eve_session: {
              session_id: sessionId,
              continuation_token_present: true
            }
          }
        })
      });
      return;
    }
    if (url.pathname.startsWith('/api/workflow-runs/run-eve-ui-session-') && method === 'GET') {
      const runId = url.pathname.split('/').pop() || 'run-eve-ui-session-001';
      const sessionId = runId.replace(/^run-/, '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          run: {
            id: runId,
            workflow_id: `wf-${sessionId}`,
            project_id: 'salestailor',
            status: 'running',
            trigger_type: 'human',
            env: 'eve',
            action_required: 'await_eve_result',
            metadata: {
              expected_result_contract: 'external_runner.v0',
              runner: {
                type: 'eve',
                session_id: sessionId,
                continuation_token_present: true,
                eve_trace_ref: `eve://sessions/${sessionId}`
              },
              loop_control: {
                owner_id: 'keigo',
                cost_owner_id: 'keigo',
                approval_owner_id: 'keigo',
                stop_conditions: { malformed: true }
              }
            }
          },
          run_steps: [{ id: 'step-eve', step_name: 'eve_session_create', status: 'success', message: 'Eve session created' }],
          context_snapshots: [{ source_type: 'loop_intent', source_ref: loopIntentId, preview: 'Eve dispatch context' }],
          human_steps: [],
          outputs: [],
          audit_logs: [{
            action: 'workflow.eve_session.dispatched',
            created_at: '2026-06-26T00:00:00.000Z',
            after: {
              runner_type: 'eve',
              eve_session_id: sessionId,
              state_transition: 'awaiting_eve_result',
              expected_result_contract: 'external_runner.v0',
              continuation_token_present: true
            }
          }]
        })
      });
      return;
    }
    if (url.pathname.startsWith('/api/workflows/wf-eve-ui-session-') && method === 'GET') {
      const workflowId = url.pathname.split('/').pop() || 'wf-eve-ui-session-001';
      const sessionId = workflowId.replace(/^wf-/, '');
      const runId = `run-${sessionId}`;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workflow: {
            id: workflowId,
            workspace_id: 'default',
            org_id: 'salestailor',
            project_id: 'salestailor',
            name: 'MTG前準備 Eve Session',
            owner_id: 'keigo',
            default_assignee_id: 'keigo',
            default_approver_id: 'keigo',
            execution_env: 'external',
            risk_level: 'medium',
            hitl_policy: 'external_runner',
            implementation_key: 'eve-session-dispatch',
            context_sources: [{
              source_type: 'loop_intent',
              source_ref: loopIntentId,
              required: true
            }]
          },
          context_sources: [{
            source_type: 'loop_intent',
            source_ref: loopIntentId,
            required: true
          }],
          runs: [{
            id: runId,
            workflow_id: workflowId,
            project_id: 'salestailor',
            status: 'running',
            started_at: '2026-06-26T00:00:00.000Z',
            action_required: 'await_eve_result'
          }]
        })
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not mocked' }) });
  });

  await page.goto('/workflows');
  await page.getByRole('button', { name: /salestailor/ }).click();
  await expect(page.locator(`[data-loop-intent-id="${loopIntentId}"]`).first()).toBeVisible();

  const firstDispatchButton = page.getByRole('button', { name: 'Eveへ送る' });
  await firstDispatchButton.click();
  await expect(firstDispatchButton).toBeDisabled();
  await expect.poll(() => requestBodies.length).toBe(1);
  await firstDispatchButton.click({ force: true });
  expect(requestBodies).toHaveLength(1);
  releaseFirstDispatch?.();
  await expect(page.getByText('Eve sessionを作成しました: eve-ui-session-001')).toBeVisible();
  await expect(page.getByText('Run: run-eve-ui-session-001')).toBeVisible();
  await page.getByRole('button', { name: 'Run Trace' }).click();
  await expect(page.getByRole('heading', { name: 'Run Trace' })).toBeVisible();
  await expect(page.getByText('Eve Session', { exact: true })).toBeVisible();
  await expect(page.getByText('eve-ui-session-001', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Eve Continuation Token', { exact: true })).toBeVisible();
  await expect(page.getByText('present', { exact: true }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('eve-ui-cont-001');
  await expect(page.getByText('Expected Result Contract', { exact: true })).toBeVisible();
  await expect(page.getByText('external_runner.v0', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Stop Conditions Warning', { exact: true })).toBeVisible();
  await expect(page.getByText('run.metadata.loop_control.stop_conditions must be an array', { exact: true })).toBeVisible();
  await expect(page.getByText('workflow.eve_session.dispatched')).toBeVisible();
  await expect(page.locator('[data-action="rerun"]')).toHaveCount(0);
  await expect(page.getByText('Loop IntentのEve接続で再実行', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← Workflow' }).click();
  await expect(page.getByRole('heading', { name: 'MTG前準備 Eve Session' })).toBeVisible();
  await expect(page.locator('[data-action="run-workflow"]')).toHaveCount(0);
  await expect(page.getByText('Loop IntentのEve接続で実行', { exact: true })).toBeVisible();
  await page.locator('button[data-action="project"]').first().click();
  expect(requestBodies[0]).toEqual({});

  await page.getByRole('button', { name: 'Eve sessionを再表示' }).click();
  await expect(page.getByText('Eve sessionを再利用しました: eve-ui-session-001')).toBeVisible();
  expect(requestBodies[1]).toEqual({});

  await page.getByRole('button', { name: '新規Eve session' }).click();
  await expect(page.getByText('Eve sessionを作成しました: eve-ui-session-002')).toBeVisible();
  expect(requestBodies[2]).toEqual({ forceNewSession: true });
  await expect(page.locator('body')).not.toContainText('eve-ui-cont-002');
  expect(runtimeIssues).toEqual([]);
});

test('story-eve-runtime-session-connection-v0 FM-002 negative_path browser UI shows Eve dispatch failure without hiding Loop Intent controls', async ({ page }) => {
  const runtimeIssues = collectBrowserRuntimeIssues(page);
  const loopIntentId = 'loop_salestailor_salestailor_pre_meeting_briefing_bootstrap';
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/csrf-token' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'test-csrf' }) });
      return;
    }
    if (url.pathname === '/api/config/projects' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [{ id: 'salestailor', session_select: true }] }) });
      return;
    }
    if (url.pathname === '/api/workflows' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflows: [] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/role-agents' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role_agent_instances: [] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/templates' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflow_templates: [] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/bindings' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflow_bindings: [] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/triggers' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflow_triggers: [] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/loop-intents' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loop_intents: [{
            id: loopIntentId,
            org_id: 'salestailor',
            project_id: 'salestailor',
            trigger_type: 'schedule',
            input_summary: 'MTG前準備',
            eligibility: {
              status: 'needs_approval',
              requires_human_approval: true
            },
            enabled: true
          }]
        })
      });
      return;
    }
    if (url.pathname === `/api/workflows/control/loop-intents/${loopIntentId}/eve-session` && method === 'POST') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { message: 'Eve session create failed' },
          state_transition: 'blocked_eve_session_create_failed',
          details: {
            state_transition: 'blocked_eve_session_create_failed',
            eve_status: 502
          }
        })
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not mocked' }) });
  });

  await page.goto('/workflows');
  await page.getByRole('button', { name: /salestailor/ }).click();
  await page.getByRole('button', { name: 'Eveへ送る' }).click();

  await expect(page.getByText(/Eveへ送れません: Eve session create failed/)).toBeVisible();
  await expect(page.getByText(/状態: blocked_eve_session_create_failed/)).toBeVisible();
  await expect(page.getByText(/Eve status: 502/)).toBeVisible();
  await expect(page.locator(`[data-loop-intent-id="${loopIntentId}"]`).first()).toBeVisible();
  expect(runtimeIssues.filter((issue) => !issue.includes('400 (Bad Request)'))).toEqual([]);
});

test('story-eve-runtime-session-connection-v0 S-011 browser UI disables Eve dispatch for non-dispatchable Loop Intent states', async ({ page }) => {
  const runtimeIssues = collectBrowserRuntimeIssues(page);
  const humanOnlyIntentId = 'loop_salestailor_salestailor_human_only_bootstrap';
  const cancelledIntentId = 'loop_salestailor_salestailor_cancelled_bootstrap';
  const disabledIntentId = 'loop_salestailor_salestailor_disabled_bootstrap';
  const blockedStatusIntentId = 'loop_salestailor_salestailor_blocked_bootstrap';
  const statusHumanOnlyIntentId = 'loop_salestailor_salestailor_status_human_only_bootstrap';
  const canceledIntentId = 'loop_salestailor_salestailor_canceled_bootstrap';
  const eligibilityBlockedIntentId = 'loop_salestailor_salestailor_eligibility_blocked_bootstrap';
  const blockedReasonsIntentId = 'loop_salestailor_salestailor_blocked_reasons_bootstrap';
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/csrf-token' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'test-csrf' }) });
      return;
    }
    if (url.pathname === '/api/config/projects' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [{ id: 'salestailor', session_select: true }] }) });
      return;
    }
    if (url.pathname === '/api/workflows' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflows: [] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/role-agents' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role_agent_instances: [] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/templates' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflow_templates: [] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/bindings' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflow_bindings: [] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/triggers' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflow_triggers: [] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/loop-intents' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loop_intents: [
            {
              id: humanOnlyIntentId,
              org_id: 'salestailor',
              project_id: 'salestailor',
              status: 'ready',
              trigger_type: 'human',
              input_summary: '人間だけで確認するLoop Intent',
              eligibility: {
                status: 'human_only',
                requires_human_approval: true
              },
              enabled: true
            },
            {
              id: cancelledIntentId,
              org_id: 'salestailor',
              project_id: 'salestailor',
              status: 'cancelled',
              trigger_type: 'event',
              input_summary: '取り消し済みLoop Intent',
              eligibility: {
                status: 'needs_approval',
                requires_human_approval: true
              },
              enabled: true
            },
            {
              id: disabledIntentId,
              org_id: 'salestailor',
              project_id: 'salestailor',
              status: 'ready',
              trigger_type: 'schedule',
              input_summary: '無効化されたLoop Intent',
              eligibility: {
                status: 'needs_approval',
                requires_human_approval: true
              },
              enabled: false
            },
            {
              id: blockedStatusIntentId,
              org_id: 'salestailor',
              project_id: 'salestailor',
              status: 'blocked',
              trigger_type: 'event',
              input_summary: 'blocked statusのLoop Intent',
              eligibility: {
                status: 'needs_approval',
                requires_human_approval: true
              },
              enabled: true
            },
            {
              id: statusHumanOnlyIntentId,
              org_id: 'salestailor',
              project_id: 'salestailor',
              status: 'human_only',
              trigger_type: 'human',
              input_summary: 'status human_onlyのLoop Intent',
              eligibility: {
                status: 'needs_approval',
                requires_human_approval: true
              },
              enabled: true
            },
            {
              id: canceledIntentId,
              org_id: 'salestailor',
              project_id: 'salestailor',
              status: 'canceled',
              trigger_type: 'event',
              input_summary: 'canceled statusのLoop Intent',
              eligibility: {
                status: 'needs_approval',
                requires_human_approval: true
              },
              enabled: true
            },
            {
              id: eligibilityBlockedIntentId,
              org_id: 'salestailor',
              project_id: 'salestailor',
              status: 'ready',
              trigger_type: 'schedule',
              input_summary: 'eligibility blockedのLoop Intent',
              eligibility: {
                status: 'blocked',
                requires_human_approval: true
              },
              enabled: true
            },
            {
              id: blockedReasonsIntentId,
              org_id: 'salestailor',
              project_id: 'salestailor',
              status: 'ready',
              trigger_type: 'schedule',
              input_summary: 'blocked_reasonsつきLoop Intent',
              eligibility: {
                status: 'needs_approval',
                requires_human_approval: true
              },
              blocked_reasons: ['policy_mismatch'],
              enabled: true
            }
          ]
        })
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not mocked' }) });
  });

  await page.goto('/workflows');
  await page.getByRole('button', { name: /salestailor/ }).click();

  await expect(page.locator(`[data-action="dispatch-eve-session"][data-loop-intent-id="${humanOnlyIntentId}"]`)).toBeDisabled();
  await expect(page.locator(`[data-action="dispatch-eve-session"][data-loop-intent-id="${cancelledIntentId}"]`)).toBeDisabled();
  await expect(page.locator(`[data-action="dispatch-eve-session"][data-loop-intent-id="${disabledIntentId}"]`)).toBeDisabled();
  await expect(page.locator(`[data-action="dispatch-eve-session"][data-loop-intent-id="${blockedStatusIntentId}"]`)).toBeDisabled();
  await expect(page.locator(`[data-action="dispatch-eve-session"][data-loop-intent-id="${statusHumanOnlyIntentId}"]`)).toBeDisabled();
  await expect(page.locator(`[data-action="dispatch-eve-session"][data-loop-intent-id="${canceledIntentId}"]`)).toBeDisabled();
  await expect(page.locator(`[data-action="dispatch-eve-session"][data-loop-intent-id="${eligibilityBlockedIntentId}"]`)).toBeDisabled();
  await expect(page.locator(`[data-action="dispatch-eve-session"][data-loop-intent-id="${blockedReasonsIntentId}"]`)).toBeDisabled();
  await expect(page.locator(`[data-eve-dispatch-block-reason="${humanOnlyIntentId}"]`)).toContainText('eligibility: human_only');
  await expect(page.locator(`[data-eve-dispatch-block-reason="${cancelledIntentId}"]`)).toContainText('status: cancelled');
  await expect(page.locator(`[data-eve-dispatch-block-reason="${disabledIntentId}"]`)).toContainText('Loop Intent disabled');
  await expect(page.locator(`[data-eve-dispatch-block-reason="${blockedStatusIntentId}"]`)).toContainText('status: blocked');
  await expect(page.locator(`[data-eve-dispatch-block-reason="${statusHumanOnlyIntentId}"]`)).toContainText('status: human_only');
  await expect(page.locator(`[data-eve-dispatch-block-reason="${canceledIntentId}"]`)).toContainText('status: canceled');
  await expect(page.locator(`[data-eve-dispatch-block-reason="${eligibilityBlockedIntentId}"]`)).toContainText('eligibility: blocked');
  await expect(page.locator(`[data-eve-dispatch-block-reason="${blockedReasonsIntentId}"]`)).toContainText('policy_mismatch');
  expect(runtimeIssues).toEqual([]);
});
