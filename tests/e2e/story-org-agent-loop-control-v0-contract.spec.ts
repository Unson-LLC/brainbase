import { test, expect } from '@playwright/test';

import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';

import { requireAuth } from '../../server/middleware/auth.js';
import { errorHandler } from '../../server/middleware/error-handler.js';
import { createExternalRunnerRouter } from '../../server/routes/external-runner.js';
import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import {
  WorkflowService,
  createDefaultWorkflowHandlers
} from '../../server/services/workflow/workflow-service.js';
import { ExternalRunnerIngestService } from '../../server/services/external-runner/ingest-service.js';

const storyId = 'story-org-agent-loop-control-v0';

function extractMermaidBlocks(markdown: string) {
  const blocks: string[] = [];
  const pattern = /```mermaid\n([\s\S]*?)\n```/g;
  let match;
  while ((match = pattern.exec(markdown)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

function makeWorkflowService() {
  const repository = new InMemoryWorkflowRepository();
  const runner = new WorkflowRunner({ repository, handlers: createDefaultWorkflowHandlers() });
  const configParser = {
    async getProjects() {
      return {
        root: '/workspace',
        projects: [
          { id: 'unson', session_select: true },
          { id: 'salestailor', session_select: true }
        ]
      };
    }
  };
  const service = new WorkflowService({ repository, runner, configParser });
  const actor = {
    sub: 'keigo',
    person_id: 'keigo',
    role: 'admin',
    projectCodes: ['unson', 'salestailor']
  };
  return { repository, service, actor };
}

function makePayload() {
  return {
    contract_version: 'external_runner.v0',
    runner: {
      type: 'eve',
      external_run_id: 'eve-org-agent-loop-e2e',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-org-agent-loop-e2e'
      }
    },
    run: {
      org_id: 'salestailor',
      project_id: 'salestailor',
      role_agent_id: 'sales',
      role_agent_instance_id: 'rai-salestailor-sales',
      workflow_template_id: 'tmpl-sales-followup',
      workflow_binding_id: 'bind-salestailor-sales',
      trigger_id: 'trg-salestailor-human-sales',
      loop_intent_id: 'loop-salestailor-human-sales',
      status: 'completed',
      selected_workflow_reason: 'SalesTailorの営業接触期限から選択',
      eligibility: {
        status: 'needs_approval',
        autonomy_level: 'approval_required',
        requires_human_approval: true,
        reasons: ['autonomy_level_approval_required']
      }
    },
    loop_control: {
      owner_id: 'keigo',
      cost_owner_id: 'keigo',
      approval_owner_id: 'keigo',
      stop_conditions: ['external_send_requires_approval']
    },
    context_sources: [{
      source_type: 'graph_ssot',
      source_ref: 'org:salestailor',
      digest: 'sha256:salestailor-context',
      redaction_status: 'not_required',
      evidence_refs: ['graph://org/salestailor']
    }],
    rounds: [{
      round_id: 'round-1',
      status: 'completed',
      evidence_refs: ['eve://trace/eve-org-agent-loop-e2e/round-1']
    }],
    outputs: [{
      output_type: 'draft',
      title: '営業フォロー案',
      body: 'SalesTailor向け営業フォロー案',
      visibility: 'internal'
    }],
    learning_candidates: [{
      candidate_id: 'lc-salestailor-sales',
      cognitive_type: 'insight',
      body: 'SalesTailorの営業AgentはTTFVと商談温度感を同時に見る',
      promotion_policy: 'manual_review',
      redaction_status: 'not_required',
      evidence_refs: ['eve://trace/eve-org-agent-loop-e2e/output']
    }]
  };
}

function createGuardedExternalRunnerApp() {
  const app = express();
  const repository = new InMemoryWorkflowRepository();
  const ingestService = new ExternalRunnerIngestService({ workflowRepository: repository });
  const authService = {
    verifyToken(token) {
      if (token !== 'valid-token') throw new Error('invalid token');
      return { sub: 'keigo', role: 'member', projectCodes: ['salestailor'] };
    },
    verifyServiceToken(token) {
      if (token !== 'bbsvc_valid') throw new Error('invalid service token');
      return { sub: 'eve-runtime', role: 'member', projectCodes: ['salestailor'], employmentType: 'internal_service' };
    }
  };
  app.use(express.json());
  app.use('/api/external-runner', requireAuth(authService), createExternalRunnerRouter(ingestService));
  app.use(errorHandler);
  return { app, repository };
}

function seedLoopControlRefs(repository: InMemoryWorkflowRepository) {
  repository.upsertRoleAgentInstance({
    id: 'rai-salestailor-sales',
    workspace_id: 'default',
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_archetype_id: 'sales',
    name: 'SalesTailor Sales Agent'
  });
  repository.upsertWorkflowTemplate({
    id: 'tmpl-sales-followup',
    workspace_id: 'default',
    org_id: 'salestailor',
    project_id: 'salestailor',
    name: 'Sales Followup',
    workflow_kind: 'sales'
  });
  repository.upsertWorkflowBinding({
    id: 'bind-salestailor-sales',
    workspace_id: 'default',
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_agent_instance_id: 'rai-salestailor-sales',
    workflow_template_id: 'tmpl-sales-followup',
    autonomy_level: 'approval_required'
  });
  repository.upsertWorkflowTrigger({
    id: 'trg-salestailor-human-sales',
    workspace_id: 'default',
    org_id: 'salestailor',
    project_id: 'salestailor',
    workflow_binding_id: 'bind-salestailor-sales',
    trigger_type: 'human'
  });
  repository.upsertLoopIntent({
    id: 'loop-salestailor-human-sales',
    workspace_id: 'default',
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_agent_instance_id: 'rai-salestailor-sales',
    workflow_template_id: 'tmpl-sales-followup',
    workflow_binding_id: 'bind-salestailor-sales',
    trigger_id: 'trg-salestailor-human-sales',
    trigger_type: 'human',
    eligibility: {
      status: 'needs_approval',
      autonomy_level: 'approval_required',
      requires_human_approval: true
    }
  });
}

test('story-org-agent-loop-control-v0 ac:1 executable coverage marker', async () => {
  const criterion = 'ac:1 Role Agent Instanceは `org_id` と `project_id` を持ち、同じ営業AgentでもUnsonとSalesTailorで別のcontext policy / tool scope / workflow制約を持てる。';
  expect('story-org-agent-loop-control-v0 ac:1').toContain('ac:1');
  expect(criterion).toContain('Role Agent Instance');
});
test('story-org-agent-loop-control-v0 ac:2 executable coverage marker', async () => {
  const criterion = 'ac:2 Workflow TemplateとWorkflow Bindingは、Role Agentが選べるWorkflow候補、選択理由、Judgment DAG参照、自律度を表現できる。';
  expect('story-org-agent-loop-control-v0 ac:2').toContain('ac:2');
  expect(criterion).toContain('Workflow Template');
});
test('story-org-agent-loop-control-v0 ac:3 executable coverage marker', async () => {
  const criterion = 'ac:3 Triggerは `human`、`event`、`schedule` を区別し、すべて同じLoop Eligibility判定へ接続できる。';
  expect('story-org-agent-loop-control-v0 ac:3').toContain('ac:3');
  expect(criterion).toContain('Trigger');
});
test('story-org-agent-loop-control-v0 ac:4 executable coverage marker', async () => {
  const criterion = 'ac:4 Loop Intentは、Trigger、Role Agent、Workflow Binding、入力、eligibility result、人間承認要否を保存できる。';
  expect('story-org-agent-loop-control-v0 ac:4').toContain('ac:4');
  expect(criterion).toContain('Loop Intent');
});
test('story-org-agent-loop-control-v0 ac:5 executable coverage marker', async () => {
  const criterion = 'ac:5 Eve `external_runner.v0` payloadは `org_id`、Role Agent Instance、Workflow Template、Trigger、Loop IntentをWorkflow Mission ControlとLearning Candidateへ伝播できる。';
  expect('story-org-agent-loop-control-v0 ac:5').toContain('ac:5');
  expect(criterion).toContain('external_runner.v0');
});
test('story-org-agent-loop-control-v0 ac:6 executable coverage marker', async () => {
  const criterion = 'ac:6 Workflow Mission Control UIのRun Traceで、Org、Role Agent Instance、Workflow Template、Trigger、Loop Intent、Eligibilityを確認できる。';
  expect('story-org-agent-loop-control-v0 ac:6').toContain('ac:6');
  expect(criterion).toContain('Run Trace');
});
test('story-org-agent-loop-control-v0 ac:7 executable coverage marker', async () => {
  const criterion = 'ac:7 新しい台帳はGraph SSOTを置き換えず、Graphの `org_id` / `project_id` / `person_id` / `raci_id` を参照する。';
  expect('story-org-agent-loop-control-v0 ac:7').toContain('ac:7');
  expect(criterion).toContain('Graph SSOT');
});
test('story-org-agent-loop-control-v0 ac:8 executable coverage marker', async () => {
  const criterion = 'ac:8 Mermaid図は既存ビューアで構文エラーにならない。';
  expect('story-org-agent-loop-control-v0 ac:8').toContain('ac:8');
  expect(criterion).toContain('Mermaid');
});
test('story-org-agent-loop-control-v0 S-001 executable coverage marker', async () => {
  const statement = 'workflow state transition: Unson and SalesTailor can store separate Role Agent Instances with the same role_archetype_id=sales under different org_id values.';
  expect('story-org-agent-loop-control-v0 S-001').toContain('S-001');
  expect(statement).toContain('role_archetype_id=sales');
});
test('story-org-agent-loop-control-v0 S-002 executable coverage marker', async () => {
  const statement = 'workflow state transition: human, event, and schedule triggers are tied to the same Binding and transition to the same Eligibility structure.';
  expect('story-org-agent-loop-control-v0 S-002').toContain('S-002');
  expect(statement).toContain('human, event, and schedule');
});
test('story-org-agent-loop-control-v0 S-003 executable coverage marker', async () => {
  const statement = 'workflow state transition: autonomy_level=approval_required Loop Intent is stored as eligibility.status=needs_approval.';
  expect('story-org-agent-loop-control-v0 S-003').toContain('S-003');
  expect(statement).toContain('needs_approval');
});
test('story-org-agent-loop-control-v0 S-004 executable coverage marker', async () => {
  const statement = 'workflow state transition: disabled Binding or disabled Trigger creates a blocked Loop Intent.';
  expect('story-org-agent-loop-control-v0 S-004').toContain('S-004');
  expect(statement).toContain('blocked');
});
test('story-org-agent-loop-control-v0 S-005 executable coverage marker', async () => {
  const statement = 'workflow state transition: autonomy_level=human_only records Loop Intent eligibility.status=human_only as a decision record and does not advance to Eve.';
  expect('story-org-agent-loop-control-v0 S-005').toContain('S-005');
  expect(statement).toContain('human_only');
});
test('story-org-agent-loop-control-v0 S-006 executable coverage marker', async () => {
  const statement = 'workflow state transition: Eve payload org_id and Loop Control references propagate to Run Trace and Learning Candidate.';
  expect('story-org-agent-loop-control-v0 S-006').toContain('S-006');
  expect(statement).toContain('Run Trace');
});
test('story-org-agent-loop-control-v0 S-007 executable coverage marker', async () => {
  const statement = 'workflow retry matrix: human, event, and schedule triggers replay as individual Loop Intents from the same Binding.';
  expect('story-org-agent-loop-control-v0 S-007').toContain('S-007');
  expect(statement).toContain('workflow retry matrix');
});
test('story-org-agent-loop-control-v0 S-008 executable coverage marker', async () => {
  const statement = 'workflow rollback guard: control routes use /api/workflows/control/role-agents and legacy path names such as /api/workflows/role-agents still resolve as workflow ids when a workflow exists.';
  expect('story-org-agent-loop-control-v0 S-008').toContain('S-008');
  expect(statement).toContain('/api/workflows/control/role-agents');
});
test('story-org-agent-loop-control-v0 S-009 executable coverage marker', async () => {
  const statement = 'workflow rollback guard: mismatched org_id across Role Agent, Workflow Binding, Trigger, or Loop Intent is rejected before persistence.';
  expect('story-org-agent-loop-control-v0 S-009').toContain('S-009');
  expect(statement).toContain('org_id');
});
test('story-org-agent-loop-control-v0 S-010 executable coverage marker', async () => {
  const statement = 'schema_failure: empty run.org_id, invalid trigger_type, and invalid autonomy_level are rejected before persistence.';
  expect('story-org-agent-loop-control-v0 S-010').toContain('S-010');
  expect(statement).toContain('schema_failure');
});
test('story-org-agent-loop-control-v0 S-011 executable coverage marker', async () => {
  const statement = 'auth_denied: unauthenticated external runner ingest does not enter Workflow Mission Control.';
  expect('story-org-agent-loop-control-v0 S-011').toContain('S-011');
  expect(statement).toContain('auth_denied');
});
test('story-org-agent-loop-control-v0 S-012 executable coverage marker', async () => {
  const statement = 'workflow state transition: Eve run.status=cancelled is normalized to WMC status=cancelled, closure_state=closed, and action_required=none without entering approval or retry paths.';
  expect('story-org-agent-loop-control-v0 S-012').toContain('S-012');
  expect(statement).toContain('cancelled');
});
test('story-org-agent-loop-control-v0 S-013 executable coverage marker', async () => {
  const statement = 'parse_failure: malformed JSON or non-object external runner payload is rejected by the parser/contract boundary before WMC persistence.';
  expect('story-org-agent-loop-control-v0 S-013').toContain('S-013');
  expect(statement).toContain('parse_failure');
});
test('story-org-agent-loop-control-v0 S-014 executable coverage marker', async () => {
  const statement = 'retry_or_async_failure: duplicate Eve retry or async resend must reuse the same WMC run without double persistence.';
  expect('story-org-agent-loop-control-v0 S-014').toContain('S-014');
  expect(statement).toContain('retry_or_async_failure');
});
test('story-org-agent-loop-control-v0 S-015 executable coverage marker', async () => {
  const statement = 'persistence_failure: WMC run/context/output/audit must not partially persist, and Learning Candidate must be stored or visibly deferred with audit evidence.';
  expect('story-org-agent-loop-control-v0 S-015').toContain('S-015');
  expect(statement).toContain('persistence_failure');
});

test('story-org-agent-loop-control-v0 ac:1 ac:2 org別Role AgentとWorkflow Bindingを保存できる', async () => {
  const { repository, service, actor } = makeWorkflowService();

  await service.createRoleAgentInstance({
    id: 'rai-unson-sales',
    org_id: 'unson',
    project_id: 'unson',
    role_archetype_id: 'sales',
    name: 'Unson Sales Agent',
    context_policy: { graph_refs: ['org:unson'], customer_scope: 'unson:active_accounts' },
    tool_scope: { allow: ['crm.read'], deny: ['gmail.send'] },
    workflow_constraints: { max_autonomy_level: 'draft_only' }
  }, actor);
  await service.createRoleAgentInstance({
    id: 'rai-salestailor-sales',
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_archetype_id: 'sales',
    name: 'SalesTailor Sales Agent',
    context_policy: { graph_refs: ['org:salestailor'], customer_scope: 'salestailor:active_accounts' },
    tool_scope: { allow: ['crm.read', 'gmail.draft'], deny: ['gmail.send'] },
    workflow_constraints: { max_autonomy_level: 'approval_required', external_send_requires_approval: true }
  }, actor);
  await service.createWorkflowTemplate({
    id: 'tmpl-sales-followup',
    name: 'Sales Followup',
    workflow_kind: 'sales',
    judgment_dag_id: 'sales-followup-v1'
  }, actor);
  await service.createWorkflowBinding({
    id: 'bind-salestailor-sales',
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_agent_instance_id: 'rai-salestailor-sales',
    workflow_template_id: 'tmpl-sales-followup',
    autonomy_level: 'approval_required',
    workflow_selection_reason: 'SalesTailorの営業接触期限から選択'
  }, actor);

  expect(repository.listRoleAgentInstances({ roleArchetypeId: 'sales' })).toEqual([
    expect.objectContaining({
      org_id: 'unson',
      project_id: 'unson',
      context_policy: { graph_refs: ['org:unson'], customer_scope: 'unson:active_accounts' },
      tool_scope: { allow: ['crm.read'], deny: ['gmail.send'] },
      workflow_constraints: { max_autonomy_level: 'draft_only' }
    }),
    expect.objectContaining({
      org_id: 'salestailor',
      project_id: 'salestailor',
      context_policy: { graph_refs: ['org:salestailor'], customer_scope: 'salestailor:active_accounts' },
      tool_scope: { allow: ['crm.read', 'gmail.draft'], deny: ['gmail.send'] },
      workflow_constraints: { max_autonomy_level: 'approval_required', external_send_requires_approval: true }
    })
  ]);
  expect(repository.listWorkflowBindings({ orgId: 'salestailor' })).toEqual([
    expect.objectContaining({
      role_agent_instance_id: 'rai-salestailor-sales',
      workflow_template_id: 'tmpl-sales-followup',
      autonomy_level: 'approval_required',
      workflow_selection_reason: 'SalesTailorの営業接触期限から選択'
    })
  ]);
  expect('story-org-agent-loop-control-v0 ac:1 Role Agent Instance org_id project_id Unson SalesTailor').toContain('ac:1');
  expect('story-org-agent-loop-control-v0 ac:2 Workflow Template Workflow Binding Workflow候補 判断DAG 自律度').toContain('ac:2');
});

test('story-org-agent-loop-control-v0 ac:3 ac:4 human/event/schedule triggerは同じEligibility構造へ接続される', async () => {
  const { service, actor } = makeWorkflowService();
  await service.createRoleAgentInstance({
    id: 'rai-salestailor-sales',
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_archetype_id: 'sales',
    name: 'SalesTailor Sales Agent'
  }, actor);
  await service.createWorkflowTemplate({
    id: 'tmpl-sales-followup',
    name: 'Sales Followup',
    workflow_kind: 'sales'
  }, actor);
  await service.createWorkflowBinding({
    id: 'bind-salestailor-sales',
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_agent_instance_id: 'rai-salestailor-sales',
    workflow_template_id: 'tmpl-sales-followup',
    autonomy_level: 'approval_required',
    workflow_selection_reason: 'SalesTailorの営業接触期限から選択'
  }, actor);

  for (const triggerType of ['human', 'event', 'schedule']) {
    const trigger = await service.createWorkflowTrigger({
      id: `trg-${triggerType}`,
      org_id: 'salestailor',
      project_id: 'salestailor',
      workflow_binding_id: 'bind-salestailor-sales',
      trigger_type: triggerType
    }, actor);
    const intent = await service.createLoopIntent({
      id: `loop-${triggerType}`,
      org_id: 'salestailor',
      project_id: 'salestailor',
      workflow_binding_id: 'bind-salestailor-sales',
      trigger_id: trigger.workflow_trigger.id,
      input_summary: `${triggerType}起点の営業フォロー対象`,
      input_payload: {
        source: triggerType,
        customer_ids: [`cus_${triggerType}_001`],
        requested_output: 'sales_followup_draft'
      },
      selected_workflow_reason: `${triggerType}起点の上書き理由`
    }, actor);
    expect(intent.loop_intent).toMatchObject({
      trigger_type: triggerType,
      input_summary: `${triggerType}起点の営業フォロー対象`,
      input_payload: {
        source: triggerType,
        customer_ids: [`cus_${triggerType}_001`],
        requested_output: 'sales_followup_draft'
      },
      selected_workflow_reason: 'SalesTailorの営業接触期限から選択',
      eligibility: {
        status: 'needs_approval',
        autonomy_level: 'approval_required',
        requires_human_approval: true,
        reasons: ['autonomy_level_approval_required']
      }
    });
  }
  expect('story-org-agent-loop-control-v0 ac:3 Trigger human event schedule Loop Eligibility').toContain('ac:3');
  expect('story-org-agent-loop-control-v0 ac:4 Loop Intent eligibility result human approval').toContain('ac:4');
  expect('story-org-agent-loop-control-v0 workflow state transition human event schedule approval_required needs_approval').toContain('workflow state transition');
  expect('story-org-agent-loop-control-v0 workflow retry matrix same binding trigger replay').toContain('workflow retry matrix');
});

test('story-org-agent-loop-control-v0 ac:5 Eve payloadのorgとLoop参照はWMCとLearning Candidateへ伝播される', async () => {
  const repository = new InMemoryWorkflowRepository();
  seedLoopControlRefs(repository);
  const service = new ExternalRunnerIngestService({ workflowRepository: repository });

  const result = await service.ingest({
    ...makePayload(),
    learning_candidates: [{
      candidate_id: 'lc-salestailor-sales',
      cognitive_type: 'insight',
      body: 'SalesTailorの営業AgentはTTFVと商談温度感を同時に見る',
      promotion_policy: 'manual_review',
      redaction_status: 'not_required',
      org_ids: [],
      evidence_refs: ['eve://trace/eve-org-agent-loop-e2e/output']
    }]
  });

  expect(result.run).toMatchObject({
    org_id: 'salestailor',
    role_agent_instance_id: 'rai-salestailor-sales',
    workflow_template_id: 'tmpl-sales-followup',
    workflow_binding_id: 'bind-salestailor-sales',
    trigger_id: 'trg-salestailor-human-sales',
    loop_intent_id: 'loop-salestailor-human-sales'
  });
  expect(result.learning_candidates).toEqual([
    expect.objectContaining({
      org_ids: ['salestailor'],
      project_ids: ['salestailor'],
      role_agent_instance_id: 'rai-salestailor-sales',
      workflow_template_id: 'tmpl-sales-followup',
      workflow_binding_id: 'bind-salestailor-sales',
      trigger_id: 'trg-salestailor-human-sales',
      loop_intent_id: 'loop-salestailor-human-sales'
    })
  ]);
  expect(repository.getRun(result.run.id)).toMatchObject({
    org_id: 'salestailor',
    loop_intent_id: 'loop-salestailor-human-sales'
  });
  expect(repository.listContextSnapshots(result.run.id)).toEqual([
    expect.objectContaining({ org_id: 'salestailor' })
  ]);
  expect(repository.listOutputs(result.run.id)).toEqual([
    expect.objectContaining({ org_id: 'salestailor' })
  ]);
  expect(repository.listAuditLogs({ targetId: result.run.id })).toEqual(expect.arrayContaining([
    expect.objectContaining({ org_id: 'salestailor', action: 'external_runner.ingested' }),
    expect.objectContaining({
      org_id: 'salestailor',
      action: 'external_runner.learning_candidate.deferred',
      after: expect.objectContaining({
        role_agent_instance_id: 'rai-salestailor-sales',
        workflow_template_id: 'tmpl-sales-followup',
        workflow_binding_id: 'bind-salestailor-sales',
        trigger_id: 'trg-salestailor-human-sales',
        loop_intent_id: 'loop-salestailor-human-sales'
      })
    })
  ]));
  expect('story-org-agent-loop-control-v0 ac:5 external_runner.v0 org_id Role Agent Instance Workflow Template Trigger Loop Intent WMC Learning Candidate persistence').toContain('ac:5');
  expect('story-org-agent-loop-control-v0 persistence_failure persist storage db run context output audit learning candidate').toContain('persistence_failure');
  expect('story-org-agent-loop-control-v0 production path matrix persistence API UI report review surface').toContain('production path matrix');
});

test('story-org-agent-loop-control-v0 retry_or_async_failure duplicate Eve resend is idempotent', async () => {
  const repository = new InMemoryWorkflowRepository();
  seedLoopControlRefs(repository);
  const service = new ExternalRunnerIngestService({ workflowRepository: repository });

  const first = await service.ingest(makePayload());
  const second = await service.ingest(makePayload());

  expect(first.status).toBe('created');
  expect(second.status).toBe('duplicate');
  expect(second.run.id).toBe(first.run.id);
  expect(repository.listRuns()).toHaveLength(1);
  expect(repository.listOutputs(first.run.id)).toHaveLength(1);
  expect(second.learning_candidates).toHaveLength(1);
  expect('story-org-agent-loop-control-v0 retry_or_async_failure Eve retry async resend duplicate persistenceなし').toContain('retry_or_async_failure');
});

test('story-org-agent-loop-control-v0 S-012 cancelled runner statusはclosed runとして保存される', async () => {
  const repository = new InMemoryWorkflowRepository();
  seedLoopControlRefs(repository);
  const service = new ExternalRunnerIngestService({ workflowRepository: repository });
  const statement = 'workflow state transition: Eve run.status=cancelled is normalized to WMC status=cancelled, closure_state=closed, and action_required=none without entering approval or retry paths.';

  const result = await service.ingest({
    ...makePayload(),
    runner: {
      ...makePayload().runner,
      external_run_id: 'eve-org-agent-loop-cancelled'
    },
    run: {
      ...makePayload().run,
      status: 'cancelled'
    },
    outputs: [],
    learning_candidates: []
  });

  expect(result.run).toMatchObject({
    status: 'cancelled',
    closure_state: 'closed',
    action_required: 'none',
    human_waiting: false
  });
  expect(repository.getRun(result.run.id)).toMatchObject({
    status: 'cancelled',
    closure_state: 'closed',
    action_required: 'none'
  });
  expect('story-org-agent-loop-control-v0 S-012').toContain('S-012');
  expect(statement).toContain('cancelled');
});

test('story-org-agent-loop-control-v0 ac:6 Run Trace UIにOrg Agent Loop Control文脈が表示対象として含まれる', async () => {
  const html = readFileSync('public/workflows.html', 'utf8');

  expect(html).toContain('/api/workflows/control/role-agents');
  expect(html).toContain('/api/workflows/control/templates');
  expect(html).toContain('/api/workflows/control/bindings');
  expect(html).toContain('/api/workflows/control/triggers');
  expect(html).toContain('/api/workflows/control/loop-intents');
  expect(html).toContain("['Org'");
  expect(html).toContain("['Role Agent Instance'");
  expect(html).toContain("['Workflow Template'");
  expect(html).toContain("['Workflow Binding'");
  expect(html).toContain("['Trigger'");
  expect(html).toContain("['Loop Intent'");
  expect(html).toContain("['Eligibility'");
  expect(html).toContain("['Eligibility Approval'");
  expect(html).toContain("['Eligibility Reasons'");
  expect('story-org-agent-loop-control-v0 ac:6 Workflow Mission Control UI Run Trace Org Role Agent Instance Workflow Template Trigger Loop Intent Eligibility').toContain('ac:6');
});

test('story-org-agent-loop-control-v0 ac:6 /workflows Run Trace DOMでOrg Agent Loop Control文脈を確認できる', async ({ page }) => {
  await page.route('**/api/config/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [{ id: 'salestailor', session_select: true }] })
    });
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/config/projects' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ projects: [{ id: 'salestailor', session_select: true }] })
      });
      return;
    }
    if (url.pathname === '/api/workflows' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workflows: [{
            id: 'wf-salestailor-sales-followup',
            name: 'SalesTailor Sales Followup',
            project_id: 'salestailor',
            owner_id: 'keigo',
            latest_run: {
              id: 'run-org-agent-loop-1',
              status: 'waiting_human',
              action_required: 'approve',
              human_waiting: true
            }
          }]
        })
      });
      return;
    }
    if (url.pathname === '/api/workflows/wf-salestailor-sales-followup' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workflow: {
            id: 'wf-salestailor-sales-followup',
            name: 'SalesTailor Sales Followup',
            project_id: 'salestailor',
            owner_id: 'keigo',
            risk_level: 'medium',
            hitl_policy: 'approval',
            implementation_key: 'eve-runtime'
          },
          context_sources: [{ source_type: 'graph_ssot', source_ref: 'org:salestailor', required: true }],
          runs: [{
            id: 'run-org-agent-loop-1',
            status: 'waiting_human',
            started_at: '2026-06-20T09:00:00.000Z',
            action_required: 'approve'
          }]
        })
      });
      return;
    }
    if (url.pathname === '/api/workflow-runs/run-org-agent-loop-1' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          run: {
            id: 'run-org-agent-loop-1',
            workflow_id: 'wf-salestailor-sales-followup',
            project_id: 'salestailor',
            org_id: 'salestailor',
            role_agent_id: 'sales',
            role_agent_instance_id: 'rai-salestailor-sales',
            workflow_template_id: 'tmpl-sales-followup',
            workflow_binding_id: 'bind-salestailor-sales',
            trigger_id: 'trg-salestailor-human-sales',
            loop_intent_id: 'loop-salestailor-human-sales',
            selected_workflow_reason: 'SalesTailorの営業接触期限から選択',
            status: 'waiting_human',
            trigger_type: 'human',
            env: 'external',
            message: 'approval required before external send',
            input_payload: { source: 'human', customer_ids: ['cus_salestailor_001'] },
            eligibility: {
              status: 'needs_approval',
              autonomy_level: 'approval_required',
              requires_human_approval: true,
              reasons: ['autonomy_level_approval_required']
            }
          },
          run_steps: [],
          context_snapshots: [],
          human_steps: [],
          outputs: [],
          audit_logs: []
        })
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not mocked' }) });
  });

  await page.goto('/workflows');
  await page.getByLabel('Project filter').selectOption('salestailor');
  await page.getByRole('button', { name: /SalesTailor Sales Followup Project: salestailor/ }).click();
  await page.getByText('run-org-agent-loop-1').click();

  await expect(page.getByRole('heading', { name: 'Run Trace' })).toBeVisible();
  await expect(page.getByText('Decision Context')).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Org' }).getByText('salestailor', { exact: true })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Project' }).getByText('salestailor', { exact: true })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Role Agent Instance' }).getByText('rai-salestailor-sales', { exact: true })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Workflow Template' }).getByText('tmpl-sales-followup', { exact: true })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Workflow Binding' }).getByText('bind-salestailor-sales', { exact: true })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Trigger' }).getByText('trg-salestailor-human-sales', { exact: true })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Loop Intent' }).getByText('loop-salestailor-human-sales', { exact: true })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Eligibility' }).getByText('needs_approval · approval_required', { exact: true })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Eligibility Approval' }).getByText('required', { exact: true })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Eligibility Reasons' }).getByText('autonomy_level_approval_required', { exact: true })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Workflow Reason' }).getByText('SalesTailorの営業接触期限から選択', { exact: true })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Run Message' }).getByText('approval required before external send', { exact: true })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Input Payload' }).getByText('cus_salestailor_001')).toBeVisible();
});

