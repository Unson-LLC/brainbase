# PR作成

現在のfeature branchを通常のGitHub経路でレビューに出します。開発worktreeの管理はCodexが所有します。正本は `docs/architecture/ADR-019-codex-owns-development-runtime.md` です。

1. `git status --short --branch`、`git remote -v`、`git worktree list`で対象と既存変更を確認する。
2. repoの規約からbaseを確認する。main/developの存在順で選ばず、baseへ直接commitしない。
3. 今回のファイルだけを明示的にstage/commitし、対象テストと一度のレビューを行う。
4. `git diff <base>...HEAD`で差分を確認し、feature branchをpushする。
5. `gh pr create --base <確認したbase> --head <feature-branch> --title <タイトル> --body-file <本文ファイル>`で作成する。本文にStory/Spec、変更、実行済み検証、未確認事項を記す。
6. `gh pr view --json url,baseRefName,headRefName,headRefOid,state`で確認し、CodexではPRを現在のタスクへ添付する。

PR作成はマージ・deployではありません。マージは `/merge` に従います。旧Brainbase session APIや自動worktree cleanupは使用しません。
