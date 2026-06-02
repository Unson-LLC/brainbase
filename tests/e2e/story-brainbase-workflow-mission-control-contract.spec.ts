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

test('story-brainbase-workflow-mission-control ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 foundation contract', async () => {
  const story = await import('node:fs').then((fs) => fs.readFileSync('docs/stories/story-brainbase-workflow-mission-control.md', 'utf8'));
  const spec = await import('node:fs').then((fs) => fs.readFileSync('docs/specs/story-brainbase-workflow-mission-control-spec.md', 'utf8'));
  const architecture = await import('node:fs').then((fs) => fs.readFileSync('docs/architecture/brainbase-workflow-mission-control-architecture.md', 'utf8'));
  const design = await import('node:fs').then((fs) => fs.readFileSync('docs/design/brainbase-workflow-project-first-ux.md', 'utf8'));

  // story-brainbase-workflow-mission-control ac:1 path: docs/architecture/brainbase-workflow-mission-control-architecture.md
  expect(story).toContain('path: docs/architecture/brainbase-workflow-mission-control-architecture.md');
  expect(story).toContain('Workflow Mission Control の全体 Story / Architecture / Spec が存在する');
  // story-brainbase-workflow-mission-control ac:2 path: docs/architecture/ADR-015-workflow-mission-control-project-first-ui.md
  expect(story).toContain('path: docs/architecture/ADR-015-workflow-mission-control-project-first-ui.md');
  expect(architecture).toContain('Project Detail');
  // story-brainbase-workflow-mission-control ac:3 path: docs/specs/story-brainbase-workflow-mission-control-spec.md
  expect(story).toContain('path: docs/specs/story-brainbase-workflow-mission-control-spec.md');
  expect(story).toContain('Workflow は `workspace_id` と `project_id` を必須にする');
  // story-brainbase-workflow-mission-control ac:4 story-workflow-mission-control-foundation
  expect(story).toContain('story-workflow-mission-control-foundation');
  expect(story).toContain('path: docs/design/brainbase-workflow-project-first-ux.md');
  expect(story).toContain('Project-first UX の design doc が存在し、Workspace / Project / Workflow / Run detail の画面責務が明記されている');
  expect(design).toContain('Workspace Home');
  expect(design).toContain('Project Detail');
  expect(design).toContain('Workflow Detail');
  expect(design).toContain('Run Detail / Trace');
  expect(spec).toContain('UI-001: Workspace home project cards');
  expect(spec).toContain('UI-002: Project detail owns workflow browsing and creation');
  expect(spec).toContain('UI-003: Global `/workflows` is an operational inbox');
  expect(spec).toContain('UI-006: Run detail / trace');
  expect(spec).toContain('UI-007: Context binding visibility');
  expect(spec).toContain('Workflow の `project_id` は、Brainbase の Session 作成時に選択する既存 Project と同じ概念を使う');
  expect(spec).toContain('空の `projectCodes` を unrestricted として扱わない');
  expect(spec).toContain('空 grant unrestricted は UI selector logic に限定する');
  // story-brainbase-workflow-mission-control ac:5 story-workflow-project-context-binding
  expect(story).toContain('story-workflow-project-context-binding');
  expect(spec).toContain('owner_id');
  // story-brainbase-workflow-mission-control ac:6 story-workflow-run-ledger-core-runner
  expect(story).toContain('story-workflow-run-ledger-core-runner');
  // story-brainbase-workflow-mission-control ac:7 Workflow は context_sources を持ち、UI で何の context を使うか見える方針が明記されている。
  expect(spec).toContain('context_sources');
  // story-brainbase-workflow-mission-control ac:8 story-workflow-dashboard-v0
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
  // story-workflow-ai-draft-builder: chat prompt -> draft -> builder preview -> dry-run -> publish
  expect(story).toContain('story-workflow-ai-draft-builder');
  const draftStory = await import('node:fs').then((fs) => fs.readFileSync('docs/stories/story-workflow-ai-draft-builder.md', 'utf8'));
  const draftSpec = await import('node:fs').then((fs) => fs.readFileSync('docs/specs/story-workflow-ai-draft-builder-spec.md', 'utf8'));
  const draftArchitecture = await import('node:fs').then((fs) => fs.readFileSync('docs/architecture/workflow-ai-draft-builder-architecture.md', 'utf8'));
  expect(draftStory).toContain('chat-like prompt');
  expect(draftArchitecture).toContain('Draft is not workflow state');
  expect(draftSpec).toContain('POST /api/workflows/draft');
  expect(draftSpec).toContain('Draft test validates the generated plan');
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

  // story-brainbase-workflow-mission-control ac:3 ac:7 Project-first UX and context visibility
  await expect(page.getByRole('heading', { name: 'Workflow Mission Control' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Workspace/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'プロジェクト' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Operational Inbox' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Approval Workflow Project: sample-project/ })).toBeVisible();
  await expect(page.getByText('Project: sample-project / Owner: sato')).toBeVisible();
  await expect(page.getByRole('button', { name: /Action: approve/ })).toBeVisible();
  await expect(page.getByText('Human waiting: yes')).toBeVisible();
  await expect(page.getByText('Planned context')).toBeVisible();
  await expect(page.getByText('project:sample-project').first()).toBeVisible();
  await expect(page.getByText('Resolved context')).toBeVisible();
  await expect(page.getByText('project:sample-project (resolved)')).toBeVisible();
});

test('story-brainbase-workflow-mission-control /workflows preserves shell return and bearer auth', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('brainbase.auth.token', 'workflow-test-token');
  });
  await page.route('**/api/workflows', async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer workflow-test-token');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ workflows: [] })
    });
  });

  await page.goto('/workflows');

  const terminalLink = page.getByRole('link', { name: 'Brainbase terminalへ戻る' });
  await expect(terminalLink).toBeVisible();
  await expect(terminalLink).toHaveAttribute('href', '/');
  await expect(page.getByText('ログインが必要です。')).not.toBeVisible();
});

