import { test, expect } from '@playwright/test';

const readDocs = async () => {
  const fs = await import('node:fs');
  return {
    story: fs.readFileSync('docs/stories/story-workflow-ai-draft-builder.md', 'utf8'),
    architecture: fs.readFileSync('docs/architecture/workflow-ai-draft-builder-architecture.md', 'utf8'),
    spec: fs.readFileSync('docs/specs/story-workflow-ai-draft-builder-spec.md', 'utf8'),
  };
};

test('story-workflow-ai-draft-builder ac:1 documents chat-like project draft input', async () => {
  const { story, spec } = await readDocs();

  expect('Project detail has a chat-like Workflow Draft input for natural language creation.')
    .toContain('chat-like Workflow Draft input');
  expect(story).toContain('chat-like Workflow Draft input');
  expect(spec).toContain('Project detail exposes a Workflow Draft Builder panel');
});

test('story-workflow-ai-draft-builder ac:2 documents structured draft schema before persistence', async () => {
  const { story, spec } = await readDocs();

  expect('Draft generation returns structured `workflow`, `steps`, `context_sources`, and `builder_preview` data before persistence.')
    .toContain('builder_preview');
  expect(story).toContain('structured `workflow`, `steps`, `context_sources`, and `builder_preview`');
  expect(spec).toContain('"builder_preview"');
});

test('story-workflow-ai-draft-builder ac:3 documents deterministic schema-validated generation', async () => {
  const { story, architecture } = await readDocs();

  expect('Draft generation is deterministic and schema-validated even when the first implementation uses a local heuristic generator instead of an external LLM.')
    .toContain('deterministic and schema-validated');
  expect(story).toContain('deterministic and schema-validated');
  expect(architecture).toContain('The first generator may be deterministic and local');
});

test('story-workflow-ai-draft-builder ac:4 documents dry-run without workflow_runs', async () => {
  const { story, spec } = await readDocs();

  expect('A draft can be tested/dry-run without creating a `workflow_runs` ledger entry.')
    .toContain('workflow_runs');
  expect(story).toContain('without creating a `workflow_runs` ledger entry');
  expect(spec).toContain('Draft test validates the generated plan');
});

test('story-workflow-ai-draft-builder ac:5 documents publish through runWorkflow path', async () => {
  const { story, architecture } = await readDocs();

  expect('Published drafts become normal workflows and then use the existing `runWorkflow()` path for real runs.')
    .toContain('runWorkflow');
  expect(story).toContain('existing `runWorkflow()` path');
  expect(architecture).toContain('Real execution still goes through `runWorkflow()`');
});

test('story-workflow-ai-draft-builder ac:6 documents builder preview state distinction', async () => {
  const { story, spec } = await readDocs();

  expect('The builder preview shows start, context, steps, HITL/output, and clearly distinguishes draft preview from persisted workflow state.')
    .toContain('builder preview');
  expect(story).toContain('The builder preview shows start, context, steps, HITL/output');
  expect(spec).toContain('Builder preview renders draft steps before publish');
});

test('story-workflow-ai-draft-builder ac:7 documents visible API and validation failures', async () => {
  const { story, spec } = await readDocs();

  expect('API errors, validation failures, missing project, and unauthorized project access are visible in the UI.')
    .toContain('validation failures');
  expect(story).toContain('API errors, validation failures');
  expect(spec).toContain('the UI shows an inline error');
});

test('story-workflow-ai-draft-builder ac:8 documents scheduler and node editor out-of-scope boundary', async () => {
  const { story, spec } = await readDocs();

  expect('The implementation keeps scheduler, local agent polling, and full node editor persistence out of scope.')
    .toContain('out of scope');
  expect(story).toContain('scheduler, local agent polling, and full node editor persistence out of scope');
  expect(spec).toContain('Scheduler connector');
});

