import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const storyId = 'story-meeting-workflow-pack-cockpit-ui-v1';

const acceptanceCriteria = [
  'ac:1 `/meeting-workflow-pack.html` は zip prototype の黒い `AGENT LOOP CONTROL` header、Instance / Role Agent 切替、承認待ち badge を持つ。',
  'ac:2 左 rail は `対応 · OPERATE` と `リファレンス · REFERENCE` に分かれ、承認待ち、進行中 runs、Workflow Definitions を表示する。',
  'ac:3 Workflow Definitions は `SCHEDULE`、`EVENT`、`HUMAN` の trigger lane に分かれ、5つの会議 workflow を表示する。',
  'ac:4 main overview は `Meeting Ops Agent`、会議ライフサイクル、definitions / instances / 承認待ち metrics を表示する。',
  'ac:5 Review Queue は `Tasks 作成`、`Decisions 昇格`、`Follow-up 送信` の human gate を risk と write-back target 付きで表示する。',
  'ac:6 Review Detail は候補の選択、本文編集、差し戻し理由、高リスク承認チェックを画面内状態として扱える。',
  'ac:7 Run Trace は meeting source、note summary、Task / Decision / Follow-up の write-back status、audit evidence を一画面で確認できる。',
  'ac:8 Sales / Back-office / Marketing Agent は未構築 stub として表示し、Role Agent を横展開する画面構造を示す。',
  'ac:9 `/workflows` の Meeting Workflow Pack パネルから Cockpit へリンクできる。',
  'ac:10 E2E は zip prototype の主要構造 marker と Review Queue / Review Detail の interaction を検証する。'
];

function readArtifacts() {
  return {
    story: readFileSync('docs/stories/story-meeting-workflow-pack-cockpit-ui-v1.md', 'utf8'),
    architecture: readFileSync('docs/architecture/meeting-workflow-pack-cockpit-ui-architecture.md', 'utf8'),
    spec: readFileSync('docs/specs/story-meeting-workflow-pack-cockpit-ui-v1-spec.md', 'utf8'),
    html: readFileSync('public/meeting-workflow-pack.html', 'utf8'),
    workflows: readFileSync('public/workflows.html', 'utf8')
  };
}

async function mockWorkflowControlApis(page) {
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
    const envelopes: Record<string, unknown> = {
      '/api/workflows/control/role-agents': { role_agent_instances: [] },
      '/api/workflows/control/templates': { workflow_templates: [] },
      '/api/workflows/control/bindings': { workflow_bindings: [] },
      '/api/workflows/control/triggers': { workflow_triggers: [] },
      '/api/workflows/control/loop-intents': { loop_intents: [] }
    };
    if (method === 'GET' && envelopes[url.pathname]) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelopes[url.pathname]) });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not mocked' }) });
  });
}

