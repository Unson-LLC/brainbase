---
story_id: story-active-indicator-claude-toolless-staleness
title: ツール無し区間でも Claude 稼働インジケータを維持する
status: implemented
horizon: M1
view: runtime
period: 2026-05
reason: 既存 _buildStatusForSession の staleness 窓を「明示的な claude working turn のときだけ 5 分→30 分」に切り替える局所修正。責務分担・依存関係・公開境界・データ構造を変えない。Codex 経路は従来値据え置き。
architecture_docs:
  - path: docs/session-activity-indicator-lifecycle.md
    status: accepted
spec_docs:
  - path: docs/specs/story-active-indicator-claude-toolless-staleness-spec.md
    status: accepted
source_requirement:
  requirement_title: Claude Code セッションの稼働インジケータが作業中なのに消える問題を解消する
---

# ツール無し区間でも Claude 稼働インジケータを維持する

## Background

Claude Code セッションのアクティブインジケータが「過去に何度も直しているのにまた消える」と再報告された。
[[story-active-indicator-claude-heartbeat-revival]] で heartbeat 復活経路は直したが、別の経路が残っていた。

ブラウザ実機調査の結果、`/api/sessions/status` は claude セッションを正しく `isWorking:true` で返しており、
client store にも正しい hookStatus が入り、再レンダリングも機能していた。つまり「heartbeat が届いている間」は正常。

決定的な再現:

- Claude の activity-bridge (`.claude/scripts/core/monitoring/brainbase-activity-bridge.ts`) は **PostToolUse でしか heartbeat を投げない**。turn 中にツール呼び出しが無い区間 (深い思考 / 長文生成 / 子エージェント (Task) 待ち / 入力待ち前) では heartbeat が来ない。
- `server/services/session-core/activity-service-methods.js` の `_buildStatusForSession` は `WORKING_TIMEOUT = 5分` で `isWorkingStale` を判定し、開いている turn でも `isWorkingStale && (activeTurnCount>0 || hasOpenWorking)` のとき `null` を返す。
- よって **ツール無しで 5 分を超えた Claude turn は、まだ作業中なのに indicator が消える**。
- Codex は `codex/hook/*` が密に届き、加えて `tmux-pane-title-spinner` fallback が効くためこの 5 分枯渇に当たりにくい。これが「claude code の場合だけ消える」症状の正体。

整合性の不一致も確認:turn は `restoreHookStatus` / `_isStaleCodexPtyTurn` で 30 分 (`STALE_TURN_TIMEOUT`) まで生存扱いなのに、`_buildStatusForSession` だけ 5 分で indicator を消していた。

deterministic repro (pre-fix): claude turn_started を 6 分前に投げ heartbeat 無し → `getSessionStatus()` が `null` (INDICATOR PRESENT? false)。

## Change

`server/services/session-core/activity-service-methods.js` の `_buildStatusForSession` で、
**明示的な claude の working turn が開いている間だけ** staleness 窓を `WORKING_TIMEOUT` (5分) から
`CLAUDE_WORKING_TIMEOUT` (30分 = `STALE_TURN_TIMEOUT` と同値) に切り替える。

判定 `isClaudeWorking = hasOpenWorking && (activeTurnIds に claude- turn がある || lastEventType が claude/ で始まる)`。
これにより:

- ツール無しで 5〜30 分動く claude turn は indicator を維持
- 30 分を超えたら turn は死んだとみなし従来通り消す
- Codex (`codex/hook`・`codex-pty-turn`) は `WORKING_TIMEOUT` 5 分のまま据え置き
- Claude の done (Stop → turn_completed, lastDoneAt>=lastWorkingAt) は `hasOpenWorking=false` で `isClaudeWorking=false` となり 30 分窓を誤適用しない

## Acceptance Criteria

- [x] 6 分間 heartbeat の無い開いた claude turn でも `/api/sessions/status` が当該 session を `isWorking:true` で返す
- [x] 30 分を超えた開いた claude turn は死んだとみなし `getSessionStatus` から消える
- [x] Codex の `codex/hook/*` / `codex-pty-turn` 経路は 5 分 staleness のまま変更しない (非回帰)
- [x] Claude の turn 完了 (done) は working ではなく done のまま、30 分窓を誤適用しない

## Implementation Evidence

- `server/services/session-core/activity-service-methods.js`: `_buildStatusForSession` に `CLAUDE_WORKING_TIMEOUT` と `isClaudeWorking` を追加し `workingTimeout` を分岐
- `tests/unit/activity-service-methods.test.js`: 下記 4 テストを追加 (pre-fix repro で 6 分 null を実測済み)
  - `claude_開いたturnは5分heartbeat無しでもindicatorを保つ`
  - `claude_開いたturnは30分超で死んだとみなしindicatorを消す`
  - `codex_開いたturnは5分heartbeat無しで消える_非回帰`
  - `claude_完了後はworkingではなくdoneのまま_30分窓を誤適用しない`
- ブラウザ実機 (`localhost:31013`) で claude セッションの working indicator (青 pulse) が描画されることを確認

## Out Of Scope

- bridge (`brainbase-activity-bridge.ts`) に時間ベースの定期 heartbeat を追加する案 (hook は one-shot のため別途検討)
- Codex 経路の staleness 値変更
- pane-title-spinner fallback の挙動変更
- インジケータの UI 表現変更
- client (`session-list-renderer.js` / `session-indicators.js`) の変更 (実機検証で正常動作を確認済み)
