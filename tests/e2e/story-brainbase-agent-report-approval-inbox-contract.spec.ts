// Story-level E2E (contract, in-process) for C2: agent report → Companion approval inbox.
//
// Live E2E against the running server is blocked: the running server currently runs
// main-branch code without the `agent_report` runner type, so a live ingest would be
// rejected by the old contract-schema until this PR merges + the server restarts;
// additionally ~/.brainbase/tokens.json is expired (JWT signing-key rotation).
// This suite therefore drives the real ExternalRunnerIngestService + dedicated runtime services +
// InMemoryWorkflowRepository in-process (no live server, no HTTP mocks of the layer
// under test), exactly like tests/e2e/story-meeting-review-package-ingest-v1-contract.spec.ts.
//
// Clause coverage: S-001..S-007 from
// docs/specs/story-brainbase-agent-report-approval-inbox-spec.md.

import { test, expect } from '@playwright/test';

import { ExternalRunnerIngestService } from '../../server/services/external-runner/ingest-service.js';
import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import {
  TestAutomationRuntime,
  createDefaultWorkflowHandlers
} from '../helpers/test-automation-runtime.js';
import {
  appendPendingFallback,
  buildAgentReportPayload,
  submitReport
} from '../../scripts/bin/bb-report-submit.mjs';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeStack() {
  const repository = new InMemoryWorkflowRepository();
  const ingestService = new ExternalRunnerIngestService({ workflowRepository: repository });
  const runner = new WorkflowRunner({ repository, handlers: createDefaultWorkflowHandlers() });
  const workflowService = new TestAutomationRuntime({
    repository,
    runner,
    configParser: {
      async getProjects() {
        return { projects: [{ id: 'brainbase', session_select: true }] };
      }
    }
  });
  return { repository, ingestService, workflowService };
}

const ACTOR = { person_id: 'sato_keigo', projectCodes: ['brainbase'], role: 'member', authSource: 'test' };

function orphanRuns(repository) {
  return repository
    .listRuns()
    .filter((run) => run.closure_state === 'needs_action' || run.status === 'needs_action');
}

test('story-brainbase-agent-report-approval-inbox ac:1 S-001 agent_report ingest は waiting_human / open / approve の run に写り、report_markdown output と pending human_step を伴う', async () => {
  const { repository, ingestService } = makeStack();
  const payload = buildAgentReportPayload({
    sender: 'agent/ceo',
    title: 'CEOレビュー 2026-07',
    period: '2026-07',
    markdown: '# CEOレビュー\n\n本文',
    requiredBy: 'sato_keigo'
  });
  const ingested = await ingestService.ingest(payload);
  expect(ingested.run).toMatchObject({ status: 'waiting_human', closure_state: 'open' });
  const humanSteps = repository.listHumanSteps(ingested.run.id);
  expect(humanSteps).toHaveLength(1);
  expect(humanSteps[0]).toMatchObject({ status: 'pending', required_by: 'sato_keigo' });
  const outputs = repository.listOutputs(ingested.run.id);
  expect(outputs[0]).toMatchObject({ output_type: 'report_markdown' });
});

test('story-brainbase-agent-report-approval-inbox ac:2 S-002 全 human_step 承認で run は success / closed になり approval inbox から退出し、孤児 needs_action run を残さない', async () => {
  const { repository, ingestService, workflowService } = makeStack();
  const ingested = await ingestService.ingest(buildAgentReportPayload({
    sender: 'agent/cso', title: 'CSOレビュー 2026-07', period: '2026-07', markdown: '# CSO', requiredBy: 'sato_keigo'
  }));
  const runId = ingested.run.id;

  const inboxBefore = await workflowService.listCompanionApprovalInbox({ projectId: 'brainbase' }, ACTOR);
  expect(inboxBefore.items.find((item) => item.run_id === runId)).toMatchObject({
    kind: 'workflow_approval', status: 'waiting_human'
  });

  const pending = repository.listHumanSteps(runId).find((s) => s.status === 'pending');
  const resolved = await workflowService.automationRunService.resolveHumanStep(pending.id, { resolution: 'approved' }, ACTOR);
  expect(resolved.resumed_run).toMatchObject({
    id: runId, status: 'success', closure_state: 'closed', human_waiting: false, action_required: 'none'
  });

  const inboxAfter = await workflowService.listCompanionApprovalInbox({ projectId: 'brainbase' }, ACTOR);
  expect(inboxAfter.items.find((item) => item.run_id === runId)).toBeUndefined();
  expect(orphanRuns(repository)).toHaveLength(0);
});

