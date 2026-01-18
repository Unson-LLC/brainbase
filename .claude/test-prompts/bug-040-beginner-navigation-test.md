# BUG-040: 初心者ナビゲーション テンプレート作成後の進行テスト

## テスト目的

初心者ナビゲーション 3/5「テンプレートを作成」完了後、自動的に4/5「プロジェクトを実行」に進むことを検証する。

## 背景

**修正内容**: `/api/templates` (GET) のレスポンス構造を `{ templates: [...] }` から `{ data: [...] }` に変更し、他のAPIと構造を統一した。

**修正箇所**: `src/app/api/templates/route.ts:274`

**期待される動作**: テンプレートを1つ以上作成すると、初心者ナビゲーションが自動的に3/5から4/5に進む。

## Playwrightテスト実装手順

### 1. テストファイル作成

**配置場所**: `tests/e2e/basic/beginner-navigation-template-creation.spec.ts`

### 2. テスト前提条件

- 新規ユーザーまたは初心者ナビゲーション進行中のユーザー
- プロフィール設定完了（1/5, 2/5完了）
- テンプレート未作成（3/5未完了）

### 3. テストシナリオ

#### メインシナリオ

```typescript
test("初心者ナビゲーション: テンプレート作成後に4/5に進む", async ({
  page,
}) => {
  // 1. ログイン（初心者ナビゲーション進行中のユーザー）
  // 2. ダッシュボードに移動
  // 3. 初心者ナビゲーションが3/5「テンプレートを作成」を表示していることを確認
  // 4. 「テンプレートを作成」ボタンをクリック
  // 5. テンプレート作成ページ (/templates) に遷移
  // 6. 必須フィールドを入力してテンプレートを作成
  //    - 基本情報: 名前、説明
  //    - メッセージ戦略: モード選択（AI自動など）
  //    - 実行設定: 実行優先度選択
  //    - KPI設定: 主要KPI選択
  // 7. 「作成」ボタンをクリック
  // 8. テンプレート一覧ページに戻る
  // 9. ダッシュボードに戻る
  // 10. 初心者ナビゲーションが4/5「プロジェクトを実行」に進んでいることを確認
  // 11. 3/5「テンプレートを作成」が完了マークになっていることを確認
});
```

#### エッジケース1: 複数テンプレート作成

```typescript
test("初心者ナビゲーション: 複数テンプレート作成後も4/5に進む", async ({
  page,
}) => {
  // 1つ目のテンプレート作成後、さらに2つ目を作成しても正しく4/5を表示
});
```

#### エッジケース2: ページリロード後の状態維持

```typescript
test("初心者ナビゲーション: ページリロード後も4/5の状態を維持", async ({
  page,
}) => {
  // テンプレート作成後、ページをリロードしても4/5の状態が維持される
});
```

### 4. 検証ポイント

#### API レスポンス構造の確認

```typescript
// /api/templates (GET) のレスポンスが正しい構造であることを確認
page.route("**/api/templates*", async (route) => {
  const response = await route.fetch();
  const json = await response.json();

  // 新しい構造: { data: [...], total: number }
  expect(json).toHaveProperty("data");
  expect(json).toHaveProperty("total");
  expect(Array.isArray(json.data)).toBe(true);

  // 古い構造が使われていないことを確認
  expect(json).not.toHaveProperty("templates");

  route.fulfill({ response });
});
```

#### UI要素の確認

```typescript
// 初心者ナビゲーションの進行状態
await expect(
  page.locator('[data-testid="beginner-nav-step-3"]'),
).toHaveAttribute("data-status", "completed");
await expect(
  page.locator('[data-testid="beginner-nav-step-4"]'),
).toHaveAttribute("data-status", "current");

// または、テキストベースの確認
await expect(page.getByText("3/5", { exact: false })).not.toBeVisible();
await expect(page.getByText("4/5", { exact: false })).toBeVisible();
await expect(page.getByText("プロジェクトを実行")).toBeVisible();
```

### 5. テストデータ準備

#### 初心者ナビゲーション進行中のユーザー作成

```typescript
// セットアップ関数
async function setupBeginnerUser() {
  // 1. 新規ユーザー作成
  // 2. プロフィール設定（name, company, email）
  // 3. 商品情報登録（1つ以上）
  // 4. テンプレートは未作成の状態
  // 5. ダッシュボードで初心者ナビゲーションが3/5を表示していることを確認
}
```

### 6. テスト実行コマンド

```bash
# 単体実行
npx playwright test tests/e2e/basic/beginner-navigation-template-creation.spec.ts

# UI モードで実行（デバッグ用）
npx playwright test tests/e2e/basic/beginner-navigation-template-creation.spec.ts --ui

# ヘッドレスモードで実行
npx playwright test tests/e2e/basic/beginner-navigation-template-creation.spec.ts --headed
```

## 実装時の注意事項

### 1. 認証状態の管理

- `tests/e2e/fixtures/auth.ts` の既存認証ヘルパーを使用
- または新規に初心者ユーザー用のフィクスチャを作成

### 2. データクリーンアップ

- テスト終了後、作成したテンプレートを削除
- ユーザーの初心者ナビゲーション状態をリセット

### 3. 待機処理

- API呼び出し完了を待つ: `await page.waitForResponse('**/api/templates')`
- UI更新を待つ: `await page.waitForSelector('[data-testid="beginner-nav-step-4"]')`

### 4. エラーハンドリング

- テンプレート作成失敗時のエラーメッセージ確認
- APIエラー時のフォールバック動作確認

## 期待される結果

### 成功時

- ✅ テンプレート作成後、初心者ナビゲーションが4/5に進む
- ✅ 3/5「テンプレートを作成」が完了マークになる
- ✅ 4/5「プロジェクトを実行」が現在のステップとして表示される
- ✅ API レスポンスが `{ data: [...], total: number }` 形式である

### 失敗時（修正前の動作）

- ❌ テンプレート作成後も3/5のまま進まない
- ❌ API レスポンスが `{ templates: [...], total: number }` 形式である
- ❌ `useUserProgress.ts` が `templatesData?.data` を取得できない

## 関連ファイル

- **修正ファイル**: `src/app/api/templates/route.ts`
- **影響を受けるフック**: `src/hooks/useUserProgress.ts`
- **関連コンポーネント**: ダッシュボードの初心者ナビゲーション
- **PR**: https://github.com/Unson-LLC/salestailor/pull/819

## 参考情報

- Playwright公式ドキュメント: https://playwright.dev/
- プロジェクトのE2Eテストガイド: `tests/e2e/README.md`
- 既存の初心者ナビゲーションテスト: `tests/e2e/*/dashboard*.spec.ts`
