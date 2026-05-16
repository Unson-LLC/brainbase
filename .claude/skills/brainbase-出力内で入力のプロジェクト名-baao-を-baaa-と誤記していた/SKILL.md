---
name: brainbase-出力内で入力のプロジェクト名-baao-を-baaa-と誤記していた
description: 出力内で入力のプロジェクト名 BAAO を BAAA と誤記していた
---

# brainbase-出力内で入力のプロジェクト名-baao-を-baaa-と誤記していた

## Trigger
- Use when this pattern appears: 出力内で入力のプロジェクト名 BAAO を BAAA と誤記していた

## Steps
- 1. 入力に出た project_name/link label を一覧化する
- 2. 出力前に本文内の固有名詞が一覧と一致するか確認する
- 3. 類似文字列（BAAO/BAAA など）が出たら入力値へ修正する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/出力内で入力のプロジェクト名-baao-を-baaa-と誤記していた

## Source
- Promoted from explicit_learn / success