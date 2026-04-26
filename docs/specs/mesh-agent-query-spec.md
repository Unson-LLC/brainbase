---
source_story: sprint.brainbase.mesh-agent-query
source_architecture: docs/architecture/mesh-agent-query-architecture.md
parent_story_id: month.brainbase.mesh-mvp-foundation
related_docs:
  - docs/stories/mesh-agent-query-story.md
  - docs/architecture/mesh-agent-query-architecture.md
  - docs/architecture/ADR-001-mesh-architecture.md
nocodb_milestone_id: 41
nocodb_ship_id: 34
nocodb_task_ids: [304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317]
status: in_progress
date: 2026-03-29
updated: 2026-04-26
---

# Spec: Mesh Agent Query

STR-001の受入条件をArchitectureの3レイヤー構造に基づいて実装仕様に落とす。

## 1. Node Profile スキーマ

### config.yml拡張

既存の`config.yml`に`mesh`セクションと、各projectに`assignees`を追加する。

```yaml
mesh:
  relay_url: wss://relay.brain-base.work
  agent_runtime: claude-code  # claude-code | codex | ollama

projects:
  - id: salestailor
    local:
      path: projects/salestailor
      glob_include:
        - app/**/*
        - docs/**/*
    nocodb:
      base_id: pqot58neiu3o1xo
    assignees:                    # ← 追加
      - slack_user_id: U07LNUP582X   # 佐藤
      - slack_user_id: U08XXXXXXXX   # 委託A
```

### Node Profile（起動時に構築）

```typescript
interface NodeProfile {
  nodeId: string;              // crypto.randomUUID().slice(0,8) or 環境変数
  slackUserId: string;         // Slackログインで取得
  roleRank: number;            // auth-serviceから取得 (1=Member, 2=GM, 3=CEO)
  agentRuntime: string;        // config.yml mesh.agent_runtime
  projects: ProjectScope[];    // config.ymlから自分がassigneesに含まれるprojectを抽出
}

interface ProjectScope {
  projectId: string;           // config.yml projects[].id
  localPath: string;           // BRAINBASE_ROOT/../ + projects[].local.path（絶対パス解決済み）
  globInclude: string[];       // projects[].local.glob_include
  nocodbBaseId: string;        // projects[].nocodb.base_id
  nocodbTaskTableId: string;   // nocodb-table-mappingから取得
  nocodbMilestoneTableId: string;
}
```

### Node Profile構築フロー

```
1. Slackログイン → slackUserId取得
2. auth-service → roleRank取得
3. config.yml読み込み → mesh.relay_url, mesh.agent_runtime取得
4. config.yml.projects をループ:
   各project.assigneesに自分のslackUserIdが含まれるか判定
   → 含まれるprojectだけをNodeProfile.projectsに追加
5. 各projectのlocalPathを BRAINBASE_ROOT/../ 基準で絶対パス解決
6. NodeProfile完成 → MeshService.start()に渡す
```

## 2. Envelope形式

### Envelope構造

```typescript
interface Envelope {
  id: string;          // crypto.randomUUID()
  from: string;        // 送信元nodeId
  to: string;          // 宛先nodeId or 'all'
  type: EnvelopeType;  // 'query' | 'response' | 'ping' | 'pong' | 'peer_joined' | 'peer_left'
  payload: string;     // 暗号化済みペイロード（base64）
  ts: number;          // Date.now()
  nonce: string;       // crypto.randomUUID()
}
```

### Query Payload（暗号化前）

```typescript
interface QueryPayload {
  question: string;    // 質問テキスト
  scope: QueryScope;   // 'status' | 'code' | 'project' | 'general'
  projectId?: string;  // 特定プロジェクトに限定する場合
}

type QueryScope = 'status' | 'code' | 'project' | 'general';
```

### Response Payload（暗号化前）

```typescript
interface ResponsePayload {
  queryId: string;     // 元のenvelope.id
  data: ContextData;   // 収集結果
  error?: string;      // エラー時
  reason?: string;     // エラー理由
}
```

## 3. MCP Tool定義

### mesh_query

