---
name: brainbase-decision必要事項と止まり検知の件数差をそのまま流さず-差分理由を明示する
description: Decision必要事項と止まり検知の件数差をそのまま流さず、差分理由を明示する
---

# brainbase-decision必要事項と止まり検知の件数差をそのまま流さず-差分理由を明示する

## Trigger
- Use when this pattern appears: Decision必要事項と止まり検知の件数差をそのまま流さず、差分理由を明示する

## Steps
- 1. Decision対象リストと止まり検知リストを集合比較する
- 2. 差分があれば「Decision対象外だが監視対象」「軽微なため後段扱い」など分類する
- 3. 見出しは「Decision必要6件＋監視1件」のように差分を含めて書く

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/decision必要事項と止まり検知の件数差をそのまま流さず-差分理由を明示する

## Source
- Promoted from explicit_learn / success