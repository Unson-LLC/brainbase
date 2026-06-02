---
spec_id: spec-waiting-indicator-sticky-until-response
story_id: story-waiting-indicator-sticky-until-response
status: accepted
---

# Spec: 入力待ち(orange)のスティッキー維持

## Invariants

- `_deriveLiveActivity` は `activityKind` を算出後、`_shouldPreserveWaiting(...)` が true のとき
  `activityKind` を `'waiting_input'` に固定する(→ `statusTone='waiting'`)。
- `_shouldPreserveWaiting({ previous, metadata, eventType, status, activeTurnIds })` は次を**すべて**満たすときだけ true:
  1. 直前が waiting(`previous.activityKind === 'waiting_input'` または `previous.statusTone === 'waiting'`)
  2. `status !== 'done'`(turn が閉じていない)
  3. `activeTurnIds.size > 0`(active turn がある)
  4. 明示 `metadata.activityKind` が無い、または `'waiting_input'`
  5. `eventType ∈ WAITING_BACKGROUND_EVENT_TYPES` または `eventType === ''`
- `WAITING_BACKGROUND_EVENT_TYPES` = { `codex/pty-shim-heartbeat`, `codex/pty-shim-ready`,
  `tmux-pane-title-spinner`, `claude/notification-waiting` }。
- 状態導出 `_deriveSnapshotFields`(waiting/running/done/idle の判定)・優先度・staleness は不変。

## Scenarios

### S1. 背景イベントで維持
waiting 中に `codex/pty-shim-heartbeat` / `codex/pty-shim-ready` が来ても `getSessionStatus().state === 'waiting'`。

### S2. 実応答で解除
waiting 中に実活動イベント(`exec_command_output_delta` 等)が来たら `'running'` へ解除。

### S3. turn 完了で解除
waiting 中に `turn_completed`(status=done)が来たら `'done-unread'` へ遷移。

### S4. 明示 activityKind で上書き
`metadata.activityKind`(≠waiting_input)を伴うフックイベントは waiting を上書きできる(既存挙動)。

## Anti-patterns (this fix avoids)

- 背景 pty-shim heartbeat が waiting_input を `'working'` で上書きし、ユーザー応答前に orange が消える
- 別セッション切替の resync で待機状態が失われる
- 実活動・turn 完了でも waiting が解除されず orange が残り続ける(過剰な維持)

## Verification

- `tests/unit/activity-service-methods.test.js`: 背景維持(heartbeat/ready)/実活動解除/turn完了解除/
  明示上書き/`_shouldPreserveWaiting` 真偽表
- `tests/e2e/story-waiting-indicator-sticky-until-response-contract.spec.ts`(4): AC1-4

## Out Of Scope

- 30 分 working staleness(backstop 維持)
- クライアント描画・状態機械段階定義・待機発火経路(notify/Notification hook)