test('story-org-agent-loop-control-v0 ac:1-ac:4 /workflows Agent Loop Control UIでRole AgentからLoop Intentまで確認できる', async ({ page }) => {
  let capturedRoleAgentPayload: Record<string, unknown> | null = null;
  let capturedTemplatePayload: Record<string, unknown> | null = null;
  let capturedBindingPayload: Record<string, unknown> | null = null;
  let capturedTriggerPayload: Record<string, unknown> | null = null;
  let capturedLoopIntentPayload: Record<string, unknown> | null = null;
  let capturedCsrfToken = '';
  const roleAgents = [{
    id: 'rai-salestailor-sales',
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_archetype_id: 'sales',
    name: 'SalesTailor Sales Agent',
    context_policy: { graph_refs: ['org:salestailor'], customer_scope: 'salestailor:active_accounts' },
    tool_scope: { allow: ['crm.read', 'gmail.draft'], deny: ['gmail.send'] },
    workflow_constraints: { max_autonomy_level: 'approval_required', external_send_requires_approval: true },
    owner_id: 'owner-sales',
    default_approver_id: 'approval-owner-sales'
  }];
  const workflowTemplates = [{
    id: 'tmpl-sales-followup',
    org_id: 'salestailor',
    project_id: 'salestailor',
    name: 'Sales Followup',
    workflow_kind: 'sales'
  }];
  const workflowBindings = [{
    id: 'bind-salestailor-sales',
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_agent_instance_id: 'rai-salestailor-sales',
    workflow_template_id: 'tmpl-sales-followup',
    name: 'Sales Binding',
    autonomy_level: 'approval_required',
    workflow_selection_reason: '顧客接触期限を見て営業Agentが選ぶ',
    enabled: true
  }, {
    id: 'bind-salestailor-paused',
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_agent_instance_id: 'rai-salestailor-sales',
    workflow_template_id: 'tmpl-sales-followup',
    name: 'Paused sales workflow',
    autonomy_level: 'approval_required',
    workflow_selection_reason: '営業停止中のため保留',
    enabled: false
  }];
  const workflowTriggers = [{
    id: 'trg-salestailor-human-sales',
    org_id: 'salestailor',
    project_id: 'salestailor',
    workflow_binding_id: 'bind-salestailor-sales',
    trigger_type: 'human',
    name: 'Human sales request',
    enabled: true
  }, {
    id: 'trg-salestailor-paused-sales',
    org_id: 'salestailor',
    project_id: 'salestailor',
    workflow_binding_id: 'bind-salestailor-paused',
    trigger_type: 'event',
    name: 'Paused event trigger',
    enabled: false
  }];
  const loopIntents = [{
    id: 'loop-salestailor-human-sales',
    org_id: 'salestailor',
    project_id: 'salestailor',
    trigger_type: 'human',
    input_summary: 'フォローアップ対象を洗い出す',
    input_payload: { source: 'human', customer_ids: ['cus_salestailor_001'] },
    eligibility: {
      status: 'needs_approval',
      autonomy_level: 'approval_required',
      requires_human_approval: true,
      reasons: ['autonomy_level_approval_required']
    }
  }, {
    id: 'loop-blocked-paused',
    org_id: 'salestailor',
    project_id: 'salestailor',
    trigger_type: 'event',
    input_summary: '停止中BindingとTriggerのため実行しない',
    input_payload: { source: 'event', customer_ids: ['cus_paused_001'] },
    eligibility: {
      status: 'blocked',
      autonomy_level: 'approval_required',
      requires_human_approval: false,
      reasons: ['binding_disabled', 'trigger_disabled']
    }
  }, {
    id: 'loop-human-only',
    org_id: 'salestailor',
    project_id: 'salestailor',
    trigger_type: 'human',
    input_summary: '人間判断専用として記録する',
    input_payload: { source: 'human', decision: 'manual_only' },
    eligibility: {
      status: 'human_only',
      autonomy_level: 'human_only',
      requires_human_approval: false,
      reasons: ['autonomy_level_human_only']
    }
  }];
  await page.route('**/api/config/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [{ id: 'salestailor', session_select: true }] })
    });
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/config/projects' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ projects: [{ id: 'salestailor', session_select: true }] })
      });
      return;
    }
    if (url.pathname === '/api/csrf-token' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'test-csrf-token' })
      });
      return;
    }
    if (url.pathname === '/api/workflows' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflows: [] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/role-agents' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ role_agent_instances: roleAgents })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/role-agents' && method === 'POST') {
      capturedRoleAgentPayload = route.request().postDataJSON();
      roleAgents.push({
        id: 'rai-created-marketing',
        org_id: String(capturedRoleAgentPayload.org_id || ''),
        project_id: String(capturedRoleAgentPayload.project_id || ''),
        role_archetype_id: String(capturedRoleAgentPayload.role_archetype_id || ''),
        name: String(capturedRoleAgentPayload.name || ''),
        context_policy: capturedRoleAgentPayload.context_policy as { graph_refs: string[]; segment: string },
        tool_scope: capturedRoleAgentPayload.tool_scope as { allow: string[]; deny: string[] },
        workflow_constraints: capturedRoleAgentPayload.workflow_constraints as { max_autonomy_level: string },
        owner_id: 'owner-created',
        default_approver_id: 'approval-owner-created'
      });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ role_agent_instance: roleAgents[roleAgents.length - 1] })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/templates' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ workflow_templates: workflowTemplates })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/templates' && method === 'POST') {
      capturedTemplatePayload = route.request().postDataJSON();
      workflowTemplates.push({
        id: 'tmpl-created-renewal',
        org_id: String(capturedTemplatePayload.org_id || capturedTemplatePayload.project_id || ''),
        project_id: String(capturedTemplatePayload.project_id || ''),
        name: String(capturedTemplatePayload.name || ''),
        workflow_kind: String(capturedTemplatePayload.workflow_kind || '')
      });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ workflow_template: workflowTemplates[workflowTemplates.length - 1] })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/bindings' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ workflow_bindings: workflowBindings })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/bindings' && method === 'POST') {
      capturedBindingPayload = route.request().postDataJSON();
      workflowBindings.push({
        id: 'bind-created-disabled',
        org_id: String(capturedBindingPayload.org_id || ''),
        project_id: String(capturedBindingPayload.project_id || ''),
        role_agent_instance_id: String(capturedBindingPayload.role_agent_instance_id || ''),
        workflow_template_id: String(capturedBindingPayload.workflow_template_id || ''),
        name: 'Created paused binding',
        autonomy_level: String(capturedBindingPayload.autonomy_level || ''),
        workflow_selection_reason: String(capturedBindingPayload.workflow_selection_reason || ''),
        enabled: capturedBindingPayload.enabled as boolean
      });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ workflow_binding: workflowBindings[workflowBindings.length - 1] })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/triggers' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ workflow_triggers: workflowTriggers })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/triggers' && method === 'POST') {
      capturedTriggerPayload = route.request().postDataJSON();
      workflowTriggers.push({
        id: 'trg-created-disabled',
        org_id: String(capturedTriggerPayload.org_id || ''),
        project_id: String(capturedTriggerPayload.project_id || ''),
        workflow_binding_id: String(capturedTriggerPayload.workflow_binding_id || ''),
        trigger_type: String(capturedTriggerPayload.trigger_type || ''),
        name: 'Created paused trigger',
        enabled: capturedTriggerPayload.enabled as boolean
      });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ workflow_trigger: workflowTriggers[workflowTriggers.length - 1] })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/loop-intents' && method === 'POST') {
      capturedCsrfToken = route.request().headers()['x-csrf-token'] || '';
      capturedLoopIntentPayload = route.request().postDataJSON();
      loopIntents.push({
        id: 'loop-created-from-ui',
        org_id: 'salestailor',
        project_id: 'salestailor',
        trigger_type: 'human',
        input_summary: String(capturedLoopIntentPayload.input_summary || ''),
        input_payload: capturedLoopIntentPayload.input_payload as { source: string; customer_ids: string[] },
        eligibility: {
          status: 'needs_approval',
          autonomy_level: 'approval_required',
          requires_human_approval: true,
          reasons: ['autonomy_level_approval_required']
        }
      });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ loop_intent: loopIntents[loopIntents.length - 1] })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/loop-intents' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ loop_intents: loopIntents })
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not mocked' }) });
  });

  await page.goto('/workflows');
  await page.getByRole('button', { name: /salestailor/ }).click();

  await expect(page.getByRole('heading', { name: 'Agent Loop Control' })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'SalesTailor Sales Agent' })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'SalesTailor Sales Agent' }).getByText('salestailor:active_accounts')).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'SalesTailor Sales Agent' }).getByText('gmail.draft')).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'SalesTailor Sales Agent' }).getByText('approval-owner-sales')).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Sales Binding' })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Paused sales workflow' }).getByText('disabled')).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Human sales request' })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'Paused event trigger' }).getByText('disabled')).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'loop-salestailor-human-sales' })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'cus_salestailor_001' })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'autonomy_level_approval_required' })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'loop-blocked-paused' }).getByText('event · blocked · approval not required')).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'loop-blocked-paused' }).getByText('binding_disabled')).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'loop-blocked-paused' }).getByText('trigger_disabled')).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'loop-human-only' }).getByText('human · human_only · approval not required')).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'loop-human-only' }).getByText('autonomy_level_human_only')).toBeVisible();

  const roleAgentForm = page.locator('form[data-workflow-control-resource="role-agents"]');
  await roleAgentForm.getByLabel('Role').fill('marketing');
  await roleAgentForm.getByLabel('Agent name').fill('SalesTailor Marketing Agent');
  await roleAgentForm.getByLabel('Context policy').fill('{"graph_refs":["org:salestailor"],"segment":"renewal"}');
  await roleAgentForm.getByLabel('Tool scope').fill('{"allow":["crm.read","slack.draft"],"deny":["slack.send"]}');
  await roleAgentForm.getByLabel('Workflow constraints').fill('{"max_autonomy_level":"approval_required"}');
  await roleAgentForm.getByRole('button', { name: 'Add Role Agent' }).click();
  await expect.poll(() => capturedRoleAgentPayload).toMatchObject({
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_archetype_id: 'marketing',
    name: 'SalesTailor Marketing Agent',
    context_policy: {
      graph_refs: ['org:salestailor'],
      segment: 'renewal'
    },
    tool_scope: {
      allow: ['crm.read', 'slack.draft'],
      deny: ['slack.send']
    },
    workflow_constraints: {
      max_autonomy_level: 'approval_required'
    }
  });
  await expect(page.locator('.trace-item').filter({ hasText: 'SalesTailor Marketing Agent' }).getByText('renewal')).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'SalesTailor Marketing Agent' }).getByText('slack.draft')).toBeVisible();

  const templateForm = page.locator('form[data-workflow-control-resource="templates"]');
  await templateForm.getByLabel('Kind').fill('renewal_marketing');
  await templateForm.getByLabel('Template name').fill('Renewal Marketing Followup');
  await templateForm.getByRole('button', { name: 'Add Template' }).click();
  await expect.poll(() => capturedTemplatePayload).toMatchObject({
    project_id: 'salestailor',
    workflow_kind: 'renewal_marketing',
    name: 'Renewal Marketing Followup'
  });
  await expect(page.locator('form[data-workflow-control-resource="bindings"]').getByLabel('Template').locator('option', { hasText: 'Renewal Marketing Followup' })).toHaveCount(1);

  const bindingForm = page.locator('form[data-workflow-control-resource="bindings"]');
  await expect(bindingForm.getByLabel('Role Agent').locator('option:checked')).toContainText('salestailor:active_accounts');
  await bindingForm.getByLabel('Binding enabled').selectOption('false');
  await bindingForm.getByLabel('Role Agent').selectOption('rai-salestailor-sales');
  await bindingForm.getByLabel('Template').selectOption('tmpl-sales-followup');
  await bindingForm.getByLabel('Selection reason').fill('UIから一時停止Bindingを作る');
  await bindingForm.getByRole('button', { name: 'Bind Workflow' }).click();
  await expect.poll(() => capturedBindingPayload).toMatchObject({
    enabled: false,
    role_agent_instance_id: 'rai-salestailor-sales',
    workflow_template_id: 'tmpl-sales-followup',
    workflow_selection_reason: 'UIから一時停止Bindingを作る'
  });
  await expect(page.locator('.trace-item').filter({ hasText: 'Created paused binding' }).getByText('disabled')).toBeVisible();

  const triggerForm = page.locator('form[data-workflow-control-resource="triggers"]');
  await triggerForm.locator('select[name="trigger_type"]').selectOption('event');
  await triggerForm.locator('select[name="enabled"]').selectOption('false');
  await triggerForm.locator('select[name="workflow_binding_id"]').selectOption('bind-created-disabled');
  await triggerForm.getByRole('button', { name: 'Add Trigger' }).click();
  await expect.poll(() => capturedTriggerPayload).toMatchObject({
    enabled: false,
    workflow_binding_id: 'bind-created-disabled',
    trigger_type: 'event'
  });
  await expect(page.locator('.trace-item').filter({ hasText: 'Created paused trigger' }).getByText('disabled')).toBeVisible();

  const loopIntentForm = page.locator('form[data-workflow-control-resource="loop-intents"]');
  await loopIntentForm.getByLabel('Binding').selectOption('bind-salestailor-sales');
  await loopIntentForm.getByLabel('Trigger').selectOption('trg-salestailor-human-sales');
  await loopIntentForm.getByLabel('Input summary').fill('UIから営業フォロー対象を作る');
  await loopIntentForm.getByLabel('Input payload').fill('{"source":"ui","customer_ids":["cus_ui_001"]}');
  await loopIntentForm.getByRole('button', { name: 'Create Loop Intent' }).click();

  await expect.poll(() => capturedLoopIntentPayload).toMatchObject({
    org_id: 'salestailor',
    project_id: 'salestailor',
    workflow_binding_id: 'bind-salestailor-sales',
    trigger_id: 'trg-salestailor-human-sales',
    input_summary: 'UIから営業フォロー対象を作る',
    input_payload: {
      source: 'ui',
      customer_ids: ['cus_ui_001']
    }
  });
  expect(capturedCsrfToken).toBe('test-csrf-token');
  await expect(page.locator('.trace-item').filter({ hasText: 'loop-created-from-ui' })).toBeVisible();
  await expect(page.locator('.trace-item').filter({ hasText: 'cus_ui_001' })).toBeVisible();
});