test('story-brainbase-workflow-mission-control opens inside Brainbase shell without route navigation', async ({ page }) => {
  await page.route('**/api/workflows', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        workflows: [{
          id: 'brainbase-alive',
          name: 'Brainbase Alive',
          project_id: 'general',
          owner_id: 'local-user',
          context_sources: [{ source_type: 'project', source_ref: 'general' }],
          latest_run: { id: 'run-1', status: 'success', action_required: 'none', human_waiting: false },
          latest_context_snapshots: [{ source_type: 'project', source_ref: 'general', status: 'resolved' }]
        }]
      })
    });
  });
  await page.route('**/api/workflows/brainbase-alive', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        workflow: {
          id: 'brainbase-alive',
          name: 'Brainbase Alive',
          project_id: 'general',
          owner_id: 'local-user',
          risk_level: 'low',
          hitl_policy: 'none',
          implementation_key: 'brainbase-alive'
        },
        context_sources: [{ source_type: 'project', source_ref: 'general', required: true, permission: 'read' }],
        runs: [{ id: 'run-1', status: 'success', started_at: '2026-06-01T09:00:00.000Z', action_required: 'none' }]
      })
    });
  });
  await page.route('**/api/config/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [{ id: 'general', session_select: true }] })
    });
  });

  await page.goto('/');
  await page.locator('#ab-workflows-btn').click();

  await expect(page.locator('#activity-bar')).toBeVisible();
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#workflows-overlay.open')).toBeVisible();
  await expect(page.locator('#session-context-bar')).toHaveCSS('display', 'none');
  await expect(page.locator('#terminal-header')).toHaveCSS('display', 'none');
  await expect(page.locator('#terminal-stage')).toHaveCSS('display', 'none');
  await expect(page.locator('#ab-workflows-btn')).toHaveClass(/active/);
  await expect(page).toHaveURL(/\/$/);

  const frame = page.frameLocator('#workflows-overlay-frame');
  await expect(frame.getByRole('heading', { name: 'Workflow Mission Control' })).toBeVisible();
  await expect(frame.locator('.topbar')).toHaveCSS('display', 'none');
  await expect(frame.getByRole('link', { name: 'Brainbase terminalへ戻る' })).toHaveCount(0);
  await frame.getByRole('button', { name: /Brainbase Alive/ }).click();
  await expect(frame.getByRole('heading', { name: 'Brainbase Alive' })).toBeVisible();
  await expect(frame.getByRole('button', { name: '← general' })).toBeVisible();
  await frame.getByRole('button', { name: '← general' }).click();
  await expect(frame.getByRole('heading', { name: 'general' })).toBeVisible();
  await expect(frame.getByRole('button', { name: '← Workspace' })).toBeVisible();
  await frame.getByRole('button', { name: '← Workspace' }).click();
  await expect(frame.getByRole('heading', { name: 'Workflow Mission Control' })).toBeVisible();

  await page.locator('#workflows-back-terminal').click();
  await expect(page.locator('#workflows-overlay.open')).toHaveCount(0);
  await expect(page.locator('#terminal-stage')).not.toHaveCSS('display', 'none');
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
  await expect(page.locator('.error').getByRole('link', { name: 'Brainbase Terminalへ戻る' })).toBeVisible();

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
  // story-brainbase-workflow-mission-control ac:3 ac:7 Project Detail keeps workflow browsing and context in one view.
  await expect(page.getByRole('heading', { name: 'sample-project' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ワークフロー', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ドキュメント / Context' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Approval Workflow Project: sample-project/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Action: approve/ })).toBeVisible();
  await expect(page.getByText('Other Workflow')).not.toBeVisible();
});

