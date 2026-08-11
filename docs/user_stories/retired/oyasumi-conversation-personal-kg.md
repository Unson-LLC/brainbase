---
story_id: oyasumi-conversation-personal-kg
title: OyasumiでCodex/Claude Code会話をPersonal KGへ取り込む
status: retired
retired_reason: 2026-08-11に/oyasumiから会話ログの直接収集を外し、Brainbaseへ正規化済みの記録だけを入力にしたため。
---

# Oyasumi会話ログ直接収集（廃止）

このStoryは`/oyasumi`がローカル会話ログを日次scanし、Personal KG candidateへ直接書き込む契約を定義していた。

現在の`/oyasumi`はCodex/Claude Codeタスクやローカルログを全件収集しない。Personal KG候補はBrainbase内の判断結果と実行記録から作り、未接続・部分取得・timeoutを0件へ変換しない。現行の正本は`.claude/commands/oyasumi.md`と`.claude/skills/daily-reflection/SKILL.md`を参照する。
