---
name: vibepro-story-refactor
description: Use when a repository explicitly uses VibePro Story and Spec artifacts for a focused refactor.
---

# VibePro Story Refactor

## Purpose

利用者価値と既存の振る舞いを守りながら、限定した責務を安全に整理する。

## When to Use

対象リポジトリがVibePro Story／Specを明示的に使い、受け入れ条件を変えない限定的なrefactorを行う場合に使う。

## Process

1. Storyの目的、受け入れ条件、変更しない振る舞いを確認する。
2. 境界や契約が変わる場合だけArchitecture／ADRを更新する。
3. 変更対象を一つの責務に絞り、必要なSpecを最小限更新する。
4. 変更前の振る舞いを対象テストで固定し、小さく実装する。
5. 影響範囲のテストを実行し、通常のGitHub PRとレビューへ進む。

## Red Flags

Gate DAG、`gate:agent_review`、head-bound evidence、review lifecycle、`vibepro pr create`、`vibepro execute merge` を必須にしない。旧成果物に表示されても新しい作業を起こさない。

## Common Rationalizations

「refactorだから旧Gate一式を閉じる必要がある」は理由にならない。必要なのは受け入れ条件と変更しない振る舞いの確認である。

## Verification

変更コードと影響範囲のテストを確認する。受け入れ条件の未達、セキュリティ境界、データ損失、変更した配備／ロールバック、CI検証不能だけを阻害理由にする。
