---
name: form-submission-test-improvement
description: 失敗した企業のフォーム送信テストを繰り返し実行し、エラーパターンを分析して改善策を実装することで成功率を向上させるスキル (project)
---

# フォーム送信テスト改善スキル

## 目的

`scripts/test/test-all-failed-companies.ts`のFAILED_COMPANIESに記載された企業に対してフォーム送信テストを繰り返し実行し、失敗パターンを分析・分類して改善策を実装し、成功率を継続的に向上させる。

## 安全対策

**重要**: `.env`で`ENABLE_FORM_SUBMISSION=false`が設定されていることを必ず確認する。この設定により、送信ボタンのクリックはスキップされ、実際の送信は行われない。

```bash
# 実行前に必ず確認
grep "ENABLE_FORM_SUBMISSION" .env
# 期待される出力: ENABLE_FORM_SUBMISSION=false
```

---

## 🚨 重要: ログ出力ルール（絶対厳守）

**全てのログ・レポートは必ず`.tmp/form-test/YYYYMMDD/`ディレクトリに出力すること**

```bash
# 1. 日付ディレクトリ作成（必須・最初に実行）
mkdir -p .tmp/form-test/$(date +%Y%m%d)

# 2. テスト実行（必ずteeで階層ディレクトリに出力）
npx tsx scripts/test/test-all-failed-companies.ts 2>&1 | tee .tmp/form-test/$(date +%Y%m%d)/test-$(date +%H%M%S).log

# 3. 分析レポートも同じディレクトリに保存
# .tmp/form-test/YYYYMMDD/analysis-report.md
```

### ディレクトリ構造

```
.tmp/
└── form-test/
    └── 20250107/
        ├── test-120000.log           # テストログ（タイムスタンプ付き）
        ├── test-143000.log           # 追加テストログ
        ├── analysis-report.md        # 分析レポート
        └── debug/                    # デバッグ用スクリーンショット等
            └── screenshot-*.png
```

---

## 主な機能

### 1. テスト実行

```bash
# 全企業をテスト（65社）- 必ず階層ディレクトリに出力
mkdir -p .tmp/form-test/$(date +%Y%m%d)
npx tsx scripts/test/test-all-failed-companies.ts 2>&1 | tee .tmp/form-test/$(date +%Y%m%d)/test-$(date +%H%M%S).log
```

### 2. エラーパターン分類

テスト結果を以下のカテゴリに分類:

| カテゴリ | 説明 | 対応可否 |
|---------|------|----------|
| メールのみ対応 | mailto:リンクのみ | **対応不要** |
| サイト側問題 | ドメイン消失/403/404 | **対応不可** |
| CAPTCHA | reCAPTCHA/画像認証 | **対応困難** |
| フォーム要素なし | `<form>`タグ検出失敗 | 要改善 |
| 送信ボタン検出失敗 | ボタンが見つからない | 要改善 |
| フィールド入力失敗 | 特定フィールド入力エラー | 要改善 |
| 外部サービス | Jimdo/Zendesk等 | 要個別対応 |

### 3. 分析レポート生成

レポートは必ず`.tmp/form-test/YYYYMMDD/analysis-report.md`に保存:

```markdown
# テスト結果レポート

## サマリー
- 総テストケース: 65件
- 成功: X件 (X%)
- 失敗: X件 (X%)

## 失敗ケース詳細（URL付き）
### 1. メールのみ対応（対応不要）- X件
| 企業名 | URL | 備考 |
|--------|-----|------|
...

## 改善優先順位
1. [高] XX件に影響するパターンAの改善
2. [中] XX件に影響するパターンBの改善
```

---

## 実装済み改善（2025-01-07）

### 1. ログインフォーム除外機能

**ファイル**: `src/lib/services/form-automation/page.ts`

```typescript
// パスワードフィールドを含むフォームをスキップ
const hasPasswordField = await form.locator('input[type="password"]').count();
if (hasPasswordField > 0) {
  console.info(`フォーム ${i} はログインフォームとしてスキップ`);
  continue;
}
```

**効果**: Breraが成功（ログインフォームと問い合わせフォームの混在ページ）

### 2. 日付ピッカー対応

**ファイル**: `src/lib/services/form-automation/formField.ts`

