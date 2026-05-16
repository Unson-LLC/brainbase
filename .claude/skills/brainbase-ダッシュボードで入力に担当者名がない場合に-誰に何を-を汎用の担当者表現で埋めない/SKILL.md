---
name: brainbase-ダッシュボードで入力に担当者名がない場合に-誰に何を-を汎用の担当者表現で埋めない
description: ダッシュボードで入力に担当者名がない場合に「誰に何を」を汎用の担当者表現で埋めない
---

# brainbase-ダッシュボードで入力に担当者名がない場合に-誰に何を-を汎用の担当者表現で埋めない

## Trigger
- Use when this pattern appears: ダッシュボードで入力に担当者名がない場合に「誰に何を」を汎用の担当者表現で埋めない

## Steps
- 1. 入力JSONに owner/assignee/GM/person があるか確認する
- 2. なければ Graph SSOT またはタスクDBで project -> owner を引く
- 3. それでも不明なら「誰に: 担当者未特定」「何を: owner確認後に期限超過上位N件を整理」と書く

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/ダッシュボードで入力に担当者名がない場合に-誰に何を-を汎用の担当者表現で埋めない

## Source
- Promoted from explicit_learn / success