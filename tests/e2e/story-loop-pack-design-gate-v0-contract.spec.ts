import { test, expect } from '@playwright/test';
import express from 'express';
import { readFileSync } from 'node:fs';
import request from 'supertest';

import { createWorkflowRouter } from '../../server/routes/workflows.js';
import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import {
  WorkflowService,
  createBrainbaseAliveWorkflow,
  createDefaultWorkflowHandlers
} from '../../server/services/workflow/workflow-service.js';

const storyId = 'story-loop-pack-design-gate-v0';

function makeRuntimeApp() {
  const repository = new InMemoryWorkflowRepository({
    seedWorkflows: [createBrainbaseAliveWorkflow()]
  });
  const runner = new WorkflowRunner({
    repository,
    handlers: createDefaultWorkflowHandlers()
  });
  const configParser = {
    async getProjects() {
      return {
        root: '/workspace',
        projects: [
          { id: 'sample-project', session_select: true, aliases: ['salestailor'] }
        ]
      };
    }
  };
  const service = new WorkflowService({ repository, runner, configParser });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { sub: 'sato', role: 'member' };
    req.access = {
      personId: 'sato',
      projectCodes: ['sample-project'],
      role: 'member'
    };
    req.authSource = 'test';
    next();
  });
  app.use('/api/workflows', createWorkflowRouter(service, {
    meetingAutomationService: service.meetingAutomationService
  }));
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return { app, repository };
}

function readArtifacts() {
  return {
    story: readFileSync('docs/stories/story-loop-pack-design-gate-v0.md', 'utf8'),
    architecture: readFileSync('docs/architecture/loop-pack-design-gate-architecture.md', 'utf8'),
    spec: readFileSync('docs/specs/story-loop-pack-design-gate-v0-spec.md', 'utf8'),
    gate: readFileSync('server/services/workflow/loop-pack-design-gate.js', 'utf8'),
    meetingPack: readFileSync('server/services/workflow/meeting-workflow-pack.js', 'utf8'),
    workflowService: readFileSync('server/services/workflow/workflow-service.js', 'utf8'),
    meetingAutomationService: readFileSync('server/services/meeting-automation/meeting-automation-service.js', 'utf8'),
    workflowRoutes: readFileSync('server/routes/workflows.js', 'utf8'),
    gateTest: readFileSync('tests/server/services/loop-pack-design-gate.test.js', 'utf8'),
    serviceTest: readFileSync('tests/server/services/workflow-org-agent-control.test.js', 'utf8'),
    routeTest: readFileSync('tests/server/routes/workflows.test.js', 'utf8')
  };
}