```typescript
// フィールド検出時: flatpickrクラスやname属性に"date"を含む場合にdate型として検出
const fieldClass = await fieldLocator.getAttribute("class");
if (fieldClass?.includes("flatpickr") && type === "text") {
  type = "date";
}
const nameAttr = await fieldLocator.getAttribute("name");
if (nameAttr?.toLowerCase().includes("date") && type === "text") {
  type = "date";
}

// 入力時: flatpickrは元のinputを非表示にするため、可視性チェックをスキップ
case "date":
  const dateSet = await this._fillDateField(locator, value);
  if (!dateSet) {
    // 非表示の場合はJavaScriptで直接値を設定
    await locator.evaluate((el, val) => {
      el.value = val;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  }
  break;
```

**対象**: Fix mart（flatpickr使用）

### 3. 送信ボタン検出改善（部分一致対応）

**ファイル**:
- `src/constants/formAutomation.ts`
- `src/lib/services/form-automation/page.ts`

```typescript
// 新しい部分一致パターン
export const SUBMIT_BUTTON_TEXT_PARTIAL_REGEX =
  /(送る|送信|確認.*(送信|する)|入力.*確認|申込|登録|Submit|Send|Confirm)/i;

// 検出時: 完全一致と部分一致の両方をチェック
const textMatch = buttonText && (
  SUBMIT_BUTTON_TEXT_REGEX.test(buttonText.trim()) ||
  SUBMIT_BUTTON_TEXT_PARTIAL_REGEX.test(buttonText.trim())
);
```

**対象**: iPhone修理救急便（「入力内容を確認して送信する」ボタン）

---

## 改善対象ファイル

```typescript
// 主要な改善対象ファイル
src/lib/services/contactFormAutomation.ts    // フォーム自動入力・送信
src/lib/services/contactFormFinder.ts        // フォーム検出
src/lib/services/contactFormLlm.ts           // LLMによるフォーム分析
src/lib/services/form-automation/            // フォーム自動化モジュール
  ├── browser.ts                             // ブラウザ制御
  ├── formField.ts                           // フィールド処理（日付ピッカー対応）
  └── page.ts                                // ページ処理（ログインフォーム除外）
```

---

## ワークフロー

### フェーズ1: 初回テスト実行

```bash
# 1. 環境変数確認
grep "ENABLE_FORM_SUBMISSION" .env

# 2. 日付ディレクトリ作成
mkdir -p .tmp/form-test/$(date +%Y%m%d)

# 3. テスト実行（階層ディレクトリに出力）
npx tsx scripts/test/test-all-failed-companies.ts 2>&1 | tee .tmp/form-test/$(date +%Y%m%d)/initial-test.log

# 4. 結果サマリー確認
grep -E "^\[.*\/65\]|✅|❌" .tmp/form-test/$(date +%Y%m%d)/initial-test.log | tail -100
```

### フェーズ2: 結果分析

```bash
# 成功/失敗カウント
echo "成功数:" && grep "✅ 成功" .tmp/form-test/$(date +%Y%m%d)/*.log | wc -l
echo "失敗数:" && grep "❌ 失敗" .tmp/form-test/$(date +%Y%m%d)/*.log | wc -l

# 失敗詳細抽出
grep -E "^\[.*\/65\]|❌ 失敗:" .tmp/form-test/$(date +%Y%m%d)/*.log | grep -A1 "^\[" | grep "❌"

# エラーカテゴリ別集計
grep "❌ 失敗" .tmp/form-test/$(date +%Y%m%d)/*.log | sed 's/.*失敗: //' | cut -d':' -f1 | sort | uniq -c | sort -rn
```

### フェーズ3: 改善実装

優先度に従って改善を実装:

1. **高優先度**: 複数企業に影響するパターン
2. **中優先度**: 個別対応で解決可能なケース
3. **低優先度**: 外部サービス依存のケース

### フェーズ4: 再テスト

```bash
# 改善後のテスト
npx tsx scripts/test/test-all-failed-companies.ts 2>&1 | tee .tmp/form-test/$(date +%Y%m%d)/improved-test.log

# 成功率比較
echo "初回:" && grep "✅ 成功" .tmp/form-test/$(date +%Y%m%d)/initial-test.log | wc -l
echo "改善後:" && grep "✅ 成功" .tmp/form-test/$(date +%Y%m%d)/improved-test.log | wc -l
```

---

## エラー対処パターン集

### パターン1: ログインフォーム誤検出

```typescript
// 実装済み: page.ts
// パスワードフィールドを含むフォームをスキップ
const hasPasswordField = await form.locator('input[type="password"]').count();
if (hasPasswordField > 0) {
  continue;
}
```

