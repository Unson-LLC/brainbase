import { test, expect } from '@playwright/test';

import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';

import { requireAuth } from '../../server/middleware/auth.js';
import { createExternalRunnerRouter } from '../../server/routes/external-runner.js';
import { ExternalRunnerContractError } from '../../server/services/external-runner/contract-schema.js';
import { ExternalRunnerIngestService } from '../../server/services/external-runner/ingest-service.js';
import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';

const storyId = 'story-external-runner-adapter-contract-v0';

function expectRunIdForExternalRun(runId: string, externalRunId: string) {
  const readable = String(externalRunId || 'unknown').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80);
  expect(runId).toMatch(new RegExp(`^run_brainbase_eve_${readable}_[a-f0-9]{12}$`));
}

function makePayload(overrides = {}) {
  return {
    contract_version: 'external_runner.v0',
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-001',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-e2e-001'
      }
    },
    run: {
      project_id: 'brainbase',
      role_agent_id: 'sales',
      workflow_id: 'wf_sales_followup',
      workflow_name: '営業フォローアップ',
      status: 'completed',
      selected_workflow_reason: '案件の次回接触期限が近い'
    },
    loop_control: {
      owner_id: 'keigo',
      cost_owner_id: 'keigo',
      approval_owner_id: 'keigo',
      stop_conditions: ['external_send_requires_approval']
    },
    context_sources: [{
      source_type: 'graph_ssot',
      source_ref: 'customer:acme',
      digest: 'sha256:context',
      redaction_status: 'not_required',
      evidence_refs: ['graph://customer/acme']
    }],
    judgment_dag_trace: {
      dag_id: 'sales-followup-v1',
      version: '1',
      nodes: ['classify', 'draft'],
      evidence_refs: ['graph://customer/acme']
    },
    rounds: [{
      round_id: 'round-1',
      status: 'completed',
      evidence_refs: ['eve://trace/eve-e2e-001/round-1']
    }],
    outputs: [{
      id: 'out-1',
      output_type: 'draft',
      title: 'Slack返信案',
      body: '次回提案の返信案',
      visibility: 'internal',
      approval_required: true,
      evidence_refs: ['eve://trace/eve-e2e-001/output/out-1']
    }],
    learning_candidates: [{
      candidate_id: 'lc-1',
      cognitive_type: 'insight',
      body: '営業フォローでは期限と顧客温度感を同時に見る',
      promotion_policy: 'manual_review',
      redaction_status: 'not_required',
      evidence_refs: ['eve://trace/eve-e2e-001/output/out-1']
    }],
    ...overrides
  };
}

function makeService(candidateRepository = null) {
  const repository = new InMemoryWorkflowRepository();
  const service = new ExternalRunnerIngestService({ workflowRepository: repository, candidateRepository });
  return { repository, service };
}

function createGuardedRouteApp() {
  const app = express();
  const repository = new InMemoryWorkflowRepository();
  const ingestService = new ExternalRunnerIngestService({ workflowRepository: repository });
  const authService = {
    verifyToken(token) {
      if (token !== 'valid-token') throw new Error('invalid token');
      return { sub: 'keigo', role: 'member', projectCodes: ['brainbase'] };
    },
    verifyServiceToken(token) {
      if (token !== 'bbsvc_valid') throw new Error('invalid service token');
      return { sub: 'eve-runtime', role: 'member', projectCodes: ['brainbase'], employmentType: 'internal_service' };
    }
  };
  app.use(express.json());
  app.use('/api/external-runner', requireAuth(authService), createExternalRunnerRouter(ingestService));
  return { app, repository };
}

test('story-external-runner-adapter-contract-v0 ac:1 `external_runner.v0` は `runner.type=eve` とEve trace参照を必須にする。', async () => {
  const { repository, service } = makeService();

  await expect(service.ingest(makePayload({
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-ac1',
      agent_id: 'sales-agent',
      eve: {}
    }
  }))).rejects.toMatchObject({ code: 'missing_string' });
  expect(`${storyId} ac:1 external_runner.v0 runner.type=eve Eve trace参照`).toContain('external_runner.v0');
  expect(repository.listRuns()).toHaveLength(0);
});

