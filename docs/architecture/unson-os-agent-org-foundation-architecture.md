# アーキテクチャ: UnsonOS エージェント組織基盤

## 文書メタ情報

- 状態: 有効
- 種別: アーキテクチャ
- 主題: エージェント組織基盤
- 親文書: [エージェント組織基盤ストーリー](../stories/unson-os-agent-org-foundation-story.md)
- 派生元: [エージェント組織基盤ストーリー](../stories/unson-os-agent-org-foundation-story.md)
- 関連文書: [エージェント組織基盤仕様](../specs/unson-os-agent-org-foundation-spec.md), [UnsonOS 正準ドメイン](./unson-os-canonical-domain.md)
- 置換: なし

## 位置づけ

UnsonOS v0 は **Brainbase を置き換えるものではなく、Brainbase 上に載るエージェント組織実行基盤** として定義する。

- **Brainbase**: 実務担当向け操作面。人間の可視化、セッション操作、タスク確認、MCP 接続の窓口
- **UnsonOS**: 組織実行基盤面。role / agent / work item / run / approval / audit を扱う
- **OpenGoat**: 参考実装。組織実行基盤の考え方は取り込むが、依存境界には入れない

## レイヤー構成

既存の 4 層アーキテクチャに沿いながら、UnsonOS の責務を追加する。

```text
┌────────────────────────────────────────────────────────────┐
│ 実務担当向け操作面 (Brainbase UI / Session / Console)      │
│ - セッション一覧 / ttyd / タスク表示 / 承認待ち一覧表示    │
├────────────────────────────────────────────────────────────┤
│ イベントバス + ストア                                      │
│ - 組織イベント、実行イベント、承認イベント                 │
├────────────────────────────────────────────────────────────┤
│ 組織実行サービス                                           │
│ - OrgRegistryService                                      │
│ - WorkOrchestratorService                                 │
│ - RuntimeAdapterService                                   │
│ - ApprovalAuditService                                    │
│ - ArtifactLedgerService                                   │
├────────────────────────────────────────────────────────────┤
│ データ / 連携層                                            │
│ - NocoDB メタデータリポジトリ                              │
│ - Filesystem 成果物 / ログリポジトリ                       │
│ - MCP / provider adapter                                  │
└────────────────────────────────────────────────────────────┘
```

## 中核コンテキスト

### 1. 組織台帳

- `Organization`, `Role`, `Agent`, `RuntimeProvider` を管理
- Brainbase のセッションは `Agent` の実行コンテナとして再定義する
- どの role がどの provider を使えるかをここで決める

### 2. 作業オーケストレーター

- `WorkItem` を受付し、分解、委譲、実行作成を担う
- 管理者 agent が作業者 agent に渡すときの割り振りルールを持つ
- 低リスクは自動割り振り、高リスクは承認要求へ送る

### 3. 実行基盤アダプター

- `OpenClaw`, `Claude Code`, `Codex` などの差分を吸収する
- 組織実行基盤から見える責務は `start`, `resume`, `cancel`, `collectArtifacts` に絞る
- provider 固有の認証や CLI 差分は adapter 内に閉じる

### 4. 承認と監査

- 承認要求、差し戻し、例外介入、監査記録を担う
- 半自律運転の境界をここで管理する
- 高リスク操作の定義は仕様で固定し、実行基盤側に散らさない

### 5. 成果物台帳

- 成果物、実行ログ、判断理由、失敗理由を保持する
- UI は台帳の投影を表示し、正本は持たない

## データフロー

```text
実務担当が目標を作る
  → WorkOrchestratorService.createWorkItem()
  → OrgRegistryService resolves manager/worker candidates
  → WorkOrchestratorService dispatches work
  → RuntimeAdapterService starts or resumes agent run
  → Agent produces artifacts / tool calls / result
  → ApprovalAuditService decides auto-complete or waiting_approval
  → ArtifactLedgerService stores output and trace
  → EventBus emits org/run/approval events
  → Brainbase UI updates queue, status, and audit views
```

## ガードレール

- **semi-autonomous が前提**
- 次の操作は自動完了させない
  - 外部システムへの破壊的更新
  - 金額、顧客、公開投稿に関わる変更
  - 未承認の credential 使用
- 上記は必ず `ApprovalAuditService` を通して `waiting_approval` に遷移させる

## SSOT

- 構造化メタデータ: NocoDB
- 実行ログ / 成果物 / raw trace: Filesystem
- UI Store: projection only

## 移行方針

- v0 は Brainbase の実務担当向け操作面を活かす
- 既存 task / schedule / session をすぐ消さない
- 最初はエージェント組織用のデータモデルと UI projection を追加し、旧来の task / session 運用と並走可能にする
