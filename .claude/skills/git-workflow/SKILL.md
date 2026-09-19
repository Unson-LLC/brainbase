---
name: git-workflow
description: Brainbaseの対象限定commit、通常のGitHub PR/CI/merge、反映確認の境界を守る。
---

# Git Workflow

1. repo・branch・HEAD・upstream・worktree・dirty状態を確認する。既存の無関係な差分を保持する。
2. worktree作成は `branch-worktree-rules`、commit形式と粒度は `git-commit-rules` に従う。今回のファイルだけを明示的にstageする。全量stage、baseへの直接commit、無条件switch/resetはしない。
3. 対象テストと一度のレビュー後、`.claude/commands/create-pr.md` の通常のGitHub経路でPRを作成する。
4. CI・対象SHA・権限を確認し、`.claude/commands/merge.md` に従う。保護ルールや承認を迂回しない。
5. マージ結果をreadbackする。ソース統合と本番反映は分けて報告する。

## 稼働環境への反映

マージを理由に個人checkoutを切り替えたり、サーバーを自動再起動したりしない。確認・反映が依頼された場合は `.claude/commands/deploy-merged-pr.md` と `brainbase-capability-map` を使い、現在の起動元・updater・pin・承認範囲を確認する。固定された個人パスを正本と推測しない。

開発session・worktree・プロセス管理はCodex所有。正本は `docs/architecture/ADR-019-codex-owns-development-runtime.md`。旧Brainbase lifecycle APIや自動cleanupは使わない。