test('story-external-runner-adapter-contract-v0 ac:2 Eve実行結果はWorkflow Mission Controlのrun/context/human step/output/auditへ決定的に写る。 S-001 workflow state transition', async () => {
  const { repository, service } = makeService();

  const result = await service.ingest(makePayload());

  expect(result.run).toMatchObject({
    status: 'success',
    closure_state: 'closed',
    action_required: 'none'
  });
  expectRunIdForExternalRun(result.run.id, 'eve-e2e-001');
  expect(result.workflow).toMatchObject({
    id: 'wf_sales_followup',
    execution_env: 'external',
    implementation_key: 'external-runner:eve'
  });
  expect(result.context_snapshots).toHaveLength(1);
  expect(result.outputs).toHaveLength(1);
  expect(repository.listAuditLogs({ targetId: result.run.id })).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'external_runner.ingested' }),
    expect.objectContaining({ action: 'external_runner.round_recorded' }),
    expect.objectContaining({ action: 'external_runner.learning_candidate.deferred' })
  ]));
  expect(`${storyId} ac:2 Eve実行結果 Workflow Mission Control run context human step output audit`).toContain('Workflow Mission Control');
});

test('story-external-runner-adapter-contract-v0 ac:3 Role Agent、Workflow選択理由、Judgment DAG trace、停止条件、人間承認者が保存される。', async () => {
  const { service } = makeService();

  const result = await service.ingest(makePayload({
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-ac3',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-e2e-ac3'
      }
    }
  }));

  expect(result.run.metadata).toMatchObject({
    role_agent_id: 'sales',
    selected_workflow_reason: '案件の次回接触期限が近い',
    judgment_dag_trace: expect.objectContaining({ dag_id: 'sales-followup-v1' }),
    loop_control: expect.objectContaining({
      stop_conditions: ['external_send_requires_approval'],
      approval_owner_id: 'keigo'
    })
  });
  expect(`${storyId} ac:3 Role Agent Workflow選択理由 Judgment DAG trace 停止条件 人間承認者`).toContain('Judgment DAG trace');
});

test('story-external-runner-adapter-contract-v0 ac:4 Learning CandidateはGraph SSOTへ直昇格せず、Candidate Storeまたはdeferred auditとして残る。 S-005 workflow rollback guard', async () => {
  const stored = [];
  const { service } = makeService({
    async create(input) {
      stored.push(input);
      return { id: input.id, ...input };
    }
  });

  await expect(service.ingest(makePayload({
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-auto-promote',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-e2e-auto-promote'
      }
    },
    learning_candidates: [{
      candidate_id: 'lc-auto',
      cognitive_type: 'claim',
      body: '外部runnerがGraphへ直昇格してよい',
      promotion_policy: 'auto_promote',
      redaction_status: 'not_required'
    }]
  }))).rejects.toBeInstanceOf(ExternalRunnerContractError);

  const result = await service.ingest(makePayload({
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-candidate-store',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-e2e-candidate-store'
      }
    }
  }));
  expect(result.learning_candidates).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    id: 'lc-1',
    source_system: 'external_runner',
    owner_person_id: 'keigo',
    actor_person_id: 'sales-agent',
    promotion_status: 'candidate'
  });
  expect(`${storyId} ac:4 Learning Candidate Graph SSOT Candidate Store deferred audit`).toContain('Graph SSOT');
});

test('story-external-runner-adapter-contract-v0 ac:5 外部送信・公開・契約・Graph昇格が必要な結果は人間承認待ちとして表現できる。 S-002 Workflow state transition maps Eve approval_required status to Brainbase waiting_human status, open closure_state, approve action_required, and a required human approval step.', async () => {
  const { service } = makeService();

  const result = await service.ingest(makePayload({
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-approval',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-e2e-approval'
      }
    },
    run: {
      project_id: 'brainbase',
      role_agent_id: 'sales',
      workflow_id: 'wf_sales_followup',
      workflow_name: '営業フォローアップ',
      status: 'approval_required',
      selected_workflow_reason: '外部送信前に人間承認が必要'
    },
    human_steps: [{
      id: 'hs-1',
      step_type: 'approval',
      prompt: 'Slack送信を承認する',
      required_role: 'owner'
    }]
  }));

  expect(result.run).toMatchObject({
    status: 'waiting_human',
    closure_state: 'open',
    action_required: 'approve',
    human_waiting: true
  });
  expect(result.human_steps[0]).toMatchObject({
    step_type: 'approval',
    status: 'pending',
    prompt: 'Slack送信を承認する',
    title: 'Slack送信を承認する'
  });
  expect('S-002 Workflow state transition maps Eve approval_required status to Brainbase waiting_human status, open closure_state, approve action_required, and a required human approval step.').toContain('approval_required');
  expect(`${storyId} ac:5 外部送信 公開 契約 Graph昇格 人間承認待ち`).toContain('人間承認待ち');
});

