---
name: git-workflow
description: brainbaseでコミット、PR、マージ、マージ後の反映確認を行うときに使う。
---

# Git操作

一つの依頼に対応する変更だけを通常のレビュー経路へ渡す。入力は対象repo・変更・依頼された到達点、出力はcommit/PRと検証状態。

## 必要な手順を選ぶ

| 今回の操作 | 参照先 |
|---|---|
| branch/worktreeを作る、dirty変更を分離する | [branch-worktree-rules](../branch-worktree-rules/SKILL.md) |
| コミットメッセージを書く | [git-commit-rules](../git-commit-rules/SKILL.md) |
| StoryからPRへ進める | [vibepro-workflow](../vibepro-workflow/SKILL.md) |
| PR作成 / マージ | [create-pr](../../commands/create-pr.md) / [merge](../../commands/merge.md) |
| マージ済み変更の稼働環境への反映を確認する | [deploy-merged-pr](../../commands/deploy-merged-pr.md) |

## 操作と完了の境界

- 作業前のbranch・HEAD・upstream・dirty状態を確認し、既存の変更と今回の変更を区別する。分離が必要ならworktreeの手順へ進む。
- 一つの意図を一つのcommitにし、対象ファイルだけを明示してstageする。既存のstagingも確認する。baseへ直接commitせず、`git add -A`、`git add .`、無関係なstash/resetは使わない。
- 説明には問題、変更理由、結果、検証を必要な範囲で書く。モデル名や実行ツールの署名を例文から偽って転記しない。
- 依頼とrepoの権限範囲でcommit・push・PR・CI確認まで進める。マージは通常のレビューと権限境界に従う。新しい失敗がなければ検証を反復しない。
- 完了時にcommit/PR、検証結果、現在のbranch・HEAD・upstream・dirty状態を確認する。別作業のdirty変更は残してよい。
- マージと配備・稼働確認は別の成果。マージだけを理由に個人checkoutを切り替えたり、固定パスのサービスを再起動したりしない。
- 開発session・worktree・プロセス管理はCodex所有。正本は `docs/architecture/ADR-019-codex-owns-development-runtime.md`。旧Brainbase lifecycle APIや自動cleanupは使わない。
- 失敗時は失敗した操作と残作業を示し、復旧可能な範囲は進める。認証・CI・readbackの失敗を成功扱いしない。
