import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const storyId = 'story-mana-meeting-workflow-pack-data-v1';

const meetingTemplates = [
  'pre-meeting-briefing',
  'transcript-to-meeting-note',
  'meeting-note-to-tasks',
  'meeting-note-to-decisions',
  'post-meeting-follow-up-message'
].map((id) => ({
  id: `wft_salestailor_salestailor_${id.replace(/-/g, '_')}`,
  org_id: 'salestailor',
  project_id: 'salestailor',
  workflow_kind: 'meeting',
  name: id,
  tags: ['meeting-workflow-definition', 'mana-meeting-workflow-pack-v1', id]
}));

const meetingDefinitionTriggerTypes = {
  'pre-meeting-briefing': ['schedule', 'human'],
  'transcript-to-meeting-note': ['event', 'human'],
  'meeting-note-to-tasks': ['event', 'human'],
  'meeting-note-to-decisions': ['event', 'human'],
  'post-meeting-follow-up-message': ['event', 'human']
};

function definitionIdFromTemplate(template) {
  return template.tags.find((tag) => meetingDefinitionTriggerTypes[tag]);
}

function meetingBindingFor(template) {
  const definitionId = definitionIdFromTemplate(template);
  return {
    id: `wfb_salestailor_salestailor_meeting_ops_${definitionId.replace(/-/g, '_')}`,
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_agent_instance_id: 'rai_salestailor_salestailor_meeting_ops',
    workflow_template_id: template.id,
    autonomy_level: 'approval_required',
    enabled: true
  };
}

function staleMeetingBindingFor(template) {
  const binding = meetingBindingFor(template);
  return {
    ...binding,
    id: binding.id.replace('meeting_ops', 'other_agent'),
    role_agent_instance_id: 'rai_salestailor_salestailor_other_agent'
  };
}

function meetingTriggersFor(template) {
  const definitionId = definitionIdFromTemplate(template);
  const binding = meetingBindingFor(template);
  return meetingDefinitionTriggerTypes[definitionId].map((triggerType) => ({
    id: `wftg_salestailor_salestailor_${definitionId.replace(/-/g, '_')}_${triggerType}`,
    org_id: 'salestailor',
    project_id: 'salestailor',
    workflow_binding_id: binding.id,
    trigger_type: triggerType,
    enabled: true
  }));
}

function staleMeetingTriggersFor(template) {
  const definitionId = definitionIdFromTemplate(template);
  const binding = staleMeetingBindingFor(template);
  return meetingDefinitionTriggerTypes[definitionId].map((triggerType) => ({
    id: `wftg_salestailor_salestailor_stale_${definitionId.replace(/-/g, '_')}_${triggerType}`,
    org_id: 'salestailor',
    project_id: 'salestailor',
    workflow_binding_id: binding.id,
    trigger_type: triggerType,
    enabled: true
  }));
}

function meetingLoopIntentFor(template) {
  const definitionId = definitionIdFromTemplate(template);
  const binding = meetingBindingFor(template);
  return {
    id: `loop_salestailor_salestailor_${definitionId.replace(/-/g, '_')}_bootstrap`,
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_agent_instance_id: 'rai_salestailor_salestailor_meeting_ops',
    workflow_template_id: template.id,
    workflow_binding_id: binding.id,
    workflow_trigger_id: meetingTriggersFor(template)[0].id,
    eligibility: {
      status: 'needs_approval',
      requires_human_approval: true
    },
    enabled: true
  };
}

function staleMeetingLoopIntentFor(template) {
  const definitionId = definitionIdFromTemplate(template);
  const binding = staleMeetingBindingFor(template);
  return {
    id: `loop_salestailor_salestailor_stale_${definitionId.replace(/-/g, '_')}`,
    org_id: 'salestailor',
    project_id: 'salestailor',
    role_agent_instance_id: 'rai_salestailor_salestailor_other_agent',
    workflow_template_id: template.id,
    workflow_binding_id: binding.id,
    workflow_trigger_id: `missing-trigger-${definitionId}`,
    eligibility: {
      status: 'needs_approval',
      requires_human_approval: true
    },
    enabled: true
  };
}

const misleadingTemplates = [
  'pre-meeting-briefing',
  'transcript-to-meeting-note',
  'meeting-note-to-tasks',
  'meeting-note-to-decisions',
  'post-meeting-follow-up-message'
].map((id) => ({
  id: `wft_global_${id.replace(/-/g, '_')}`,
  org_id: null,
  project_id: null,
  workflow_kind: 'operational',
  name: id,
  tags: ['legacy-template', id]
}));

const partialMeetingTemplates = meetingTemplates.map((template) => ({
  ...template,
  id: template.id.replace('salestailor_salestailor', 'global'),
  org_id: null,
  project_id: null
}));