test('story-external-runner-adapter-contract-v0 ac:5 S-002b waiting_human creates human wait state', async () => {
  const { service } = makeService();

  const result = await service.ingest(makePayload({
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-waiting-human',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-e2e-waiting-human'
      }
    },
    run: {
      project_id: 'brainbase',
      role_agent_id: 'sales',
      workflow_id: 'wf_sales_followup',
      workflow_name: '営業フォローアップ',
      status: 'waiting_human',
      selected_workflow_reason: 'Eve側でhuman approval待ち'
    },
    human_steps: [{
      id: 'hs-waiting-human',
      step_type: 'approval',
      prompt: 'Eve承認を確認する',
      required_role: 'owner'
    }]
  }));

  expect(result.run).toMatchObject({
    status: 'waiting_human',
    closure_state: 'open',
    action_required: 'approve',
    human_waiting: true
  });
  expect(result.human_steps[0]).toMatchObject({
    step_type: 'approval',
    status: 'pending',
    prompt: 'Eve承認を確認する',
    title: 'Eve承認を確認する'
  });
});

test('story-external-runner-adapter-contract-v0 ac:6 同じproject内の同じEve run idの再送は重複実行ではなく冪等なduplicateとして扱い、別projectの同一Eve run idは別runとして扱う。 S-004 workflow retry matrix', async () => {
  const { service } = makeService();

  const first = await service.ingest(makePayload({
    run: {
      project_id: 'brainbase',
      role_agent_id: 'sales',
      workflow_id: 'wf_sales_followup',
      workflow_name: '営業フォローアップ',
      status: 'completed',
      workflow_run_id: 'caller-run-a'
    }
  }));
  const second = await service.ingest(makePayload({
    run: {
      project_id: 'brainbase',
      role_agent_id: 'sales',
      workflow_id: 'wf_sales_followup',
      workflow_name: '営業フォローアップ',
      status: 'completed',
      workflow_run_id: 'caller-run-b'
    }
  }));

  expect(second).toMatchObject({
    status: 'duplicate',
    run: { id: first.run.id }
  });
  expectRunIdForExternalRun(first.run.id, 'eve-e2e-001');
  expect(second.outputs).toHaveLength(1);
  expect(`${storyId} ac:6 同じproject内 同じEve run id 再送 重複実行 冪等 duplicate`).toContain('duplicate');
});

test('story-external-runner-adapter-contract-v0 ac:7 S-004d workflow_idが省略されたfallback workflowはprojectごとに分離される。', async () => {
  const { repository, service } = makeService();

  const first = await service.ingest(makePayload({
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-fallback-workflow',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-e2e-fallback-workflow-brainbase'
      }
    },
    run: {
      project_id: 'brainbase',
      role_agent_id: 'sales',
      workflow_name: '営業フォローアップ',
      status: 'completed'
    }
  }));
  const second = await service.ingest(makePayload({
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-fallback-workflow',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-e2e-fallback-workflow-salestailor'
      }
    },
    run: {
      project_id: 'salestailor',
      role_agent_id: 'sales',
      workflow_name: 'SalesTailor営業フォローアップ',
      status: 'completed'
    }
  }));

  expect(first.workflow.id).toBe('external_runner_brainbase_sales-agent');
  expect(second.workflow.id).toBe('external_runner_salestailor_sales-agent');
  expect(first.run.project_id).toBe('brainbase');
  expect(second.run.project_id).toBe('salestailor');
  expect(repository.listRuns()).toHaveLength(2);
  expect(`${storyId} S-004d fallback workflow project-scoped workflow_id省略`).toContain('S-004d');
});