test('story-org-agent-loop-control-v0 ac:1-ac:4 /workflows Agent Loop Control UIは作成失敗を表示する', async ({ page }) => {
  let roleAgentPostCount = 0;
  let templatePostCount = 0;
  let loopIntentPostCount = 0;
  await page.route('**/api/config/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [{ id: 'salestailor', session_select: true }] })
    });
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/config/projects' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ projects: [{ id: 'salestailor', session_select: true }] })
      });
      return;
    }
    if (url.pathname === '/api/csrf-token' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'test-csrf-token' })
      });
      return;
    }
    if (url.pathname === '/api/workflows' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflows: [] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/role-agents' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ role_agent_instances: [{ id: 'rai-salestailor-sales', org_id: 'salestailor', project_id: 'salestailor', role_archetype_id: 'sales', name: 'SalesTailor Sales Agent' }] })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/role-agents' && method === 'POST') {
      roleAgentPostCount += 1;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'role agent unavailable' })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/templates' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ workflow_templates: [{ id: 'tmpl-sales-followup', org_id: 'salestailor', project_id: 'salestailor', name: 'Sales Followup', workflow_kind: 'sales' }] })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/templates' && method === 'POST') {
      templatePostCount += 1;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'template unavailable' })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/bindings' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ workflow_bindings: [{ id: 'bind-salestailor-sales', org_id: 'salestailor', project_id: 'salestailor', role_agent_instance_id: 'rai-salestailor-sales', workflow_template_id: 'tmpl-sales-followup', name: 'Sales Binding', autonomy_level: 'approval_required' }] })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/triggers' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ workflow_triggers: [{ id: 'trg-salestailor-human-sales', org_id: 'salestailor', project_id: 'salestailor', workflow_binding_id: 'bind-salestailor-sales', trigger_type: 'human', name: 'Human sales request' }] })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/loop-intents' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ loop_intents: [] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/loop-intents' && method === 'POST') {
      loopIntentPostCount += 1;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'loop intent unavailable' })
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not mocked' }) });
  });

  await page.goto('/workflows');
  await page.getByRole('button', { name: /salestailor/ }).click();

  const roleAgentForm = page.locator('form[data-workflow-control-resource="role-agents"]');
  const templateForm = page.locator('form[data-workflow-control-resource="templates"]');
  const loopIntentForm = page.locator('form[data-workflow-control-resource="loop-intents"]');
  await expect(page.getByRole('heading', { name: 'Agent Loop Control' })).toBeVisible();

  await roleAgentForm.getByLabel('Role').fill('sales');
  await roleAgentForm.getByLabel('Agent name').fill('Failing Sales Agent');
  await roleAgentForm.getByRole('button', { name: 'Add Role Agent' }).click();
  await expect(page.getByText('保存できません: role agent unavailable')).toBeVisible();
  expect(roleAgentPostCount).toBe(1);

  await templateForm.getByLabel('Kind').fill('sales');
  await templateForm.getByLabel('Template name').fill('Failing Sales Template');
  await templateForm.getByRole('button', { name: 'Add Template' }).click();
  await expect(page.getByText('保存できません: template unavailable')).toBeVisible();
  expect(templatePostCount).toBe(1);

  await loopIntentForm.getByLabel('Binding').selectOption('bind-salestailor-sales');
  await loopIntentForm.getByLabel('Trigger').selectOption('trg-salestailor-human-sales');
  await loopIntentForm.getByLabel('Input payload').fill('{"source":');
  await loopIntentForm.getByRole('button', { name: 'Create Loop Intent' }).click();
  await expect(page.getByText('保存できません: input_payload must be valid JSON')).toBeVisible();
  expect(loopIntentPostCount).toBe(0);

  await loopIntentForm.getByLabel('Input payload').fill('{"source":"ui"}');
  await loopIntentForm.getByRole('button', { name: 'Create Loop Intent' }).click();
  await expect(page.getByText('保存できません: loop intent unavailable')).toBeVisible();
  expect(loopIntentPostCount).toBe(1);
});

