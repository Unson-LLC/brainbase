---
name: brainbase-請求書作成前に契約書・会話・内訳合計の3点照合を必須にする
description: 請求書作成前に契約書・会話・内訳合計の3点照合を必須にする
---

# brainbase-請求書作成前に契約書・会話・内訳合計の3点照合を必須にする

## Trigger
- Use when this pattern appears: 請求書作成前に契約書・会話・内訳合計の3点照合を必須にする

## Steps
- 1. 契約書から期間・税抜額・消費税・税込額を抽出
- 2. 会話ログ/合意文から同じ項目を抽出
- 3. 明細行の税抜合計、消費税、税込合計を手計算で検算
- 4. 差分があれば「未確定」として確認事項にする
- 5. 確定後にのみ freee API の POST/PUT を実行

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- specs/請求書作成前に契約書・会話・内訳合計の3点照合を必須にする

## Source
- Promoted from explicit_learn / success