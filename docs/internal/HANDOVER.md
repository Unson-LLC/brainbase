# 旧HANDOVERの退役案内

このファイルは現在の引継ぎ・未完了タスクの正本ではありません。2026年2月22日の自動生成に失敗したスナップショットは、現行手順から除外しました。過去の本文はこのファイルのGit履歴に残っています。

## 作業を再開するとき

1. 対象のCodexタスクで最新の依頼、実施結果、未完了事項を確認する。
2. 対象repoとworktreeを確認したうえで、`git status --short --branch`、`git diff --stat`、必要に応じてPR・CIの現在状態を読み取る。過去の記録だけから現在状態を推測しない。
3. 記録と実状態に差があれば、未確認として切り分ける。他の作業の変更を上書きせず、checkoutの切替・再起動・削除を自動実行しない。

開発作業の所有境界は[ADR-019](../architecture/ADR-019-codex-owns-development-runtime.md)、Git操作は[Git Workflow](../../.claude/skills/git-workflow/SKILL.md)を参照してください。