### パターン2: 日付ピッカー（flatpickr）

```typescript
// 実装済み: formField.ts
const fpInstance = (el as any)._flatpickr;
if (fpInstance && typeof fpInstance.setDate === "function") {
  fpInstance.setDate(dateValue, true);
  return true;
}
```

### パターン3: フォームが見つからない（iframe）

```typescript
// 原因: iframeにフォームがある
// 対策: iframe内のフォーム検索
const frames = page.frames();
for (const frame of frames) {
  const form = await frame.$('form');
  if (form) { /* 処理 */ }
}
```

### パターン4: 送信ボタン認識エラー

```typescript
// 対策: 複数のパターンで検索
const buttonPatterns = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("送信")',
  'button:has-text("確認")',
  'button:has-text("お問い合わせ")',
  '[role="button"]:has-text("送信")',
  '.submit-button',
  '#submit',
];
```

### パターン5: 送信ボタン無効化（JavaScript）

```typescript
// 対策: ボタンが有効化されるまで待機
await page.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 10000 });
```

---

## 失敗カテゴリ詳細

### 対応不要・不可

| カテゴリ | 件数 | 理由 |
|----------|------|------|
| メールのみ | 4件 | Webフォームが存在しない |
| サイト問題 | 5件 | DNS消失/403/404 |
| CAPTCHA | 6件 | 自動化不可能 |

### 改善可能

| カテゴリ | 件数 | 対応策 |
|----------|------|--------|
| フォーム要素なし | 5件 | iframe対応、動的フォーム待機 |
| 送信ボタン検出 | 3件 | ボタンパターン拡張 |
| フィールド入力 | 1件 | 日付ピッカー修正 |
| 外部サービス | 3件 | Jimdo/Zendesk個別対応 |

---

## 関連ファイル

- **テストスクリプト**: `scripts/test/test-all-failed-companies.ts`
- **フォーム自動化**: `src/lib/services/contactFormAutomation.ts`
- **フォーム検出**: `src/lib/services/contactFormFinder.ts`
- **ページ処理**: `src/lib/services/form-automation/page.ts`
- **フィールド処理**: `src/lib/services/form-automation/formField.ts`
- **環境設定**: `.env` (`ENABLE_FORM_SUBMISSION=false`)

---

## 成功基準

- **短期目標**: 成功率50%以上 ✅達成（57%）
- **中期目標**: 成功率70%以上
- **最終目標**: 改善可能ケース全て成功（対応不要・不可を除く）

---

## 注意事項

1. **実際の送信は行わない**: `ENABLE_FORM_SUBMISSION=false`を必ず確認
2. **ログは必ず階層ディレクトリに出力**: `.tmp/form-test/YYYYMMDD/`
3. **API負荷に注意**: テスト間に待機時間（3秒）を設ける
4. **段階的な改善**: 一度に大きな変更を行わず、小さな改善を積み重ねる
5. **レポート更新**: テスト後は必ず`analysis-report.md`を更新する

---

## 🚨 コンテキスト管理ルール（絶対厳守）

### コンテキスト85%到達時の対応

**トリガー**: コンテキスト使用率が85%に達した場合

**必須アクション**:
```bash
# 1. 作業状態を保存
# 現在の進捗をanalysis-report.mdに記録

# 2. /compactコマンドを実行
/compact

# 3. 圧縮後に作業を継続
# analysis-report.mdを参照して作業再開
```

### 大容量ファイル読み込み時の対応

**トリガー**: 500行を超えるファイルを読み込む必要がある場合

**必須アクション**:
```typescript
// 1. まずファイルのシンボル概要を取得
mcp__serena__get_symbols_overview(relative_path)

// 2. 必要なシンボルのみを読み込み
mcp__serena__find_symbol(name_path, include_body=true)

// 3. 全体を読む必要がある場合は分割読み込み
Read(file_path, offset=0, limit=200)    // 最初の200行
Read(file_path, offset=200, limit=200)  // 次の200行
// 以降必要に応じて繰り返し
```

### 作業継続のための状態保存

各フェーズ完了時に以下を`.tmp/form-test/YYYYMMDD/analysis-report.md`に記録:

1. **完了した改善内容**
2. **次に対応すべきエラー**
3. **変更したファイル一覧**
4. **テスト結果（成功率の変化）**

これにより、`/compact`後も作業を継続可能
