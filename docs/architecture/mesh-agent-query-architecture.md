---
source_story: STR-001
source_frame: mesh-ai-driven-management
status: accepted
date: 2026-03-29
---

# Architecture: Mesh Agent Query

STR-001「全委託メンバーのAIに一斉問い合わせして数秒で全体像を統合したい」を実現するためのアーキテクチャ。

## レイヤー構造

3つのレイヤーで構成する。各レイヤーは独立して動作し、依存方向は上から下のみ。

```
┌─────────────────────────────────────┐
│  Interface Layer（接点）             │  Claude Code MCP / REST API
├─────────────────────────────────────┤
│  Mesh Layer（通信・認証・暗号）       │  MeshService / Relay / Crypto
├─────────────────────────────────────┤
│  Context Layer（ローカル情報収集）    │  QueryHandler / ContextCollector
└─────────────────────────────────────┘
```

### Interface Layer

Agent（Claude Code）やUI（ブラウザ）がMeshに触れる唯一の境界。

| 接点 | 責務 |
|------|------|
| **MCP Tools** | Claude Codeからmesh_query / mesh_peersを呼べるようにする |
| **REST API** | MCP ToolsがBrainbase Express Serverに問い合わせる中継 |

Interface Layerは「Meshの存在をAgentから隠す」のではなく、「Agentが自然言語で問い合わせたらMeshが動く」ように接続する。

### Mesh Layer

Node間の通信・認証・暗号化を担う。

| コンポーネント | 責務 |
|--------------|------|
| **MeshService** | ノードライフサイクル管理。Query送信、Response受信、ピア管理の統合点 |
| **RelayClient** | Relay Serverへの接続管理。再接続、heartbeat |
| **Relay Server** | 暗号化envelopeを転送する中継。内容は復号不能 |
| **Crypto** | Ed25519署名 + X25519暗号化。envelope単位で暗号化・署名 |
| **PeerRegistry** | 接続中ピアの公開鍵・Role・オンライン状態を管理 |
| **MessageRouter** | 受信envelopeをtype別にハンドラにディスパッチ |
| **PermissionChecker** | ROLE_RANKベースでQueryの許可/拒否を判定 |

### Context Layer

Queryを受けたNodeが「何を返すか」を決めるレイヤー。

| コンポーネント | 責務 |
|--------------|------|
| **QueryHandler** | 問い合わせを受信し、権限チェック → 情報収集 → 応答生成の流れを制御 |
| **LocalContextCollector** | ノード上のローカル情報源からデータを収集 |

## 境界（Boundary）

### Node境界

各メンバーのPC = 1 Node。Node内部は完全に独立しており、Node間の通信はMesh Layerのenvelope経由のみ。

```
Node A                              Node B
┌────────────────┐                 ┌────────────────┐
│ Claude Code    │                 │ Claude Code    │
│   ↕ MCP        │                 │   ↕ MCP        │
│ Interface      │                 │ Interface      │
│   ↕             │                 │   ↕             │
│ Mesh Layer     │ ←── Relay ──→  │ Mesh Layer     │
│   ↕             │  (envelope)    │   ↕             │
│ Context Layer  │                 │ Context Layer  │
└────────────────┘                 └────────────────┘
```

**Node間で流れるもの**: 暗号化されたenvelope（query/response）のみ
**Node間で流れないもの**: 会話ログ、terminal output、.env、生ファイル

### 信頼境界

| 境界 | 信頼レベル |
|------|-----------|
| Node内部 | 完全信頼。ローカルのAI・ファイルシステムは信頼する |
| Relay | 非信頼。暗号化envelopeを転送するだけ。Relayが侵害されても通信内容は保護される |
| Node間 | 条件付き信頼。ROLE_RANKに基づくPermissionCheckerが問い合わせを制御 |

### 認証境界

Slackワークスペースへの参加 = チームへの信頼。Slackログイン時にROLE_RANKを取得し、暗号鍵のスコープを自動決定。別途の招待コードや承認フローは不要。

## Node Profile（ノードの自己定義）

各Nodeは起動時に「自分が誰で、何にアクセスできるか」を宣言する。これがQueryHandlerの収集範囲とPermissionCheckerの判定根拠になる。

```
Node Profile:
  node_id:        自動生成 or 環境変数
  user:           Slackログインで確定（slack_user_id）
  role_rank:      auth-serviceから取得（CEO=3, GM=2, Member=1）
  agent_runtime:  Claude Code | Codex | その他（環境変数で指定）
  projects:       このノードが担当するプロジェクトIDリスト（config.ymlから導出）
  workspace_scope: 各プロジェクトのアクセス可能ディレクトリ（config.ymlから導出）
```

Node Profileはメッシュ参加時にRelay経由で他ノードに共有される（公開情報のみ: node_id, role_rank, projects, 公開鍵）。

## Workspace Scope（ファイルアクセス境界）

QueryHandlerのLocalContextCollectorは、config.ymlで定義されたプロジェクトディレクトリ内のファイルのみ収集する。

### パス解決

`BRAINBASE_ROOT/../` を基準に、config.ymlの `projects[].local.path` を相対パスで解決する。

