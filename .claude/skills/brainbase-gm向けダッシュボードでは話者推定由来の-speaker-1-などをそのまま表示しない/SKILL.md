---
name: brainbase-gm向けダッシュボードでは話者推定由来の-speaker-1-などをそのまま表示しない
description: "GM向けダッシュボードでは話者推定由来の `Speaker 1` などをそのまま表示しない"
---

# brainbase-gm向けダッシュボードでは話者推定由来の-speaker-1-などをそのまま表示しない

## Trigger
- Use when this pattern appears: GM向けダッシュボードでは話者推定由来の `Speaker 1` などをそのまま表示しない

## Steps
- 1. メンバー一覧に `Speaker <number>` / `話者<number>` / `未定` が含まれるか確認する
- 2. 実名・担当・タスクと紐づかないものは dashboard の主要メンバー欄から除外する
- 3. 必要なら末尾に「未特定メンバーあり」とだけ注記する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/gm向けダッシュボードでは話者推定由来の-speaker-1-などをそのまま表示しない

## Source
- Promoted from explicit_learn / success