# PRのマージ

開発session・worktree・プロセスの所有者はCodexです。正本は `docs/architecture/ADR-019-codex-owns-development-runtime.md`。旧Brainbase session/state APIは使いません。

## 手順

1. `git status --short --branch`、`git remote -v`、`git worktree list`でrepo・branch・HEAD・dirty状態を確認する。無関係な変更を含めない。
2. `gh pr view <PR番号> --json url,baseRefName,headRefName,headRefOid,state,reviewDecision,mergeStateStatus`で対象を確認する。baseはrepo規約に従い、branchの存在順から推測しない。
3. 対象テスト・レビュー・`gh pr checks <PR番号>`とマージ権限を確認する。pending/failureを成功扱いしない。
4. repoの方式に従い `gh pr merge <PR番号> --merge --match-head-commit <確認したhead-SHA>` でマージする。保護ルールや承認を迂回しない。
5. `gh pr view <PR番号> --json state,mergedAt,mergeCommit,url`でMERGEDとmerge commitを確認し、`git fetch origin`で取得する。

## 境界

ソース統合と本番反映は別です。マージだけでdeploy・再起動・worktree削除を自動実行しません。反映は起動元と承認範囲を確認します。元checkoutを無条件にswitch/resetしません。後片付けはowner、dirty状態、PID/cwdを確認した対象だけを扱います。