```typescript
{
  name: "mesh_query",
  description: "メッシュ上の他ノードのAIに質問する。各ノードのローカル文脈に基づいた構造化応答が返る。",
  inputSchema: {
    type: "object",
    properties: {
      to: {
        type: "string",
        description: "宛先ノードID。'all'で全ノードに一斉問い合わせ"
      },
      question: {
        type: "string",
        description: "質問内容"
      },
      scope: {
        type: "string",
        enum: ["status", "code", "project", "general"],
        default: "general",
        description: "status=タスク・ブランチ状態, code=diff・変更ファイル, project=タスク全件・マイルストーン, general=全部"
      }
    },
    required: ["to", "question"]
  }
}
```

### mesh_peers

```typescript
{
  name: "mesh_peers",
  description: "メッシュに接続中のピア（チームメンバー）の一覧を表示する",
  inputSchema: {
    type: "object",
    properties: {}
  }
}
```

### MCP Tool 戻り値（共通）

成功時:
```typescript
// MCP Tool Response (success)
{
  content: [
    { type: "text", text: <JSON.stringify(result)> }
  ]
}
```

失敗時（§11 エラーモデル準拠）:
```typescript
// MCP Tool Response (error) — REST API のエラーレスポンスを text にして返す
{
  content: [
    { type: "text", text: JSON.stringify({ error: { code, message, timestamp } }) }
  ],
  isError: true
}
```

## 4. REST API定義

### GET /api/mesh/status

メッシュの接続状態を返す。

```typescript
// Response
{
  enabled: boolean;
  nodeId: string;
  roleRank: number;
  projects: string[];        // 担当プロジェクトIDリスト
  connected: boolean;        // Relay接続中か
  peers: PeerInfo[];
}
```

### GET /api/mesh/peers

オンラインのピア一覧を返す。

```typescript
// Response
{
  peers: PeerInfo[];
}

interface PeerInfo {
  nodeId: string;
  roleRank: number;
  projects: string[];
  online: boolean;
}
```

### POST /api/mesh/query

他ノードに問い合わせを送信する。

```typescript
// Request
{
  to: string;          // nodeId or 'all'
  question: string;
  scope?: QueryScope;  // default: 'general'
}

// Response（同期）
// to が特定nodeIdの場合: そのノードの応答を待って返す（タイムアウト30秒）
{
  queryId: string;
  from: string;
  data: ContextData;
}

// to が 'all' の場合: 全ノードの応答を集約して返す（タイムアウト30秒、届いた分だけ）
{
  queryId: string;
  responses: Array<{
    from: string;
    data: ContextData;
  }>;
  timeout: string[];   // タイムアウトしたnodeIdリスト
}
```

### Error Responses (§11 エラーモデル準拠)

全エンドポイント共通: 失敗時は `AppError.toJSON()` 形式 `{ error: { code, message, timestamp } }`。

| HTTP | code | 発生ケース |
|---|---|---|
| 400 | `VALIDATION_ERROR` | リクエスト body に必須フィールド欠如 |
| 400 | `MESH_ENVELOPE_INVALID` | envelope パース失敗 |
| 400 | `MESH_ENVELOPE_EXPIRED` | リプレイ攻撃検出（ts > 60秒経過 or nonce重複） |
| 401 | `UNAUTHORIZED` | Slack 認証セッションなし |
| 403 | `FORBIDDEN` | Slack 認証セッション期限切れ |
| 403 | `MESH_PERMISSION_DENIED` | Permission Checker 拒否 |
| 403 | `MESH_REVOKED` | revoke 済みノードからのアクセス |
| 404 | `MESH_PEER_NOT_FOUND` | 宛先 nodeId が PeerRegistry にない or boxPublicKey 未登録 |
| 413 | `MESH_ENVELOPE_TOO_LARGE` | envelope/payload サイズ超過 |
| 429 | `MESH_RATE_LIMITED` | 単位時間あたりのQuery上限超過 |
| 500 | `MESH_DECRYPTION_FAILED` | sealed-box 復号失敗 |
| 500 | `INTERNAL_ERROR` | 上記以外のサーバー内部エラー |
| 503 | `MESH_NOT_ENABLED` | MESH_RELAY_URL 未設定（Mesh無効） |
| 503 | `MESH_NOT_CONNECTED` | Relay 未接続（再接続中） |
| 504 | `MESH_QUERY_TIMEOUT` | 30秒以内に応答なし |

### 部分応答セマンティクス（'all' 宛先時）

`to: "all"` の場合、`responses[]` には30秒以内に届いた応答のみが入り、未応答 nodeId は `timeout[]` に列挙される。
オフラインノード or 権限拒否ノードも `timeout[]` に含まれる（差別化情報は§14 ロギング側で観測）。

