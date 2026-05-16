---
name: brainbase-期限超過数だけから原因診断を断定しない
description: 期限超過数だけから原因診断を断定しない
---

# brainbase-期限超過数だけから原因診断を断定しない

## Trigger
- Use when this pattern appears: 期限超過数だけから原因診断を断定しない

## Steps
- 悪い例: 「進行中が多いのに超過あり — 完了定義が曖昧な可能性あり」を断定トーンで主因扱いする
- 良い例: 「仮説: 完了定義のズレまたは優先度過多。確認: 進行中8件の完了条件とブロッカーを担当者に確認」
- 数値から言えること、仮説、確認アクションを分けて書く

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- spikes/期限超過数だけから原因診断を断定しない

## Source
- Promoted from explicit_learn / success