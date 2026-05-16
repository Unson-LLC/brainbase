---
name: brainbase-朝ブリーフィングでは全体進捗率に引きずられず-対象タスク群だけの停滞を明示する
description: 朝ブリーフィングでは全体進捗率に引きずられず、対象タスク群だけの停滞を明示する
---

# brainbase-朝ブリーフィングでは全体進捗率に引きずられず-対象タスク群だけの停滞を明示する

## Trigger
- Use when this pattern appears: 朝ブリーフィングでは全体進捗率に引きずられず、対象タスク群だけの停滞を明示する

## Steps
- 1. 入力タスクを担当者向け対象群として集計する
- 2. 未着手件数、期限超過件数、最古の超過日数を算出する
- 3. 全体進捗率は補足情報に留め、対象群の停滞を主文脈にする
- 例: 「スプリント80%」でも「EXPO系5件はすべて未着手」と明示する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/朝ブリーフィングでは全体進捗率に引きずられず-対象タスク群だけの停滞を明示する

## Source
- Promoted from explicit_learn / success