## 5. QueryHandler収集データ形式

### ContextData（scopeごとの応答形式）

```typescript
// scope: 'status'
interface StatusContext {
  tasks: Array<{
    title: string;
    status: string;      // 未着手 | 進行中 | 完了 | 保留
    priority: string;
  }>;
  worktreeStatus: string;   // git status --porcelain の出力
  recentCommits: string;    // git log --oneline -5 の出力
  sessionState: string;     // 'running'
}

// scope: 'code'
interface CodeContext {
  gitDiff: string;           // git diff（最大5000文字）
  changedFiles: string[];    // git diff --name-only
}

// scope: 'project'
interface ProjectContext {
  tasks: Array<{
    title: string;
    status: string;
    priority: string;
    assignee: string;
  }>;
  milestones: Array<{
    name: string;
    status: string;
    progress: number;
  }>;
}

// scope: 'general'
type GeneralContext = StatusContext & CodeContext & ProjectContext;
```

### 収集元とconfig.yml対応

| 収集項目 | 収集元 | config.ymlとの対応 |
|---------|--------|-------------------|
| tasks | NocoDB API | `projects[].nocodb.base_id` → table-mappingでtableId解決 |
| milestones | NocoDB API | 同上 |
| worktreeStatus | `git status --porcelain` | `projects[].local.path` で解決したディレクトリで実行 |
| recentCommits | `git log --oneline -5` | 同上 |
| gitDiff | `git diff` | 同上 |
| changedFiles | `git diff --name-only` | 同上 |

複数プロジェクト担当の場合、各プロジェクトごとにContextを収集し、projectIdをキーにマージする。

## 6. Permission Checker仕様

### 関数シグネチャ

```typescript
type CheckQueryPermissionInput = {
  fromRole: number;                  // 問い合わせ元のROLE_RANK
  fromProjects: string[];            // 問い合わせ元の担当プロジェクト
  toProjects: string[];              // 問い合わせ先の担当プロジェクト
  scope?: QueryScope;                // 任意。将来scope別ポリシー拡張用
};

type CheckQueryPermissionResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: string;
      code: 'INSUFFICIENT_ROLE' | 'PROJECT_MISMATCH';
    };

export function checkQueryPermission(
  input: CheckQueryPermissionInput
): CheckQueryPermissionResult;
```

### 判定ルール

| fromRole | 判定 | code (拒否時) |
|---|---|---|
| `>= 3` (CEO) | 常に許可 | — |
| `>= 2` (GM) | 常に許可 | — |
| `=== 1` (Worker) | fromProjects と toProjects に共通プロジェクトがあれば許可、なければ拒否 | `PROJECT_MISMATCH` |
| その他 (`<= 0`) | 常に拒否 | `INSUFFICIENT_ROLE` |

### REST API/MCP Tool への伝搬

判定結果が `allowed: false` の場合、§11 エラーモデルに従い:
- HTTP: 403 + `code: 'MESH_PERMISSION_DENIED'`
- `details` (ログ専用): `{ permissionCode: result.code, reason: result.reason }`

## 7. Slackログイン → メッシュ参加 統合仕様

### auth-serviceへの変更点（Phase 3 対象）

`server/services/auth-service.js` の Slack OAuth コールバック処理に以下フックを追加する。

| 変更箇所 | 内容 |
|---|---|
| `AuthService.completeSlackOAuth()` の末尾 | `MeshLifecycle.onSlackLoginSuccess({ slackUserId, roleRank })` を呼ぶ |
| 新規モジュール `server/mesh/lifecycle.js` | `onSlackLoginSuccess()` で下記フローを実行 |

```
Slackログイン成功後:
  1. slackUserId, roleRank取得（既存 AuthService）
  2. ConfigParser.getConfig() → NodeProfile構築（buildNodeProfile）
  3. ~/.brainbase/mesh/node-keypair.json の存在チェック
     - 存在しない → generateKeyPair() → saveKeyPair()
     - 存在する → loadKeyPair()
  4. MeshService.start(nodeProfile, keyPair)（既に起動済みなら no-op）
  5. Relay接続完了 → mesh_query 使用可能
```

### 環境変数