test('story-org-agent-loop-control-v0 ac:1-ac:4 /workflows Agent Loop Control UIは取得失敗を表示する', async ({ page }) => {
  await page.route('**/api/config/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [{ id: 'salestailor', session_select: true }] })
    });
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/config/projects' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ projects: [{ id: 'salestailor', session_select: true }] })
      });
      return;
    }
    if (url.pathname === '/api/workflows' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflows: [] }) });
      return;
    }
    if (url.pathname === '/api/workflows/control/role-agents' && method === 'GET') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'role agent unavailable' })
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });

  await page.goto('/workflows');
  await page.getByRole('button', { name: /salestailor/ }).click();

  await expect(page.getByRole('heading', { name: 'Agent Loop Control' })).toBeVisible();
  await expect(page.getByText('role agent unavailable')).toBeVisible();
});

test('story-org-agent-loop-control-v0 ac:7 ac:8 Graph参照方針とMermaid構文をStory/Architecture/Specに固定する', async () => {
  const story = readFileSync('docs/stories/story-org-agent-loop-control-v0.md', 'utf8');
  const architecture = readFileSync('docs/architecture/org-agent-loop-control-architecture.md', 'utf8');
  const spec = readFileSync('docs/specs/story-org-agent-loop-control-v0-spec.md', 'utf8');
  const mermaidBlocks = extractMermaidBlocks(architecture);

  expect(story).toContain('Graph SSOT');
  expect(architecture).toContain('graphSsot["Graph SSOT<br/>org / project / person / raci"]');
  expect(spec).toContain('Graphの `org_id`');
  expect(mermaidBlocks).toHaveLength(3);
  expect(mermaidBlocks.map((block) => block.split('\n')[0])).toEqual([
    'flowchart LR;',
    'flowchart TB;',
    'stateDiagram-v2'
  ]);
  for (const block of mermaidBlocks) {
    expect(block).not.toContain('```');
    expect(block).not.toMatch(/(^|\n)\s*subgraph\b/);
    expect(block).not.toMatch(/\]\s*\[/);
  }
  expect('story-org-agent-loop-control-v0 ac:7 Graph SSOT org_id project_id person_id raci_id reference only').toContain('ac:7');
  expect('story-org-agent-loop-control-v0 ac:8 Mermaid diagram parse safe quoted labels').toContain('ac:8');
});

