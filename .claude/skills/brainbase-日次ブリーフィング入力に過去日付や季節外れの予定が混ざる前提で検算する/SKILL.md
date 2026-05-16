---
name: brainbase-日次ブリーフィング入力に過去日付や季節外れの予定が混ざる前提で検算する
description: 日次ブリーフィング入力に過去日付や季節外れの予定が混ざる前提で検算する
---

# brainbase-日次ブリーフィング入力に過去日付や季節外れの予定が混ざる前提で検算する

## Trigger
- Use when this pattern appears: 日次ブリーフィング入力に過去日付や季節外れの予定が混ざる前提で検算する

## Steps
- 例: 2026/04/26 のブリーフィングに「1月中旬」「2026-01-20期限」が出た場合
- 期限超過日数を明示する
- 今日やる作業は実行ではなく、担当者確認・期限更新・不要ならクローズ判断にする
- 近日イベントなど現在も効いている制約だけを実行計画に残す

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/日次ブリーフィング入力に過去日付や季節外れの予定が混ざる前提で検算する

## Source
- Promoted from explicit_learn / success