| 変数 | 用途 | デフォルト | 実装ステータス |
|------|------|-----------|--------------|
| `MESH_RELAY_URL` | Relay ServerのWebSocket URL | なし（未設定時はMesh無効） | ✅ 実装済み |
| `MESH_NODE_ID` | ノードID | 自動生成 | ✅ 実装済み |
| `MESH_AGENT_RUNTIME` | Agent Runtime種別 | claude-code | ⏳ 未実装（Spec 定義のみ。読み取り箇所なし） |
| `MESH_ROLE_RANK` | ROLE_RANK（auth-service未統合時のフォールバック） | `1` | ✅ 実装済み |
| `MESH_SLACK_USER_ID` | Slackユーザーid（auth-service未統合時のフォールバック） | 空文字 | ✅ 実装済み |
| `MESH_TASK_TABLE_ID` | NocoDBタスクテーブルID（暫定） | 空文字 | ⚠️ 未使用（NodeProfile.projects[].nocodbBaseIdへ移行予定） |
| `MESH_MILESTONE_TABLE_ID` | NocoDBマイルストーンテーブルID（暫定） | 空文字 | ⚠️ 未使用 |

## 8. Relay Server仕様

### プロトコル

| メッセージ | 方向 | 形式 |
|-----------|------|------|
| auth | Client→Relay | `{ type: 'auth', nodeId, publicKey, boxPublicKey, roleRank, projects }` |
| auth_ok | Relay→Client | `{ type: 'auth_ok', nodeId }` |
| envelope | Client→Relay | `{ type: 'envelope', to, payload }` |
| envelope | Relay→Client | `{ type: 'envelope', from, to, payload }` |
| peer_joined | Relay→All | `{ type: 'peer_joined', nodeId, publicKey, boxPublicKey, roleRank, projects }` |
| peer_left | Relay→All | `{ type: 'peer_left', nodeId }` |
| revoke | Client(CEO)→Relay | `{ type: 'revoke', targetNodeId, signature }` |
| peer_revoked | Relay→All | `{ type: 'peer_revoked', nodeId }` |
| ping | Relay→Client | WebSocket ping frame |
| pong | Client→Relay | WebSocket pong frame (自動) |
| error | Relay→Client | `{ type: 'error', code, message }` （§11 エラーコード準拠） |

### Relay Server エラーコード（type='error' 時）

| code | 発生ケース |
|---|---|
| `MESH_AUTH_FAILED` | auth メッセージ不正、署名検証失敗 |
| `MESH_DUPLICATE_NODE_ID` | 同一 nodeId が既に接続中 |
| `MESH_TOO_MANY_CONNECTIONS` | チームの接続上限（50ノード）到達 |
| `MESH_ENVELOPE_TOO_LARGE` | envelope が 1MB 超過 |
| `MESH_ENVELOPE_EXPIRED` | envelope.ts > 60秒 経過、または nonce 重複検出 |
| `MESH_PEER_NOT_FOUND` | envelope の to が存在しない nodeId |
| `MESH_REVOKED` | 接続元 nodeId が deny-list に登録済み |
| `MESH_RATE_LIMITED` | 単位時間あたりのメッセージ上限超過 |

### Relay Serverの制約と挙動

- envelopeの`payload`は暗号化済み文字列。Relayは復号しない
- ピア情報（nodeId, publicKey, roleRank, projects）はメモリ保持のみ。永続化しない
- **deny-list は永続化** (`relay/data/deny-list.sqlite`)。再起動後も拒否し続ける（§12 セキュリティ境界）
- Relay再起動時は全ノードが再接続・再認証する
- 認証失敗時 `MESH_AUTH_FAILED` を返却して切断
- サイズ超過時 `MESH_ENVELOPE_TOO_LARGE` を返却（接続は維持）
- リプレイ検出時 `MESH_ENVELOPE_EXPIRED` を返却（接続は維持、但し連続発生時は切断）

## 9. オフボーディング仕様

### CLI（Phase 3 対象、未実装）

```bash
brainbase mesh revoke <nodeId>
```

### Revoke envelope 形式

```typescript
type RevokeMessage = {
  type: 'revoke';
  targetNodeId: string;       // 失効対象の nodeId
  signature: string;          // Ed25519 署名 (base64)
                              // 署名対象: `revoke:${targetNodeId}:${ts}`
  ts: number;                 // 発行時刻（リプレイ防止）
};
```

### 認可

