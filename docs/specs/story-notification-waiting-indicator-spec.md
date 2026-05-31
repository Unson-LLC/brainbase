---
spec_id: spec-notification-waiting-indicator
story_id: story-notification-waiting-indicator
status: accepted
---

# Spec: Notification hook による返答待ち(orange)表示

## Invariants

- orange(state='waiting')は `_deriveSnapshotFields` が `isWorking=true` かつ
  `activityKind='waiting_input'`(または `statusTone='waiting'`)のとき返す。`isDone` は先に評価される
  ため status='done' では done-unread になる。
- `notifyClaudeWaiting(payload)` は:
  - payload の `notification_type`(または `notificationType`/`type`)と `message` を必ず logHookExecution に記録する。
  - `isWaitingNotification` が true のときのみ報告する。判定: type ∈ {permission_prompt, elicitation_dialog} は true、
    {idle_prompt, auth_success, elicitation_complete/response} は false、type 不明時は message ヒューリスティック。
  - 報告は `status='working'`, `lifecycle='heartbeat'`, `eventType='claude/notification-waiting'`,
    `activityKind='waiting_input'` で投げる(orange かつ isWorking 維持)。
  - 開いている turn が無ければ `claude/notification-bootstrap`(turn_started)で bootstrap してから投げる。
- Notification hook は `.claude/settings.json` の `Notification`(matcher `.*`)で全通知を受け、hook 内で種別判定する。
- notification entrypoint は payload を stdin(JSON)で受け取る。

## Scenarios

### S1. 許可/選択肢待ち → orange
Notification(permission_prompt または elicitation_dialog)→ working+waiting_input 報告 →
getSessionStatus が state='waiting'(orange), isWorking=true を返す。

### S2. 返答待ちでない通知は無視
idle_prompt / auth_success / elicitation_complete 等 → 報告しない(orange を出さない)。
payload ログだけは残す。

### S3. 返答後の復帰
waiting の後、ユーザー返答で後続の PostToolUse heartbeat(activityKind=reasoning 等)→ state='running'(青)。
Stop → done-unread。

### S4. status の選択
status='working'+waiting_input → state='waiting'(orange)。status='done'+waiting_input → done-unread(緑)。
よって hook は working を使う。

## Contracts

- POST /api/sessions/report_activity に status='working', activityKind='waiting_input' を投げると
  GET /api/sessions/status は当該 session を state='waiting'(confidence='explicit')で返す。
- Notification hook の payload type は環境依存(auto-permission mode では permission_prompt が鳴らない等)。
  実 type は logHookExecution の記録で確認し WAITING_NOTIFICATION_TYPES を調整できる。

## Anti-patterns (this fix avoids)

- 返答待ち(選択肢/許可)で止まっているのに稼働インジケータが orange にならない(Stop が鳴らず取りこぼし)
- orange を出すつもりで status='done' を投げて done-unread(緑)になる
- 返答待ちでない通知(idle/auth)で誤って orange を出す

## Verification

- `tests/unit/notification-waiting-state.test.js`: working+waiting_input→waiting / done+waiting_input→done-unread / 復帰
- `tests/unit/activity-bridge-hook-bundles.test.js`: 4 バンドル(notification 含む)の鮮度
- `tests/e2e/story-notification-waiting-indicator-contract.spec.ts`: AC1-4(実 .mjs hook × ライブサーバ)

## Out Of Scope

- 実 notification_type の最終確定(運用で payload ログから追従)
- Stop hook の waiting→done-unread バグ修正(別Story)
- Codex notify の status 確認
