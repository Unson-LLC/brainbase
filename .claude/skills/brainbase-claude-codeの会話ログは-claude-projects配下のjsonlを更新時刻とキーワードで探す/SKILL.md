---
name: brainbase-claude-jsonl-search
description: Claude Codeの会話ログは~/.claude/projects配下のjsonlを更新時刻とキーワードで探す
---

# brainbase-claude-codeの会話ログは-claude-projects配下のjsonlを更新時刻とキーワードで探す

## Trigger
- Use when this pattern appears: Claude Codeの会話ログは~/.claude/projects配下のjsonlを更新時刻とキーワードで探す

## Steps
- find ~/.claude/projects -name '*.jsonl' -mtime -3 -print
- rg -n 'AI駆動|実験台|会社名|人名' ~/.claude/projects/**/*.jsonl
- 候補が出たら jq/rg で user message と assistant text を抽出して復元する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/claude-codeの会話ログは-claude-projects配下のjsonlを更新時刻とキーワードで探す

## Source
- Promoted from explicit_learn / success