---
spec_id: spec-active-indicator-pane-spinner-unchanged-drop
story_id: story-active-indicator-pane-spinner-unchanged-drop
status: accepted
---

# Spec: pane-title フォールバックの未変化ドロップ

## Invariants

- `_getPaneTitleActivityStatuses` は pane title 先頭文字が `PANE_TITLE_SPINNER_CHARS` のとき working 候補にする
- working から落とす条件は次のいずれか:
  - pane が一覧から消えて `PANE_TITLE_SPINNER_STALE_TIMEOUT` (30s) 超過
  - 先頭文字が spinner 文字でない (idle/done タイトル) → 即 `cache.delete` + skip
  - タイトルが `PANE_TITLE_SPINNER_UNCHANGED_TIMEOUT` (=30 分) を超えて未変化 (フリーズ判定)
- `PANE_TITLE_SPINNER_UNCHANGED_TIMEOUT` は 30 分とし、explicit 側 `CLAUDE_WORKING_TIMEOUT` /
  `STALE_TURN_TIMEOUT` と同値にそろえる
- タイトルが変化すると `lastChangedAt` が更新され未変化タイマーがリセットされる

## Scenarios

### S1. 遅い braille スピナーの誤ドロップ防止

1. pane title `⠂ Claude Code` を観測 → working(confidence=fallback)
2. 5〜10 分タイトル未変化 (braille が進まない静止区間) でも `now - lastChangedAt < 30分`
3. → working を保つ。pre-fix(30s) では落ちていた

### S2. フリーズしたスピナーの打ち切り

1. pane title `⠂ Claude Code` 観測
2. 31 分間まったく未変化
3. `now - lastChangedAt > 30分` → working から落とす

### S3. スピナー文字消失で即ドロップ

1. `⠂ Claude Code` (working) → `✳ Claude Code` (✳ は spinner set 外)
2. 先頭文字が spinner でない → `cache.delete` + skip → 即ドロップ

### S4. 変化でタイマーリセット

1. `⠂ Claude Code` 観測 → 20 分後 `⠴ Claude Code` (braille 前進=変化)
2. `lastChangedAt` 更新 → さらに 20 分(累計 40 分)でも直近変化から 20 分なので working 継続

## Contracts

- GET `/api/sessions/status` は、pane title にスピナー文字が出ていて pane が観測され続ける Claude
  セッションを、タイトル未変化が 30 分に達するまで `state:'running', isWorking:true, confidence:'fallback'`
  で返す
- pane 消失 / スピナー文字消失で当該 sessionId は status から消える

## Anti-patterns (this fix avoids)

- 遅い braille スピナーの 30s 未変化を「フリーズ」と誤判定して working 中に indicator を消す (青→無印)
- pane / スピナー文字の消失による正当なドロップまで無効化する(→ S3/pane消失は維持)

## Verification

- `tests/unit/activity-service-methods.test.js` の `_getPaneTitleActivityStatuses` describe (S1-S4 + pane消失)
- `tests/e2e/story-active-indicator-pane-spinner-unchanged-drop-report-activity.spec.ts` (AC1-4)

## Out Of Scope

- explicit hook 不達の根本原因
- 終了時の done 解決 (explicit Stop hook 不達時の無印)
- Codex 経路の意図的挙動変更
