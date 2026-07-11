# worktree-service Git Migration Architecture

story: story-worktree-service-git-migration
status: active
created_at: 2026-07-11

## Goal

`server/services/worktree-service.js` からJujutsu依存を撤去し、gitネイティブ実装へ移行する。
正本repoマージデプロイガードの保護レベルは維持する（弱体化・削除は不可）。

## Layer Boundary

- WorktreeService はセッションworktreeのライフサイクル（作成・状態・マージ・rotation・削除）と正本repoデプロイガードの唯一の所有者である。
- コントローラ層（runtime-handlers等）はgit/ghコマンドを直接組み立てず、診断表示目的の read-only git コマンドのみ許容する。
- gh CLI（PR作成・マージ・メタデータ取得）の使い方は変更しない。

## Command Mapping (jj → git)

| 用途 | 旧 (jj) | 新 (git) |
|---|---|---|
| repo判定 | `jj -R <repo> version` | `git -C <repo> rev-parse --git-dir` |
| repo初期化 | `jj git init --colocate` | `git init`（既存git repoならスキップ） |
| fetch | `jj git fetch` | `git fetch origin` |
| workspace作成 | `jj workspace add --name <n> -r <rev>` | `git worktree add -b <branch> <path> <rev>`（branch既存時は `git worktree add <path> <branch>`） |
| workspace一覧 | `jj workspace list` | `git worktree list --porcelain` |
| workspace削除 | `jj workspace forget` + fs.rm | `git worktree remove --force`（失敗時 fs.rm + `git worktree prune`） |
| bookmark作成/移動 | `jj bookmark create/set` | `git branch -f <name> <rev>`（worktree作成時は `-b` で同時作成） |
| bookmark削除 | `jj bookmark delete` | `git branch -D <name>` |
| bookmark存在/push済み判定 | `jj bookmark list --all-remotes` | `git rev-parse --verify refs/heads/<name>` / `refs/remotes/origin/<name>` |
| push | `jj git push --bookmark <name>` | `git push origin <branch>` |
| base..target件数 | `jj log -r "base..target" \| wc -l` | `git rev-list --count <base>..<target>` |
| working copy dirty | `jj status` の Working copy changes | `git status --porcelain`（artifactパスfilterは既存 `_isWorkspaceArtifactStatusPath` を流用） |
| コンフリクト検査 | `jj resolve --list` | `git ls-files -u`（非空=コンフリクト） |
| stale workspace回復 | `jj workspace update-stale` | 廃止（git worktreeにstale概念なし）。`.git/index.lock` stale回復は維持 |
| コミットログ | `jj log -T <template>` | 既存 `_getGitCommitLog`（`git log --format=%h%x00...`）へ一本化 |
| 正本同期 | `jj git fetch` + `jj rebase -b default@ -d <main>` | `git fetch origin` + `git checkout -B <main> origin/<main>`（uncommitted変更をclobberする場合はgitが拒否→fail loud） |

## Merge Deployment Guard (protection-equivalent redesign)

`getMergeDeploymentGuardStatus(repoPath)` — 判定順序と reason コードを維持し、jj固有部のみ置換:

1. `disabled` / `non_canonical_repo`: 変更なし。
2. `missing_git_head`: `git rev-parse --verify HEAD`（変更なし）。
3. `not_jj_repo` → **`not_git_repo`**: `_isGitRepo()` 失敗で `ready:false`。error文言は "Canonical Brainbase repo must be a Git repo for merge deployment guard"。
4. dirty検査: `git status --porcelain` を artifact filter に通し、関連変更が残れば `canonical_workspace_dirty`。
5. コミット比較: `headCommit = git rev-parse HEAD`、`mainCommit = git rev-parse refs/remotes/origin/<main>`（無ければ `refs/heads/<main>`）。どちらか解決不能なら `unresolved_git_revision`（旧 `unresolved_jj_revision`）。
6. 不一致時: `git diff --name-only <mainCommit> <headCommit>` を artifact filter に通し、関連パスなしなら `ok_ignored_artifact_delta`、ありなら `canonical_workspace_not_deployed`。
7. 例外は `guard_check_failed`。

`syncCanonicalWorkspaceAfterMerge(repoPath, main)`:
- `git fetch origin` → `git checkout -B <main> origin/<main>`。
- 正本checkoutがdetached HEADでもこの操作でmainブランチのcheckoutへ収束する（jj時代のdetached運用を解消）。
- checkout失敗（ローカル変更のclobber等）は `deploy_sync_failed` で fail loud。成功後にガードを再実行し `ready` を確認する。

## Serialization / Recovery

- `_withRepoLock` によるrepo単位の直列化は維持する。
- `_execJujutsuWithStaleRetry` → `_execGitWithLockRetry(repoPath, command)`: repo lock下で `git -C <repo> <command>` を実行し、`index.lock` エラー時はstale lockfile回復（mtime 30s + lsof判定、既存実装）後に1回リトライする。
- `_ensureGitCompatibility` / `_removeGitCompatibility`（`.git/worktrees` メタデータの手書き合成）は**廃止**する。git worktreeが正規にメタデータを管理する。jj時代に合成されたworktreeは `.git/worktrees/<name>` に登録済みのため `git worktree list` で引き続き見える（後方互換）。

## Zombie Cleanup

- ゾンビ定義を「`.jj/working_copy` があるのに jj workspace list に無い」から「worktreeディレクトリに `.git`（file/dir）があるのに `git worktree list --porcelain` に無い」へ変更。
- 削除後に `git worktree prune` を実行する。

## Out of Service Scope (post-merge ops)

- `code/brainbase/.jj` の物理撤去。
- `.claude/commands/deploy-merged-pr.md`（workspace root / brainbase）のgitフロー化。
- 正本checkoutの detached HEAD → `git checkout develop` 復帰（syncCanonicalWorkspaceAfterMergeの `checkout -B` が以後これを維持する）。

## Risks

- 正本checkoutは本番セッションマージ経路。ガードのreason分岐を減らす変更は事故再発リスクがあるため、reasonコード互換（呼び出し元・テストが参照）を保つ。
- `git checkout -B` は対象ブランチが他のworktreeでcheckout済みだと失敗する → その場合はエラーを返す（黙ってdetachedへフォールバックしない）。
