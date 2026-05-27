---
spec_id: spec-active-indicator-claude-heartbeat-revival
story_id: story-active-indicator-claude-heartbeat-revival
status: accepted
---

# Spec: Claude heartbeat の活性インジケータ復活

## Invariants

- `_isStrongWorkingSignal({ status:'working', lifecycle, eventType, metadata })` は次の条件で true を返す:
  - `eventType` が `codex/hook/` で始まり、`lifecycle` が `turn_started` または `heartbeat` のとき
  - `eventType` が `claude/` で始まり、`lifecycle` が `turn_started` または `heartbeat` のとき
  - `metadata.activityKind` が `task_started` / `running_command` / `editing_file` のいずれかのとき
- `reportActivity` の heartbeat 分岐は `strongWorkingSignal === true` のとき `lastWorkingAt = max(lastWorkingAt, timestamp)` を実行する
- `effectiveStatus = activeTurnIds.size > 0 || lastWorkingAt > lastDoneAt ? 'working' : 'done'`

## Scenarios

### S1. 通常 working 経路

1. claude/post-tool-use heartbeat (status=working) を受信する
2. `_isStrongWorkingSignal` が true を返す
3. heartbeat 分岐で `lastWorkingAt` が timestamp に更新される
4. `effectiveStatus = 'working'`
5. `hookStatus.status = 'working'` が永続化される

### S2. done 状態からの復活

1. Stop hook 経路で `hookStatus = { status:'done', lastDoneAt:t1 }` になる
2. その後 claude/post-tool-use heartbeat (status=working, timestamp=t2 > t1) を受信する
3. heartbeat 分岐で `lastWorkingAt = t2` に更新される
4. `effectiveStatus = 'working'` で indicator が復活する

### S3. Codex 経路は変化なし

1. codex/hook/pre_tool_use heartbeat (status=working) を受信する
2. `_isStrongWorkingSignal` は従来通り true を返す
3. 既存の挙動と同じ working signal として処理される

## Contracts

- POST `/api/sessions/report_activity` に `lifecycle:'heartbeat'`, `eventType:'claude/post-tool-use'`, `status:'working'` を投げると、その後の `/api/sessions/status` で当該 sessionId が `state:'running', isWorking:true` で返る

## Anti-patterns (this fix avoids)

- Claude heartbeat を弱い signal として扱い `lastWorkingAt` を更新しない
- `effectiveStatus = 'done'` & `lastWorkingAt = 0` & `lastDoneAt = 0` の不整合状態を `hookStatus.set` で永続化
- tmux-pane-title-spinner fallback (confidence=fallback) しか出ない状態で indicator が空白に見える

## Verification

- `tests/unit/activity-service-methods.test.js`
  - `claude/post-tool-use_heartbeat_空状態でworkingに復活する` (S1)
  - `claude/_heartbeat_done済みでも復活してindicatorを保つ` (S2)
  - 既存テスト群が S3 を保証 (Codex hook/ 経路の turn_started, turn_completed, heartbeat, terminal_done)

## Out Of Scope

- bridge 側 (`.claude/scripts/core/monitoring/brainbase-activity-bridge.ts`) の state.json 同期戦略
- Codex 経路のロジック変更
- インジケータの UI 表現変更