test.describe(storyId, () => {
  test(`${storyId} ac1 Pack manifest required sections are contract and code`, async () => {
    const artifacts = readArtifacts();

    expect(artifacts.story, 'ac1 manifest required section target_business_process').toContain('target_business_process');
    expect(artifacts.story).toContain('completion_rubric');
    expect(artifacts.gate).toContain('REQUIRED_SECTIONS');
    expect(artifacts.meetingPack).toContain('buildMeetingWorkflowPackManifest');
  });

  test(`${storyId} ac2 Design Gate is deterministic before Pack creation`, async () => {
    const artifacts = readArtifacts();

    expect(artifacts.story, 'ac2 deterministic design gate review').toContain('deterministic');
    expect(artifacts.spec).toContain('LLM呼び出しに依存しない');
    expect(artifacts.gate).toContain('reviewLoopPackDesign');
  });

  test(`${storyId} ac3 Passing Meeting Workflow Pack compiles to existing control records`, async () => {
    const artifacts = readArtifacts();
    const meetingAutomationRuntime = artifacts.workflowService + artifacts.meetingAutomationService;

    expect(meetingAutomationRuntime, 'ac3 passing pack compiles to Workflow Control records').toContain('bootstrapPack');
    expect(meetingAutomationRuntime).toContain('upsertRoleAgentInstance');
    expect(meetingAutomationRuntime).toContain('upsertWorkflowTemplate');
    expect(artifacts.serviceTest).toContain('bootstraps meeting pack records into Workflow Control data');
  });

  test(`${storyId} ac4 Bootstrap returns and audits loop_pack_design_review`, async () => {
    const artifacts = readArtifacts();

    expect(artifacts.workflowService + artifacts.meetingAutomationService, 'ac4 bootstrap returns design review evidence').toContain('loop_pack_design_review');
    expect(artifacts.routeTest).toContain('manifest_digest');
    expect(artifacts.serviceTest).toContain('workflow.meeting_pack.bootstrapped');
  });

  test(`${storyId} ac5 needs_revision bootstrap writes no Workflow Control records`, async () => {
    const artifacts = readArtifacts();

    expect(artifacts.workflowService + artifacts.meetingAutomationService, 'ac5 needs_revision blocks bootstrap before writes').toContain('loop pack design gate did not pass');
    expect(artifacts.serviceTest).toContain('blocks meeting pack bootstrap before writes when design review needs revision');
    expect(artifacts.serviceTest).toContain('listAuditLogs({ targetId:');
  });

  test(`${storyId} ac3 ac4 runtime design-review API is no-write before bootstrap`, async () => {
    const { app, repository } = makeRuntimeApp();

    const res = await request(app)
      .post('/api/workflows/control/meeting-pack/design-review')
      .send({ org_id: 'sample-project', project_id: 'sample-project' })
      .expect(200);

    expect(res.body.meeting_workflow_pack_design.loop_pack_design_review.status, 'ac3 runtime design gate passes before import').toBe('pass');
    expect(res.body.meeting_workflow_pack_design.loop_pack_design_review.manifest_digest, 'ac4 runtime design review has digest evidence').toMatch(/^[a-f0-9]{64}$/);
    expect(repository.listRoleAgentInstances({ orgId: 'sample-project', projectId: 'sample-project' }), 'ac3 design-review does not create role agents').toHaveLength(0);
    expect(repository.listWorkflowTemplates({ orgId: 'sample-project', projectId: 'sample-project', workflowKind: 'meeting' }), 'ac3 design-review does not create templates').toHaveLength(0);
    expect(repository.listAuditLogs({ targetId: 'mana-meeting-workflow-pack-v1' }), 'ac4 design-review does not audit before import').toHaveLength(0);
  });

  test(`${storyId} ac3 ac4 runtime bootstrap writes records and audits design review`, async () => {
    const { app, repository } = makeRuntimeApp();

    const res = await request(app)
      .post('/api/workflows/control/meeting-pack/bootstrap')
      .send({ org_id: 'sample-project', project_id: 'sample-project' })
      .expect(201);

    expect(res.body.loop_pack_design_review.status, 'ac3 runtime bootstrap imports only passing pack').toBe('pass');
    expect(res.body.meeting_workflow_pack.workflow_templates, 'ac3 runtime bootstrap creates workflow templates').toHaveLength(5);
    expect(res.body.meeting_workflow_pack.workflow_triggers, 'ac3 runtime bootstrap creates trigger-reachable bindings').toHaveLength(10);
    expect(repository.ledger.runs, 'ac3 bootstrap does not create runtime runs').toHaveLength(0);
    expect(repository.ledger.outputs, 'ac3 bootstrap does not create runtime outputs').toHaveLength(0);
    expect(repository.ledger.human_steps, 'ac3 bootstrap does not create runtime human steps').toHaveLength(0);
    expect(repository.listAuditLogs({ targetId: 'mana-meeting-workflow-pack-v1' })[0].after.loop_pack_design_review, 'ac4 audit stores design review status and digest').toMatchObject({
      status: 'pass',
      manifest_digest: res.body.loop_pack_design_review.manifest_digest
    });
  });

  test(`${storyId} ac6 Pack creation rejects hidden runtime state mutation`, async () => {
    const artifacts = readArtifacts();

    expect(artifacts.story, 'ac6 hidden runtime state mutation is rejected').toContain('隠れたruntime state');
    expect(artifacts.gate).toContain('direct_runtime_state_mutation');
    expect(artifacts.gateTest).toContain('direct_runtime_mutation_not_for_pack_creation');
  });

  test(`${storyId} ac7 Meeting Pack has loop closure rubric`, async () => {
    const artifacts = readArtifacts();

    expect(artifacts.story, 'ac7 loop closure rubric is required').toContain('Loop closure');
    expect(artifacts.meetingPack).toContain('loop_closure');
    expect(artifacts.gateTest).toContain('completion_rubric');
  });

  test(`${storyId} ac8 Design Gate is contract gate, not AI judge`, async () => {
    const artifacts = readArtifacts();

    expect(artifacts.story, 'ac8 deterministic contract gate is not an AI judge').toContain('AI judgeではなく');
    expect(artifacts.spec).toContain('deterministicに動き');
    expect(artifacts.gate).not.toContain('openai');
  });

  test(`${storyId} S-001 passing Meeting Pack design review`, async () => {
    const artifacts = readArtifacts();

    expect(artifacts.spec).toContain('### S-001');
    expect(artifacts.gateTest).toContain('passes the Meeting Workflow Pack manifest');
    expect(artifacts.gateTest).toContain("status: 'pass'");
  });

  test(`${storyId} S-002 bootstrap stores design review evidence`, async () => {
    const artifacts = readArtifacts();

    expect(artifacts.spec).toContain('### S-002');
    expect(artifacts.routeTest).toContain('exposes meeting pack bootstrap under Workflow Control namespace');
    expect(artifacts.routeTest).toContain('loop_pack_design_review');
  });

  test(`${storyId} S-003 missing completion rubric blocks Pack import`, async () => {
    const artifacts = readArtifacts();

    expect(artifacts.spec).toContain('### S-003');
    expect(artifacts.gateTest).toContain('blocks a manifest without completion rubric');
    expect(artifacts.gateTest).toContain('missing_loop_closure_rubric');
  });

  test(`${storyId} flow_replay artifact_replay scenario_clause_e2e coverage marker`, async () => {
    const artifacts = readArtifacts();

    expect(artifacts.routeTest).toContain('/api/workflows/control/meeting-pack/design-review');
    expect(artifacts.routeTest).toContain('/api/workflows/control/meeting-pack/bootstrap');
    expect(artifacts.architecture).toContain('状態図');
    expect('flow_replay artifact_replay scenario_clause_e2e').toContain('scenario_clause_e2e');
  });
});
