# brainbase MCP Server

brainbase内部運用システムのEntityコンテキストを提供するMCPサーバー。

## 概要

Graph SSOT APIからプロジェクト・人物・組織・RACI等のエンティティを読み込み、Claude Codeからコンテキスト取得可能にする。

## 特徴

- **Graph API 専用**: Graph SSOT APIのみをデータソースとして使用
- **JWT認証対応**: Graph SSOT APIのBearer Token認証をサポート
- **自動トークンリフレッシュ**: Refresh Tokenを使った自動更新
- **Control plane契約**: 認証済みproject scopeとfailure/audit evidenceを機械可読で返却
- **エイリアス解決**: 人物名・組織名の別名からID解決
- **RACI統合**: 立ち位置（Position-based）フォーマット対応

## インストール

```bash
cd /Users/ksato/workspace/unson-mcp-servers/mcp-servers/brainbase
npm install
npm run build
```

## 環境変数

| 環境変数 | 必須 | デフォルト | 説明 |
|---------|-----|-----------|------|
| `BRAINBASE_ENTITY_SOURCE` | No | `graphapi` | `graphapi` 固定。ほかの値はエラー |
| `BRAINBASE_GRAPH_API_URL` | No | `https://bb.unson.jp` | Graph SSOT APIのURL |
| `BRAINBASE_API_URL` | No | - | `BRAINBASE_GRAPH_API_URL` の別名（Infisicalの既存secret名に合わせた alias） |
| `BRAINBASE_API_BASE_URL` | No | - | `BRAINBASE_GRAPH_API_URL` の別名（後方互換） |
| `BRAINBASE_PROJECT_CODES` | No | - | プロジェクトコードのカンマ区切りリスト（フィルタリング用） |
| `BRAINBASE_GRAPH_API_TOKEN` | No | - | サービス実行用のAPIトークン |
| `BRAINBASE_AUTH_MODE` | No | トークン環境変数ありなら `service`、なしなら `interactive` | 接続全体の認証方式 |

対話型のCodexでは、MCP接続設定に次を明示します。

```toml
[mcp_servers.brainbase.env]
BRAINBASE_AUTH_MODE = "interactive"
```

`interactive` は保存済みユーザートークンだけを使い、環境変数のサービストークンを無視します。`service` は環境変数のトークンだけを使い、未設定なら認証エラーになります。保存済みユーザーへの切替は行いません。判断・参照は同じ接続の認証を共有します。JWTと設定済みプロジェクト範囲の積集合による制限は引き続き適用されます。設定変更後はMCPを再接続してください。

## JWT認証セットアップ

### 1. トークン取得

```bash
cd /Users/ksato/workspace/code/brainbase
npm run mcp-setup
```

→ `~/.brainbase/tokens.json` に保存される

### 2. トークンファイルのパーミッション確認

```bash
ls -la ~/.brainbase/tokens.json
# → -rw------- (600)
```

### 3. トークンの自動更新

TokenManagerが自動的にトークンの期限をチェックし、必要に応じてRefresh Tokenを使って更新する。

## 使い方

### graphapiモード

```bash
# 事前準備: トークン取得
npm run mcp-setup

# MCP起動
export BRAINBASE_ENTITY_SOURCE=graphapi
export BRAINBASE_GRAPH_API_URL=https://bb.unson.jp
export BRAINBASE_PROJECT_CODES=brainbase,zeims
node dist/index.js
```

## MCPツール

Graph系ツール（`get_context` / `list_entities` / `get_entity` / `search`）は、デフォルトでBrainbase Philosophy Contextを先頭に付与する。これはUI表示ではなく、Graph操作前に `CLAUDE.md` 的な判断前提を注入するためのもの。

無効化が必要な場合のみ `includePhilosophy: false` を渡す。scopeを指定する場合は `scope: "crm"` のように渡す。

### `brainbase_projects`

認証済みactorが参照できるactive project catalogを取得する。caller側のscope引数は受け付けず、JWTの`projectCodes`と`BRAINBASE_PROJECT_CODES`の積集合だけを返す。

返却値は`status: ok | unavailable | error`、`scope`、`audit`を常に含む。確認済み0件は`status: ok`かつ`count: 0`であり、認証・通信・上流・schema障害を空配列へ変換しない。token自体は返さない。

**例**:
```typescript
mcp__brainbase__brainbase_projects({})
```

### `brainbase_run_receipt_inbox`

Mana、Codex Automations、GitHub Actions、SalesTailorから集約したRun Receiptの最新Inboxを、認証済みproject scope内で取得する。`project_id`、`source_type`、`run_status`、`evidence_state`、`limit`で絞り込める。

これは汎用Workflowの作成・編集・公開・手動実行を提供するツールではない。`blocked`、`unconfirmed`、`no_data`はそのまま返し、認証・通信・上流・schema障害は`unavailable`または`error`として返す。確認済み0件だけが`status: ok`かつ`count: 0`になる。

**例**:
```typescript
mcp__brainbase__brainbase_run_receipt_inbox({
  project_id: "brainbase",
  run_status: "blocked",
  evidence_state: "unconfirmed",
  limit: 25,
})
```

### `brainbase_run_receipt_history`

1つのsource identityについてRun Receiptの履歴を新しい順に取得する。`project_id`、`source_type`、`source_identity`は必須で、認証済みproject scope外の参照はAPI通信前に拒否する。

