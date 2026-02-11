# brainbase MCP Server

brainbase内部運用システムのEntityコンテキストを提供するMCPサーバー。

## 概要

brainbaseの`_codex/`ディレクトリまたはGraph SSOT APIからプロジェクト・人物・組織・RACI等のエンティティを読み込み、Claude Codeからコンテキスト取得可能にする。

## 特徴

- **3つのデータソースモード**:
  - **Filesystem**: ローカル`_codex/`から読み込み（既存動作）
  - **Graph API**: Graph SSOT APIから取得（JWT認証）
  - **Hybrid**: API優先、障害時Filesystemフォールバック

- **JWT認証対応**: Graph SSOT APIのBearer Token認証をサポート
- **自動トークンリフレッシュ**: Refresh Tokenを使った自動更新
- **エイリアス解決**: 人物名・組織名の別名からID解決
- **RACI統合**: 立ち位置（Position-based）フォーマット対応

## インストール

```bash
cd /Users/ksato/workspace/unson-mcp-servers/mcp-servers/brainbase
npm install
npm run build
```

## 環境変数

### 共通

| 環境変数 | 必須 | デフォルト | 説明 |
|---------|-----|-----------|------|
| `BRAINBASE_ENTITY_SOURCE` | No | `filesystem` | データソースモード（`filesystem` / `graphapi` / `hybrid`） |

### filesystemモード

| 環境変数 | 必須 | デフォルト | 説明 |
|---------|-----|-----------|------|
| `CODEX_PATH` | Yes | - | `_codex` ディレクトリのパス |

### graphapiモード / hybridモード

| 環境変数 | 必須 | デフォルト | 説明 |
|---------|-----|-----------|------|
| `BRAINBASE_GRAPH_API_URL` | Yes | - | Graph SSOT APIのURL（例: `http://localhost:31013`） |
| `BRAINBASE_PROJECT_CODES` | No | - | プロジェクトコードのカンマ区切りリスト（フィルタリング用） |
| `BRAINBASE_GRAPH_API_TOKEN` | No | - | API Tokenの環境変数フォールバック |

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

### Mode 1: filesystemモード（既存動作）

```bash
export BRAINBASE_ENTITY_SOURCE=filesystem
export CODEX_PATH=/Users/ksato/workspace/shared/_codex
node dist/index.js
```

### Mode 2: graphapiモード

```bash
# 事前準備: トークン取得
npm run mcp-setup

# MCP起動
export BRAINBASE_ENTITY_SOURCE=graphapi
export BRAINBASE_GRAPH_API_URL=http://localhost:31013
export BRAINBASE_PROJECT_CODES=brainbase,zeims
node dist/index.js
```

### Mode 3: hybridモード（推奨）

```bash
# API優先、障害時Filesystemフォールバック
export BRAINBASE_ENTITY_SOURCE=hybrid
export BRAINBASE_GRAPH_API_URL=http://localhost:31013
export CODEX_PATH=/Users/ksato/workspace/shared/_codex
node dist/index.js
```

## MCPツール

### `get_context`

トピック/エンティティに関連するコンテキストを取得。

**例**:
```typescript
// Claude Codeから実行
mcp__brainbase__get_context({ topic: "佐藤圭吾" })
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

### Hybrid Fallback

hybridモードでAPI障害時、自動的にFilesystemに切り替わる。ログで確認可能:

```
[HybridSource] API source failed, falling back to filesystem: Error: ...
```

## アーキテクチャ

```
EntitySource (interface)
├── FilesystemSource      - ローカルファイルスキャン
├── GraphAPISource        - Graph SSOT API統合
└── HybridSource          - API優先、障害時FSフォールバック

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

最終更新: 2026-02-07
