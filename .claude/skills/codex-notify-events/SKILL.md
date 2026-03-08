---
name: codex-notify-events
description: Codex CLI の `-c notify=...` コールバック、イベント名、セッションアクティビティインジケータ連携を扱う運用メモ。Codex の notify/event を UI 状態へ結びつけるときに使う。
location: managed
type: project
---

# Codex Notify Events

## 目的

Codex CLI の notify コールバックを使って、brainbase のセッションアクティビティインジケータを安定して制御するための知見をまとめる。

## 使う場面

- Codex のイベントを UI 状態へマッピングするとき
- `scripts/codex-notify.sh` の取りこぼしを調査するとき
- `orange / green / none` のライフサイクルを確認するとき
- Codex の hook 相当の仕組みが本当にあるか確認したいとき

## 確認済みの事実

### Codex CLI は `-c/--config` で notify コールバックを設定できる

```bash
codex --help
```

brainbase では実際に `-c notify=...` で起動している。

```bash
codex -c 'notify=["bash","/absolute/path/to/scripts/codex-notify.sh"]'
```

### 実装上の notify 入口

- [scripts/codex-notify.sh](/Users/ksato/workspace/code/brainbase/scripts/codex-notify.sh)
- [scripts/codex-wrapper.sh](/Users/ksato/workspace/code/brainbase/scripts/codex-wrapper.sh)
- [server/controllers/session-controller.js](/Users/ksato/workspace/code/brainbase/server/controllers/session-controller.js)
- [server/services/session-manager.js](/Users/ksato/workspace/code/brainbase/server/services/session-manager.js)
- [public/modules/session-indicators.js](/Users/ksato/workspace/code/brainbase/public/modules/session-indicators.js)

## 代表イベント

Codex まわりで観測・対応対象にしているイベント名はこれ。

- `turn/started`
- `turn/completed`
- `agent-turn-start`
- `agent-turn-complete`
- `item/agentMessage/delta`
- `item/assistantMessage/delta`
- `item/commandExecution/outputDelta`
- `item/fileChange/outputDelta`
- `user-input-requested`

注意:
- payload のキー名は固定前提にしない
- `type` だけでなく `method` も見る
- `turn-id` だけでなく `turnId` / `turn.id` も見る
- `thread-id` だけでなく `threadId` / `thread.id` も見る

## インジケータの意味

- `orange`: ユーザ入力後、AI が turn 実行中
- `green`: AI が止まってユーザ入力待ち
- `none`: 活動中でも完了待ちでもない、または緑が既読化された状態

## 推奨マッピング

### Orange に入る

- `agent-turn-start`
- `agent-turn-begin`
- `turn/started`
- `task_started`

### Orange を維持する heartbeat

- `assistant-message`
- `assistant-response`
- `assistant-message-complete`
- `assistant-response-complete`
- `item/agentMessage/delta`
- `item/assistantMessage/delta`
- `item/commandExecution/outputDelta`
- `item/fileChange/outputDelta`
- `item/completed`

### Green に入る

- `user-input-requested`
- `request-user-input`
- `waiting-for-user-input`
- `turn/completed`
- `task_complete`
- `turn/failed`
- `turn/interrupted`

設計意図:
- 理想の終端は `AI が入力待ちに戻った` イベント
- ただし実イベント差や後方互換のため `turn/completed` も done 側に残す

## 実装メモ

`scripts/codex-notify.sh` は JSON payload からイベントを抽出して `/api/sessions/report_activity` へ投げる。

送信フィールド:

- `sessionId`
- `status`
- `reportedAt`
- `lifecycle`
- `eventType`
- `turnId`

`lifecycle` の意味:

- `turn_started`: orange 開始
- `heartbeat`: orange 維持
- `turn_completed`: green 遷移

## デバッグ手順

1. `codex --help` で `-c/--config` があることを確認する
2. 起動コマンドに `notify=["bash",".../codex-notify.sh"]` が入っているか見る
3. [scripts/codex-notify.sh](/Users/ksato/workspace/code/brainbase/scripts/codex-notify.sh) で `type/method`, `turnId`, `threadId` の取り方を確認する
4. server 側の `[Hook] Received status update...` ログで `lifecycle` と `turnId` を見る
5. `/api/sessions/status` の `isWorking`, `isDone`, `lastEventType`, `activeTurnCount` を確認する

## 関連ドキュメント

- [docs/session-activity-indicator-lifecycle.md](/Users/ksato/workspace/code/brainbase/docs/session-activity-indicator-lifecycle.md)
