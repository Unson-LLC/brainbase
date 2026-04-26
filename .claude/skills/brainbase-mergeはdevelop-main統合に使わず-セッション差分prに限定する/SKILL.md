---
name: brainbase-mergeはdevelop-main統合に使わず-セッション差分prに限定する
description: /mergeはdevelop→main統合に使わず、セッション差分PRに限定する
---

# brainbase-mergeはdevelop-main統合に使わず-セッション差分prに限定する

## Trigger
- Use when this pattern appears: /mergeはdevelop→main統合に使わず、セッション差分PRに限定する

## Steps
- 1. merge前に `git log --oneline main..develop` と差分件数を確認
- 2. developが大きく先行していたら直接PR/mergeしない
- 3. 対象機能だけ `cherry-pick` して `feature/<topic>` PRを作る
- 4. develop→main一括統合は別PR・別タスクでコンフリクト解消する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/mergeはdevelop-main統合に使わず-セッション差分prに限定する

## Source
- Promoted from explicit_learn / success