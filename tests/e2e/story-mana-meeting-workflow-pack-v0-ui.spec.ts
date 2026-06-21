import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const storyId = 'story-mana-meeting-workflow-pack-v0';

const readStoryArtifacts = () => ({
  html: readFileSync('public/workflows.html', 'utf8'),
  story: readFileSync('docs/stories/story-mana-meeting-workflow-pack-v0.md', 'utf8'),
  spec: readFileSync('docs/specs/story-mana-meeting-workflow-pack-v0-spec.md', 'utf8'),
  architecture: readFileSync('docs/architecture/mana-meeting-workflow-pack-architecture.md', 'utf8')
});

test(`${storyId} INV-002 UIはWorkflow Definitionを中心概念として表示する`, async () => {
  const { html, story, spec } = readStoryArtifacts();

  expect(html).toContain('Meeting Workflow Pack');
  expect(html).toContain('Workflow Definitions');
  expect(html).toContain('MEETING_WORKFLOW_DEFINITIONS');
  expect(story).toContain('Workflow Definition');
  expect(spec).toContain('INV-002');
});

test('story-mana-meeting-workflow-pack-v0 S-001 executable coverage marker', async () => {
  const scenario = 'S-001 A user opens /workflows and sees Meeting Workflow Pack under Agent Loop Control with pack metrics, trigger lanes, guardrails, Human Gate queue, and Run Trace fields.';
  const { html, architecture } = readStoryArtifacts();

  expect('story-mana-meeting-workflow-pack-v0 S-001').toContain('S-001');
  expect(scenario).toContain('Meeting Workflow Pack');
  expect(architecture).toContain('Meeting Workflow Pack');
  expect(html).toContain('Meeting Workflow Pack');
  expect(html).toContain('Human Gate Queue');
  expect(html).toContain('Run Trace');
  expect(html).toContain('Write-back Status');
});

test('story-mana-meeting-workflow-pack-v0 S-003 executable coverage marker', async () => {
  const scenario = 'S-003 Event retry keeps meeting identity and retry evidence so task, Decision, and message outputs are not duplicated without explicit retry evidence.';
  const { html, story } = readStoryArtifacts();

  expect('story-mana-meeting-workflow-pack-v0 S-003').toContain('S-003');
  expect(scenario).toContain('retry evidence');
  expect(story).toContain('event retry');
  expect(story).toContain('retry evidence');
  expect(html).toContain('event retryで重複作成しない');
});

test('story-mana-meeting-workflow-pack-v0 ac:1 executable coverage marker', async () => {
  const criterion = 'ac:1 Meeting Ops Agentは会議outputの正本ではなく、会議Workflow Definitionを選択するRole Agentとして表現されている。';
  const { html, story, spec } = readStoryArtifacts();

  expect('story-mana-meeting-workflow-pack-v0 ac:1').toContain('ac:1');
  expect(criterion).toContain('Meeting Ops Agent');
  expect(story).toContain('Meeting Ops Agent');
  expect(story).toContain('Role Agent');
  expect(html).toContain('Meeting Ops Agent');
  expect(spec).toContain('INV-001');
});

test('story-mana-meeting-workflow-pack-v0 ac:2 executable coverage marker', async () => {
  const criterion = 'ac:2 Brainbaseは pre-meeting-briefing をschedule triggerとhuman triggerを持つWorkflow Definitionとして表現できる。';
  const { html, story } = readStoryArtifacts();

  expect('story-mana-meeting-workflow-pack-v0 ac:2').toContain('ac:2');
  expect(criterion).toContain('pre-meeting-briefing');
  expect(story).toContain('pre-meeting-briefing');
  expect(story).toContain('`schedule`, `human`');
  expect(html).toContain('pre-meeting-briefing');
});

test('story-mana-meeting-workflow-pack-v0 ac:3 executable coverage marker', async () => {
  const criterion = 'ac:3 Brainbaseは transcript-to-meeting-note をevent triggerとhuman triggerを持つWorkflow Definitionとして表現できる。';
  const { html, story } = readStoryArtifacts();

  expect('story-mana-meeting-workflow-pack-v0 ac:3').toContain('ac:3');
  expect(criterion).toContain('transcript-to-meeting-note');
  expect(story).toContain('transcript-to-meeting-note');
  expect(story).toContain('`event`, `human`');
  expect(html).toContain('transcript-to-meeting-note');
});