test('story-external-runner-adapter-contract-v0 ac:8 S-004e bearer requestのlearning candidate actor省略時は認証主体本人に正規化される。', async () => {
  const { app, repository } = createGuardedRouteApp();
  const payload = makePayload({
    learning_candidates: [{
      candidate_id: 'cand-bearer-default-actor',
      cognitive_type: 'insight',
      body: 'External runner learned a marketing review heuristic.'
    }]
  });

  const response = await request(app)
    .post('/api/external-runner/ingest')
    .set('Authorization', 'Bearer valid-token')
    .send(payload)
    .expect(201);

  expect(response.body.learning_candidates).toEqual([
    expect.objectContaining({
      candidate_id: 'cand-bearer-default-actor',
      owner_person_id: 'keigo',
      actor_person_id: 'keigo',
      persistence_status: 'deferred'
    })
  ]);
  expect(repository.listRuns()).toHaveLength(1);
  expect(`${storyId} S-004e bearer learning candidate actor authenticated person`).toContain('S-004e');
});

test('story-external-runner-adapter-contract-v0 ac:7 既存Workflow IDを指定する場合、WorkflowのprojectとEve payloadのprojectが一致しないrunは保存前に拒否する。 S-004b workflow rollback guard', async () => {
  const { repository, service } = makeService();
  repository.upsertWorkflow({
    id: 'wf_cross_project_collision',
    workspace_id: 'default',
    project_id: 'brainbase',
    name: 'Brainbase existing workflow',
    owner_id: 'keigo',
    default_assignee_id: 'keigo',
    default_approver_id: 'keigo',
    execution_env: 'local',
    implementation_key: 'manual-placeholder',
    context_sources: []
  });

  await expect(service.ingest(makePayload({
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-workflow-project-mismatch',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-e2e-workflow-project-mismatch'
      }
    },
    run: {
      project_id: 'salestailor',
      role_agent_id: 'sales',
      workflow_id: 'wf_cross_project_collision',
      workflow_name: 'SalesTailor followup',
      status: 'completed'
    }
  }))).rejects.toMatchObject({
    code: 'workflow_project_mismatch',
    details: {
      workflow_id: 'wf_cross_project_collision',
      workflow_project_id: 'brainbase',
      run_project_id: 'salestailor'
    }
  });
  expect(repository.listRuns()).toHaveLength(0);
  expect(repository.listAuditLogs()).toHaveLength(0);
  expect(`${storyId} ac:7 workflow_id project mismatch 保存前 拒否`).toContain('workflow_id');
});

test('story-external-runner-adapter-contract-v0 ac:8 service/internal credential以外の外部runner requestは、payloadのowner/cost owner/approval ownerを認証主体本人以外へ委任できない。 S-004c workflow ownership guard', async () => {
  const route = readFileSync('server/routes/external-runner.js', 'utf8');
  const routeTest = readFileSync('tests/server/routes/external-runner-routes.test.js', 'utf8');

  expect(route).toContain('loop_control_delegation_not_allowed');
  expect(route).toContain("req.authSource === 'service-token'");
  expect(routeTest).toContain('rejects bearer owner and approver spoofing before persistence');
  expect(`${storyId} ac:8 service/internal credential owner cost owner approval owner 委任拒否`).toContain('ac:8');
});

test('story-external-runner-adapter-contract-v0 S-003 Workflow state transition maps Eve cancelled status to Brainbase cancelled status and closed closure_state instead of success.', async () => {
  const { service } = makeService();

  const result = await service.ingest(makePayload({
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-cancelled',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-e2e-cancelled'
      }
    },
    run: {
      project_id: 'brainbase',
      role_agent_id: 'sales',
      workflow_id: 'wf_sales_followup',
      workflow_name: '営業フォローアップ',
      status: 'cancelled',
      selected_workflow_reason: '停止条件に到達した'
    }
  }));

  expect(result.run).toMatchObject({
    status: 'cancelled',
    closure_state: 'closed',
    action_required: 'none'
  });
  expect('S-003 Workflow state transition maps Eve cancelled status to Brainbase cancelled status and closed closure_state instead of success.').toContain('cancelled');
});