- **CEO のみ実行可** (`fromRole >= 3`)
- Relay 側で署名を CEO の公開鍵で検証
- CEO 公開鍵未登録 or 検証失敗時 → `MESH_AUTH_FAILED` を返却して拒否
- ts > 60秒経過は `MESH_ENVELOPE_EXPIRED`

### フロー

```
1. CEO Node が brainbase mesh revoke <nodeId> 実行
2. CLI が revoke envelope を Ed25519 で署名し Relay に送信
3. Relay:
   a. 署名を CEO 公開鍵で検証
   b. ts が 60秒以内か検証
   c. 失敗時 → MESH_AUTH_FAILED または MESH_ENVELOPE_EXPIRED 返却
4. 検証成功時:
   a. deny-list (sqlite) に targetNodeId と targetPublicKey を追加
   b. 対象 nodeId の WebSocket を即時切断
   c. 全ピアに { type: 'peer_revoked', nodeId } を broadcast
5. 各ピアが PeerRegistry から対象を removePeer()
6. 対象ノードの再接続試行は MESH_REVOKED で拒否
```

### 失効後の挙動

- **既存セッション**: WebSocket 切断後、対象ノードのローカル `~/.brainbase/mesh/` に保存された keypair はそのまま残るが、Relay 接続が拒否されるため Mesh 機能停止
- **再接続試行**: 5秒間隔の RelayClient 再接続が `MESH_REVOKED` で連続失敗。MAX_RETRIES (5) 到達後にギブアップ
- **ローカル鍵削除**: 必須ではないが、対象ノード側で `rm -rf ~/.brainbase/mesh/` を実行すれば完全クリーンアップ

## 10. 受入条件とSpecの紐付け

| 受入条件 | Specセクション |
|---------|---------------|
| AC-1: mesh_queryで一斉問い合わせ → 構造化JSON応答 | §3 MCP Tool, §4 REST API, §5 ContextData |
| AC-2: 委託間mesh_query（同プロジェクト） | §6 Permission Checker |
| AC-3: npm start + Slackログインでメッシュ参加 | §7 Slackログイン統合, §1 Node Profile |
| AC-4: 異プロジェクトQuery拒否 | §6 Permission Checker, §11 エラーモデル |
| AC-5: Relay管理者でも復号不能 | §2 Envelope（payload暗号化）, §8 Relay制約, §12 セキュリティ境界 |
| AC-6: mesh_peersでメンバー一覧 | §3 MCP Tool, §4 REST API |
| AC-7: オフボーディング時の鍵失効 | §9 オフボーディング, §12 deny-list永続化 |

---

## 11. エラーモデル

### 統一フォーマット

`server/lib/errors.js` の `AppError.toJSON()` を採用。全 REST API・MCP Tool・Relay error メッセージで同形式。

```json
{
  "error": {
    "code": "MESH_PEER_NOT_FOUND",
    "message": "Peer 'node-abc123' not found in registry",
    "timestamp": "2026-04-26T10:30:00.000Z"
  }
}
```

`details` はログ専用（`AppError.toLog()` には含む、`toJSON()` には含めない）。

### Mesh 専用エラーコード一覧

`server/lib/errors.js` の `ErrorCodes` に下記を追加する（Phase 3対象）。

```typescript
export const MeshErrorCodes = {
  // 入力バリデーション (400)
  MESH_ENVELOPE_INVALID: { code: 'MESH_ENVELOPE_INVALID', statusCode: 400 },
  MESH_ENVELOPE_EXPIRED: { code: 'MESH_ENVELOPE_EXPIRED', statusCode: 400 },

  // 認証・認可 (403)
  MESH_PERMISSION_DENIED: { code: 'MESH_PERMISSION_DENIED', statusCode: 403 },
  MESH_REVOKED: { code: 'MESH_REVOKED', statusCode: 403 },

  // リソース不在 (404)
  MESH_PEER_NOT_FOUND: { code: 'MESH_PEER_NOT_FOUND', statusCode: 404 },

  // ペイロードサイズ (413)
  MESH_ENVELOPE_TOO_LARGE: { code: 'MESH_ENVELOPE_TOO_LARGE', statusCode: 413 },

  // レート制限 (429)
  MESH_RATE_LIMITED: { code: 'MESH_RATE_LIMITED', statusCode: 429 },

  // サーバーエラー (500)
  MESH_DECRYPTION_FAILED: { code: 'MESH_DECRYPTION_FAILED', statusCode: 500 },

  // サービス不可 (503)
  MESH_NOT_ENABLED: { code: 'MESH_NOT_ENABLED', statusCode: 503 },
  MESH_NOT_CONNECTED: { code: 'MESH_NOT_CONNECTED', statusCode: 503 },

  // タイムアウト (504)
  MESH_QUERY_TIMEOUT: { code: 'MESH_QUERY_TIMEOUT', statusCode: 504 },

  // Relay 専用 (auth プロトコル内)
  MESH_AUTH_FAILED: { code: 'MESH_AUTH_FAILED', statusCode: 401 },
  MESH_DUPLICATE_NODE_ID: { code: 'MESH_DUPLICATE_NODE_ID', statusCode: 409 },
  MESH_TOO_MANY_CONNECTIONS: { code: 'MESH_TOO_MANY_CONNECTIONS', statusCode: 429 },
};
```