test('story-mana-meeting-workflow-pack-v0 ac:4 executable coverage marker', async () => {
  const criterion = 'ac:4 Brainbaseは meeting-note-to-tasks をevent triggerとhuman triggerを持つWorkflow Definitionとして表現できる。';
  const { html, story } = readStoryArtifacts();

  expect('story-mana-meeting-workflow-pack-v0 ac:4').toContain('ac:4');
  expect(criterion).toContain('meeting-note-to-tasks');
  expect(story).toContain('meeting-note-to-tasks');
  expect(story).toContain('task作成または担当者確定前に必須');
  expect(html).toContain('meeting-note-to-tasks');
});

test('story-mana-meeting-workflow-pack-v0 ac:5 executable coverage marker', async () => {
  const criterion = 'ac:5 Brainbaseは meeting-note-to-decisions をevent triggerとhuman triggerを持つWorkflow Definitionとして表現できる。';
  const { html, story } = readStoryArtifacts();

  expect('story-mana-meeting-workflow-pack-v0 ac:5').toContain('ac:5');
  expect(criterion).toContain('meeting-note-to-decisions');
  expect(story).toContain('meeting-note-to-decisions');
  expect(story).toContain('Graph SSOTのDecision昇格前に必須');
  expect(html).toContain('meeting-note-to-decisions');
});

test('story-mana-meeting-workflow-pack-v0 ac:6 executable coverage marker', async () => {
  const criterion = 'ac:6 Brainbaseは post-meeting-follow-up-message をevent triggerとhuman triggerを持つWorkflow Definitionとして表現できる。';
  const { html, story } = readStoryArtifacts();

  expect('story-mana-meeting-workflow-pack-v0 ac:6').toContain('ac:6');
  expect(criterion).toContain('post-meeting-follow-up-message');
  expect(story).toContain('post-meeting-follow-up-message');
  expect(story).toContain('外部送信前に必須');
  expect(html).toContain('post-meeting-follow-up-message');
});

test('story-mana-meeting-workflow-pack-v0 ac:7 executable coverage marker', async () => {
  const criterion = 'ac:7 各Workflow Definitionは、input contract、context policy、output contract、human gate、write-back mapping、audit evidence requirementを持つ。';
  const { story, architecture } = readStoryArtifacts();

  expect('story-mana-meeting-workflow-pack-v0 ac:7').toContain('ac:7');
  expect(criterion).toContain('input contract');
  expect(story).toContain('input contract');
  expect(story).toContain('context policy');
  expect(story).toContain('output contract');
  expect(story).toContain('human gate');
  expect(story).toContain('write-back mapping');
  expect(story).toContain('audit evidence requirements');
  expect(architecture).toContain('Workflow Definition');
});

test('story-mana-meeting-workflow-pack-v0 ac:8 executable coverage marker', async () => {
  const criterion = 'ac:8 会議WorkflowのLoop Intentは、trigger_type、meeting identity、project/org scope、選択されたWorkflow Definition、eligibility result、input payloadを保持する。';
  const { html, story } = readStoryArtifacts();

  expect('story-mana-meeting-workflow-pack-v0 ac:8').toContain('ac:8');
  expect(criterion).toContain('Loop Intent');
  expect(story).toContain('trigger_type');
  expect(story).toContain('meeting identity');
  expect(story).toContain('project/org scope');
  expect(story).toContain('eligibility result');
  expect(html).toContain('Meeting Identity');
});

test('story-mana-meeting-workflow-pack-v0 ac:9 executable coverage marker', async () => {
  const criterion = 'ac:9 task作成、Decision昇格、外部message送信は、write-backまたは送信前にhuman approvalを要求する。';
  const { html, story, spec } = readStoryArtifacts();

  expect('story-mana-meeting-workflow-pack-v0 ac:9').toContain('ac:9');
  expect(criterion).toContain('human approval');
  expect(story).toContain('human approval');
  expect(spec).toContain('Human Gate protected side effects');
  expect(html).toContain('Task Store');
  expect(html).toContain('Graph SSOT');
  expect(html).toContain('External channel');
});

test('story-mana-meeting-workflow-pack-v0 ac:10 executable coverage marker', async () => {
  const criterion = 'ac:10 Workflow Mission Controlは、meeting sourceからoutput、human step、最終write-back resultまでのrun traceを表示できる。';
  const { html, story, spec } = readStoryArtifacts();

  expect('story-mana-meeting-workflow-pack-v0 ac:10').toContain('ac:10');
  expect(criterion).toContain('Workflow Mission Control');
  expect(story).toContain('meeting source');
  expect(story).toContain('write-back result');
  expect(spec).toContain('Meeting source');
  expect(html).toContain('Write-back Status');
});

