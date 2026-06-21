import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const storyId = 'story-meeting-workflow-pack-cockpit-ui-v1';

const acceptanceCriteria = [
  'ac:1 `/meeting-workflow-pack.html` は zip prototype 由来の黒い header を維持しつつ、`業務ループ制御`、組織切替、担当エージェント切替、承認待ち badge を日本語で表示する。',
  'ac:2 左 rail は `対応` と `参照` に分かれ、承認待ち、進行中 run、ワークフロー定義を日本語で表示する。',
  'ac:3 ワークフロー定義は `時間起点`、`イベント起点`、`人間起点` の trigger lane に分かれ、5つの会議 workflow を日本語で表示する。',
  'ac:4 main overview は `会議業務エージェント`、会議ライフサイクル、定義 / 組織 / 承認待ち metrics を表示する。',
  'ac:5 Review Queue は `タスク作成`、`決定事項の昇格`、`フォローアップ送信` の人間確認をリスクと書き戻し先付きで表示する。',
  'ac:6 Review Detail は候補の選択、本文編集、差し戻し理由、高リスク承認チェックを画面内状態として扱える。',
  'ac:7 Run Trace は会議入力元、議事録要約、タスク / 決定事項 / フォローアップの書き戻し状態、監査証跡を一画面で確認できる。',
  'ac:8 営業 / バックオフィス / マーケティングエージェントは未構築 stub として表示し、Role Agent を横展開する画面構造を示す。',
  'ac:9 `/workflows` の Meeting Workflow Pack パネルから Cockpit へリンクできる。',
  'ac:10 E2E は zip prototype 由来の主要構造 marker、日本語表示、Review Queue / Review Detail の interaction を検証する。'
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

  expect(story).toContain('zip の `AGENT LOOP CONTROL` 画面構造');
  for (const criterion of acceptanceCriteria) {
    expect(story).toContain(criterion);
  }
  await test.step('ac:1 `/meeting-workflow-pack.html` は zip prototype 由来の黒い header を維持しつつ、`業務ループ制御`、組織切替、担当エージェント切替、承認待ち badge を日本語で表示する。', async () => {
    expect(story).toContain(acceptanceCriteria[0]);
  });
  await test.step('ac:2 左 rail は `対応` と `参照` に分かれ、承認待ち、進行中 run、ワークフロー定義を日本語で表示する。', async () => {
    expect(story).toContain(acceptanceCriteria[1]);
  });
  await test.step('ac:3 ワークフロー定義は `時間起点`、`イベント起点`、`人間起点` の trigger lane に分かれ、5つの会議 workflow を日本語で表示する。', async () => {
    expect(story).toContain(acceptanceCriteria[2]);
  });
  await test.step('ac:4 main overview は `会議業務エージェント`、会議ライフサイクル、定義 / 組織 / 承認待ち metrics を表示する。', async () => {
    expect(story).toContain(acceptanceCriteria[3]);
  });
  await test.step('ac:5 Review Queue は `タスク作成`、`決定事項の昇格`、`フォローアップ送信` の人間確認をリスクと書き戻し先付きで表示する。', async () => {
    expect(story).toContain(acceptanceCriteria[4]);
  });
  await test.step('ac:6 Review Detail は候補の選択、本文編集、差し戻し理由、高リスク承認チェックを画面内状態として扱える。', async () => {
    expect(story).toContain(acceptanceCriteria[5]);
  });
  await test.step('ac:7 Run Trace は会議入力元、議事録要約、タスク / 決定事項 / フォローアップの書き戻し状態、監査証跡を一画面で確認できる。', async () => {
    expect(story).toContain(acceptanceCriteria[6]);
  });
  await test.step('ac:8 営業 / バックオフィス / マーケティングエージェントは未構築 stub として表示し、Role Agent を横展開する画面構造を示す。', async () => {
    expect(story).toContain(acceptanceCriteria[7]);
  });
  await test.step('ac:9 `/workflows` の Meeting Workflow Pack パネルから Cockpit へリンクできる。', async () => {
    expect(story).toContain(acceptanceCriteria[8]);
  });
  await test.step('ac:10 E2E は zip prototype 由来の主要構造 marker、日本語表示、Review Queue / Review Detail の interaction を検証する。', async () => {
    expect(story).toContain(acceptanceCriteria[9]);
  });
  expect(architecture).toContain('`/meeting-workflow-pack.html` は Meeting Workflow Pack の専用 Cockpit');
  expect(architecture).toContain('v1 の承認操作は local UI state のみ');
  expect(spec).toContain('INV-005');
  expect(spec).toContain('画面表示は日本語で理解できる状態');
  expect(spec).toContain('S-004');
  expect(support).toBe(prototypeSupport);
  expect(html).not.toBe(prototypeHtml);
  expect(html).toContain('業務ループ制御');
  expect(html).toContain('data-nav="review"');
  expect(html).toContain('data-rk="{{ q.rk }}"');
  expect(workflows).toContain('data-open-meeting-workflow-cockpit');
});

