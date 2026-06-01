import { test, expect } from '@playwright/test';

import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import {
  WorkflowService,
  createBrainbaseAliveWorkflow,
  createDefaultWorkflowHandlers
} from '../../server/services/workflow/workflow-service.js';

function makeService(extraHandlers = {}) {
  const repository = new InMemoryWorkflowRepository({
    seedWorkflows: [createBrainbaseAliveWorkflow()]
  });
  const runner = new WorkflowRunner({
    repository,
    handlers: {
      ...createDefaultWorkflowHandlers({
        clock: () => new Date('2026-06-01T09:00:00.000Z')
      }),
      ...extraHandlers
    }
  });
  const configParser = {
    async getProjects() {
      return {
        root: '/workspace',
        projects: [
          { id: 'sample-project', session_select: true },
          { id: 'hidden-project', session_select: false }
        ]
      };
    }
  };
  return {
    repository,
    service: new WorkflowService({ repository, runner, configParser })
  };
}

test('story-brainbase-workflow-mission-control ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 foundation contract', async () => {
  const story = await import('node:fs').then((fs) => fs.readFileSync('docs/stories/story-brainbase-workflow-mission-control.md', 'utf8'));
  const spec = await import('node:fs').then((fs) => fs.readFileSync('docs/specs/story-brainbase-workflow-mission-control-spec.md', 'utf8'));
  const architecture = await import('node:fs').then((fs) => fs.readFileSync('docs/architecture/brainbase-workflow-mission-control-architecture.md', 'utf8'));

  // story-brainbase-workflow-mission-control ac:1 path: docs/architecture/brainbase-workflow-mission-control-architecture.md
  expect(story).toContain('path: docs/architecture/brainbase-workflow-mission-control-architecture.md');
  expect(story).toContain('Workflow Mission Control の全体 Story / Architecture / Spec が存在する');
  // story-brainbase-workflow-mission-control ac:2 path: docs/specs/story-brainbase-workflow-mission-control-spec.md
  expect(story).toContain('path: docs/specs/story-brainbase-workflow-mission-control-spec.md');
  expect(story).toContain('Workflow は `workspace_id` と `project_id` を必須にする');
  // story-brainbase-workflow-mission-control ac:3 story-workflow-mission-control-foundation
  expect(story).toContain('story-workflow-mission-control-foundation');
  expect(spec).toContain('Workflow の `project_id` は、Brainbase の Session 作成時に選択する既存 Project と同じ概念を使う');
  expect(spec).toContain('空の `projectCodes` を unrestricted として扱わない');
  expect(spec).toContain('空 grant unrestricted は UI selector logic に限定する');
  // story-brainbase-workflow-mission-control ac:4 story-workflow-project-context-binding
  expect(story).toContain('story-workflow-project-context-binding');
  expect(spec).toContain('owner_id');
  // story-brainbase-workflow-mission-control ac:5 story-workflow-run-ledger-core-runner
  expect(story).toContain('story-workflow-run-ledger-core-runner');
  expect(spec).toContain('context_sources');
  // story-brainbase-workflow-mission-control ac:6 story-workflow-dashboard-v0
  expect(story).toContain('story-workflow-dashboard-v0');
  expect(architecture).toContain('workflow_run_context_snapshots');
  expect(spec).toContain('scheduler connector を実装必須にしない');
  expect(spec).toContain('Node server 内の `setInterval` や in-process cron は、production workflow run の canonical scheduler にしない');
  expect(spec).toContain('scheduler は直接 business logic を呼ばず、`runWorkflow()` に接続し、`trigger_type=local|cron` と `env=local|cloud` を ledger に残す');
  const nonGoals = architecture.slice(architecture.indexOf('## 18. Explicit Non-goals'));
  expect(nonGoals).toContain('- local launchd / Lightsail systemd timer connector をこのStoryで実装する。');
});

