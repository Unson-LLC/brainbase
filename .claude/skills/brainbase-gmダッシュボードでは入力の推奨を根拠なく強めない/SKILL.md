---
name: brainbase-gmダッシュボードでは入力の推奨を根拠なく強めない
description: GMダッシュボードでは入力の推奨を根拠なく強めない
---

# brainbase-gmダッシュボードでは入力の推奨を根拠なく強めない

## Trigger
- Use when this pattern appears: GMダッシュボードでは入力の推奨を根拠なく強めない

## Steps
- 1. Decision項目ごとに入力の選択肢と推奨をそのまま保持する
- 2. 追加提案は「根拠: 期限超過/待機中/Ship 0件」などを確認してから書く
- 3. 根拠が弱い場合は「状況確認」「優先度確認」「ブロッカー確認」に留める

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/gmダッシュボードでは入力の推奨を根拠なく強めない

## Source
- Promoted from explicit_learn / success