test('story-brainbase-agent-report-approval-inbox ac:3 S-007 human_step 却下で run は cancelled / closed に写り、兄弟 pending step を cancel し孤児を残さない', async () => {
  const { repository, ingestService, workflowService } = makeStack();
  const ingested = await ingestService.ingest(buildAgentReportPayload({
    sender: 'agent/retro', title: '週次レトロ 2026-W27', period: '2026-W27', markdown: '# レトロ', requiredBy: 'sato_keigo'
  }));
  const runId = ingested.run.id;
  const pending = repository.listHumanSteps(runId).find((s) => s.status === 'pending');
  const resolved = await workflowService.automationRunService.resolveHumanStep(pending.id, { resolution: 'rejected' }, ACTOR);
  expect(resolved.resumed_run).toMatchObject({ status: 'cancelled', closure_state: 'closed' });
  const inboxAfter = await workflowService.listCompanionApprovalInbox({ projectId: 'brainbase' }, ACTOR);
  expect(inboxAfter.items.find((item) => item.run_id === runId)).toBeUndefined();
  expect(orphanRuns(repository)).toHaveLength(0);
});

test('story-brainbase-agent-report-approval-inbox ac:4 S-008 複数 human_step の一部のみ承認では run は waiting_human を維持する', async () => {
  const { repository, ingestService, workflowService } = makeStack();
  const payload = buildAgentReportPayload({
    sender: 'agent/cso', title: 'CSO複数承認 2026-07', period: '2026-07', markdown: '# CSO', requiredBy: 'sato_keigo'
  });
  payload.human_steps = [
    { id: `${payload.human_steps[0].id}_1`, step_key: 'review_agent_report', status: 'pending', required_by: 'sato_keigo', approval_reason: '承認1' },
    { id: `${payload.human_steps[0].id}_2`, step_key: 'review_agent_report', status: 'pending', required_by: 'sato_keigo', approval_reason: '承認2' }
  ];
  const ingested = await ingestService.ingest(payload);
  const runId = ingested.run.id;
  const pendings = repository.listHumanSteps(runId).filter((s) => s.status === 'pending');
  expect(pendings.length).toBe(2);
  const first = await workflowService.automationRunService.resolveHumanStep(pendings[0].id, { resolution: 'approved' }, ACTOR);
  expect(first.resumed_run).toMatchObject({ status: 'waiting_human', closure_state: 'open' });
  const second = await workflowService.automationRunService.resolveHumanStep(pendings[1].id, { resolution: 'approved' }, ACTOR);
  expect(second.resumed_run).toMatchObject({ status: 'success', closure_state: 'closed' });
  expect(orphanRuns(repository)).toHaveLength(0);
});

test('story-brainbase-agent-report-approval-inbox ac:6 S-006 owner/approver 委譲は認証主体本人に限定され、ingest された run の owner/approver は認証主体に固定される', async () => {
  const { repository, ingestService } = makeStack();
  // buildAgentReportPayload pins owner/cost/approval owner + human_step required_by to requiredBy.
  const payload = buildAgentReportPayload({
    sender: 'agent/ceo', title: 'CEO auth', period: '2026-07', markdown: '# 本文', requiredBy: 'sato_keigo'
  });
  expect(payload.loop_control).toMatchObject({
    owner_id: 'sato_keigo', cost_owner_id: 'sato_keigo', approval_owner_id: 'sato_keigo'
  });
  expect(payload.human_steps[0].required_by).toBe('sato_keigo');

  // Ingest it and confirm the persisted run + human step keep the authenticated
  // owner (sato_keigo) rather than any delegated identity, so a report cannot be
  // filed on behalf of, or requiring approval from, a different person.
  const ingested = await ingestService.ingest(payload);
  const humanSteps = repository.listHumanSteps(ingested.run.id);
  expect(humanSteps).toHaveLength(1);
  expect(humanSteps[0].required_by).toBe('sato_keigo');
  const persisted = repository.getRun(ingested.run.id);
  expect(persisted).toMatchObject({ project_id: 'brainbase', status: 'waiting_human' });
});