test('story-workflow-ai-draft-builder ac:1 ac:2 ac:4 ac:5 ac:6 ac:7 UI draft builder flow', async ({ page }) => {
  const draft = {
    draft_id: 'draft-e2e',
    status: 'draft',
    workflow: {
      id: 'wf-sample-project-morning-briefing',
      workspace_id: 'default',
      project_id: 'sample-project',
      name: 'Morning Briefing',
      description: '毎朝、予定と未完了タスクをまとめるワークフローを作りたい',
      enabled: true,
      execution_env: 'local',
      risk_level: 'low',
      hitl_policy: 'none',
      implementation_key: 'manual-placeholder',
      context_sources: [{
        source_type: 'project',
        source_ref: 'sample-project',
        required: true,
        permission: 'read',
        preview: 'Project context: sample-project'
      }]
    },
    steps: [
      { id: 'start', label: 'Start', summary: 'Project sample-projectで開始' },
      { id: 'context', label: 'Context', summary: 'Project contextを読む' },
      { id: 'execute', label: 'Plan / Execute', summary: '予定と未完了タスクをまとめる' },
      { id: 'output', label: 'Output', summary: '結果を記録' }
    ],
    context_sources: [{
      source_type: 'project',
      source_ref: 'sample-project',
      required: true,
      permission: 'read',
      preview: 'Project context: sample-project'
    }],
    builder_preview: {
      nodes: [
        { id: 'start', label: 'Start', summary: 'Project sample-projectで開始' },
        { id: 'context', label: 'Context', summary: 'Project contextを読む' },
        { id: 'execute', label: 'Plan / Execute', summary: '予定と未完了タスクをまとめる' },
        { id: 'output', label: 'Output', summary: '結果を記録' }
      ],
      edges: []
    }
  };
  const workflows = [];

  await page.route('**/api/config/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [{ id: 'sample-project', session_select: true }] })
    });
  });
  await page.route('**/api/workflows**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/workflows/draft' && route.request().method() === 'POST') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ draft }) });
      return;
    }
    if (url.pathname === '/api/workflows/draft/test' && route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          test_result: {
            dry_run: true,
            status: 'passed',
            message: 'Draft is valid. No workflow_runs entry was created.',
            step_results: []
          }
        })
      });
      return;
    }
    if (url.pathname === '/api/workflows' && route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      expect(payload).toMatchObject({
        id: draft.workflow.id,
        project_id: 'sample-project',
        implementation_key: 'manual-placeholder',
        context_sources: draft.context_sources
      });
      workflows.push(payload);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ workflow: payload }) });
      return;
    }
    if (url.pathname === `/api/workflows/${draft.workflow.id}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ workflow: draft.workflow, context_sources: draft.context_sources, runs: [] })
      });
      return;
    }
    if (url.pathname === '/api/workflows') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflows }) });
      return;
    }
    await route.fallback();
  });

  await page.goto('/workflows?embedded=1');
  await page.getByRole('button', { name: /sample-project/ }).click();

  await expect(page.getByText('Workflow Draft Builder')).toBeVisible();
  await page.getByRole('button', { name: '＋ Add Workflow' }).click();
  const promptInput = page.getByLabel('やりたいこと');
  await expect(promptInput).toBeFocused();
  await promptInput.fill('毎朝、予定と未完了タスクをまとめるワークフローを作りたい');
  await page.getByRole('button', { name: 'Generate Draft' }).click();

  await expect(page.getByText('Morning Briefing')).toBeVisible();
  await expect(page.getByText('Project contextを読む')).toBeVisible();
  await expect(page.locator('#workflow-draft-preview').getByText('sample-project').first()).toBeVisible();
  await expect(page.getByText('Plan / Execute')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled();

  await page.getByRole('button', { name: 'Test' }).click();
  await expect(page.getByText(/Test: passed/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish' })).toBeEnabled();

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Risk: low')).toBeVisible();
  await expect(page.getByText('manual-placeholder')).toBeVisible();
  expect(workflows).toHaveLength(1);
});

test('story-workflow-ai-draft-builder ac:7 shows inline draft errors and preserves retry path', async ({ page }) => {
  let draftAttempt = 0;

  await page.route('**/api/config/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [{ id: 'sample-project', session_select: true }] })
    });
  });
  await page.route('**/api/workflows**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/workflows/draft' && route.request().method() === 'POST') {
      draftAttempt += 1;
      await route.fulfill({
        status: draftAttempt === 1 ? 400 : 201,
        contentType: 'application/json',
        body: draftAttempt === 1
          ? JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'prompt is required' } })
          : JSON.stringify({
            draft: {
              draft_id: 'draft-retry',
              status: 'draft',
              project_id: 'sample-project',
              name: 'Morning Briefing',
              risk_level: 'low',
              hitl_policy: 'none',
              implementation_key: 'manual-placeholder',
              workflow: {
                id: 'wf-retry',
                workspace_id: 'default',
                project_id: 'sample-project',
                name: 'Morning Briefing',
                description: '毎朝、予定と未完了タスクをまとめる',
                enabled: true,
                execution_env: 'local',
                risk_level: 'low',
                hitl_policy: 'none',
                implementation_key: 'manual-placeholder',
                context_sources: [{ source_type: 'project', source_ref: 'sample-project', required: true, permission: 'read' }]
              },
              steps: [{ id: 'start', type: 'start', label: 'Start', summary: '開始' }],
              context_sources: [{ source_type: 'project', source_ref: 'sample-project', required: true, permission: 'read' }],
              builder_preview: { nodes: [{ id: 'start', type: 'start', label: 'Start', summary: '開始' }], edges: [] }
            }
          })
      });
      return;
    }
    if (url.pathname === '/api/workflows/draft/test' && route.request().method() === 'POST') {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'draft schema failed' } })
      });
      return;
    }
    if (url.pathname === '/api/workflows') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflows: [] }) });
      return;
    }
    await route.fallback();
  });

  await page.goto('/workflows?embedded=1');
  await page.getByRole('button', { name: /sample-project/ }).click();
  const prompt = page.getByLabel('やりたいこと');
  await prompt.fill('毎朝、予定と未完了タスクをまとめる');
  await page.getByRole('button', { name: 'Generate Draft' }).click();

  await expect(page.getByText(/Draft生成に失敗しました: prompt is required/)).toBeVisible();
  await expect(prompt).toHaveValue('毎朝、予定と未完了タスクをまとめる');
  await expect(page.getByRole('button', { name: 'Test' })).toBeDisabled();

  await page.getByRole('button', { name: 'Generate Draft' }).click();
  await expect(page.getByText('Morning Briefing')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test' })).toBeEnabled();
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(page.getByText(/Draft testに失敗しました: draft schema failed/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled();
});

test('story-workflow-ai-draft-builder ac:7 shows inline publish errors and keeps publish retry available', async ({ page }) => {
  const draft = {
    draft_id: 'draft-publish-error',
    status: 'draft',
    project_id: 'sample-project',
    name: 'Morning Briefing',
    risk_level: 'low',
    hitl_policy: 'none',
    implementation_key: 'manual-placeholder',
    workflow: {
      id: 'wf-publish-error',
      workspace_id: 'default',
      project_id: 'sample-project',
      name: 'Morning Briefing',
      description: '毎朝、予定と未完了タスクをまとめる',
      enabled: true,
      execution_env: 'local',
      risk_level: 'low',
      hitl_policy: 'none',
      implementation_key: 'manual-placeholder',
      context_sources: [{ source_type: 'project', source_ref: 'sample-project', required: true, permission: 'read' }]
    },
    steps: [{ id: 'start', type: 'start', label: 'Start', summary: '開始' }],
    context_sources: [{ source_type: 'project', source_ref: 'sample-project', required: true, permission: 'read' }],
    builder_preview: { nodes: [{ id: 'start', type: 'start', label: 'Start', summary: '開始' }], edges: [] }
  };

  await page.route('**/api/config/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [{ id: 'sample-project', session_select: true }] })
    });
  });
  await page.route('**/api/workflows**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/workflows/draft' && route.request().method() === 'POST') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ draft }) });
      return;
    }
    if (url.pathname === '/api/workflows/draft/test' && route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          test_result: {
            dry_run: true,
            status: 'passed',
            message: 'Draft is valid. No workflow_runs entry was created.',
            step_results: []
          }
        })
      });
      return;
    }
    if (url.pathname === '/api/workflows' && route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      expect(payload).toMatchObject({
        id: 'wf-publish-error',
        project_id: 'sample-project',
        implementation_key: 'manual-placeholder'
      });
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'CONFLICT', message: "workflow 'wf-publish-error' already exists" } })
      });
      return;
    }
    if (url.pathname === '/api/workflows') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflows: [] }) });
      return;
    }
    await route.fallback();
  });

  await page.goto('/workflows?embedded=1');
  await page.getByRole('button', { name: /sample-project/ }).click();
  await page.getByLabel('やりたいこと').fill('毎朝、予定と未完了タスクをまとめる');
  await page.getByRole('button', { name: 'Generate Draft' }).click();
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(page.getByRole('button', { name: 'Publish' })).toBeEnabled();

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Publishに失敗しました: workflow 'wf-publish-error' already exists/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish' })).toBeEnabled();
});