### 実装パターン

REST API では `asyncHandler` + `AppError` で投げる:

```javascript
import { asyncHandler } from '../lib/async-handler.js';
import { AppError } from '../lib/errors.js';
import { MeshErrorCodes } from '../mesh/errors.js';

router.post('/query', asyncHandler(async (req, res) => {
  const { to, question, scope } = req.body;
  if (!to || !question) {
    throw AppError.validation('Missing required fields', { required: ['to', 'question'] });
  }
  if (!meshService) throw new AppError('Mesh not enabled', MeshErrorCodes.MESH_NOT_ENABLED);
  // ...
}));
```

---

## 12. セキュリティ境界

### リプレイ攻撃対策

- 受信側（Relay + 各ノード）は envelope.ts を検証
- `Date.now() - envelope.ts > 60_000` ms の場合、`MESH_ENVELOPE_EXPIRED` で破棄
- nonce を直近 5 分の LRU キャッシュに保存し、重複検出時も `MESH_ENVELOPE_EXPIRED` で破棄
- Relay 側でも同じ検証を実施（ピア側の実装ミスをカバー）

### サイズ上限

| 対象 | 上限 | 超過時 |
|---|---|---|
| envelope 全体 (JSON文字列) | 1 MB | `MESH_ENVELOPE_TOO_LARGE` (413) で拒否 |
| Query payload (復号後) | 64 KB | sender 側で送信前に拒否 |
| Response payload (復号後) | 512 KB | QueryHandler 側で truncate 後 `data.truncated: true` を付与 |

WebSocket フレームレベルでは `ws` ライブラリの `maxPayload` オプションで 1 MB を強制。

### 同時接続数制限

- 1 Relay インスタンスあたり最大 50 接続（チーム想定 3-7 人 + 余裕）
- 同一 nodeId からの重複接続は `MESH_DUPLICATE_NODE_ID` で拒否（先勝ち）
- 短時間（10秒以内）の auth 連発は `MESH_RATE_LIMITED` で拒否

### Relay deny-list 永続化

- 保存先: `relay/data/deny-list.sqlite`
- スキーマ: `revoked_nodes(node_id TEXT PRIMARY KEY, public_key TEXT, revoked_at TEXT, revoked_by TEXT)`
- 起動時に SQLite から読み込み、メモリ上の Set に展開
- revoke 受信時に SQLite に書き込んでメモリ Set を更新
- Relay コンテナ再デプロイ時はボリュームマウントで永続化

### 認証境界の責務分離

| 境界 | 責務 | 場所 |
|---|---|---|
| Slack 認証 | ユーザーの身元確認、roleRank 取得 | `server/services/auth-service.js` |
| Mesh 鍵 | ノード固有の暗号化能力 | `~/.brainbase/mesh/node-keypair.json` |
| Permission Checker | Query 単位の権限判定 | `server/mesh/query/permission-checker.js` |
| Relay deny-list | チーム単位の失効判定 | `relay/data/deny-list.sqlite` |

各境界は独立。Slack 認証が落ちても既存 Mesh セッションは維持、Mesh 鍵が漏洩しても Slack 認証は無傷、等。

---

## 13. テストケース仕様

### カバレッジ目標

`docs/architecture/feedback-loop.md` および既存 `vitest.config.js` 準拠で **80% 以上**。

### テストレイヤー分担

