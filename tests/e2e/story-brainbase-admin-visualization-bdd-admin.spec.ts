import { expect, test } from '@playwright/test';

test('story-brainbase-admin-visualization-bdd ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9 renders Japanese admin visualization surfaces', async ({ page }) => {
  const personalKgRequests: string[] = [];
  await page.route('**/api/admin/overview', async (route) => route.fulfill({
    json: {
      sources: [
        { source_class: 'graph_ssot', label: 'Graph正本', status: 'available' },
        { source_class: 'candidate_store', label: '候補ストア', status: 'available' },
        { source_class: 'personal_kg', label: '個人KG', status: 'available' },
        { source_class: 'ai_context', label: 'AI文脈リゾルバ', status: 'available' },
        { source_class: 'runtime_config', label: '設定/実行環境', status: 'available' }
      ],
      graph: { total: 1 },
      candidates: { total: 1 },
      personal_kg: { total: 2, summary: { sns_ready_count: 1, review_count: 1 } }
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
  await page.route('**/api/admin/personal-kg**', async (route) => {
    personalKgRequests.push(route.request().url());
    const url = new URL(route.request().url());
    if (url.searchParams.get('owner') === 'umeda') {
      await route.fulfill({
        json: {
          source_class: 'personal_kg',
          status: 'available',
          owner_person_id: null,
          requested_owner_person_id: 'umeda',
          summary: { total: 0, returned_count: 0 },
          records: [],
          warnings: ['指定された所有者(umeda)は現在の権限では表示できません']
        }
      });
      return;
    }
    await route.fulfill({
      json: {
        source_class: 'personal_kg',
        status: 'available',
        owner_person_id: 'sato_keigo',
        summary: { total: 2, returned_count: 1, active_count: 2, sns_ready_count: 1, review_count: 1, needs_redaction_count: 0, agency_none_count: 1, latest_seen_at: '2026-06-14T00:00:00.000Z', truncated: true },
        records: [
          { source_class: 'personal_kg', id: 'cand_kg', memory_layer: 'personal_kg_core', sns_ready: false, promotion_status: 'candidate', redaction_status: 'none', requires_approval: true, cognitive_type: 'insight', agency_level: 'synthesize', source_system: 'codex', created_at: '2026-06-14T00:00:00.000Z', body_preview: '判断基準' }
        ],
        warnings: []
      }
    });
  });
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
        { source_class: 'personal_kg', label: '個人KG', status: 'available' }
      ]
    }
  }));
  await page.route('**/api/admin/health', async (route) => route.fulfill({
    json: {
      sources: [{ source_class: 'runtime_config', label: '設定/実行環境', status: 'partial' }],
      runtime_config: {
        database: { source_class: 'runtime_config', label: 'DB接続先', status: 'available', connection_status: 'connected', keys: ['INFO_SSOT_DATABASE_URL', 'INFO_SSOT_DB_URL'] },
        keys: [
          { source_class: 'runtime_config', key: 'INFO_SSOT_DATABASE_URL', status: 'present' },
          { source_class: 'runtime_config', key: 'INFO_SSOT_DB_URL', status: 'missing' }
        ]
      }
    }
  }));

  await page.goto('/admin.html');

  // story-brainbase-admin-visualization-bdd ac:9
  // UIの主表示は日本語である。言語切り替えを入れる場合も日本語をdefault/fallbackにする。
  await expect(page.getByRole('heading', { name: 'Brainbase 管理画面' })).toBeVisible();
  await expect(page.getByText('正本、候補、個人KG、AI参照文脈、設定状態を分けて確認します。'), '日本語 default/fallback labels are visible').toBeVisible();
  await expect(page.getByRole('button', { name: '候補ストア' })).toBeVisible();
  await expect(page.getByRole('button', { name: '個人KG' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Graph正本' })).toBeVisible();
  await expect(page.getByRole('button', { name: '設定/ヘルス' })).toBeVisible();

  // story-brainbase-admin-visualization-bdd ac:1
  // OverviewでGraph SSOT、candidate-store、Personal KG、AI Context、設定/healthの状態が見える。
  await expect(page.locator('[data-overview]').getByRole('heading', { name: '個人KG' })).toBeVisible();
  await expect(page.getByText('SNS利用可')).toBeVisible();
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
  // Personal KGは現在のログイン主体に紐づく owner-visible `memory_candidates` をサーバーAPI経由で集計し、memory layer、SNS利用可否、review/redaction状態、最新候補を表示する。
  await page.getByRole('button', { name: '個人KG' }).click();
  const personalKg = page.locator('[data-section="personal-kg"]');
  await expect(personalKg.locator('.panel-header .badge.personal')).toHaveText('個人KG');
  await expect(personalKg.getByText('所有者: sato_keigo')).toBeVisible();
  await expect(personalKg.getByText('表示: 1 / 2')).toBeVisible();
  await expect(personalKg.getByText('記憶層: personal_kg_core')).toBeVisible();
  await expect(personalKg.getByText('SNS利用可: いいえ')).toBeVisible();
  await expect(personalKg.getByText('反映状態: 候補')).toBeVisible();
  await expect(personalKg.getByText('秘匿状態: なし')).toBeVisible();
  await expect(personalKg.getByText('レビュー: 要')).toBeVisible();
  await expect(personalKg.getByText('認知タイプ: insight')).toBeVisible();
  await expect(personalKg.getByText('AI利用: synthesize')).toBeVisible();
  await expect(personalKg.getByText('入力元: codex')).toBeVisible();
  await expect(personalKg.getByText('作成日時: 2026-06-14T00:00:00.000Z')).toBeVisible();
  await expect(personalKg.getByText('最新: 2026-06-14T00:00:00.000Z')).toBeVisible();
  await expect(personalKg.getByText('要レビュー')).toBeVisible();
  await expect(personalKg.getByRole('button', { name: 'さらに表示' })).toBeVisible();
  await expect(personalKg.getByText('判断基準')).toBeVisible();
  expect(personalKgRequests.some((url) => url.includes('/api/admin/personal-kg')), 'Personal KGはサーバーAPI経由で集計する').toBe(true);

  // story-brainbase-admin-visualization-bdd ac:5
  // Personal KGでアクセス外ownerを指定した場合は、別ownerへ黙ってフォールバックせず、表示対象外の状態と理由を日本語で表示する。
  await personalKg.getByLabel('所有者').fill('umeda');
  await personalKg.getByRole('button', { name: '絞り込み' }).click();
  await expect(personalKg.getByText('表示対象外'), 'ac:5 out-of-scope owner is not silently replaced by the login owner').toBeVisible();
  await expect(personalKg.getByText('指定された所有者(umeda)は現在の権限では表示できません'), 'ac:5 reason is visible in Japanese').toBeVisible();
  await expect(personalKg.getByText('全件表示')).not.toBeVisible();

  // story-brainbase-admin-visualization-bdd ac:6
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

  // story-brainbase-admin-visualization-bdd ac:7
  // 設定/healthはSSOTサーバーパターンのDB接続先キーの存在有無と、サーバー側の実接続チェック結果を分けて示すが、secret値そのものは返さない。
  await page.getByRole('button', { name: '設定/ヘルス' }).click();
  const health = page.locator('[data-section="health"]');
  await expect(health.getByText('DB接続先')).toBeVisible();
  await expect(health.getByText('接続: 接続済み')).toBeVisible();
  await expect(health.getByText('値: 非表示').first()).toBeVisible();
  // story-brainbase-admin-visualization-bdd ac:8
  // Graph、candidate-store、Personal KG、DB接続の一部が失敗した場合でも、管理画面全体を500にせず、該当sourceを `unavailable` または `partial` として表示する。
  await expect(health.getByText('一部不足')).toBeVisible();
  await expect(health.getByText('不足', { exact: true })).toBeVisible();
});

test('story-brainbase-admin-visualization-bdd ac:8 shows Graph and candidate-store unavailable states as visible errors', async ({ page }) => {
  await page.route('**/api/admin/overview', async (route) => route.fulfill({
    json: {
      sources: [
        { source_class: 'graph_ssot', label: 'Graph正本', status: 'unavailable' },
        { source_class: 'candidate_store', label: '候補ストア', status: 'unavailable' },
        { source_class: 'personal_kg', label: '個人KG', status: 'available' },
        { source_class: 'ai_context', label: 'AI文脈リゾルバ', status: 'available' },
        { source_class: 'runtime_config', label: '設定/実行環境', status: 'partial' }
      ],
      graph: { total: 0 },
      candidates: { total: 0 },
      personal_kg: { total: 0, summary: {} }
    }
  }));
  await page.route('**/api/admin/graph/entities**', async (route) => route.fulfill({
    json: {
      source_class: 'graph_ssot',
      status: 'unavailable',
      reason: 'InfoSSOTService is not configured',
      records: []
    }
  }));
  await page.route('**/api/admin/candidates**', async (route) => route.fulfill({
    json: {
      source_class: 'candidate_store',
      status: 'unavailable',
      reason: 'candidateRepository is not configured',
      records: []
    }
  }));

  await page.goto('/admin.html');

  await page.getByRole('button', { name: 'Graph正本' }).click();
  const graph = page.locator('[data-section="graph"]');
  await expect(graph.getByText('未接続')).toBeVisible();
  await expect(graph.getByText('Graph正本サービスが未設定です')).toBeVisible();
  await expect(graph.getByText('表示できるレコードがありません')).not.toBeVisible();

  await page.getByRole('button', { name: '候補ストア' }).click();
  const candidates = page.locator('[data-section="candidates"]');
  await expect(candidates.getByText('未接続')).toBeVisible();
  await expect(candidates.getByText('候補ストアリポジトリが未設定です')).toBeVisible();
  await expect(candidates.getByText('表示できるレコードがありません')).not.toBeVisible();
});

test('story-brainbase-admin-visualization-bdd ac:10 /api/admin/* requires authenticated access', async ({ request }) => {
  // story-brainbase-admin-visualization-bdd ac:10
  // `/api/admin/*` は認証済みユーザーの `req.access` に従い、未認証では使えない。
  const response = await request.get('/api/admin/overview');
  expect(response.status(), '未認証では使えない').toBe(401);
});