test('story-brainbase-workflow-mission-control ac:7 ac:8 ac:9 ac:10 ac:11 ac:12 runWorkflow ledger contract', async () => {
  const { service, repository } = makeService({
    needsHuman: async (ctx) => (
      ctx.humanStepResolution
        ? {
            status: 'success',
            closureState: 'closed',
            actionRequired: 'none',
            message: 'Human approval resumed through runWorkflow',
            outputCount: 1,
            data: { resumed: true }
          }
        : {
            status: 'waiting_human',
            actionRequired: 'approve',
            message: 'Approve external publish',
            humanStep: {
              stepType: 'approval',
              prompt: 'Approve external publish'
            }
          }
    )
  });

  const story = await import('node:fs').then((fs) => fs.readFileSync('docs/stories/story-brainbase-workflow-mission-control.md', 'utf8'));

  // story-brainbase-workflow-mission-control ac:7 story-workflow-human-in-the-loop
  expect(story).toContain('story-workflow-human-in-the-loop');
  // story-brainbase-workflow-mission-control ac:8 story-workflow-routine-integration
  expect(story).toContain('story-workflow-routine-integration');
  // story-brainbase-workflow-mission-control ac:9 どの workspace / project に属する仕事なのか。
  expect(story).toContain('どの workspace / project に属する仕事なのか。');
  const createResult = await service.createWorkflow({
    id: 'project-bound-workflow',
    project_id: 'sample-project',
    name: 'Project Bound Workflow',
    owner_id: 'sato',
    context_sources: [{
      source_type: 'project',
      source_ref: 'sample-project',
      required: true
    }]
  }, { sub: 'sato', projectCodes: ['sample-project'] });
  expect(createResult.workflow.project_id).toBe('sample-project');
  expect(createResult.workflow.owner_id).toBe('sato');
  expect(repository.listWorkflowContextSources(createResult.workflow.id)).toHaveLength(1);

  const runResult = await service.runWorkflow('brainbase-alive', {
    actorId: 'sato',
    projectCodes: ['general'],
    triggerType: 'manual',
    env: 'local'
  });
  // story-brainbase-workflow-mission-control ac:10 どの context を使って AI が判断・生成したのか。
  expect(repository.listContextSnapshots(runResult.run.id)).toHaveLength(1);
  // story-brainbase-workflow-mission-control ac:11 owner / assignee / approver は誰か。
  expect(story).toContain('owner / assignee / approver は誰か。');
  await expect(service.getWorkflow('brainbase-alive')).resolves.toMatchObject({
    workflow: expect.objectContaining({ owner_id: 'local-user' })
  });
  expect(runResult.run.started_by).toBe('sato');
  // story-brainbase-workflow-mission-control ac:12 run が成功したのか、未完了なのか、人間判断待ちなのか。
  expect(story).toContain('run が成功したのか、未完了なのか、人間判断待ちなのか。');
  expect(runResult.run.action_required).toBe('none');
  expect(runResult.run.status).toBe('success');
  expect(runResult.run.closure_state).toBe('closed');
  expect(repository.listRunSteps(runResult.run.id)[0]).toMatchObject({ status: 'success' });
  expect(repository.listOutputs(runResult.run.id)).toHaveLength(1);

  await service.createWorkflow({
    id: 'human-gated-workflow',
    project_id: 'sample-project',
    name: 'Human Gated Workflow',
    owner_id: 'sato',
    implementation_key: 'needsHuman',
    context_sources: [{
      source_type: 'project',
      source_ref: 'sample-project',
      required: true
    }]
  }, { sub: 'sato', projectCodes: ['sample-project'] });
  const humanRun = await service.runWorkflow('human-gated-workflow', {
    actorId: 'sato',
    projectCodes: ['sample-project'],
    triggerType: 'manual',
    env: 'local'
  });
  // story-brainbase-workflow-mission-control ac:8
  expect(humanRun.run.status).toBe('waiting_human');
  expect(humanRun.humanStep.status).toBe('pending');
  const resolved = await service.resolveHumanStep(humanRun.humanStep.id, { resolution: 'approved' }, {
    sub: 'sato',
    projectCodes: ['sample-project']
  });
  // story-brainbase-workflow-mission-control ac:11
  expect(resolved.human_step.status).toBe('approved');
  expect(resolved.resumed_run).toMatchObject({
    parent_run_id: humanRun.run.id,
    trigger_type: 'human_resume',
    status: 'success',
    closure_state: 'closed'
  });

  await expect(service.createWorkflow({
    id: 'hidden-project-workflow',
    project_id: 'hidden-project',
    name: 'Hidden Project Workflow'
  }, { sub: 'sato', projectCodes: ['hidden-project'] })).rejects.toThrow("project 'hidden-project' is not selectable");
  // story-brainbase-workflow-mission-control ac:12
  await expect(service.getRun(runResult.run.id)).resolves.toMatchObject({
    run: expect.objectContaining({ id: runResult.run.id }),
    run_steps: expect.any(Array),
    context_snapshots: expect.any(Array),
    outputs: expect.any(Array),
    audit_logs: expect.any(Array)
  });
});