| レイヤー | 対象 | ツール |
|---|---|---|
| Unit | crypto, envelope, peer-registry, message-router, permission-checker, node-profile | Vitest (node環境) |
| Integration | 2ノードメッシュ + Relay 経由の暗号化往復 | Vitest + 実Relay起動 |
| E2E (Phase 3) | ブラウザ → Brainbase UI → MCP → mesh_query | Playwright |

### 既存 41 テストとのマッピング

| Spec セクション | テストファイル | テスト数 |
|---|---|---|
| §1 Node Profile | `tests/mesh/node-profile.test.js` | 7 |
| §2 Envelope形式 | `tests/mesh/envelope.test.js` | 6 |
| §2 暗号化 | `tests/mesh/crypto/key-manager.test.js` + `envelope-crypto.test.js` | 8 |
| §6 Permission Checker | `tests/mesh/query/permission-checker.test.js` | 5 |
| §8 Peer Registry / Router | `tests/mesh/peer-registry.test.js` + `message-router.test.js` | 9 |
| §6 Spec準拠（roleRank/projects） | `tests/mesh/spec-compliance.test.js` | 3 |
| 全体 | `tests/mesh/integration.test.js` | 1 |
| 合計 | | 41 |

### Phase 3 で追加すべきテスト

- §11 エラーモデル: 全 MeshErrorCodes が想定 HTTP/MCP レスポンスで返ることを確認
- §12 リプレイ攻撃: 古い ts / 重複 nonce が拒否されること
- §12 サイズ上限: 1MB 超 envelope が拒否されること
- §12 同時接続数: 51ノード目で `MESH_TOO_MANY_CONNECTIONS` が返ること
- §12 deny-list 永続化: Relay 再起動後も拒否が継続すること
- §9 revoke フロー: CEO 署名検証、対象切断、broadcast、再接続拒否
- §7 Slack ログイン → 自動メッシュ参加: モック AuthService で起動フロー検証

---

## 14. ロギング・監視仕様

### ログレベル基準

| レベル | 用途 | 例 |
|---|---|---|
| `error` | 復旧不能 or 要調査 | `MESH_DECRYPTION_FAILED`, `MESH_AUTH_FAILED`, Relay切断 |
| `warn` | 拒否や異常だが継続可能 | `MESH_PERMISSION_DENIED`, `MESH_ENVELOPE_EXPIRED` |
| `info` | 主要ライフサイクル | `MeshService.start/stop`, peer_joined/left, revoke 実行 |
| `debug` | Query/Response 詳細、payload サイズ | scope別収集対象 |

### ログフォーマット

統一: `[Mesh][${nodeId.slice(0,8)}] ${event} ${JSON.stringify(detail)}`

例:
```
[Mesh][a1b2c3d4] MeshService.start { relayUrl: 'wss://...', role: 'ceo', projects: ['p-a'] }
[Mesh][a1b2c3d4] query.send { to: 'node-xyz', scope: 'status', queryId: 'q-001' }
[Mesh][a1b2c3d4] query.timeout { queryId: 'q-001', elapsedMs: 30001 }
[Mesh][a1b2c3d4] permission.denied { from: 'node-xyz', code: 'PROJECT_MISMATCH' }
```

### 監視メトリクス

将来 Prometheus エクスポート対象（Phase 4+）:

| メトリクス | 種別 | 説明 |
|---|---|---|
| `mesh_peers_connected` | Gauge | 現在接続中のピア数 |
| `mesh_query_total{from,scope,result}` | Counter | Query 送信回数（成功/失敗/タイムアウト別） |
| `mesh_response_duration_ms` | Histogram | Query 送信から応答受信までの時間 |
| `mesh_envelope_size_bytes` | Histogram | envelope サイズ分布 |
| `mesh_errors_total{code}` | Counter | エラーコード別の発生回数 |

---

## 15. 実装ステータスマトリクス

仕様項目ごとの「実装済み / Phase 3 / 未実装」の一覧。Spec と現実の乖離を明示する。