```
例: BRAINBASE_ROOT = ~/workspace/shared
    config.yml: projects[0].local.path = projects/salestailor
    解決結果: ~/workspace/projects/salestailor/
```

委託メンバーはBrainbaseをgit cloneするだけでパス構造が確定する。追加設定ゼロ。

### 収集範囲の制約

| 収集する | 収集しない |
|---------|-----------|
| config.ymlに定義されたプロジェクトのディレクトリ | ~/Downloads、~/Desktop等の個人ファイル |
| `glob_include`で指定されたファイルパターン | .envファイル（シークレット） |
| gitの状態（status, diff, log） | Claude Code会話ログ |
| NocoDB上の担当タスク | terminal output |

### 担当プロジェクトの制御

佐藤がconfig.ymlの`projects`セクションに「誰がどのプロジェクト担当か」を定義する。委託メンバーのNodeは、自分が担当するプロジェクトのディレクトリのみQueryHandlerの収集対象になる。担当外プロジェクトのフォルダは存在していてもアクセスしない。

## Agent Runtime抽象

Interface Layerに「Agent Runtime」の抽象を入れる。NodeごとにどのAI Agentを使うかを選択可能にする。

```
Interface Layer:
  AgentAdapter（抽象）
    ├── ClaudeCodeAdapter（MCP stdio）  ← MVP
    ├── CodexAdapter（codex exec）      ← 将来
    └── OSSModelAdapter（Ollama等）     ← 将来
```

MVPではClaude Code（MCP経由）のみ対応。Agent Runtimeの選択は環境変数`MESH_AGENT_RUNTIME`で行う（デフォルト: claude-code）。

MCP ToolsはAgent Runtimeに依存しない。mesh_query/mesh_peersはBrainbase REST APIを経由するため、どのAgentからでも呼べる。

## データフロー

### Query/Response フロー

```
1. CEO Claude Code: "全体の状況教えて"
2. → mesh_query MCP Tool呼び出し
3. → Interface Layer: REST API POST /api/mesh/query
4. → Mesh Layer: MeshService.sendQuery()
5.   → payload暗号化 (seal)
6.   → createEnvelope (type: query)
7.   → RelayClient.send() → Relay Server → 対象Node
8.
9. 対象Node:
10.  → RelayClient受信 → MeshService.handleIncomingEnvelope()
11.  → payload復号 (unseal)
12.  → MessageRouter → QueryHandler
13.  → PermissionChecker: ROLE_RANKチェック
14.  → LocalContextCollector: ローカル情報収集
15.  → 構造化JSONで応答生成
16.  → 応答暗号化 → Relay経由で返送
17.
18. CEO Node:
19.  → 応答受信 → 復号
20.  → MCP Tool結果としてClaude Codeに返却
21.  → Claude Codeが構造化JSONを解釈して自然言語で報告
```

### Slackログイン → メッシュ参加 フロー

```
1. npm start → Brainbase Server起動
2. Slackログイン (既存OAuth Device Code Flow)
3. → slack_user_id取得
4. → auth-serviceからROLE_RANK取得
5. → ROLE_RANKに基づいて鍵スコープ決定
6. → ~/.brainbase/mesh/ に鍵ペアが未存在なら自動生成
7. → MeshService.start() → Relay接続 → 公開鍵登録
8. → メッシュ参加完了
```

## SSOTの所在

| データ | SSOT | 理由 |
|--------|------|------|
| タスク状態（タイトル、ステータス、期限） | NocoDB | 全ノード共通。変更なし |
| ユーザーの認証・Role | auth-service (PostgreSQL) | Slackログインで確定。変更なし |
| 暗号鍵ペア | 各Nodeの ~/.brainbase/mesh/ | Nodeごとに一意。他Nodeに共有しない |
| ピアの公開鍵 | PeerRegistry（メモリ） | Relay接続時に交換。永続化不要 |
| ローカル作業文脈 | 各Nodeのファイルシステム | Node上のgit、worktree、Claude Codeが正本 |
| Node Profile | config.yml + auth-service | config.ymlがプロジェクト定義、auth-serviceがRole定義 |
| Workspace Scope | config.yml の projects[].local.path | BRAINBASE_ROOT基準の相対パスで解決 |
| Query/Response | なし（フロー） | 残さない。その場で消費して終わり |

## 既存アーキテクチャパターンとの整合

### EventBus

MeshServiceはEventEmitter継承。`message`イベントで受信envelopeを通知。既存のBrainbase EventBusパターンと同じ。

### Service Layer

MeshService、QueryHandler、LocalContextCollectorは全てステートレスなService。依存はconstructor注入。既存のBrainbase Service Layerパターンと同じ。

### DI Container

MeshServiceの依存（keyManager, relayUrl, nodeId, role）はconstructor注入。server.jsで組み立て。既存のDIパターンと同じ。

## ADR判定

このArchitectureには以下の「初めて」が含まれるため、ADRとして記録する：

1. **Agent間の直接通信** — Brainbaseにおいて初めてのNode間通信
2. **暗号化通信層** — libsodiumによる非対称暗号の導入
3. **Relay Server** — 外部プロセスとしてのインフラ追加
4. **MCP Toolの動的追加** — mesh_query/mesh_peersの追加