test('story-brainbase-workflow-mission-control /workflows covers detail and action network failures', async ({ page }) => {
  let workflowDetailFails = true;
  let runDetailFails = true;
  await page.route('**/api/config/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [{ id: 'sample-project', session_select: true }] })
    });
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/workflows' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workflows: [{
            id: 'approval-workflow',
            name: 'Approval Workflow',
            project_id: 'sample-project',
            owner_id: 'sato',
            context_sources: [{ source_type: 'project', source_ref: 'sample-project' }],
            latest_run: { id: 'run-1', status: 'waiting_human', action_required: 'approve', human_waiting: true },
            latest_context_snapshots: [{ source_type: 'project', source_ref: 'sample-project', status: 'resolved' }]
          }]
        })
      });
      return;
    }
    if (url.pathname === '/api/workflows' && method === 'POST') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'create failed' }) });
      return;
    }
    if (url.pathname === '/api/workflows/approval-workflow' && method === 'GET') {
      if (workflowDetailFails) {
        workflowDetailFails = false;
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'detail failed' }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workflow: {
            id: 'approval-workflow',
            name: 'Approval Workflow',
            project_id: 'sample-project',
            owner_id: 'sato',
            risk_level: 'low',
            hitl_policy: 'approval',
            implementation_key: 'manual-placeholder'
          },
          context_sources: [{ source_type: 'project', source_ref: 'sample-project', required: true, permission: 'read' }],
          runs: [{ id: 'run-1', status: 'waiting_human', started_at: '2026-06-01T09:00:00.000Z', action_required: 'approve' }]
        })
      });
      return;
    }
    if (url.pathname === '/api/workflows/approval-workflow/run' && method === 'POST') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'run failed' }) });
      return;
    }
    if (url.pathname === '/api/workflow-runs/run-1' && method === 'GET') {
      if (runDetailFails) {
        runDetailFails = false;
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'run detail failed' }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          run: { id: 'run-1', workflow_id: 'approval-workflow', project_id: 'sample-project', status: 'waiting_human', trigger_type: 'manual', env: 'local' },
          run_steps: [{ id: 'step-1', step_name: 'human approval', status: 'waiting_human', message: 'Approve external publish' }],
          context_snapshots: [{ source_type: 'project', source_ref: 'sample-project', status: 'resolved', preview: 'project:sample-project' }],
          human_steps: [{ id: 'human-1', step_type: 'approval', status: 'pending', prompt: 'Approve external publish' }],
          outputs: [],
          audit_logs: []
        })
      });
      return;
    }
    if (url.pathname === '/api/workflow-runs/run-1/rerun' && method === 'POST') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'rerun failed' }) });
      return;
    }
    if (url.pathname === '/api/workflow-runs/run-1/human-steps/human-1/resolve' && method === 'POST') {
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not mocked' }) });
  });

  await page.goto('/workflows');
  await page.getByLabel('Project filter').selectOption('sample-project');
  await page.getByLabel('Name').fill('Failure Path');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('保存できません: HTTP 500')).toBeVisible();

  await page.getByRole('button', { name: /Approval Workflow Project: sample-project/ }).click();
  await expect(page.getByText('Workflow を読み込めません: HTTP 500')).toBeVisible();

  await page.getByRole('button', { name: 'approval-workflow' }).click();
  await expect(page.getByRole('heading', { name: 'Approval Workflow' })).toBeVisible();
  await page.getByRole('button', { name: '▷ 実行' }).click();
  await expect(page.getByText('実行できません: HTTP 500')).toBeVisible();

  await page.getByText('run-1').click();
  await expect(page.getByText('Run を読み込めません: HTTP 500')).toBeVisible();

  await page.getByRole('button', { name: 'Approval Workflow' }).click();
  await page.getByText('run-1').click();
  await expect(page.getByRole('heading', { name: 'Run Trace' })).toBeVisible();
  await page.getByRole('button', { name: '↻ Rerun' }).click();
  await expect(page.getByText('再実行できません: HTTP 500')).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('人間判断を処理できません: HTTP 403')).toBeVisible();
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
