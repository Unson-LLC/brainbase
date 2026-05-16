---
name: brainbase-ブリーフィング生成では件数を手計算せず-入力データと注意書きの整合を必ず検算する
description: ブリーフィング生成では件数を手計算せず、入力データと注意書きの整合を必ず検算する
---

# brainbase-ブリーフィング生成では件数を手計算せず-入力データと注意書きの整合を必ず検算する

## Trigger
- Use when this pattern appears: ブリーフィング生成では件数を手計算せず、入力データと注意書きの整合を必ず検算する

## Steps
- 1. deadline == 今日 のタスクを抽出して件数を数える
- 2. deadline < 今日 かつ未完了のタスクを抽出して件数を数える
- 3. 入力の「重要な注意点」にある件数と照合する
- 4. ズレた場合はタスク名一覧を見直してから本文に反映する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/ブリーフィング生成では件数を手計算せず-入力データと注意書きの整合を必ず検算する

## Source
- Promoted from explicit_learn / success