---
name: dev-qa
description: >
  Paperclip Dev Team: QA。Steel.dev クラウドブラウザ経由で Web アプリを実ユーザー視点で
  テスト。バグ検出→修正→再検証ループ。gstack qa を Paperclip heartbeat + Steel.dev 用に
  再設計。
user_invocable: false
---

# Dev QA — Browser Testing & Bug Fix Agent

Paperclip heartbeat で動くQAエージェント。
Steel.dev クラウドブラウザ API を使い、Web アプリを実ユーザー視点でテストする。

## 環境変数

| 変数 | 用途 |
|------|------|
| `STEEL_API_KEY` | Steel.dev API認証 |
| `PAPERCLIP_API_URL` | Paperclip API |
| `PAPERCLIP_API_KEY` | Paperclip 認証 |
| `PAPERCLIP_COMPANY_ID` | 会社ID |
| `PAPERCLIP_RUN_ID` | 実行ID |

## Heartbeat フロー

1. Paperclip Skill で自分の割り当て Issue を取得
2. Issue からテスト対象URL・スコープを抽出
3. Steel.dev でブラウザセッション作成
4. テスト実行 → バグ検出 → 修正 → 再検証
5. レポートを Issue コメントに投稿
6. セッション終了

## Steel.dev ブラウザ操作

### セッション作成

```bash
SESSION=$(curl -s -X POST "https://api.steel.dev/v1/sessions" \
  -H "steel-api-key: $STEEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"timeout": 900000}')
SESSION_ID=$(echo $SESSION | jq -r '.id')
CDP_URL=$(echo $SESSION | jq -r '.cdpUrl // .websocketUrl')
```

### ページ遷移

```bash
curl -s -X POST "https://api.steel.dev/v1/sessions/$SESSION_ID/actions/navigate" \
  -H "steel-api-key: $STEEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$TARGET_URL\"}"
```

### スクリーンショット取得

```bash
curl -s "https://api.steel.dev/v1/sessions/$SESSION_ID/actions/screenshot" \
  -H "steel-api-key: $STEEL_API_KEY" \
  -o screenshot.png
```

### セッション終了

```bash
curl -s -X DELETE "https://api.steel.dev/v1/sessions/$SESSION_ID" \
  -H "steel-api-key: $STEEL_API_KEY"
```

## テストプロセス

### Step 1: テスト対象の特定

Issue の内容から以下を抽出:
- **Target URL**: テスト対象のURL
- **Scope**: 全体 / 特定ページ / diff起点
- **Tier**: Quick（critical+high）/ Standard（+medium）/ Exhaustive（+cosmetic）

### Step 2: テスト実行

各ページで以下をチェック:

#### レンダリング
- ページが正常に表示されるか（HTTP 200）
- レイアウト崩れがないか
- モバイルビューポートでの表示

#### インタラクション
- 全リンクが機能するか
- フォーム送信が動作するか
- ボタンクリックが期待通りか
- ダブルクリック、高速連打への耐性

#### エッジケース
- 空入力・長文入力
- 特殊文字入力（`<script>`, SQL injection patterns）
- ネットワーク遅延時の挙動
- 戻るボタン、リロード

#### コンソール
- JavaScript エラーの有無
- ネットワークエラーの有無
- パフォーマンス警告

### Step 3: バグ報告フォーマット

```markdown
## 🐛 QA Report

**Target:** [URL]
**Tier:** [Quick / Standard / Exhaustive]
**Health Score:** [0-100]

### Critical
- [C1] [ページ] 問題の説明
  **Evidence:** [スクリーンショット / コンソールエラー]
  **Steps:** 再現手順

### High
- [H1] ...

### Medium
- [M1] ...

### Low/Cosmetic
- [L1] ...
```

### Step 4: バグ修正（Tier に応じて）

- Quick: Critical + High のみ修正
- Standard: + Medium
- Exhaustive: + Low/Cosmetic

修正はアトミックコミット:
```bash
git add [修正ファイル]
git commit -m "fix: [バグID] [説明]"
```

### Step 5: 再検証

修正後、同じテストを再実行して修正を確認。
Before/After のヘルススコアを比較。

### Step 6: レポート投稿

最終レポートを Issue コメントに投稿:

```markdown
## ✅ QA Complete

**Before:** Health Score 65/100
**After:** Health Score 92/100

### Fixed
- [C1] ✅ [説明] — commit abc123
- [H1] ✅ [説明] — commit def456

### Remaining (deferred)
- [L1] ⏳ [説明] — cosmetic, deferred

### Ship Readiness: READY / NOT READY
```

## 注意事項

- Steel.dev セッションは必ず終了する（タイムアウト: 15分）
- スクリーンショットは一時ファイルとして扱い、レポート後に削除
- 本番環境には書き込み操作を行わない（読み取り・閲覧のみ）
- 認証が必要な場合は Issue に認証情報の取得方法を記載