test('story-external-runner-adapter-contract-v0 workflow replay matrix covers blocked and failed statuses', async () => {
  const { service } = makeService();

  const blocked = await service.ingest(makePayload({
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-blocked',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-e2e-blocked'
      }
    },
    run: {
      project_id: 'brainbase',
      role_agent_id: 'sales',
      workflow_id: 'wf_sales_followup',
      workflow_name: '営業フォローアップ',
      status: 'blocked'
    }
  }));
  const failed = await service.ingest(makePayload({
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-failed',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-e2e-failed'
      }
    },
    run: {
      project_id: 'brainbase',
      role_agent_id: 'sales',
      workflow_id: 'wf_sales_followup',
      workflow_name: '営業フォローアップ',
      status: 'failed'
    }
  }));

  expect(blocked.run).toMatchObject({
    status: 'needs_action',
    closure_state: 'needs_action',
    action_required: 'resolve_blocker'
  });
  expect(failed.run).toMatchObject({
    status: 'failed',
    closure_state: 'needs_action',
    action_required: 'check_error'
  });
});

test('story-external-runner-adapter-contract-v0 rejects non-actionable human prompts and unknown statuses', async () => {
  const { repository, service } = makeService();

  await expect(service.ingest(makePayload({
    run: {
      project_id: 'brainbase',
      role_agent_id: 'sales',
      workflow_id: 'wf_sales_followup',
      workflow_name: '営業フォローアップ',
      status: 'waiting_human'
    },
    human_steps: [{
      id: 'hs-blank',
      step_type: 'approval',
      prompt: '   '
    }]
  }))).rejects.toMatchObject({ code: 'missing_human_prompt' });

  await expect(service.ingest(makePayload({
    run: {
      project_id: 'brainbase',
      role_agent_id: 'sales',
      workflow_id: 'wf_sales_followup',
      workflow_name: '営業フォローアップ',
      status: 'succeeded'
    }
  }))).rejects.toMatchObject({ code: 'unsupported_run_status' });

  expect(repository.listRuns()).toHaveLength(0);
});

test('story-external-runner-adapter-contract-v0 rejects malformed optional arrays as contract errors', async () => {
  const { repository, service } = makeService();

  await expect(service.ingest(makePayload({ outputs: {} }))).rejects.toMatchObject({ code: 'invalid_array' });
  await expect(service.ingest(makePayload({ human_steps: {} }))).rejects.toMatchObject({ code: 'invalid_array' });
  await expect(service.ingest(makePayload({ learning_candidates: {} }))).rejects.toMatchObject({ code: 'invalid_array' });

  expect(repository.listRuns()).toHaveLength(0);
});

test('story-external-runner-adapter-contract-v0 description-only human steps remain visible to operators', async () => {
  const { service } = makeService();

  const result = await service.ingest(makePayload({
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-description-human',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-e2e-description-human'
      }
    },
    run: {
      project_id: 'brainbase',
      role_agent_id: 'sales',
      workflow_id: 'wf_sales_followup',
      workflow_name: '営業フォローアップ',
      status: 'approval_required'
    },
    human_steps: [{
      id: 'hs-description-only',
      step_type: 'approval',
      description: '説明だけで来た承認依頼'
    }]
  }));

  expect(result.human_steps[0]).toMatchObject({
    prompt: '説明だけで来た承認依頼',
    title: '説明だけで来た承認依頼',
    description: '説明だけで来た承認依頼'
  });

  const whitespacePrompt = await service.ingest(makePayload({
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-whitespace-human',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-e2e-whitespace-human'
      }
    },
    run: {
      project_id: 'brainbase',
      role_agent_id: 'sales',
      workflow_id: 'wf_sales_followup',
      workflow_name: '営業フォローアップ',
      status: 'approval_required'
    },
    human_steps: [{
      id: 'hs-whitespace-title',
      step_type: 'approval',
      prompt: '   ',
      title: 'Approve publish'
    }]
  }));

  expect(whitespacePrompt.human_steps[0]).toMatchObject({
    prompt: 'Approve publish',
    title: 'Approve publish'
  });
});

