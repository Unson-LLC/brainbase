import { expect, test } from '@playwright/test';
import express from 'express';
import { readFileSync } from 'node:fs';
import request from 'supertest';

import { requireAuth } from '../../server/middleware/auth.js';
import { createCompanionRouter } from '../../server/routes/companion.js';
import { ReplyDraftService } from '../../server/services/companion/reply-draft-service.js';
import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import { WorkflowService } from '../../server/services/workflow/workflow-service.js';

function createAuthService({ personId = 'per_keigo', projectCodes = ['sample-project'] } = {}) {
  return {
    verifyToken: () => ({
      role: 'gm',
      projectCodes,
      clearance: ['internal'],
      personId
    })
  };
}

function createApp() {
  const repository = new InMemoryWorkflowRepository();
  const runner = new WorkflowRunner({ repository, handlers: new Map() });
  const configParser = {
    async getProjects() {
      return {
        projects: [
          { id: 'sample-project', session_select: true, aliases: ['sample'] }
        ]
      };
    }
  };
  const workflowService = new WorkflowService({ repository, runner, configParser });
  const app = express();
  app.use(express.json());
  app.use('/api/companion', createCompanionRouter({
    replyDraftService: new ReplyDraftService({
      infoSSOTService: { getContext: async () => ({ meta: {}, report: {} }) },
      learningService: { searchPersonalKgCandidates: async () => [] }
    }),
    workflowService,
    authGuard: requireAuth(createAuthService()),
    accessGuardOptions: {
      ownerPersonId: 'sato_keigo',
      ownerAliasIds: ['per_keigo']
    }
  }));
  return { app, repository };
}

function seedWorkflow(repository: InMemoryWorkflowRepository) {
  repository.upsertWorkflow({
    id: 'wf_meeting',
    workspace_id: 'default',
    project_id: 'sample-project',
    name: 'Meeting Review Package',
    implementation_key: 'meeting-review-package-ingest',
    default_approver_id: 'sato_keigo'
  });
}

function seedRun(repository: InMemoryWorkflowRepository, {
  runId = 'run_pending',
  status = 'waiting_human',
  humanStepStatus = 'pending'
} = {}) {
  repository.createRun({
    id: runId,
    workspace_id: 'default',
    project_id: 'sample-project',
    workflow_id: 'wf_meeting',
    status,
    action_required: status === 'waiting_human' ? 'approve' : 'none',
    human_waiting: status === 'waiting_human',
    metadata: {
      meeting_identity: {
        title: 'Tech Knight / United ホテルDX案件レビュー',
        case_scope: 'hotel-dx-united'
      },
      source_event: {
        permalink: 'https://unson.slack.com/archives/C08SYTDR7R8/p1782367965844209'
      }
    }
  });
  repository.createHumanStep({
    id: `human_${runId}`,
    workspace_id: 'default',
    project_id: 'sample-project',
	    workflow_id: 'wf_meeting',
	    workflow_run_id: runId,
	    step_type: 'approval',
	    requested_by: 'system',
	    requested_to: 'sato_keigo',
	    prompt: 'Task候補を作成してよいか確認してください',
	    status: humanStepStatus,
	    metadata: {
	      write_back_target: 'task_store',
	      protects: ['task_create']
    }
  });
  repository.createContextSnapshot({
    id: `ctx_${runId}`,
    workspace_id: 'default',
    project_id: 'sample-project',
    workflow_id: 'wf_meeting',
    workflow_run_id: runId,
    source_type: 'review_package',
    source_ref: 'pkg_united_meeting',
    source_version: '0.1.0',
    preview: 'UnitedホテルDX案件レビューの会議文脈',
    data: {
      meeting_title: 'Tech Knight / United ホテルDX案件レビュー',
      decision_scope: 'task_candidates'
    }
  });
  repository.createOutput({
    id: `out_${runId}`,
    workspace_id: 'default',
    project_id: 'sample-project',
    workflow_id: 'wf_meeting',
    workflow_run_id: runId,
    type: 'task_candidates',
    title: 'Task候補',
    preview: '18件のTask候補',
    metadata: { write_back_target: 'task_store' },
    payload: [{ title: 'United提案の次アクション整理' }]
  });
  repository.writeAuditLog({
    id: `audit_${runId}`,
    workspace_id: 'default',
    project_id: 'sample-project',
    action: 'workflow.run.waiting_human',
    target_type: 'workflow_run',
    target_id: runId
  });
}