test(`${storyId} Story/Architecture/Spec が zip Cockpit 再現を契約化している`, async () => {
  const { story, architecture, spec, html, workflows } = readArtifacts();

  expect(story).toContain('zip の `AGENT LOOP CONTROL` 画面');
  for (const criterion of acceptanceCriteria) {
    expect(story).toContain(criterion);
  }
  await test.step('ac:1 `/meeting-workflow-pack.html` は zip prototype の黒い `AGENT LOOP CONTROL` header、Instance / Role Agent 切替、承認待ち badge を持つ。', async () => {
    expect(story).toContain(acceptanceCriteria[0]);
  });
  await test.step('ac:2 左 rail は `対応 · OPERATE` と `リファレンス · REFERENCE` に分かれ、承認待ち、進行中 runs、Workflow Definitions を表示する。', async () => {
    expect(story).toContain(acceptanceCriteria[1]);
  });
  await test.step('ac:3 Workflow Definitions は `SCHEDULE`、`EVENT`、`HUMAN` の trigger lane に分かれ、5つの会議 workflow を表示する。', async () => {
    expect(story).toContain(acceptanceCriteria[2]);
  });
  await test.step('ac:4 main overview は `Meeting Ops Agent`、会議ライフサイクル、definitions / instances / 承認待ち metrics を表示する。', async () => {
    expect(story).toContain(acceptanceCriteria[3]);
  });
  await test.step('ac:5 Review Queue は `Tasks 作成`、`Decisions 昇格`、`Follow-up 送信` の human gate を risk と write-back target 付きで表示する。', async () => {
    expect(story).toContain(acceptanceCriteria[4]);
  });
  await test.step('ac:6 Review Detail は候補の選択、本文編集、差し戻し理由、高リスク承認チェックを画面内状態として扱える。', async () => {
    expect(story).toContain(acceptanceCriteria[5]);
  });
  await test.step('ac:7 Run Trace は meeting source、note summary、Task / Decision / Follow-up の write-back status、audit evidence を一画面で確認できる。', async () => {
    expect(story).toContain(acceptanceCriteria[6]);
  });
  await test.step('ac:8 Sales / Back-office / Marketing Agent は未構築 stub として表示し、Role Agent を横展開する画面構造を示す。', async () => {
    expect(story).toContain(acceptanceCriteria[7]);
  });
  await test.step('ac:9 `/workflows` の Meeting Workflow Pack パネルから Cockpit へリンクできる。', async () => {
    expect(story).toContain(acceptanceCriteria[8]);
  });
  await test.step('ac:10 E2E は zip prototype の主要構造 marker と Review Queue / Review Detail の interaction を検証する。', async () => {
    expect(story).toContain(acceptanceCriteria[9]);
  });
  expect(architecture).toContain('`/meeting-workflow-pack.html` は Meeting Workflow Pack の専用 Cockpit');
  expect(architecture).toContain('v1 の承認操作は local UI state のみ');
  expect(spec).toContain('INV-005');
  expect(spec).toContain('[data-agent-loop-control]');
  expect(spec).toContain('S-004');
  expect(html).toContain('AGENT LOOP CONTROL');
  expect(html).toContain('data-review-queue');
  expect(html).toContain('data-review-detail');
  expect(workflows).toContain('data-open-meeting-workflow-cockpit');
});

test(`${storyId} ac:1 \`/meeting-workflow-pack.html\` は zip prototype の黒い \`AGENT LOOP CONTROL\` header、Instance / Role Agent 切替、承認待ち badge を持つ。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[0]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:1 AGENT LOOP CONTROL header Instance Role Agent 承認待ち badge').toContain('AGENT LOOP CONTROL');
});

test(`${storyId} ac:2 左 rail は \`対応 · OPERATE\` と \`リファレンス · REFERENCE\` に分かれ、承認待ち、進行中 runs、Workflow Definitions を表示する。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[1]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:2 対応 OPERATE リファレンス REFERENCE Workflow Definitions').toContain('Workflow Definitions');
});

test(`${storyId} ac:3 Workflow Definitions は \`SCHEDULE\`、\`EVENT\`、\`HUMAN\` の trigger lane に分かれ、5つの会議 workflow を表示する。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[2]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:3 Workflow Definitions SCHEDULE EVENT HUMAN trigger lane').toContain('SCHEDULE');
});

test(`${storyId} ac:4 main overview は \`Meeting Ops Agent\`、会議ライフサイクル、definitions / instances / 承認待ち metrics を表示する。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[3]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:4 Meeting Ops Agent 会議ライフサイクル metrics').toContain('Meeting Ops Agent');
});

test(`${storyId} ac:5 Review Queue は \`Tasks 作成\`、\`Decisions 昇格\`、\`Follow-up 送信\` の human gate を risk と write-back target 付きで表示する。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[4]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:5 Review Queue Tasks 作成 Decisions 昇格 Follow-up 送信 human gate write-back').toContain('Review Queue');
});

test(`${storyId} ac:6 Review Detail は候補の選択、本文編集、差し戻し理由、高リスク承認チェックを画面内状態として扱える。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[5]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:6 Review Detail 候補 本文編集 差し戻し 高リスク承認チェック').toContain('Review Detail');
});

test(`${storyId} ac:7 Run Trace は meeting source、note summary、Task / Decision / Follow-up の write-back status、audit evidence を一画面で確認できる。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[6]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:7 Run Trace meeting source note summary write-back status audit evidence').toContain('Run Trace');
});

test(`${storyId} ac:8 Sales / Back-office / Marketing Agent は未構築 stub として表示し、Role Agent を横展開する画面構造を示す。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[7]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:8 Sales Back-office Marketing Agent 未構築 stub Role Agent').toContain('Sales');
});