**例**:
```typescript
mcp__brainbase__brainbase_run_receipt_history({
  project_id: "brainbase",
  source_type: "mana",
  source_identity: "daily-secretary",
  limit: 10,
})
```

### `brainbase_run_receipt_diagnosis`

1件のRun Receiptを診断し、`blocked`、`failed`、`waiting_human`、`unconfirmed`、`no_data`を`issue_codes`と`recommended_action`へ構造化する。確認できない状態を成功へ丸めず、通信不能と契約不整合も別のstatusで返す。

**例**:
```typescript
mcp__brainbase__brainbase_run_receipt_diagnosis({
  project_id: "brainbase",
  run_id: "run_receipt_run_123",
})
```

### `brainbase_automation_run_detail`

1件のAutomation Runについて、Run Step、Human Approval、Output、Audit Logを認証済みproject scope内で取得する。汎用Workflow定義の作成・編集・公開・手動実行は提供しない。

### `brainbase_automation_human_step_resolve`

保留中のHuman Approvalを`approved`または`rejected`へ解決する。これは明示的なwrite操作であり、project scopeとactorを監査証跡へ残す。

### `brainbase_meeting_automation_diagnosis`

Meeting Sourceの接続状態と直近scheduled syncを診断する。`blocked`、`unconfirmed`、`no_data`、`failed`、`healthy`を区別し、issue codeと復旧actionを返す。Meeting Packの実行基盤はBrainbase Coreに残り、汎用Workflow製品には戻さない。

### `get_context`

トピック/エンティティに関連するコンテキストを取得。

**例**:
```typescript
// Claude Codeから実行
mcp__brainbase__get_context({ topic: "佐藤圭吾" })
mcp__brainbase__get_context({ topic: "推進案件", scope: "crm", objectType: "push_case" })
```

### `list_entities`

特定タイプのエンティティ一覧を取得。

**例**:
```typescript
mcp__brainbase__list_entities({ type: "project" })
```

### `get_entity`

エンティティをタイプとIDで取得。

**例**:
```typescript
mcp__brainbase__get_entity({ type: "person", id: "sato_keigo" })
```

### `search`

キーワードでエンティティを検索。

**例**:
```typescript
mcp__brainbase__search({ query: "brainbase" })
```

### `resolve_entity`

自然文や複合クエリからGraph正本の候補を解決する。人物・組織・プロジェクトなどが
Graphに存在しないと判断する前に使う。

`resolve_entity` は正規化、token分割、field-aware matchingを行い、
`candidates`, `matched_terms`, `matched_fields`, `confidence`,
`absence_verdict`, `searched_terms`, `fallbacks_used`, `unsupported_types` を返す。
`project` は周辺contextの指定であり、候補を厳密除外するfilterではない。
`contact` などCore indexに未実装のtype filterは黙って落とさず、
`unsupported_types` と `fallbacks_used=["unsupported_type_reported"]` に明示する。
`search` の1回のno-resultだけでGraph未登録と断定しない。

**例**:
```typescript
mcp__brainbase__resolve_entity({
  query: "若松 Lecaldo レカルド TechKnight 役員",
  types: ["person", "org"],
})
```

## エンティティタイプ

| タイプ | 説明 | 例 |
|-------|-----|---|
| `project` | プロジェクト | brainbase, zeims, salestailor |
| `person` | 人物 | sato_keigo, yamada_taro |
| `org` | 組織（法人・ブランド） | unson, techknight |
| `raci` | 体制図（立ち位置ベース） | unson, techknight |
| `app` | アプリケーション | brainbase-ui, mana |
| `customer` | 顧客 | customer_001 |
| `decision` | 決定事項 | dec_001, brainbase-2026-01-04_opencode-compatibility-strategy |

## トラブルシューティング

### Token関連

**エラー**: `No token found. Run npm run mcp-setup to obtain tokens.`

→ トークンが未取得。`npm run mcp-setup` を実行してトークンを取得。

**エラー**: `Token refresh failed: 401 Unauthorized`

→ Refresh Tokenが期限切れ。再度 `npm run mcp-setup` でトークンを再取得。

### API接続エラー

**エラー**: `Failed to fetch entities: ECONNREFUSED`

→ Graph SSOT APIが起動していない。`npm run dev` でbrainbase本体を起動。

## アーキテクチャ

```
GraphAPISource            - Graph SSOT API統合
TokenManager              - JWT + Refresh Token管理
Config                    - 環境変数ローダー
```

### Graph Entity → EntityIndex変換

Graph APIから取得したエンティティをbrainbaseのEntityIndex形式に変換:

| Graph API `entity_type` | EntityIndex Map | 変換キー |
|------------------------|----------------|---------|
| `project` | `projects` | `payload.code` → `project_id` |
| `person` | `people` | `payload.name`, `aliases` |
| `org` | `orgs` | `payload.org_id`, `aliases` |
| `raci` | `raci` | `payload.positions` |
| `app` | `apps` | `payload.app_id` |
| `customer` | `customers` | `payload.customer_id` |
| `decision` | `decisions` | `payload.decision_id` |

## 開発

### ビルド

```bash
npm run build
```

### テスト実行

```bash
npm test
```

### ローカル開発

```bash
npm run dev
```

## ライセンス

Private（UNSON社内用）

---

最終更新: 2026-07-16
