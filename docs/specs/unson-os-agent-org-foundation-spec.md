# 仕様: UnsonOS エージェント組織基盤

## 文書メタ情報

- 状態: 有効
- 種別: 仕様
- 主題: エージェント組織基盤
- 親文書: [エージェント組織基盤アーキテクチャ](../architecture/unson-os-agent-org-foundation-architecture.md)
- 派生元: [エージェント組織基盤アーキテクチャ](../architecture/unson-os-agent-org-foundation-architecture.md)
- 関連文書: [エージェント組織基盤ストーリー](../stories/unson-os-agent-org-foundation-story.md), [UnsonOS 正準ドメイン](../architecture/unson-os-canonical-domain.md)
- 置換: なし

ストーリー: UnsonOS Agent Organization Foundation

## 目的

Brainbase 上で semi-autonomous なエージェント組織を運用するための最小仕様を定義する。

- Brainbase は実務担当向け操作台として残す
- UnsonOS は組織実行基盤を担当する
- OpenGoat は参考実装として扱い、依存は持たない

## 対象範囲

- `Organization`, `Role`, `Agent`, `RuntimeProvider`, `WorkItem`, `Run`, `ApprovalRequest`, `Artifact` の定義
- work item の状態遷移
- 実行基盤アダプターの最小インターフェース
- 承認ゲートの動作
- 実務担当向け操作面から参照する API とイベント

## 対象外

- CRM / 会計 / Slack / SNS の本番接続
- 完全自律運転
- 課金、権限課金、マルチテナント対応
- provider 個別最適化

## エンティティモデル

### `Organization`

```json
{
  "id": "org-unson",
  "name": "Unson",
  "policySetId": "policy-default",
  "defaultManagerRoleId": "role-ceo"
}
```

### `Role`

```json
{
  "id": "role-cto",
  "organizationId": "org-unson",
  "name": "CTO",
  "responsibilities": ["architecture", "delegation", "review"],
  "allowedProviderIds": ["provider-codex", "provider-openclaw"]
}
```

### `Agent`

```json
{
  "id": "agent-cto-01",
  "organizationId": "org-unson",
  "roleId": "role-cto",
  "name": "CTO Agent",
  "providerId": "provider-codex",
  "sessionId": "session-cto-01",
  "status": "ready"
}
```

### `RuntimeProvider`

```json
{
  "id": "provider-openclaw",
  "type": "openclaw",
  "capabilities": ["tool_use", "session_resume", "artifact_output"]
}
```

### `WorkItem`

```json
{
  "id": "work-001",
  "organizationId": "org-unson",
  "title": "承認待ち一覧を実装",
  "objective": "承認ゲート UI と進行管理を追加",
  "requestedBy": "human-operator",
  "assignedRoleId": "role-cto",
  "assignedAgentId": "agent-cto-01",
  "riskLevel": "medium",
  "status": "delegated"
}
```

### `Run`

```json
{
  "id": "run-001",
  "workItemId": "work-001",
  "agentId": "agent-cto-01",
  "status": "running",
  "startedAt": "2026-03-09T10:00:00+09:00",
  "endedAt": null,
  "resultSummary": null
}
```

### `ApprovalRequest`

```json
{
  "id": "approval-001",
  "runId": "run-001",
  "reason": "destructive_external_write",
  "status": "pending",
  "requestedAt": "2026-03-09T10:15:00+09:00"
}
```

### `Artifact`

```json
{
  "id": "artifact-001",
  "runId": "run-001",
  "type": "patch",
  "storageRef": "data/_unson/runs/run-001/patch.diff",
  "summary": "承認待ち一覧 UI の草案"
}
```

## 状態遷移

### `WorkItem.status`

```text
draft -> queued -> delegated -> running -> waiting_approval -> completed
                                         -> failed
                                         -> cancelled
running -> completed
running -> failed
running -> waiting_approval
waiting_approval -> running
waiting_approval -> cancelled
```

### 遷移ルール

1. `draft -> queued`
   - 実務担当が work item を登録した時
2. `queued -> delegated`
   - 管理者 role / agent が解決された時
3. `delegated -> running`
   - 実行基盤アダプターが run を開始した時
4. `running -> waiting_approval`
   - policy が高リスク操作を検出した時
5. `waiting_approval -> running`
   - 実務担当が承認した時
6. `running -> completed`
   - 成果物保存と結果要約が完了した時
7. `running -> failed`
   - 実行失敗、tool error、policy violation の時

## 実行基盤アダプターインターフェース

```javascript
class RuntimeAdapter {
  async startRun({ agentId, workItemId, objective, constraints }) {}
  async resumeRun({ runId, approvalDecision }) {}
  async cancelRun({ runId, reason }) {}
  async collectArtifacts({ runId }) {}
}
```

### 必須の意味論

- `startRun` は provider 固有 session を起動または再利用できること
- `resumeRun` は approval 後に継続できること
- `cancelRun` は run を中断し、監査理由を残すこと
- `collectArtifacts` は成果物と summary を返すこと

## イベント仕様

- `org:work-item-created`
- `org:delegated`
- `org:run-started`
- `org:approval-requested`
- `org:run-completed`
- `org:run-failed`

各イベント payload は最低限以下を含む。

```json
{
  "organizationId": "org-unson",
  "workItemId": "work-001",
  "runId": "run-001",
  "agentId": "agent-cto-01",
  "timestamp": "2026-03-09T10:00:00+09:00"
}
```

## API 仕様

### `GET /api/org/agents`

- 現在の organization に紐づく agent 一覧を返す
- response は `role`, `provider`, `session`, `status` を含む

### `POST /api/org/work-items`

Request:
```json
{
  "title": "承認待ち一覧を実装",
  "objective": "承認ゲート UI と進行管理を追加",
  "riskLevel": "medium"
}
```

Response:
```json
{
  "workItemId": "work-001",
  "status": "queued"
}
```

### `POST /api/org/work-items/:id/dispatch`

- manager / agent 解決を行い、dispatch 成功時に `runId` を返す

### `GET /api/org/work-items/:id`

- work item, current run, latest approval state, artifact summary を返す

### `POST /api/org/runs/:id/approve`

Request:
```json
{
  "decision": "approved",
  "comment": "Proceed with guarded write"
}
```

Response:
```json
{
  "runId": "run-001",
  "status": "running"
}
```

### `GET /api/org/runs/:id`

- run status, result summary, error summary, artifact refs を返す

## 承認ポリシー

以下は `waiting_approval` に必ず送る。