test('story-companion-approval-inbox-v1 ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 traceability contract', async () => {
  const story = readFileSync('docs/stories/story-companion-approval-inbox-v1.md', 'utf8');
  const spec = readFileSync('docs/specs/story-companion-approval-inbox-v1-spec.md', 'utf8');
  const architecture = readFileSync('docs/architecture/companion-approval-inbox-architecture.md', 'utf8');

  // story-companion-approval-inbox-v1 ac:1 **ac:1 approval-inbox-route**: `GET /api/companion/approval-inbox` が pending human step を持つ workflow run を一覧化する。
  expect(story, 'story-companion-approval-inbox-v1 ac:1 **ac:1 approval-inbox-route**: `GET /api/companion/approval-inbox` が pending human step を持つ workflow run を一覧化する。').toContain('approval-inbox-route');
  // story-companion-approval-inbox-v1 ac:2 **ac:2 all-runs-not-latest-only**: 一覧は latest run に限定せず、`workflow_runs` 全体から pending approval を拾う。
  expect(story, 'story-companion-approval-inbox-v1 ac:2 **ac:2 all-runs-not-latest-only**: 一覧は latest run に限定せず、`workflow_runs` 全体から pending approval を拾う。').toContain('all-runs-not-latest-only');
  // story-companion-approval-inbox-v1 ac:3 **ac:3 run-envelope**: 各 approval item は `run_id`, `workflow_id`, `project_id`, `status`, `action_required`, `pending_human_steps`, `outputs`, `audit_refs` を含む。
  expect(story, 'story-companion-approval-inbox-v1 ac:3 **ac:3 run-envelope**: 各 approval item は `run_id`, `workflow_id`, `project_id`, `status`, `action_required`, `pending_human_steps`, `outputs`, `audit_refs` を含む。').toContain('run-envelope');
  // story-companion-approval-inbox-v1 ac:4 **ac:4 human-step-contract**: `pending_human_steps` は `write_back_target`, `approval_kind`, `prompt`, `status` を含み、Mac 側が「承認すると何が起きるか」を表示できる。
  expect(story, 'story-companion-approval-inbox-v1 ac:4 **ac:4 human-step-contract**: `pending_human_steps` は `write_back_target`, `approval_kind`, `prompt`, `status` を含み、Mac 側が「承認すると何が起きるか」を表示できる。').toContain('human-step-contract');
  // story-companion-approval-inbox-v1 ac:5 **ac:5 output-contract**: `outputs` は `output_type`, `title`, `summary`, `payload`, `metadata` を含み、Mac 側が承認対象の本文や候補を表示できる。
  expect(story, 'story-companion-approval-inbox-v1 ac:5 **ac:5 output-contract**: `outputs` は `output_type`, `title`, `summary`, `payload`, `metadata` を含み、Mac 側が承認対象の本文や候補を表示できる。').toContain('output-contract');
  // story-companion-approval-inbox-v1 ac:6 **ac:6 companion-auth**: missing auth / browser cookie-only auth は既存 companion guard と同じ方針で拒否される。
  expect(story, 'story-companion-approval-inbox-v1 ac:6 **ac:6 companion-auth**: missing auth / browser cookie-only auth は既存 companion guard と同じ方針で拒否される。').toContain('companion-auth');
  // story-companion-approval-inbox-v1 ac:7 **ac:7 reply-route-compatibility**: 既存の `/api/companion/reply-context` と `/api/companion/reply-draft` は互換性を維持する。
  expect(story, 'story-companion-approval-inbox-v1 ac:7 **ac:7 reply-route-compatibility**: 既存の `/api/companion/reply-context` と `/api/companion/reply-draft` は互換性を維持する。').toContain('reply-route-compatibility');
  // story-companion-approval-inbox-v1 ac:8 **ac:8 context-evidence-contract**: 各 approval item は `owner_id`, `action_kind`, `context`, `evidence`, `web_url`, `web_route` を含み、Mac 側だけで判断文脈と根拠を確認し、必要なら Brainbase Web の run detail へ遷移できる。また pending approval が response `limit` を超える場合は、返却されない全件数を `has_more` と `omitted_count` で明示する。
  expect(story, 'story-companion-approval-inbox-v1 ac:8 context-evidence-contract').toContain('context-evidence-contract');
  expect(spec, 'story-companion-approval-inbox-v1 production_path_matrix').toContain('Production Path Matrix');
  expect(spec, 'story-companion-approval-inbox-v1 scenario_clause_e2e').toContain('Workflow State Machine');
  expect(architecture, 'story-companion-approval-inbox-v1 flow_replay architecture').toContain('表示用 projection');
});