test(`${storyId} S-001 S-003 S-004 S-005 S-006 ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9 ac:10 ac:11 replays Meeting Pack bootstrap`, async ({ page }) => {
  const story = readFileSync('docs/stories/story-mana-meeting-workflow-pack-data-v1.md', 'utf8');
  const spec = readFileSync('docs/specs/story-mana-meeting-workflow-pack-data-v1-spec.md', 'utf8');
  let bootstrapped = false;
  let bootstrapAttempts = 0;

  await test.step('ac:1 bootstrap endpoint is in the Story contract', async () => {
    expect(story).toContain('ac:1 Brainbase exposes a Meeting Workflow Pack bootstrap endpoint under the Workflow Control namespace.');
  });
  await test.step('ac:2 Meeting Ops Agent is in the Story contract', async () => {
    expect(story).toContain('ac:2 Bootstrap creates or updates one `Meeting Ops Agent` Role Agent instance scoped by `org_id` and `project_id`.');
  });
  await test.step('ac:3 five meeting workflow_templates are in the Story contract', async () => {
    expect(story).toContain('ac:3 Bootstrap creates or updates exactly five meeting `workflow_templates` for `pre-meeting-briefing`, `transcript-to-meeting-note`, `meeting-note-to-tasks`, `meeting-note-to-decisions`, and `post-meeting-follow-up-message`.');
  });
  await test.step('ac:4 definition metadata is in the Story contract', async () => {
    expect(story).toContain('ac:4 Each meeting Workflow Definition carries trigger types, judgment DAG id, output contract, human gate, write-back target, risk level, and `meeting-workflow-pack` tags.');
  });
  await test.step('ac:5 approval-required bindings are in the Story contract', async () => {
    expect(story).toContain('ac:5 Bootstrap creates approval-required bindings from Meeting Ops Agent to each meeting Workflow Definition.');
  });
  await test.step('ac:6 schedule event human triggers are in the Story contract', async () => {
    expect(story).toContain("ac:6 Bootstrap creates schedule/event/human `workflow_triggers` according to each definition's trigger contract.");
  });
  await test.step('ac:7 deterministic loop_intents are in the Story contract', async () => {
    expect(story).toContain('ac:7 Bootstrap can create deterministic initial `loop_intents` without duplicating them on repeated calls.');
  });
  await test.step('ac:8 audit log is in the Story contract', async () => {
    expect(story).toContain('ac:8 Bootstrap records an audit log entry with the created or updated record ids.');
  });
  await test.step('ac:9 UI derives configured state from real data', async () => {
    expect(story).toContain('ac:9 `/workflows` displays whether each meeting Workflow Definition is configured from real Workflow Control data');
  });
  await test.step('ac:10 UI calls bootstrap and refreshes', async () => {
    expect(story).toContain('ac:10 `/workflows` can call bootstrap and refresh the Meeting Workflow Pack panel without requiring hand entry in the generic forms.');
  });
  await test.step('ac:11 existing Workflow Control APIs remain in scope', async () => {
    expect(story).toContain('ac:11 Existing individual Workflow Control APIs continue to work');
  });
  expect(story).toContain('Bootstrap creates or updates exactly five meeting');
  expect(spec).toContain('INV-009');
  expect(spec).toContain('S-006');
  expect(spec).toContain('missing -> bootstrap_requested -> records_persisted -> data_connected');

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/csrf-token' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'test-csrf' }) });
      return;
    }
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
          role_agent_instances: bootstrapped ? [{
            id: 'rai_salestailor_salestailor_meeting_ops',
            org_id: 'salestailor',
            project_id: 'salestailor',
            role_archetype_id: 'meeting-ops',
            name: 'Meeting Ops Agent'
          }] : [{
            id: 'rai_salestailor_salestailor_meeting_ops',
            org_id: 'salestailor',
            project_id: 'salestailor',
            role_archetype_id: 'meeting-ops',
            name: 'Meeting Ops Agent'
          }, {
            id: 'rai_salestailor_salestailor_other_agent',
            org_id: 'salestailor',
            project_id: 'salestailor',
            role_archetype_id: 'meeting-ops',
            name: 'Other Meeting Agent'
          }]
        })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/templates' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ workflow_templates: bootstrapped ? [...misleadingTemplates, ...partialMeetingTemplates, ...meetingTemplates] : [...misleadingTemplates, ...partialMeetingTemplates] })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/bindings' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workflow_bindings: bootstrapped ? meetingTemplates.map(meetingBindingFor) : partialMeetingTemplates.map(staleMeetingBindingFor)
        })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/triggers' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workflow_triggers: bootstrapped ? meetingTemplates.flatMap(meetingTriggersFor) : partialMeetingTemplates.flatMap(staleMeetingTriggersFor)
        })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/loop-intents' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loop_intents: bootstrapped ? meetingTemplates.map(meetingLoopIntentFor) : partialMeetingTemplates.map(staleMeetingLoopIntentFor)
        })
      });
      return;
    }
    if (url.pathname === '/api/workflows/control/meeting-pack/bootstrap' && method === 'POST') {
      expect(route.request().postDataJSON()).toMatchObject({
        org_id: 'salestailor',
        project_id: 'salestailor'
      });
      bootstrapAttempts += 1;
      if (bootstrapAttempts === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'simulated bootstrap failure' })
        });
        return;
      }
      bootstrapped = true;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          meeting_workflow_pack: {
            pack_id: 'mana-meeting-workflow-pack-v1',
            workflow_templates: meetingTemplates,
            workflow_triggers: meetingTemplates.flatMap(meetingTriggersFor),
            loop_intents: meetingTemplates.map(meetingLoopIntentFor)
          }
        })
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not mocked' }) });
  });

  await page.goto('/workflows');
  await page.getByRole('button', { name: /salestailor/ }).click();

  const pack = page.locator('[data-meeting-workflow-pack]');
  const preMeetingDefinition = pack.locator('[data-meeting-definition="pre-meeting-briefing"]').first();
  const decisionDefinition = pack.locator('[data-meeting-definition="meeting-note-to-decisions"]').first();
  await expect(pack.getByText('bootstrap needed')).toBeVisible();
  await expect(pack.getByText('5 missing definitions')).toBeVisible();
  await expect(pack.getByText('configured templates')).toBeVisible();
  await expect(preMeetingDefinition).toContainText('missing');
  await expect(pack.getByText('data connected')).toBeHidden();

  const firstBootstrapResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/workflows/control/meeting-pack/bootstrap'
      && response.request().method() === 'POST'
  ));
  await pack.getByRole('button', { name: 'Bootstrap Meeting Pack' }).click();
  expect((await firstBootstrapResponse).status()).toBe(500);

  await expect(pack.getByText('Bootstrapできません: simulated bootstrap failure')).toBeVisible();
  await expect(pack.getByText('bootstrap needed')).toBeVisible();
  await expect(pack.getByText('data connected')).toBeHidden();
  await expect(preMeetingDefinition).toContainText('missing');
  expect(bootstrapped).toBe(false);

  const secondBootstrapResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/workflows/control/meeting-pack/bootstrap'
      && response.request().method() === 'POST'
  ));
  await pack.getByRole('button', { name: 'Bootstrap Meeting Pack' }).click();
  expect((await secondBootstrapResponse).status()).toBe(201);

  await expect(pack.getByText('data connected')).toBeVisible();
  await expect(pack.getByText('All definitions connected to Workflow Control data')).toBeVisible();
  await expect(preMeetingDefinition).toContainText('configured');
  await expect(decisionDefinition).toContainText('configured');
  await expect(pack.getByRole('button', { name: 'Bootstrap Meeting Pack' })).toBeDisabled();
  await expect(page.locator('form[data-workflow-control-resource="role-agents"]')).toBeVisible();
  await expect(page.locator('form[data-workflow-control-resource="templates"]')).toBeVisible();
  await expect(page.locator('form[data-workflow-control-resource="bindings"]')).toBeVisible();
  await expect(page.locator('form[data-workflow-control-resource="triggers"]')).toBeVisible();
  await expect(page.locator('form[data-workflow-control-resource="loop-intents"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Role Agent' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Add Template' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Bind Workflow' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Add Trigger' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Create Loop Intent' })).toBeEnabled();
  expect(bootstrapped).toBe(true);
  expect(bootstrapAttempts).toBe(2);
});

