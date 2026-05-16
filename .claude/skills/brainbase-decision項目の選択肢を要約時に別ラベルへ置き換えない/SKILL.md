---
name: brainbase-decision項目の選択肢を要約時に別ラベルへ置き換えない
description: Decision項目の選択肢を要約時に別ラベルへ置き換えない
---

# brainbase-decision項目の選択肢を要約時に別ラベルへ置き換えない

## Trigger
- Use when this pattern appears: Decision項目の選択肢を要約時に別ラベルへ置き換えない

## Steps
- Decision項目を処理する前に、各項目の「選択肢」と「推奨」を抽出する
- 出力では「今日中にShip / ブロッカーを相談 / 優先度見直し」など入力の選択肢を維持する
- 表現を短縮する場合も、意味が変わる語（期限延長、担当変更など）へ置換しない

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/decision項目の選択肢を要約時に別ラベルへ置き換えない

## Source
- Promoted from explicit_learn / success