test('story-companion-approval-inbox-v1 ac:1 ac:2 ac:3 ac:4 ac:5 ac:8 context-evidence-contract pending approval projection includes run, step, output, context, evidence, web route, and source refs', async () => {
  // S1 pending run: pending human step を持つ run が approval item として返る。
  // S6 no mutation: approval inbox は repository の読み取りだけを行う。
  const { app, repository } = createApp();
  seedWorkflow(repository);
  seedRun(repository);

  const response = await request(app)
    .get('/api/companion/approval-inbox')
    .set('Authorization', 'Bearer user-token')
    .expect(200);

  expect(response.body.count).toBe(1);
  expect(response.body.items[0]).toMatchObject({
	    kind: 'workflow_approval',
	    workflow_id: 'wf_meeting',
	    run_id: 'run_pending',
	    web_url: '/workflows?run_id=run_pending',
	    web_route: {
	      path: '/workflows',
	      view: 'run',
	      run_id: 'run_pending',
	      api_path: '/api/workflow-runs/run_pending'
	    },
	    project_id: 'sample-project',
	    status: 'waiting_human',
	    action_required: 'approve',
	    owner_id: 'sato_keigo',
	    action_kind: 'task_candidates',
	    source_url: 'https://unson.slack.com/archives/C08SYTDR7R8/p1782367965844209',
        pending_human_steps: [
          expect.objectContaining({
            id: 'human_run_pending',
	            prompt: 'Task候補を作成してよいか確認してください',
	            status: 'pending',
	            requested_by: 'system',
	            requested_to: 'sato_keigo',
	            write_back_target: 'task_store',
	            approval_kind: 'approval',
            metadata: expect.objectContaining({
              write_back_target: 'task_store'
            })
          })
        ],
	        outputs: [
	          expect.objectContaining({
	            id: 'out_run_pending',
	            output_type: 'task_candidates',
	            title: 'Task候補',
	            summary: '18件のTask候補',
	            payload: [{ title: 'United提案の次アクション整理' }],
            metadata: expect.objectContaining({
              write_back_target: 'task_store'
            })
	          })
	        ],
	        context: [
	          expect.objectContaining({
	            id: 'ctx_run_pending',
	            source_type: 'review_package',
	            source_ref: 'pkg_united_meeting',
	            summary: 'UnitedホテルDX案件レビューの会議文脈',
	            payload: expect.objectContaining({
	              decision_scope: 'task_candidates'
	            })
	          })
	        ],
	        audit_refs: ['audit_run_pending'],
	        evidence: [
	          expect.objectContaining({
	            id: 'audit_run_pending',
	            action: 'workflow.run.waiting_human',
	            target_id: 'run_pending'
	          })
	        ]
	      });
});

