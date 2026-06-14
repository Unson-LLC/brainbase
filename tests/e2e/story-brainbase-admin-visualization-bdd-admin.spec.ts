import { expect, test } from '@playwright/test';

test('story-brainbase-admin-visualization-bdd renders Japanese admin visualization surfaces', async ({ page }) => {
  await page.route('**/api/admin/overview', async (route) => route.fulfill({
    json: {
      sources: [
        { source_class: 'graph_ssot', label: 'Graph正本', status: 'available' },
        { source_class: 'candidate_store', label: '候補ストア', status: 'available' },
        { source_class: 'ai_context', label: 'AI文脈リゾルバ', status: 'available' },
        { source_class: 'derived_index', label: 'LightRAG / 派生index', status: 'not_configured' },
        { source_class: 'runtime_config', label: '設定/実行環境', status: 'available' }
      ],
      graph: { total: 1 },
      candidates: { total: 1 },
      derived_indexes: [{ id: 'lightrag' }]
    }
  }));
  await page.route('**/api/admin/graph/entities**', async (route) => route.fulfill({
    json: {
      source_class: 'graph_ssot',
      records: [
        { source_class: 'graph_ssot', id: 'project_brainbase', label: 'Brainbase', entity_type: 'project', project_code: 'brainbase', sensitivity: 'internal', role_min: 'member', updated_at: '2026-06-14T00:00:00.000Z', payload_preview: '{"name":"Brainbase"}' }
      ]
    }
  }));
  await page.route('**/api/admin/candidates**', async (route) => route.fulfill({
    json: {
      source_class: 'candidate_store',
      records: [
        { source_class: 'candidate_store', id: 'cand_1', promotion_status: 'candidate', redaction_status: 'none', cognitive_type: 'preference', visibility: 'owner', sensitivity: 'internal', role_min: 'member', created_at: '2026-06-14T00:00:00.000Z', body_preview: '候補本文' }
      ]
    }
  }));
  await page.route('**/api/csrf-token', async (route) => route.fulfill({ json: { token: 'csrf-123' } }));
  await page.route('**/api/admin/context-preview', async (route) => {
    expect(route.request().headers()['x-csrf-token']).toBe('csrf-123');
    const payload = route.request().postDataJSON();
    expect(payload).toMatchObject({ project: 'brainbase', includeEdges: true, includePhilosophy: true });
    await route.fulfill({
      json: {
        source_class: 'ai_context',
        status: 'available',
        warnings: ['1件のmemoryは除外されました'],
        preview: {
          project_code: 'brainbase',
          entity_count: 1,
          edge_count: 1,
          report_preview: 'Brainbase context preview',
          included: [{ type: 'project', count: 1 }],
          memory: { included_count: 0, denied_count: 1, denied_reasons: { private_scope_denied: 1 } },
          philosophy_context: { included_in_agent_context: true }
        }
      }
    });
  });
  await page.route('**/api/admin/data-flow**', async (route) => route.fulfill({
    json: {
      source_class: 'ai_context',
      steps: [
        { source_class: 'candidate_store', label: '候補ストア', status: 'not_found', reason: '候補IDは存在しないか現在の権限では参照できません' },
        { source_class: 'graph_ssot', label: 'Graph正本', status: 'available', reason: '正本IDは現在の権限で参照できます' },
        { source_class: 'ai_context', label: 'AI文脈リゾルバ', status: 'available' },
        { source_class: 'derived_index', label: '派生index', status: 'not_configured' }
      ]
    }
  }));
  await page.route('**/api/admin/health', async (route) => route.fulfill({
    json: {
      sources: [{ source_class: 'runtime_config', label: '設定/実行環境', status: 'available' }],
      runtime_config: { keys: [{ source_class: 'runtime_config', key: 'AUTH_SESSION_SECRET', status: 'present' }] }
    }
  }));

  await page.goto('/admin.html');

  // story-brainbase-admin-visualization-bdd ac:6
  // UIの主表示は日本語である。言語切り替えを入れる場合も日本語をdefault/fallbackにする。
  await expect(page.getByRole('heading', { name: 'Brainbase 管理画面' })).toBeVisible();
  await expect(page.getByText('正本、候補、AI参照文脈、派生index、設定状態を分けて確認します。'), '日本語 default/fallback labels are visible').toBeVisible();
  await expect(page.getByRole('button', { name: '候補ストア' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Graph正本' })).toBeVisible();
  await expect(page.getByRole('button', { name: '設定/ヘルス' })).toBeVisible();

  // story-brainbase-admin-visualization-bdd ac:1
  // OverviewでGraph SSOT、candidate-store、AI Context、LightRAG/derived index、設定/healthの状態が見える。
  await expect(page.getByText('LightRAG / 派生index')).toBeVisible();
  await expect(page.getByRole('heading', { name: '設定/実行環境' })).toBeVisible();
  await expect(page.getByText('AI文脈リゾルバ')).toBeVisible();

  // story-brainbase-admin-visualization-bdd ac:2
  // Graph SSOT一覧はentity type、project、sensitivity、role_min、updated_atを持ち、読み取り専用である。
  await page.getByRole('button', { name: 'Graph正本' }).click();
  await expect(page.locator('[data-section="graph"] .panel-header .badge.graph')).toHaveText('Graph正本');
  await expect(page.getByText('種別: project')).toBeVisible();
  await expect(page.getByText('project: brainbase')).toBeVisible();
  await expect(page.getByText('sensitivity: internal')).toBeVisible();
  await expect(page.getByText('role_min: member')).toBeVisible();
  await expect(page.getByText('updated_at: 2026-06-14T00:00:00.000Z')).toBeVisible();

  // story-brainbase-admin-visualization-bdd ac:3
  // candidate-store一覧はpromotion_status、redaction_status、cognitive_type、visibility、sensitivity、created_atを持ち、Graph正本と混ぜて表示しない。
  await page.getByRole('button', { name: '候補ストア' }).click();
  const candidates = page.locator('[data-section="candidates"]');
  await expect(candidates.locator('.panel-header .badge.candidate')).toHaveText('候補ストア');
  await expect(candidates.getByText('promotion: 候補')).toBeVisible();
  await expect(candidates.getByText('redaction: なし')).toBeVisible();
  await expect(candidates.getByText('cognitive: preference')).toBeVisible();
  await expect(candidates.getByText('visibility: owner')).toBeVisible();
  await expect(candidates.getByText('sensitivity: internal')).toBeVisible();
  await expect(candidates.getByText('created_at: 2026-06-14T00:00:00.000Z')).toBeVisible();

  // story-brainbase-admin-visualization-bdd ac:4
  // AI Context Previewはproject/entity type/edge/memory条件を指定でき、含まれた文脈と除外・未接続理由を区別して表示する。
  await page.getByRole('button', { name: 'AI文脈' }).click();
  const context = page.locator('[data-section="context"]');
  await expect(context.getByLabel('プロジェクト'), 'project/entity type/edge/memory条件を指定できる').toHaveValue('brainbase');
  await expect(context.getByLabel('Entity種別'), 'AI Context Preview input is available').toHaveValue('project,person,org,decision,raci_assignment');
  await expect(context.getByLabel('edgeを含める'), 'project/entity type/edge/memory条件を指定できる').toBeChecked();
  await context.getByLabel('memory条件を評価').check();
  await page.getByRole('button', { name: '文脈を確認' }).click();
  await expect(page.getByText('1件のmemoryは除外されました'), '含まれた文脈と除外・未接続理由を区別して表示する').toBeVisible();
  await expect(page.getByText('含まれた文脈')).toBeVisible();
  await expect(page.getByText('project: 1')).toBeVisible();
  await expect(page.getByText('除外理由')).toBeVisible();
  await expect(page.getByText('private_scope_denied: 1')).toBeVisible();
  await expect(page.getByText('philosophy: 含む')).toBeVisible();

  await page.getByRole('button', { name: 'データフロー' }).click();
  await page.getByPlaceholder('project_...').fill('project_brainbase');
  await page.getByPlaceholder('cand_...').fill('cand_missing');
  await page.getByRole('button', { name: '絞り込み' }).click();
  const flow = page.locator('[data-section="flow"]');
  await expect(flow.getByText('未検出')).toBeVisible();
  await expect(flow.getByText('候補IDは存在しないか現在の権限では参照できません')).toBeVisible();

  // story-brainbase-admin-visualization-bdd ac:5
  // 設定/healthは存在有無と接続状態を示すが、secret値そのものは返さない。
  await page.getByRole('button', { name: '設定/ヘルス' }).click();
  const health = page.locator('[data-section="health"]');
  await expect(health.getByText('存在', { exact: true })).toBeVisible();
  await expect(health.getByText('値: 非表示')).toBeVisible();
});

test('story-brainbase-admin-visualization-bdd ac:7 /api/admin/* requires authenticated access', async ({ request }) => {
  // story-brainbase-admin-visualization-bdd ac:7
  // `/api/admin/*` は認証済みユーザーの `req.access` に従い、未認証では使えない。
  const response = await request.get('/api/admin/overview');
  expect(response.status(), '未認証では使えない').toBe(401);
});