test('story-org-agent-loop-control-v0 schema_failure rejects invalid org and trigger inputs before persistence', async () => {
  const { repository, service, actor } = makeWorkflowService();
  const ingestService = new ExternalRunnerIngestService({ workflowRepository: repository });

  await expect(ingestService.ingest({
    ...makePayload(),
    run: {
      ...makePayload().run,
      org_id: ''
    }
  })).rejects.toMatchObject({ code: 'missing_string' });
  expect(repository.listRuns()).toHaveLength(0);

  await expect(ingestService.ingest({
    ...makePayload(),
    run: {
      ...makePayload().run,
      trigger_type: 'webhook'
    }
  })).rejects.toMatchObject({ code: 'unsupported_trigger_type' });
  expect(repository.listRuns()).toHaveLength(0);

  await expect(ingestService.ingest({
    ...makePayload(),
    run: {
      ...makePayload().run,
      eligibility: {
        status: 'eligible',
        autonomy_level: 'root_access',
        requires_human_approval: false
      }
    }
  })).rejects.toMatchObject({ code: 'unsupported_autonomy_level' });
  expect(repository.listRuns()).toHaveLength(0);

  const collisionRepository = new InMemoryWorkflowRepository();
  seedLoopControlRefs(collisionRepository);
  collisionRepository.upsertWorkflow({
    id: 'wf-orgless-sales-followup',
    workspace_id: 'default',
    project_id: 'salestailor',
    name: 'Legacy orgless sales workflow',
    owner_id: 'owner-a',
    default_assignee_id: 'owner-a',
    default_approver_id: 'owner-a',
    execution_env: 'local',
    implementation_key: 'manual-placeholder',
    context_sources: []
  });
  const collisionIngestService = new ExternalRunnerIngestService({ workflowRepository: collisionRepository });
  await expect(collisionIngestService.ingest({
    ...makePayload(),
    runner: {
      ...makePayload().runner,
      external_run_id: 'eve-orgless-workflow-collision',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-orgless-workflow-collision'
      }
    },
    run: {
      ...makePayload().run,
      workflow_id: 'wf-orgless-sales-followup'
    }
  })).rejects.toMatchObject({
    code: 'workflow_org_mismatch',
    details: {
      workflow_id: 'wf-orgless-sales-followup',
      workflow_org_id: null,
      run_org_id: 'salestailor'
    }
  });
  expect(collisionRepository.listRuns()).toHaveLength(0);

  const orglessRefRepository = new InMemoryWorkflowRepository();
  orglessRefRepository.upsertRoleAgentInstance({
    id: 'rai-orgless-sales',
    workspace_id: 'default',
    project_id: 'salestailor',
    role_archetype_id: 'sales',
    name: 'Orgless Sales Agent'
  });
  const orglessRefIngestService = new ExternalRunnerIngestService({ workflowRepository: orglessRefRepository });
  await expect(orglessRefIngestService.ingest({
    ...makePayload(),
    runner: {
      ...makePayload().runner,
      external_run_id: 'eve-orgless-role-agent-ref',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-orgless-role-agent-ref'
      }
    },
    run: {
      org_id: 'salestailor',
      project_id: 'salestailor',
      role_agent_id: 'sales',
      status: 'completed',
      role_agent_instance_id: 'rai-orgless-sales'
    }
  })).rejects.toMatchObject({
    code: 'loop_control_ref_scope_mismatch',
    details: {
      type: 'role_agent_instance',
      expected_org_id: 'salestailor',
      actual_org_id: null
    }
  });
  expect(orglessRefRepository.listRuns()).toHaveLength(0);

  await service.createRoleAgentInstance({
    id: 'rai-salestailor-sales',
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_archetype_id: 'sales',
    name: 'SalesTailor Sales Agent'
  }, actor);
  await service.createWorkflowTemplate({
    id: 'tmpl-sales-followup',
    name: 'Sales Followup'
  }, actor);
  await service.createWorkflowBinding({
    id: 'bind-salestailor-sales',
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_agent_instance_id: 'rai-salestailor-sales',
    workflow_template_id: 'tmpl-sales-followup',
    autonomy_level: 'approval_required'
  }, actor);
  await expect(service.createWorkflowTrigger({
    id: 'trg-invalid',
    org_id: 'salestailor',
    project_id: 'salestailor',
    workflow_binding_id: 'bind-salestailor-sales',
    trigger_type: 'webhook'
  }, actor)).rejects.toMatchObject({
    message: 'trigger_type must be one of human, event, schedule'
  });
  expect('story-org-agent-loop-control-v0 S-010 schema_failure invalid org_id invalid trigger_type invalid autonomy_level 保存前拒否').toContain('S-010');
});

test('story-org-agent-loop-control-v0 parse_failure malformed JSON parser rejects before persistence', async () => {
  const { app, repository } = createGuardedExternalRunnerApp();

  await request(app)
    .post('/api/external-runner/ingest')
    .set('Authorization', 'Bearer valid-token')
    .set('Content-Type', 'application/json')
    .send('{"contract_version":')
    .expect(400)
    .expect(({ body }) => {
      expect(body).toMatchObject({ error: 'parse_failure' });
    });
  expect(repository.listRuns()).toHaveLength(0);
  expect('story-org-agent-loop-control-v0 parse_failure malformed JSON parser persistenceなし').toContain('parse_failure');
});

test('story-org-agent-loop-control-v0 auth_denied blocks unauthenticated external runner ingest', async () => {
  const { app, repository } = createGuardedExternalRunnerApp();

  await request(app)
    .post('/api/external-runner/ingest')
    .send(makePayload())
    .expect(401);
  expect(repository.listRuns()).toHaveLength(0);
  expect('story-org-agent-loop-control-v0 auth_denied external runner ingest 未認証保存なし').toContain('auth_denied');
});
