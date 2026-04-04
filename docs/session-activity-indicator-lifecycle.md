# Session Activity Indicator Lifecycle

## 目的

セッション一覧のアクティブインジケータを、`blue / orange / green / none` で一貫して扱うための設計メモ。

## 意味

- `blue`: ユーザが入力を送ってから、AI が処理を止めるまで
- `orange`: AI がユーザの選択や入力を待っている
- `green`: AI が完了し、未読の更新がある
- `none`: 未実行、既読化済み、または状態なし

## 状態遷移図

```mermaid
stateDiagram-v2
    [*] --> None

    None --> Blue: user submits prompt\nturn_started
    Blue --> Blue: assistant/tool/file delta\nheartbeat
    Blue --> Orange: user-input-requested\nturn_completed
    Blue --> Green: turn/completed fallback
    Green --> Blue: user submits next prompt
    Orange --> Blue: user submits next prompt
    Green --> None: user opens session\nthen leaves without new input
    None --> None: polling with no hook status
```

## フロー図

```mermaid
flowchart LR
    A[User inputs prompt] --> B[Codex emits turn started]
    B --> C[notify callback]
    C --> D[/api/sessions/report_activity lifecycle=turn_started/]
    D --> E[SessionManager sets isWorking=true]
    E --> F[Sidebar shows blue]

    F --> G[Codex emits delta events]
    G --> H[notify callback heartbeat]
    H --> I[SessionManager keeps working]

    I --> J[Codex/Claude emits user-input-requested or turn/completed]
    J --> K[notify callback turn_completed]
    K --> L{waiting input?}
    L -->|yes| M[Sidebar shows orange]
    L -->|no| N[Sidebar shows green]

    M --> O[User submits next prompt]
    O --> F

    N --> P[User switches away without new prompt]
    P --> Q[markDoneAsRead]
    Q --> R[Sidebar clears to none]
```

## イベントマッピング

### Orange 開始

- `agent-turn-start`
- `agent-turn-begin`
- `turn/started`
- `task_started`

### Orange 維持

- `assistant-message`
- `assistant-response`
- `assistant-message-complete`
- `assistant-response-complete`
- `item/agentMessage/delta`
- `item/assistantMessage/delta`
- `item/commandExecution/outputDelta`
- `item/fileChange/outputDelta`
- `item/completed`

### Green 遷移

- `user-input-requested`
- `request-user-input`
- `waiting-for-user-input`
- `turn/completed`
- `task_complete`
- `turn/failed`
- `turn/interrupted`

## 実装位置

- notify 入口: [scripts/codex-notify.sh](/Users/ksato/workspace/code/brainbase/scripts/codex-notify.sh)
- server 状態機械: [server/services/session-manager.js](/Users/ksato/workspace/code/brainbase/server/services/session-manager.js)
- status API: [server/controllers/session-controller.js](/Users/ksato/workspace/code/brainbase/server/controllers/session-controller.js)
- client 表示: [public/modules/session-indicators.js](/Users/ksato/workspace/code/brainbase/public/modules/session-indicators.js)
- 緑既読化: [public/app.js#L1114](/Users/ksato/workspace/code/brainbase/public/app.js#L1114)

## 実装ルール

- notify payload は `type` 固定で決め打ちしない
- `method`, `turnId`, `turn.id`, `threadId`, `thread.id` も拾う
- `assistant-message-complete` を done に倒さない
- done は `AI が入力待ちに戻った` シグナルを優先する
- `turn/completed` は後方互換の fallback として扱う