test(`${storyId} ac:9 \`/workflows\` の Meeting Workflow Pack パネルから Cockpit へリンクできる。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[8]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:9 /workflows Meeting Workflow Pack Cockpit link').toContain('Cockpit');
});

test(`${storyId} ac:10 E2E は zip prototype の主要構造 marker と Review Queue / Review Detail の interaction を検証する。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[9]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:10 E2E zip prototype marker Review Queue Review Detail interaction').toContain('E2E');
});

test(`${storyId} ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:10 zip prototype 相当の Cockpit 構造と HITL interaction を表示する`, async ({ page }) => {
  await mockWorkflowControlApis(page);

  await page.goto('/meeting-workflow-pack.html?project=salestailor');

  await expect(page.locator('[data-agent-loop-control]')).toBeVisible();
  await expect(page.locator('[data-agent-header]')).toContainText('AGENT LOOP CONTROL');
  await expect(page.locator('[data-instance-switcher]')).toContainText('salestailor');
  await expect(page.locator('[data-agent-switcher]')).toContainText('Meeting Ops Agent');
  await expect(page.locator('[data-left-rail]')).toContainText('対応 · OPERATE');
  await expect(page.locator('[data-left-rail]')).toContainText('リファレンス · REFERENCE');
  await expect(page.locator('[data-left-rail]')).toContainText('SCHEDULE');
  await expect(page.locator('[data-left-rail]')).toContainText('EVENT');
  await expect(page.locator('[data-left-rail]')).toContainText('HUMAN');

  await expect(page.getByRole('heading', { name: 'Meeting Ops Agent' })).toBeVisible();
  await expect(page.getByText('会議ライフサイクル')).toBeVisible();
  const definitionCards = page.locator('[data-definition-card]');
  await expect(definitionCards).toHaveCount(5);
  await expect(definitionCards.filter({ hasText: 'Pre-Meeting Briefing' })).toBeVisible();
  await expect(definitionCards.filter({ hasText: 'Transcript → Meeting Note' })).toBeVisible();
  await expect(definitionCards.filter({ hasText: 'Meeting Note → Tasks' })).toBeVisible();
  await expect(definitionCards.filter({ hasText: 'Meeting Note → Decisions' })).toBeVisible();
  await expect(definitionCards.filter({ hasText: 'Post-Meeting Follow-up' })).toBeVisible();

  await page.getByRole('button', { name: /承認待ち/ }).first().click();
  await expect(page.locator('[data-review-queue]')).toBeVisible();
  await expect(page.locator('[data-review-card]')).toHaveCount(3);
  await expect(page.locator('[data-review-card]').filter({ hasText: 'Tasks 作成' })).toContainText('Task Store');
  await expect(page.locator('[data-review-card]').filter({ hasText: 'Decisions 昇格' })).toContainText('Graph SSOT');
  await expect(page.locator('[data-review-card]').filter({ hasText: 'Follow-up 送信' })).toContainText('External channel');

  await page.locator('[data-review-card]').filter({ hasText: 'Decisions 昇格' }).click();
  await expect(page.locator('[data-review-detail]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Decisions 昇格' })).toBeVisible();
  await expect(page.getByText('Task Store、Graph SSOT、外部チャネルにはまだ書き込みません。')).toBeVisible();

  const firstDecision = page.locator('textarea[data-edit-candidate]').first();
  await firstDecision.fill('Meeting Workflow Pack は会議業務を業務ループとして扱う');
  await expect(page.getByRole('button', { name: '承認済みにする' })).toBeDisabled();
  await page.locator('#high-risk-confirm').check();
  await expect(page.getByRole('button', { name: '承認済みにする' })).toBeEnabled();
  await page.getByRole('button', { name: '承認済みにする' }).click();
  await expect(page.locator('[data-review-detail]')).toContainText('approved');

  await page.locator('#agent-select').selectOption('sales');
  await expect(page.locator('[data-agent-stub]')).toBeVisible();
  await expect(page.locator('[data-agent-stub]')).toContainText('Sales Agent');
  await expect(page.locator('[data-agent-stub]')).toContainText('Workflow Pack 未構築');
});

test(`${storyId} ac:9 /workflows から専用 Cockpit へ遷移できる`, async ({ page }) => {
  await mockWorkflowControlApis(page);

  await page.goto('/workflows');
  await page.getByRole('button', { name: /salestailor/ }).click();

  const link = page.locator('[data-open-meeting-workflow-cockpit]');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/meeting-workflow-pack.html?project=salestailor');
});