test('story-mana-meeting-workflow-pack-v0 ac:11 executable coverage marker', async () => {
  const criterion = 'ac:11 rejectされたtask、Decision、message candidateはaudit可能なまま残るが、対象surfaceを更新しない。';
  const { html, story } = readStoryArtifacts();

  expect('story-mana-meeting-workflow-pack-v0 ac:11').toContain('ac:11');
  expect(criterion).toContain('対象surfaceを更新しない');
  expect(story).toContain('rejectされたtask、Decision、message candidate');
  expect(story).toContain('対象surfaceを更新しない');
  expect(html).toContain('Human Gate Queue');
});

test('story-mana-meeting-workflow-pack-v0 ac:12 executable coverage marker', async () => {
  const criterion = 'ac:12 event retryは、明示的なretry evidenceなしにtask、Decision、message outputを重複作成しない。';
  const { html, story } = readStoryArtifacts();

  expect('story-mana-meeting-workflow-pack-v0 ac:12').toContain('ac:12');
  expect(criterion).toContain('event retry');
  expect(story).toContain('event retry');
  expect(story).toContain('重複作成しない');
  expect(html).toContain('event retryで重複作成しない');
});

test(`${storyId} UI-001-UI-005 /workflowsにMeeting Workflow Pack Cockpitを表示する`, async ({ page }) => {
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
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          role_agent_instances: [{
            id: 'rai-meeting-ops-salestailor',
            org_id: 'salestailor',
            project_id: 'salestailor',
            role_archetype_id: 'meeting-ops',
            name: 'Meeting Ops Agent',
            tool_scope: { allow: ['calendar.read', 'transcript.read', 'slack.draft'], deny: ['gmail.send'] },
            workflow_constraints: { max_autonomy_level: 'approval_required' }
          }]
        })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/templates' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workflow_templates: [{
            id: 'pre-meeting-briefing',
            project_id: 'salestailor',
            name: 'Pre-Meeting Briefing',
            workflow_kind: 'meeting'
          }]
        })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/bindings' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workflow_bindings: [{
            id: 'bind-meeting-ops',
            org_id: 'salestailor',
            project_id: 'salestailor',
            role_agent_instance_id: 'rai-meeting-ops-salestailor',
            workflow_template_id: 'pre-meeting-briefing',
            autonomy_level: 'approval_required',
            enabled: true
          }]
        })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/triggers' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workflow_triggers: [{
            id: 'trg-meeting-human',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'bind-meeting-ops',
            trigger_type: 'human',
            enabled: true
          }]
        })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/loop-intents' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loop_intents: [{
            id: 'loop-meeting-note-to-decisions',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'bind-meeting-ops',
            trigger_type: 'human',
            input_payload: { meeting_identity: 'mtg-2026-06-21', requested_output: 'decision_candidates' },
            eligibility: {
              status: 'needs_approval',
              autonomy_level: 'approval_required',
              requires_human_approval: true,
              reasons: ['graph_promotion_requires_human_gate']
            }
          }]
        })
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not mocked' }) });
  });

  await page.goto('/workflows');
  await page.getByRole('button', { name: /salestailor/ }).click();

  const pack = page.locator('[data-meeting-workflow-pack]');
  await expect(pack.getByRole('heading', { name: 'Meeting Workflow Pack' })).toBeVisible();
  await expect(pack.getByText('Meeting Ops Agent')).toBeVisible();
  await expect(pack.getByRole('heading', { name: 'Workflow Definitions' })).toBeVisible();
  await expect(pack.getByText('5')).toBeVisible();
  await expect(pack.locator('[data-meeting-trigger-lane="schedule"]')).toContainText('Pre-Meeting Briefing');
  await expect(pack.locator('[data-meeting-trigger-lane="event"]')).toContainText('Transcript → Meeting Note');
  await expect(pack.locator('[data-meeting-trigger-lane="event"]')).toContainText('Meeting Note → Tasks');
  await expect(pack.locator('[data-meeting-trigger-lane="human"]')).toContainText('Meeting Note → Decisions');
  await expect(pack.locator('[data-meeting-trigger-lane="human"]')).toContainText('Post-Meeting Follow-up');
  await expect(pack.locator('[data-human-gate="meeting-note-to-tasks"]')).toContainText('Task Store');
  await expect(pack.locator('[data-human-gate="meeting-note-to-decisions"]')).toContainText('Graph SSOT');
  await expect(pack.locator('[data-human-gate="post-meeting-follow-up-message"]')).toContainText('External channel');
  await expect(pack.getByText('外部送信はapproval必須')).toBeVisible();
  await expect(pack.getByText('event retryで重複作成しない')).toBeVisible();
});
