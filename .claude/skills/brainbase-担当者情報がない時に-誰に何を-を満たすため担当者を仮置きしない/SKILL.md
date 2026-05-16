---
name: brainbase-担当者情報がない時に-誰に何を-を満たすため担当者を仮置きしない
description: 担当者情報がない時に「誰に何を」を満たすため担当者を仮置きしない
---

# brainbase-担当者情報がない時に-誰に何を-を満たすため担当者を仮置きしない

## Trigger
- Use when this pattern appears: 担当者情報がない時に「誰に何を」を満たすため担当者を仮置きしない

## Steps
- 入力に assignee / owner / GM / lead があるか確認する
- なければ「誰に」は「担当未特定」または「PJオーナー要確認」とする
- 例: 「senrigan: 担当未特定。まずPJオーナーを確認し、続行/一時停止の判断を依頼」

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/担当者情報がない時に-誰に何を-を満たすため担当者を仮置きしない

## Source
- Promoted from explicit_learn / success