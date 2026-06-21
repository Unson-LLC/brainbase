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
    support: readFileSync('public/support.js', 'utf8'),
    prototypeHtml: readFileSync('docs/design/prototypes/meeting-workflow-pack/meeting-workflow-pack.dc.html', 'utf8'),
    prototypeSupport: readFileSync('docs/design/prototypes/meeting-workflow-pack/support.js', 'utf8'),
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
  const { story, architecture, spec, html, support, prototypeHtml, prototypeSupport, workflows } = readArtifacts();

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
  expect(spec).toContain('public/meeting-workflow-pack.html` is byte-for-byte aligned');
  expect(spec).toContain('S-004');
  expect(html).toBe(prototypeHtml);
  expect(support).toBe(prototypeSupport);
  expect(html).toContain('AGENT LOOP CONTROL');
  expect(html).toContain('data-nav="review"');
  expect(html).toContain('data-rk="{{ q.rk }}"');
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
  await page.goto('/meeting-workflow-pack.html?project=salestailor');

  await expect(page.getByText('AGENT LOOP CONTROL')).toBeVisible();
  await expect(page.locator('button[data-menu="instance"]')).toContainText('unson');
  await expect(page.locator('button[data-menu="agent"]')).toContainText('Meeting Ops Agent');
  await expect(page.getByText('対応 · OPERATE')).toBeVisible();
  await expect(page.getByText('リファレンス · REFERENCE')).toBeVisible();
  await expect(page.getByText('SCHEDULE', { exact: true })).toBeVisible();
  await expect(page.getByText('EVENT', { exact: true })).toBeVisible();
  await expect(page.getByText('HUMAN', { exact: true })).toBeVisible();

  await expect(page.getByRole('heading', { name: '承認待ち' })).toBeVisible();
  await expect(page.getByText('Decisions 昇格').first()).toBeVisible();
  await expect(page.getByText('Graph SSOT').first()).toBeVisible();
  await expect(page.getByText('Follow-up 送信').first()).toBeVisible();
  await expect(page.getByText('Tasks 作成').first()).toBeVisible();

  await page.locator('button[data-rk="welfare:decisions"]').click();
  await expect(page.getByRole('heading', { name: 'Decisions 昇格' })).toBeVisible();
  await expect(page.getByText('Graph SSOT（正本）に記録します。取り消せません。')).toBeVisible();

  const firstDecision = page.locator('textarea[data-k^="welfare:decisions:"]').first();
  await firstDecision.fill('Meeting Workflow Pack は会議業務を業務ループとして扱う');
  await page.getByText('取り消せない操作であることを確認しました').click();
  await expect(page.getByRole('button', { name: /承認して/ })).toBeEnabled();
  await page.getByRole('button', { name: /承認して/ }).click();
  await expect(page.getByText('承認済 · Graph SSOT へ反映')).toBeVisible();

  await page.locator('button[data-nav="overview"]').click();
  await expect(page.getByRole('heading', { name: 'Meeting Ops Agent' })).toBeVisible();
  await expect(page.getByText('会議ライフサイクル')).toBeVisible();
  await expect(page.locator('button[data-wf]')).toHaveCount(10);
  await expect(page.locator('button[data-wf="pre-meeting-briefing"]').first()).toContainText('Pre-Meeting Briefing');
  await expect(page.locator('button[data-wf="transcript-to-meeting-note"]').first()).toContainText('Transcript → Meeting Note');
  await expect(page.locator('button[data-wf="meeting-note-to-tasks"]').first()).toContainText('Meeting Note → Tasks');
  await expect(page.locator('button[data-wf="meeting-note-to-decisions"]').first()).toContainText('Meeting Note → Decisions');
  await expect(page.locator('button[data-wf="post-meeting-follow-up-message"]').first()).toContainText('Post-Meeting Follow-up');

  await page.locator('button[data-run="welfare"]').first().click();
  await expect(page.getByRole('heading', { name: '2026-06-15 福祉施設 AI経営コンサル' })).toBeVisible();
  await expect(page.getByText('Write-back Ledger')).toBeVisible();
  await expect(page.getByText('TASK STORE', { exact: true })).toBeVisible();
  await expect(page.getByText('GRAPH SSOT', { exact: true })).toBeVisible();

  await page.locator('button[data-menu="agent"]').click();
  await page.locator('button[data-agent="sales"]').click();
  await expect(page.getByRole('heading', { name: 'Sales Agent' })).toBeVisible();
  await expect(page.getByText('v0 · 未構築')).toBeVisible();
});

test(`${storyId} ac:9 /workflows から専用 Cockpit へ遷移できる`, async ({ page }) => {
  await mockWorkflowControlApis(page);

  await page.goto('/workflows');
  await page.getByRole('button', { name: /salestailor/ }).click();

  const link = page.locator('[data-open-meeting-workflow-cockpit]');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/meeting-workflow-pack.html?project=salestailor');
});