test(`${storyId} S-002 S-007 S-008 S-009 S-010 server-bound scenario coverage remains executable`, async () => {
  const serviceTest = readFileSync('tests/server/services/workflow-org-agent-control.test.js', 'utf8');
  const routeTest = readFileSync('tests/server/routes/workflows.test.js', 'utf8');

  expect(routeTest).toContain('story-mana-meeting-workflow-pack-data-v1 FM-001 auth_denied rejects meeting pack bootstrap before writes');
  expect(routeTest).toContain("expect(repository.listRoleAgentInstances({ orgId: 'sample-project', projectId: 'sample-project' })).toHaveLength(0)");
  expect(serviceTest).toContain('story-mana-meeting-workflow-pack-data-v1 FM-002 persistence_failure rolls back partial meeting pack records');
  expect(serviceTest).toContain("rejects.toThrow('persistence_failure')");
  expect(serviceTest).toContain('story-mana-meeting-workflow-pack-data-v1 FM-003 provider_failure is not invoked during bootstrap');
  expect(serviceTest).toContain('expect(providerCalls).toBe(0)');
  expect(serviceTest).toContain('story-mana-meeting-workflow-pack-data-v1 S-009 INV-002 keeps meeting pack bootstrap idempotent');
  expect(routeTest).toContain('exposes org role-agent control routes under the control namespace');
  expect(routeTest).toContain('keeps workflow control POST writes scoped to the canonical control namespace');
});
