---
story_id: story-notification-waiting-indicator
title: Notification hook で「ユーザー返答待ち」をオレンジ稼働インジケータにする
status: implemented
horizon: M1
view: runtime
period: 2026-05
reason: Claude の Notification hook を新規登録し activity-bridge に waiting 報告を追加する局所機能追加。サーバ〜島の waiting→orange 経路は既存で不変。settings.json 既存ガード等の退行リスク無し。
architecture_docs:
  - path: docs/session-activity-indicator-lifecycle.md
    status: accepted
spec_docs:
  - path: docs/specs/story-notification-waiting-indicator-spec.md
    status: accepted
source_requirement:
  requirement_title: Claude/Codex が選択肢を出して返答待ちで止まる時にオレンジインジケータを出す
---

# Notification hook で「返答待ち」をオレンジにする

## Background

要望: Claude Code / Codex がユーザーに選択肢を出して返答待ちで止まる時、稼働インジケータを
**オレンジ(waiting)** にしたい。

調査(公式ドキュメント + ローカル)で判明:
- オレンジ(state='waiting')経路はサーバ〜島まで実装済み。条件は `isWorking=true` かつ
  `activityKind='waiting_input'`(`_deriveSnapshotFields`)。
- だが Claude の発火元が **Stop hook のテキストヒューリスティックだけ**で、選択肢/許可で
  **ターン途中で止まる**状態は Stop が鳴らず取りこぼしていた。
- Claude Code 公式: **Notification hook** が `permission_prompt`(許可待ち)/`elicitation_dialog`
  (選択肢・入力待ち)/`idle_prompt` 等で発火し matcher で区別可能。`PermissionRequest` も存在。
  `Stop` はターン完了時のみ。→ Notification が「返答待ち」の正しい発火元。
- 既存 Stop の waiting 経路は `status='done'` で投げており、`isDone` が先に効いて done-unread(緑)に
  なる(orange にならない)バグも判明。

Codex 側は `scripts/codex-notify.sh` が `user-input-requested`/`waiting-for-user-input` を
`waiting_input` にマップ済み(配線あり)。

## Change

Claude 用に **Notification hook を新規登録**し、返答待ちで orange を出す:

- `.claude/scripts/hooks/notification/activity-bridge.ts`(新規 entrypoint, stdin で payload 受領)。
- `notifyClaudeWaiting()`(core bridge): payload の `notification_type`/`message` を必ずログ記録
  (実 type 確定用)。`permission_prompt`/`elicitation_dialog`(+message ヒューリスティック)のみ
  **`status='working'` + `activityKind='waiting_input'`** を投げて orange(state=waiting)にする。
  `idle_prompt`/`auth_success` 等は対象外。turn が無ければ bootstrap して isWorking を立てる。
  返答後は後続 PostToolUse/Stop が working/done に戻す。
- `.claude/settings.json` に `Notification`(matcher `.*`)を登録。
- `build-activity-bridge-hooks.mjs` に notification entrypoint を追加し `.mjs` バンドルを生成
  (run-hook.sh が node 高速経路で実行)。`build:hooks` npm script を復活(develop で欠落していた)。

orange を出すのに `status='done'` ではなく `status='working'` を使うのは、done だと isDone が
先に効いて done-unread(緑)になるため(unit で固定)。

## Acceptance Criteria

- [x] Notification(permission_prompt) で稼働インジケータが orange(state=waiting)になる
- [x] Notification(elicitation_dialog)でも orange(waiting)になる
- [x] 返答待ちでない通知(idle_prompt/auth_success)では orange を出さない
- [x] 返答後の活動(report_activity heartbeat)で waiting→running(青)に戻る

## Implementation Evidence

- `.claude/scripts/core/monitoring/brainbase-activity-bridge.ts`: `notifyClaudeWaiting` + `isWaitingNotification` + payload ログ
- `.claude/scripts/hooks/notification/activity-bridge.ts`: stdin payload を読む entrypoint
- `.claude/settings.json`: Notification hook 登録
- `.claude/scripts/build-activity-bridge-hooks.mjs` + 4 つ目の `.mjs` バンドル / `package.json` build:hooks
- `tests/unit/notification-waiting-state.test.js`(3) / `tests/unit/activity-bridge-hook-bundles.test.js`(4バンドル鮮度) / `tests/e2e/story-notification-waiting-indicator-contract.spec.ts`(4)
- 手動 smoke: permission_prompt/elicitation_dialog → state=waiting(orange) を実サーバで確認

## Out Of Scope

- 実 `notification_type` の最終確定: あなたの環境(auto-permission mode で permission_prompt は鳴らない可能性)で
  選択肢時に実際に出る type を payload ログで確認し、必要なら `WAITING_NOTIFICATION_TYPES` を調整(運用で追従)。
- Stop hook の waiting→done-unread(緑)バグの修正(別Story。本PRは Notification 経路の追加に限定)。
- Codex 側 notify の status(working/done)確認(別途)。
- `idle_prompt` を orange に含めるか(現状除外。要望次第)。
