---
story_id: story-active-indicator-claude-heartbeat-revival
title: Claude ハートビートの稼働インジケータ表示維持
status: implemented
horizon: M1
view: runtime
period: 2026-05
reason: 既存 _isStrongWorkingSignal の prefix 判定を 6 行追加するだけの修正。アーキテクチャの責務分担・依存関係・公開境界を変えない。
architecture_docs:
  - path: docs/session-activity-indicator-lifecycle.md
    status: accepted
spec_docs:
  - path: docs/specs/story-active-indicator-claude-heartbeat-revival-spec.md
    status: accepted
source_requirement:
  requirement_title: Claude Code セッションの稼働インジケータが消える問題を解消する
---

# Claude heartbeat の稼働インジケータ復活

## Background

Claude Code セッションのアクティブインジケータが、ハートビートを受信し続けているにもかかわらず突然消える事象が再発した。原因は server 側 `_isStrongWorkingSignal` が `codex/hook/` プレフィックスにしか対応しておらず、Claude の `claude/post-tool-use` ハートビートが弱い signal として扱われていたこと。

具体的な順序:
1. `.claude/scripts/core/monitoring/brainbase-activity-bridge.ts` の UserPromptSubmit hook が turn_started を投げ、`hookStatus` に turn が積まれる
2. Stop hook で `turn_completed` が投げられ、`hookStatus` の `activeTurnIds` が空になり、`lastDoneAt` が更新される
3. 続けて PostToolUse hook が `claude/post-tool-use` heartbeat (status=working) を投げるが、ここで bridge 側の ローカル保存ファイル には previous turn の id が残っているため新規 turn_started がブートストラップされない desync が起きる
4. server の `reportActivity` heartbeat 分岐で `activeTurnIds.size === 0 && lastWorkingAt <= lastDoneAt` の条件に該当し、`lastWorkingAt` が更新されない
5. `effectiveStatus = 'done'` で固まり、`{ status:'done', lastWorkingAt:0, lastDoneAt:0 }` の不整合なレコードが `hookStatus.set` + `_persistHookStatus` される
6. 次回 `_buildStatusForSession` が `!hasWorking && !hasDone && activeTurnCount===0` で null を返し、indicator が消失。`tmux-pane-title-spinner` の fallback (confidence=fallback) しか出ない値になる

## Change

`server/services/session-core/activity-service-methods.js` の `_isStrongWorkingSignal` を拡張し、`claude/` プレフィックスの eventType も `codex/hook/` と同等に turn_started / heartbeat 経路 で強い working signal として扱う。これで heartbeat 分岐の `strongWorkingSignal` 経路が `lastWorkingAt = max(lastWorkingAt, timestamp)` を実行し、`effectiveStatus = 'working'` になり indicator が復活する。

## Acceptance Criteria

- [x] `claude/post-tool-use` heartbeat (status=working, turnId=`claude-…`) を受信したら hookStatus.status='working' になり `/api/sessions/status` で session が working として返る
- [x] Stop hook で done に落ちた直後でも、続く `claude/post-tool-use` heartbeat で lastWorkingAt が更新されて indicator が消えない
- [x] Codex の `codex/hook/*` 経路、`turn_started` / `turn_completed` / `terminal_done` の既存挙動は変更しない
- [x] Unit テストで pre-fix 実装では fail / post-fix では pass する形で挙動を固定する

## Implementation Evidence

- `server/services/session-core/activity-service-methods.js`: `_isStrongWorkingSignal` に `claude/` プレフィックス分岐を追加
- `tests/unit/activity-service-methods.test.js`: `claude/post-tool-use_heartbeat_空値でworkingに復活する` / `claude/_heartbeat_done済みでも復活してindicatorを保つ` の 2 テストを追加。pre-fix で fail / post-fix で pass を実測

## Out Of Scope

- bridge (`.claude/scripts/core/monitoring/brainbase-activity-bridge.ts`) 側の desync 解消
- Codex 経路の挙動変更
- インジケータの UI 表現変更
- pane-title-spinner fallback の挙動変更
