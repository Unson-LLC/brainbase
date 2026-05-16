---
name: brainbase-略称や聞き違いらしい技術名は正式名候補に展開して検索する
description: 略称や聞き違いらしい技術名は正式名候補に展開して検索する
---

# brainbase-略称や聞き違いらしい技術名は正式名候補に展開して検索する

## Trigger
- Use when this pattern appears: 略称や聞き違いらしい技術名は正式名候補に展開して検索する

## Steps
- 最初の検索: "Corp2Skill" RAG retrieval LLM
- ヒットしない場合: "Corpus2Skill" OR "C2S" retrieval RAG knowledge skill LLM
- 一次情報としてGitHubやarXivを優先して確認する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/略称や聞き違いらしい技術名は正式名候補に展開して検索する

## Source
- Promoted from explicit_learn / success