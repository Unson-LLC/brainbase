---
name: brainbase-検査仕様書と試験成績表は同じテストid体系で揃える
description: 検査仕様書と試験成績表は同じテストID体系で揃える
---

# brainbase-検査仕様書と試験成績表は同じテストid体系で揃える

## Trigger
- Use when this pattern appears: 検査仕様書と試験成績表は同じテストID体系で揃える

## Steps
- 1. 実際の総合テストチェックリストを正本にする
- 2. 検査仕様書: ID / 大項目 / テスト項目 / テスト手順 / 期待結果
- 3. 試験成績表: 同じID / 大項目 / テスト項目 / 実施日 / 実施者 / 結果
- 4. 両者の項目数とIDを照合してから納品する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- specs/検査仕様書と試験成績表は同じテストid体系で揃える

## Source
- Promoted from explicit_learn / success