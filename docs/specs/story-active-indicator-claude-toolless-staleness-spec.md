---
spec_id: spec-active-indicator-claude-toolless-staleness
story_id: story-active-indicator-claude-toolless-staleness
status: accepted
---

# Spec: ツール無し区間での Claude 稼働インジケータ維持

## Invariants

- `_buildStatusForSession(hookData)` は staleness 判定窓を次で決める:
  - `hasOpenWorking = lastWorkingAt > lastDoneAt`
  - `isClaudeWorking = hasOpenWorking && ( activeTurnIds に `claude-` で始まる turn がある || lastEventType が `claude/` で始まる )`
  - `workingTimeout = isClaudeWorking ? CLAUDE_WORKING_TIMEOUT(30分) : WORKING_TIMEOUT(5分)`
  - `isWorkingStale = lastActiveAt > 0 && (now - lastActiveAt > workingTimeout)`
- `CLAUDE_WORKING_TIMEOUT` は `restoreHookStatus` の `STALE_TURN_TIMEOUT` および `_isStaleCodexPtyTurn` の 30 分窓と同値にそろえる
- staleness を超えた working は従来通り `null` を返す (`isWorkingStale && activeTurnCount===0 && !hasDone` / `isWorkingStale && (activeTurnCount>0 || hasOpenWorking)`)
- done 判定 (`hasOpenWorking=false`) のとき `isClaudeWorking=false` となり 30 分窓を適用しない

## Scenarios

### S1. ツール無し claude turn は 5 分超でも working

1. claude turn_started (eventType=`claude/user-prompt-submit`, turnId=`claude-…`) を 6 分前に受信
2. 以降 PostToolUse heartbeat が来ない (ツール無し区間)
3. `isClaudeWorking = true` で `workingTimeout = 30分`
4. `now - lastActiveAt (6分) <= 30分` なので `isWorkingStale=false`
5. `getSessionStatus()` が当該 session を `isWorking:true` で返す

### S2. 30 分超の claude turn は死んだとみなす

1. claude turn_started を 31 分前に受信、以降 heartbeat 無し
2. `isClaudeWorking=true`, `workingTimeout=30分`
3. `now - lastActiveAt (31分) > 30分` なので `isWorkingStale=true`
4. `isWorkingStale && (activeTurnCount>0 || hasOpenWorking)` で `null` を返し indicator を消す

### S3. Codex 経路は 5 分のまま (非回帰)

1. codex turn_started (eventType=`codex/hook/UserPromptSubmit`, turnId=`codex-pty-turn-…`) を 6 分前に受信
2. `isClaudeWorking=false` (claude- turn でも claude/ event でもない) で `workingTimeout=5分`
3. `now - lastActiveAt (6分) > 5分` で `isWorkingStale=true` → `null`。従来挙動と同一

### S4. 完了済み claude は done を維持

1. claude turn_started → turn_completed (eventType=`turn/completed`, lastDoneAt>=lastWorkingAt)
2. `hasOpenWorking=false` → `isClaudeWorking=false`
3. `isWorking=false`, `isDone=true` を返す。30 分窓を誤適用して working に固着しない

## Contracts

- POST `/api/sessions/report_activity` に `lifecycle:'turn_started'`, `eventType:'claude/user-prompt-submit'`, `status:'working'` を投げた後、5〜30 分 heartbeat が無くても `/api/sessions/status` で当該 sessionId は `state:'running', isWorking:true` を返す
- 同条件で 30 分を超えると当該 sessionId は `/api/sessions/status` から消える

## Anti-patterns (this fix avoids)

- ツール呼び出しを伴わない正当な作業区間 (深い思考 / 長文生成 / 子エージェント待ち) を 5 分で「停止」とみなして indicator を消す
- `_buildStatusForSession` の 5 分窓と turn 生存の 30 分窓 (`STALE_TURN_TIMEOUT`) の不一致を放置する
- Codex の staleness を巻き込んで変えてしまう
- done 状態に 30 分窓を適用して working に固着させる

## Verification

- `tests/unit/activity-service-methods.test.js`
  - `claude_開いたturnは5分heartbeat無しでもindicatorを保つ` (S1)
  - `claude_開いたturnは30分超で死んだとみなしindicatorを消す` (S2)
  - `codex_開いたturnは5分heartbeat無しで消える_非回帰` (S3)
  - `claude_完了後はworkingではなくdoneのまま_30分窓を誤適用しない` (S4)
- `tests/e2e/story-active-indicator-claude-toolless-staleness-report-activity.spec.ts` (Story acceptance coverage)

## Out Of Scope

- bridge 側の定期 heartbeat 追加
- Codex 経路の staleness 値変更
- pane-title-spinner fallback の挙動変更
- インジケータの UI 表現変更