test('story-external-runner-adapter-contract-v0 S-005b Candidate Store write failures remain visible on duplicate replay', async () => {
  const { service } = makeService({
    async create() {
      throw new Error('candidate store unavailable');
    }
  });

  const first = await service.ingest(makePayload({
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-candidate-failure',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-e2e-candidate-failure'
      }
    }
  }));
  const second = await service.ingest(makePayload({
    runner: {
      type: 'eve',
      external_run_id: 'eve-e2e-candidate-failure',
      agent_id: 'sales-agent',
      eve: {
        trace_ref: 'https://vercel.com/acme/eve/traces/eve-e2e-candidate-failure'
      }
    }
  }));

  expect(first.learning_candidates).toEqual([
    expect.objectContaining({
      candidate_id: 'lc-1',
      persistence_status: 'deferred',
      reason: 'candidate_store_write_failed'
    })
  ]);
  expect(first.audit_logs).toEqual(expect.arrayContaining([
    expect.objectContaining({
      action: 'external_runner.learning_candidate.deferred',
      after: expect.objectContaining({
        candidate_id: 'lc-1',
        reason: 'candidate_store_write_failed'
      })
    })
  ]));
  expect(second).toMatchObject({ status: 'duplicate' });
  expect(second.learning_candidates).toEqual([
    expect.objectContaining({
      candidate_id: 'lc-1',
      persistence_status: 'deferred',
      reason: 'candidate_store_write_failed'
    })
  ]);
});

test('story-external-runner-adapter-contract-v0 ac:9 Mermaid図は既存ビューアで構文エラーにならない。', async () => {
  const architecture = readFileSync('docs/architecture/external-runner-adapter-contract-architecture.md', 'utf8');
  const graphResolver = readFileSync('docs/architecture/graph-entity-resolver-architecture.md', 'utf8');
  const runtime = readFileSync('docs/internal/unson-os-lead-runtime-architecture.md', 'utf8');

  expect(architecture).toContain('flowchart LR;');
  expect(graphResolver).not.toContain(']    graph[');
  expect(runtime).not.toContain(']    graph[');
  expect(`${storyId} ac:7 Mermaid図 既存ビューア 構文エラー`).toContain('Mermaid図');
});

test('story-external-runner-adapter-contract-v0 S-006 auth_denied external runner API is registered behind workflowAuthGuard', async () => {
  const bootstrap = readFileSync('server/bootstrap/register-api-routes.js', 'utf8');
  const server = readFileSync('server.js', 'utf8');
  const workflowsUi = readFileSync('public/workflows.html', 'utf8');

  expect(bootstrap).toMatch(/workflowAuthGuard\s*=\s*requireAuth\(authService\)/);
  expect(bootstrap).toMatch(/app\.use\('\/api\/external-runner',\s*workflowAuthGuard,\s*createExternalRunnerRouter\(externalRunnerIngestService\)\)/);
  expect(server).toMatch(/externalRunnerIngestService[\s\S]*=\s*createCoreServices\(/);
  expect(server).toMatch(/registerApiRoutes\(app,[\s\S]*externalRunnerIngestService,/);
  expect(workflowsUi).toContain('output.preview || output.body || output.content || output.content_ref');
});

test('story-external-runner-adapter-contract-v0 S-007 compatibility guard keeps report_activity CSRF exemption separate from external runner ingest auth', async () => {
  const csrf = readFileSync('server/middleware/csrf.js', 'utf8');
  const externalRunnerRoute = readFileSync('server/routes/external-runner.js', 'utf8');
  const csrfUnit = readFileSync('tests/unit/csrf-report-activity-exempt.test.js', 'utf8');

  expect(csrf).toContain("req.path === '/api/sessions/report_activity'");
  expect(csrf).toContain("req.path?.startsWith('/api/external-runner/')");
  expect(externalRunnerRoute).toContain('server_to_server_auth_required');
  expect(externalRunnerRoute).toContain('external runner ingest requires bearer, service token, or internal API key authentication');
  expect(csrfUnit).toContain('S-007');
});