test('story-brainbase-agent-report-approval-inbox INV-001 eve (external-runner:eve) は承認専用クローズ特殊ケースから除外され、登録ハンドラ経由の resume 経路を維持する', async () => {
  const repository = new InMemoryWorkflowRepository();
  const ingestService = new ExternalRunnerIngestService({ workflowRepository: repository });
  const runner = new WorkflowRunner({ repository, handlers: createDefaultWorkflowHandlers() });
  let resumeHandlerCalled = false;
  runner.registerHandler('external-runner:eve', async (ctx) => {
    resumeHandlerCalled = true;
    return { status: 'success', closureState: 'closed', actionRequired: 'none', message: `eve resume ${ctx.humanStepResolution?.resolution}`, outputCount: 1 };
  });
  const workflowService = new TestAutomationRuntime({
    repository, runner,
    configParser: { async getProjects() { return { projects: [{ id: 'brainbase', session_select: true }] }; } }
  });
  const ingested = await ingestService.ingest({
    contract_version: 'external_runner.v0',
    runner: { type: 'eve', external_run_id: 'eve-s006', agent_id: 'sales-agent', eve: { trace_ref: 'https://vercel.com/acme/eve/traces/eve-s006' } },
    run: { project_id: 'brainbase', role_agent_id: 'sales', workflow_id: 'wf_eve_s006', status: 'approval_required' },
    loop_control: { owner_id: 'sato_keigo', cost_owner_id: 'sato_keigo', approval_owner_id: 'sato_keigo', stop_conditions: ['external_send_requires_approval'] },
    context_sources: [{ source_type: 'graph_ssot', source_ref: 'project:brainbase', redaction_status: 'not_required' }],
    rounds: [{ round_id: 'r1', status: 'completed', evidence_refs: ['eve://s006/r1'] }],
    human_steps: [{ id: 'hs-eve-s006', step_type: 'approval', prompt: 'Approve eve send' }],
    outputs: []
  });
  const pending = repository.listHumanSteps(ingested.run.id).find((s) => s.status === 'pending');
  const resolved = await workflowService.automationRunService.resolveHumanStep(pending.id, { resolution: 'approved' }, ACTOR);
  // eve went through the generic runWorkflow resume path (registered handler), NOT the approval-only close.
  expect(resumeHandlerCalled).toBe(true);
  expect(resolved.resumed_run).toMatchObject({ trigger_type: 'human_resume', parent_run_id: ingested.run.id });
});

test('story-brainbase-agent-report-approval-inbox ac:5 S-005 ingest 送信失敗時は _inbox/pending.md に追記しユーザーが検知できる形で残す', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'agent-report-e2e-'));
  try {
    const pendingPath = join(tmpDir, '_inbox', 'pending.md');
    const payload = buildAgentReportPayload({ sender: 'agent/cso', title: 'CSO fail', period: '2026-07', markdown: '# x' });
    const result = await submitReport({
      payload, baseUrl: 'http://localhost:31013', sender: 'agent/cso', title: 'CSO fail', pendingPath,
      fetchImpl: async () => { throw new Error('ECONNREFUSED 127.0.0.1:31013'); },
      tokenReader: () => 'test-token',
      logger: { log() {}, error() {} }
    });
    expect(result.ok).toBe(false);
    expect(existsSync(pendingPath)).toBe(true);
    const content = readFileSync(pendingPath, 'utf8');
    expect(content).toContain('channel: cso');
    expect(content).toContain('sender: agent/cso');
    expect(content).toContain('ECONNREFUSED');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