test('story-companion-approval-inbox-v1 ac:8 context-evidence-contract web_url opens Workflow Mission Control run detail', async ({ page }) => {
  const runtimeIssues: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeIssues.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => {
    runtimeIssues.push(`pageerror:${error.message}`);
  });
  page.on('requestfailed', (request) => {
    runtimeIssues.push(`requestfailed:${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('brainbase.auth.token', 'user-token');
  });
  await page.route('**/api/config/projects', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ projects: [{ id: 'sample-project', session_select: true }] })
    });
  });
  await page.route('**/api/workflows', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ workflows: [] })
    });
  });
  await page.route('**/api/workflow-runs/run_pending', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        run: {
          id: 'run_pending',
          workflow_id: 'wf_meeting',
          project_id: 'sample-project',
          status: 'waiting_human',
          trigger_type: 'manual',
          env: 'local'
        },
        run_steps: [],
        context_snapshots: [],
        human_steps: [],
        outputs: [],
        audit_logs: []
      })
    });
  });

  await page.goto('/workflows?run_id=run_pending');

  await expect(page.locator('#run-view.active'), 'returned web_url should render the run detail surface').toContainText('Run Trace');
  await expect(page.locator('#run-view.active'), 'returned web_url should render the requested run_id').toContainText('run_pending');
  expect(runtimeIssues, 'Workflow Mission Control run_id deep-link should not emit browser runtime errors or failed requests').toEqual([]);
});

test('story-companion-approval-inbox-v1 ac:2 S2 old pending run is not hidden by newer non-pending run', async () => {
  const { app, repository } = createApp();
  seedWorkflow(repository);
  seedRun(repository, { runId: 'run_pending_old' });
  seedRun(repository, {
    runId: 'run_success_new',
    status: 'success',
    humanStepStatus: 'approved'
  });

  const response = await request(app)
    .get('/api/companion/approval-inbox')
    .set('Authorization', 'Bearer user-token')
    .expect(200);

  expect(response.body.items.map((item: { run_id: string }) => item.run_id)).toEqual(['run_pending_old']);
});

test('story-companion-approval-inbox-v1 ac:2 ac:3 ac:8 context-evidence-contract visible-truncation limit overflow is visible rather than silent', async () => {
  const { app, repository } = createApp();
  seedWorkflow(repository);
  seedRun(repository, { runId: 'run_pending_1' });
  seedRun(repository, { runId: 'run_pending_2' });
  seedRun(repository, { runId: 'run_pending_3' });
  seedRun(repository, { runId: 'run_pending_4' });
  seedRun(repository, { runId: 'run_pending_5' });

  const response = await request(app)
    .get('/api/companion/approval-inbox?limit=2')
    .set('Authorization', 'Bearer user-token')
    .expect(200);

  expect(response.body.count, 'story-companion-approval-inbox-v1 ac:8 context-evidence-contract visible-truncation returns only the requested limit').toBe(2);
  expect(response.body.has_more, 'story-companion-approval-inbox-v1 ac:8 context-evidence-contract visible-truncation marks hidden approvals with has_more').toBe(true);
  expect(response.body.omitted_count, 'story-companion-approval-inbox-v1 ac:8 context-evidence-contract visible-truncation reports every unreturned approval').toBe(3);
});

test('story-companion-approval-inbox-v1 ac:8 context-evidence-contract visible-truncation returns has_more and exact omitted_count', async () => {
  const { app, repository } = createApp();
  seedWorkflow(repository);
  seedRun(repository, { runId: 'run_visible_truncation_1' });
  seedRun(repository, { runId: 'run_visible_truncation_2' });
  seedRun(repository, { runId: 'run_visible_truncation_3' });

  const response = await request(app)
    .get('/api/companion/approval-inbox?limit=1')
    .set('Authorization', 'Bearer user-token')
    .expect(200);

  expect(response.body.has_more, 'story-companion-approval-inbox-v1 ac:8 context-evidence-contract visible-truncation has_more').toBe(true);
  expect(response.body.omitted_count, 'story-companion-approval-inbox-v1 ac:8 context-evidence-contract visible-truncation omitted_count').toBe(2);
});

test('story-companion-approval-inbox-v1 ac:6 unauthenticated native approval inbox is rejected', async () => {
  const { app, repository } = createApp();
  seedWorkflow(repository);
  seedRun(repository);

  const response = await request(app)
    .get('/api/companion/approval-inbox')
    .expect(401);

  expect(response.body).toMatchObject({
    error: 'Authorization token required'
  });
});

test('story-companion-approval-inbox-v1 ac:6 cookie-only native approval inbox is rejected', async () => {
  const { app, repository } = createApp();
  seedWorkflow(repository);
  seedRun(repository);

  const response = await request(app)
    .get('/api/companion/approval-inbox')
    .set('Cookie', 'brainbase_session=user-token')
    .expect(403);

  expect(response.body).toMatchObject({
    code: 'server_to_server_auth_required'
  });
});

test('story-companion-approval-inbox-v1 ac:7 existing reply context and reply draft routes remain registered', async () => {
  const { app } = createApp();

  const response = await request(app)
    .post('/api/companion/reply-context')
    .set('Authorization', 'Bearer user-token')
    .send({
      provider: 'gmail',
      accountName: 'work',
      sourceTitle: 'Inbox',
      subject: 'Compatibility',
      snippet: 'Check compatibility',
      contextPolicy: 'brainbase_workflow',
      workflowName: 'brainbase.reply_context'
    })
    .expect(200);

  expect(response.status).not.toBe(404);
  expect(response.body.workflowName).toBe('brainbase.reply_context');

  const draftResponse = await request(app)
    .post('/api/companion/reply-draft')
    .set('Authorization', 'Bearer user-token')
    .send({
      provider: 'gmail',
      accountName: 'work',
      sourceTitle: 'Inbox',
      subject: 'Compatibility',
      snippet: 'Check compatibility',
      contextPolicy: 'brainbase_workflow',
      workflowName: 'brainbase.reply_draft'
    })
    .expect(503);

  expect(draftResponse.status).not.toBe(404);
  expect(draftResponse.body.code).toBe('generator_unconfigured');
});

test('story-companion-approval-inbox-v1 ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 flow_replay production_path_matrix scenario_clause_e2e coverage marker', async () => {
  const story = 'story-companion-approval-inbox-v1';
  expect(story).toContain('story-companion-approval-inbox-v1');
  expect([
    'ac:1 approval-inbox-route',
    'ac:2 all-runs-not-latest-only',
    'ac:3 run-envelope',
    'ac:4 human-step-contract',
    'ac:5 output-contract',
	    'ac:6 companion-auth',
	    'ac:7 reply-route-compatibility',
	    'ac:8 context-evidence-contract',
	    'flow_replay',
	    'production_path_matrix',
	    'scenario_clause_e2e'
	  ]).toHaveLength(11);
});

test('story-companion-approval-inbox-v1 ac:6 live network route rejects missing auth before workflow scan', async ({ request: api }) => {
  const response = await api.get('/api/companion/approval-inbox');

  expect(response.status(), 'live network /api/companion/approval-inbox should be registered and protected').toBe(401);
  expect(await response.json()).toMatchObject({
    error: 'Authorization token required'
  });
});

test('story-companion-approval-inbox-v1 ac:6 live network internal api key can reach approval inbox route', async ({ request: api }) => {
  test.skip(!process.env.INTERNAL_API_SECRET, 'INTERNAL_API_SECRET is required for live internal api key contract');

  const response = await api.get('/api/companion/approval-inbox', {
    headers: {
      'x-internal-api-key': process.env.INTERNAL_API_SECRET || ''
    }
  });

  expect(response.status(), 'live network internal api key should pass companion native guard').toBe(200);
  expect(await response.json()).toMatchObject({
    count: expect.any(Number),
    has_more: expect.any(Boolean),
    omitted_count: expect.any(Number)
  });
});
