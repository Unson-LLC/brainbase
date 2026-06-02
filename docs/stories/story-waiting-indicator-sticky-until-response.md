---
story_id: story-waiting-indicator-sticky-until-response
title: 入力待ち(orange)インジケータをユーザー応答まで継続させる
status: implemented
horizon: M1
view: runtime
period: 2026-06
reason: server _deriveLiveActivity がイベント毎に activityKind を再計算し waiting_input を保持しないため、背景の pty-shim heartbeat が orange を即潰していた局所修正。waiting を背景ノイズイベントでのみ維持し、実活動/turn終了で解除。EventBus/Store/DI/Service層・UI状態機械は不変。
architecture_docs:
  - path: docs/session-activity-indicator-lifecycle.md
    status: referenced
    reason: _deriveLiveActivity の活動種別解決ロジック内の局所修正。状態機械の段階(idle/working/waiting/done)・優先度・データフローは不変
spec_docs:
  - path: docs/specs/story-waiting-indicator-sticky-until-response-spec.md
    status: accepted
source_requirement:
  requirement_title: オレンジ(入力待ち)がユーザー選択前に別セッション切替で消える問題を直す
---

# 入力待ち(orange)インジケータをユーザー応答まで継続させる

## Background

ユーザー報告:「オレンジは実際にユーザが選択するまで継続していい。オレンジのまま別セッションにとんでも今は消えちゃうよね？」

`server/services/session-core/activity-service-methods.js` の `_deriveLiveActivity` を調査して特定:

- `activityKind = metadata.activityKind || _deriveActivityKind(eventType, status)` で**イベント毎に再計算**され、
  直前の `waiting_input` を保持しない。
- Codex セッションは pty-shim から `codex/pty-shim-heartbeat` / `codex/pty-shim-ready` を絶え間なく流す。
  これらは `metadata.activityKind` を持たないため `_deriveActivityKind('codex/pty-shim-heartbeat', 'working')`
  → **`'working'`** に化け、待機直後の背景 heartbeat が `waiting_input` を上書きして **orange→青** にする。
- 別セッションへ切替えると pty-shim の resync が走り、これが顕在化する(= 切替で消える)。
  Claude 単体は待機中に背景イベントが無いため本来は保持される。

## Change

入力待ちを「ユーザーが実際に応答するまで」維持する。`_deriveLiveActivity` に維持判定を追加:

- `WAITING_BACKGROUND_EVENT_TYPES` = `codex/pty-shim-heartbeat` / `codex/pty-shim-ready` /
  `tmux-pane-title-spinner` / `claude/notification-waiting`(+ 空 eventType)。
- `_shouldPreserveWaiting({ previous, metadata, eventType, status, activeTurnIds })`: 直前が waiting で、
  status≠done かつ active turn があり、明示 activityKind(≠waiting_input)が無く、eventType が背景セットに
  属するときだけ `true`。該当時は `activityKind` を `waiting_input` に戻す(statusTone も waiting に)。
- 解除条件は従来どおり: 実活動イベント(exec/assistant/file delta 等)・明示 activityKind・turn 完了(done)。
- 30 分の working staleness は backstop として不変(ハング時の保険)。

## Acceptance Criteria

- [x] 入力待ち(waiting/orange)は背景イベント(pty-shim heartbeat/ready)では解除されず継続する
- [x] ユーザーが応答して実活動イベントが届いたら waiting を解除する
- [x] turn が完了したら waiting を解除して done へ遷移する
- [x] 明示 activityKind を伴う実フックイベントは waiting を上書きできる

## Implementation Evidence

- `server/services/session-core/activity-service-methods.js`: `WAITING_BACKGROUND_EVENT_TYPES` /
  `_shouldPreserveWaiting` / `_deriveLiveActivity` の waiting 維持
- `tests/unit/activity-service-methods.test.js`: waiting スティッキー維持ブロック(計25)

## Out Of Scope

- 30 分 working staleness の変更(backstop として維持)
- クライアント描画ロジック・優先度tier・状態機械の段階定義の変更
- Codex notify / Claude Notification hook の変更(待機の発火経路は不変)
- 既存の入力ガード分岐 `!sessionId || typeof chunk !== 'string' || !chunk`
  (prompt buffer の引数バリデーション)は本修正の対象外・挙動不変。waiting 維持ロジックとは無関係で、
  不正入力を早期 return する従来のガードをそのまま維持する。