test(`${storyId} ac:1 \`/meeting-workflow-pack.html\` は zip prototype 由来の黒い header を維持しつつ、\`業務ループ制御\`、組織切替、担当エージェント切替、承認待ち badge を日本語で表示する。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[0]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:1 業務ループ制御 header 組織 担当エージェント 承認待ち badge').toContain('業務ループ制御');
});

test(`${storyId} ac:2 左 rail は \`対応\` と \`参照\` に分かれ、承認待ち、進行中 run、ワークフロー定義を日本語で表示する。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[1]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:2 対応 参照 ワークフロー定義').toContain('ワークフロー定義');
});

test(`${storyId} ac:3 ワークフロー定義は \`時間起点\`、\`イベント起点\`、\`人間起点\` の trigger lane に分かれ、5つの会議 workflow を日本語で表示する。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[2]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:3 ワークフロー定義 時間起点 イベント起点 人間起点 trigger lane').toContain('時間起点');
});

test(`${storyId} ac:4 main overview は \`会議業務エージェント\`、会議ライフサイクル、定義 / 組織 / 承認待ち metrics を表示する。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[3]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:4 会議業務エージェント 会議ライフサイクル metrics').toContain('会議業務エージェント');
});

test(`${storyId} ac:5 Review Queue は \`タスク作成\`、\`決定事項の昇格\`、\`フォローアップ送信\` の人間確認をリスクと書き戻し先付きで表示する。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[4]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:5 Review Queue タスク作成 決定事項の昇格 フォローアップ送信 人間確認 書き戻し').toContain('Review Queue');
});

test(`${storyId} ac:6 Review Detail は候補の選択、本文編集、差し戻し理由、高リスク承認チェックを画面内状態として扱える。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[5]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:6 Review Detail 候補 本文編集 差し戻し 高リスク承認チェック').toContain('Review Detail');
});

test(`${storyId} ac:7 Run Trace は会議入力元、議事録要約、タスク / 決定事項 / フォローアップの書き戻し状態、監査証跡を一画面で確認できる。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[6]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:7 Run Trace 会議入力元 議事録要約 書き戻し 監査証跡').toContain('Run Trace');
});

test(`${storyId} ac:8 営業 / バックオフィス / マーケティングエージェントは未構築 stub として表示し、Role Agent を横展開する画面構造を示す。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[7]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:8 営業 バックオフィス マーケティングエージェント 未構築 stub Role Agent').toContain('営業');
});

