---
source_story: STR-001
source_architecture: mesh-agent-query-architecture
status: draft
date: 2026-03-29
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

### 判定ルール

```
入力:
  fromRole: number        （問い合わせ元のROLE_RANK）
  fromProjects: string[]  （問い合わせ元の担当プロジェクト）
  toProjects: string[]    （問い合わせ先の担当プロジェクト）

判定:
  fromRole >= 3 (CEO)    → 常に許可
  fromRole >= 2 (GM)     → 常に許可
  fromRole === 1 (Worker) → fromProjectsとtoProjectsに共通プロジェクトがある場合のみ許可
  それ以外              → 拒否

出力:
  { allowed: true } or { allowed: false, reason: string }
```

## 7. Slackログイン → メッシュ参加 統合仕様

### auth-serviceへの変更

既存のSlackログイン成功コールバックに以下を追加する。

```
Slackログイン成功後:
  1. slackUserId, roleRank取得（既存）
  2. config.yml読み込み → NodeProfile構築（新規）
  3. ~/.brainbase/mesh/node-keypair.json の存在チェック
     - 存在しない → generateKeyPair() → saveKeyPair()
     - 存在する → loadKeyPair()
  4. MeshService.start(nodeProfile, keyPair)
  5. Relay接続完了 → mesh_query使用可能
```

### 環境変数

| 変数 | 用途 | デフォルト |
|------|------|-----------|
| `MESH_RELAY_URL` | Relay ServerのWebSocket URL | なし（未設定時はMesh無効） |
| `MESH_NODE_ID` | ノードID | 自動生成 |
| `MESH_AGENT_RUNTIME` | Agent Runtime種別 | claude-code |

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
| ping | Relay→Client | WebSocket ping frame |
| pong | Client→Relay | WebSocket pong frame (自動) |
| error | Relay→Client | `{ type: 'error', message }` |

### Relay Serverの制約

- envelopeの`payload`は暗号化済み文字列。Relayは復号しない
- ピア情報（nodeId, publicKey, roleRank, projects）はメモリ保持のみ。永続化しない
- Relay再起動時は全ノードが再接続・再認証する

## 9. オフボーディング仕様

### CLI

```bash
brainbase mesh revoke <nodeId>
```

### フロー

```
1. CEO NodeからRelay経由で { type: 'revoke', nodeId } を送信
2. Relayが対象nodeIdの接続を切断、deny-listに追加
3. 全ピアに { type: 'peer_revoked', nodeId } を通知
4. 各ピアがPeerRegistryから対象を削除
5. 対象ノードのRelayClient再接続が拒否される
```

## 10. 受入条件とSpecの紐付け

| 受入条件 | Specセクション |
|---------|---------------|
| AC-1: mesh_queryで一斉問い合わせ → 構造化JSON応答 | §3 MCP Tool, §4 REST API, §5 ContextData |
| AC-2: 委託間mesh_query（同プロジェクト） | §6 Permission Checker |
| AC-3: npm start + Slackログインでメッシュ参加 | §7 Slackログイン統合, §1 Node Profile |
| AC-4: 異プロジェクトQuery拒否 | §6 Permission Checker |
| AC-5: Relay管理者でも復号不能 | §2 Envelope（payload暗号化）, §8 Relay制約 |
| AC-6: mesh_peersでメンバー一覧 | §3 MCP Tool, §4 REST API |
| AC-7: オフボーディング時の鍵失効 | §9 オフボーディング |