test('story-brainbase-workflow-mission-control /workflows Mission Control surface', async ({ page }) => {
  await page.route('**/api/workflows', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        workflows: [{
          id: 'approval-workflow',
          name: 'Approval Workflow',
          project_id: 'sample-project',
          owner_id: 'sato',
          context_sources: [{
            source_type: 'project',
            source_ref: 'sample-project'
          }],
          latest_run: {
            id: 'run-1',
            status: 'waiting_human',
            action_required: 'approve',
            human_waiting: true,
            finished_at: '2026-06-01T09:00:00.000Z'
          },
          latest_context_snapshots: [{
            source_type: 'project',
            source_ref: 'sample-project',
            status: 'resolved'
          }]
        }]
      })
    });
  });

  await page.goto('/workflows');

  await expect(page.getByRole('heading', { name: 'Workflow Mission Control' })).toBeVisible();
  await expect(page.getByText('Approval Workflow')).toBeVisible();
  await expect(page.getByText('Project: sample-project / Owner: sato')).toBeVisible();
  await expect(page.getByText('Action: approve')).toBeVisible();
  await expect(page.getByText('Human waiting: yes')).toBeVisible();
  await expect(page.getByText('Planned context')).toBeVisible();
  await expect(page.getByText('project:sample-project').first()).toBeVisible();
  await expect(page.getByText('Resolved context')).toBeVisible();
  await expect(page.getByText('project:sample-project (resolved)')).toBeVisible();
});

test('story-brainbase-workflow-mission-control /workflows surfaces auth and API errors visibly', async ({ page }) => {
  await page.route('**/api/workflows', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'unauthorized' })
    });
  });

  await page.goto('/workflows');
  await expect(page.getByText('ログインが必要です。')).toBeVisible();

  await page.unroute('**/api/workflows');
  await page.route('**/api/workflows', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'boom' })
    });
  });
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('Workflow を読み込めません: HTTP 500')).toBeVisible();
});

test('story-brainbase-workflow-mission-control /workflows project filter keeps actionable context visible', async ({ page }) => {
  await page.route('**/api/workflows', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        workflows: [
          {
            id: 'approval-workflow',
            name: 'Approval Workflow',
            project_id: 'sample-project',
            owner_id: 'sato',
            context_sources: [{ source_type: 'project', source_ref: 'sample-project' }],
            latest_run: { id: 'run-1', status: 'waiting_human', action_required: 'approve', human_waiting: true },
            latest_context_snapshots: [{ source_type: 'project', source_ref: 'sample-project', status: 'resolved' }]
          },
          {
            id: 'other-workflow',
            name: 'Other Workflow',
            project_id: 'other-project',
            owner_id: 'sato',
            context_sources: [{ source_type: 'project', source_ref: 'other-project' }],
            latest_run: { id: 'run-2', status: 'success', action_required: 'none', human_waiting: false },
            latest_context_snapshots: [{ source_type: 'project', source_ref: 'other-project', status: 'resolved' }]
          }
        ]
      })
    });
  });

  await page.goto('/workflows');
  await page.getByLabel('Project filter').selectOption('sample-project');
  await expect(page.getByText('Approval Workflow')).toBeVisible();
  await expect(page.getByText('Action: approve')).toBeVisible();
  await expect(page.getByText('Other Workflow')).not.toBeVisible();
});

test('story-brainbase-workflow-mission-control /workflows real API path surfaces latest resolved context', async ({ page, request }) => {
  const headers = {
    'x-brainbase-role': 'member',
    'x-brainbase-projects': 'general'
  };
  const runResponse = await request.post('/api/workflows/brainbase-alive/run', {
    headers,
    data: { trigger_type: 'manual', env: 'local' }
  });
  expect(runResponse.ok()).toBeTruthy();

  await page.setExtraHTTPHeaders(headers);
  await page.goto('/workflows');

  await expect(page.getByRole('heading', { name: 'Workflow Mission Control' })).toBeVisible();
  await expect(page.getByText('Brainbase Alive')).toBeVisible();
  await expect(page.getByText('Project: general / Owner: local-user')).toBeVisible();
  await expect(page.getByText('Resolved context')).toBeVisible();
  await expect(page.getByText('project:general (resolved)')).toBeVisible();
});