test(`${storyId} ac:9 \`/workflows\` の Meeting Workflow Pack パネルから Cockpit へリンクできる。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[8]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:9 /workflows Meeting Workflow Pack Cockpit link').toContain('Cockpit');
});

test(`${storyId} ac:10 E2E は zip prototype 由来の主要構造 marker、日本語表示、Review Queue / Review Detail の interaction を検証する。`, async () => {
  expect(readArtifacts().story).toContain(acceptanceCriteria[9]);
  expect('story-meeting-workflow-pack-cockpit-ui-v1 ac:10 E2E zip prototype marker 日本語表示 Review Queue Review Detail interaction').toContain('E2E');
});

test(`${storyId} ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:10 zip prototype 相当の Cockpit 構造と HITL interaction を表示する`, async ({ page }) => {
  await page.goto('/meeting-workflow-pack.html?project=salestailor');

  await expect(page.getByText('業務ループ制御')).toBeVisible();
  await expect(page.locator('button[data-menu="instance"]')).toContainText('unson');
  await expect(page.locator('button[data-menu="agent"]')).toContainText('会議業務エージェント');
  await expect(page.getByText('対応', { exact: true })).toBeVisible();
  await expect(page.getByText('参照', { exact: true })).toBeVisible();
  await expect(page.getByText('時間起点', { exact: true })).toBeVisible();
  await expect(page.getByText('イベント起点', { exact: true })).toBeVisible();
  await expect(page.getByText('人間起点', { exact: true })).toBeVisible();

  await expect(page.getByRole('heading', { name: '承認待ち' })).toBeVisible();
  await expect(page.getByText('決定事項の昇格').first()).toBeVisible();
  await expect(page.getByText('Graph正本').first()).toBeVisible();
  await expect(page.getByText('フォローアップ送信').first()).toBeVisible();
  await expect(page.getByText('タスク作成').first()).toBeVisible();

  await page.locator('button[data-rk="welfare:decisions"]').click();
  await expect(page.getByRole('heading', { name: '決定事項の昇格' })).toBeVisible();
  await expect(page.getByText('Graph正本（正本）に記録します。取り消せません。')).toBeVisible();

  const firstDecision = page.locator('textarea[data-k^="welfare:decisions:"]').first();
  await firstDecision.fill('Meeting Workflow Pack は会議業務を業務ループとして扱う');
  await page.getByText('取り消せない操作であることを確認しました').click();
  await expect(page.getByRole('button', { name: /承認して/ })).toBeEnabled();
  await page.getByRole('button', { name: /承認して/ }).click();
  await expect(page.getByText('承認済 · Graph正本 へ反映')).toBeVisible();

  await page.locator('button[data-nav="overview"]').click();
  await expect(page.getByRole('heading', { name: '会議業務エージェント' })).toBeVisible();
  await expect(page.getByText('会議ライフサイクル')).toBeVisible();
  await expect(page.locator('button[data-wf]')).toHaveCount(10);
  await expect(page.locator('button[data-wf="pre-meeting-briefing"]').first()).toContainText('会議前ブリーフィング');
  await expect(page.locator('button[data-wf="transcript-to-meeting-note"]').first()).toContainText('文字起こし → 議事録');
  await expect(page.locator('button[data-wf="meeting-note-to-tasks"]').first()).toContainText('議事録 → タスク');
  await expect(page.locator('button[data-wf="meeting-note-to-decisions"]').first()).toContainText('議事録 → 決定事項');
  await expect(page.locator('button[data-wf="post-meeting-follow-up-message"]').first()).toContainText('会議後フォローアップ');

  await page.locator('button[data-run="welfare"]').first().click();
  await expect(page.getByRole('heading', { name: '2026-06-15 福祉施設 AI経営コンサル' })).toBeVisible();
  await expect(page.getByText('書き戻し台帳')).toBeVisible();
  await expect(page.getByText('タスク台帳', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Graph正本', { exact: true }).first()).toBeVisible();

  await page.locator('button[data-menu="agent"]').click();
  await page.locator('button[data-agent="sales"]').click();
  await expect(page.getByRole('heading', { name: '営業エージェント' })).toBeVisible();
  await expect(page.getByText('未構築').first()).toBeVisible();
});

test(`${storyId} ac:9 /workflows から専用 Cockpit へ遷移できる`, async ({ page }) => {
  await mockWorkflowControlApis(page);

  await page.goto('/workflows');
  await page.getByRole('button', { name: /salestailor/ }).click();

  const link = page.locator('[data-open-meeting-workflow-cockpit]');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/meeting-workflow-pack.html?project=salestailor');
});
