# VibePro Brainbase Dogfood Feedback: vibepro-brainbase-20260426-000422

## 状態

正解ラベルに基づいて採点済み。

## 指標

- 本番化ギャップ捕捉率: 1
- 本番化ギャップ的中率: 1
- ゲート違反流出率: 0

## 正しく検出できた本番化ギャップ

- gap.brainbase.change-control.detached-head
- gap.brainbase.change-control.unrelated-dirty-files
- gap.brainbase.vibepro.scorer-manual-only
- gap.brainbase.vibepro.incomplete-run-outputs
- gap.brainbase.mcp.secret-values-in-repo-config
- gap.brainbase.hooks.missing-referenced-scripts
- gap.brainbase.workflows.vibepro-score-not-automated
- gap.brainbase.graph.ssot-not-automatically-verified
- gap.brainbase.story-to-ship.vibepro-dogfood-unshipped
- gap.brainbase.ci.vibepro-scorer-outside-coverage-scope

## 未検出本番化ギャップ

- なし

## 過検出本番化ギャップ

- なし

## 流出したゲート違反

- なし

## 次回診断ルール更新候補

- 現在の診断ルールを維持し、次runで再測定する