| 仕様項目 | 状態 | 対応 NocoDB Task / 備考 |
|---|---|---|
| §1 Node Profile (assignees → projects) | ✅ 実装済み | Task 309 |
| §1 ProjectScope.localPath 解決 | ✅ 実装済み | Task 309 |
| §1 ProjectScope.nocodbTaskTableId/MilestoneTableId | ⚠️ Spec/実装乖離 | 新規Task: LocalContextCollector を NodeProfile.projects[] 対応 |
| §2 Envelope 暗号化 (seal/unseal) | ✅ 実装済み | Task 304 |
| §2 Envelope 形式 (createEnvelope/parseEnvelope) | ✅ 実装済み | Task 304 |
| §3 mesh_query / mesh_peers MCP Tool | ✅ 実装済み | Task 308 |
| §3 MCP Tool エラーレスポンス形式 | ⏳ Phase 3 | 新規Task: MCP Tool のエラー時 isError:true 対応 |
| §4 GET /api/mesh/status, /peers | ✅ 実装済み | Task 310 (server/routes/mesh.js) |
| §4 POST /api/mesh/query (同期, 30秒タイムアウト) | ⚠️ 部分実装 | 現実装は fire-and-forget。新規Task: 同期応答+タイムアウト |
| §4 'all' 宛先の部分応答 | ⏳ Phase 3 | 新規Task |
| §4 Error Responses (AppError 統一) | ⏳ Phase 3 | 新規Task: routes/mesh.js を asyncHandler+AppError 化 |
| §5 QueryHandler ContextData | ✅ 実装済み | Task 307 |
| §6 Permission Checker | ✅ 実装済み | Task 307 |
| §7 Slackログイン → 自動メッシュ参加 | ⏳ Phase 3 | Task 316 |
| §7 MESH_AGENT_RUNTIME 環境変数の利用 | ⏳ 未実装 | 新規Task |
| §8 Relay Server 基本プロトコル | ✅ 実装済み | Task 305 |
| §8 revoke / peer_revoked プロトコル | ⏳ Phase 3 | 新規Task |
| §8 構造化エラー (type='error', code) | ⏳ Phase 3 | 新規Task |
| §9 mesh revoke CLI | ⏳ Phase 3 | 新規Task |
| §11 MeshErrorCodes 定義 | ⏳ Phase 3 | 新規Task: server/mesh/errors.js |
| §12 envelope ts/nonce 検証 (リプレイ対策) | ⏳ Phase 3 | 新規Task |
| §12 envelope サイズ上限 | ⏳ Phase 3 | 新規Task |
| §12 Relay 同時接続数制限 + 重複nodeId拒否 | ⏳ Phase 3 | 新規Task |
| §12 Relay deny-list SQLite 永続化 | ⏳ Phase 3 | 新規Task |
| §13 Phase 3 追加テスト | ⏳ Phase 3 | 新規Task |
| §14 ログフォーマット統一 | ⏳ Phase 3 | 新規Task |
| §14 Prometheus メトリクス | 📋 Future | Phase 4+ |

---

## 16. 用語集

`docs/frames/mesh-ai-driven-management.md` の語彙テーブルと整合。

| 用語 | 定義 |
|------|------|
| **Node** | チームメンバーのPC上で動く Brainbase インスタンス。固有の nodeId と暗号鍵を持つ |
| **Mesh** | 複数の Node が Relay を介して形成する通信ネットワーク |
| **Relay** | 暗号化された envelope を転送する WebSocket 中継サーバー。内容は復号できない |
| **Envelope** | Node 間通信の最小単位。`{ id, from, to, type, payload, ts, nonce }` |
| **Query** | ある Node の AI から別の Node の AI への問い合わせ |
| **Response** | Query への応答。ContextData を含む |
| **QueryHandler** | Query を受けた Node がローカル文脈を収集して応答を生成する仕組み |
| **LocalContextCollector** | ローカルの NocoDB / git / wiki から ContextData を収集 |
| **PermissionChecker** | Query を許可/拒否する判定ロジック |
| **NodeProfile** | Node の自己定義（slackUserId, roleRank, agentRuntime, projects） |
| **ProjectScope** | Node が担当する個別プロジェクトのスコープ（localPath, nocodbBaseId, globInclude） |
| **ROLE_RANK** | 組織上の役割レベル。CEO=3, GM=2, Member=1。Permission Checker と鍵スコープを決定 |
| **Workspace Scope** | QueryHandler がアクセス可能なファイルシステム範囲。`config.yml` の `local.path` で制約 |
| **Agent Runtime** | Node 上で動く AI Agent の種別 (claude-code / codex / ollama)。MVP は claude-code のみ |
| **deny-list** | Relay が再接続を拒否する revoke 済み nodeId のリスト。SQLite で永続化 |
| **scope** | Query の問い合わせ種別 (status/code/project/general)。LocalContextCollector の収集範囲を決定 |
