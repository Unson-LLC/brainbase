---
name: brainbase-gh-pr-merge後にjjのローカルmainが更新されない場合はmain-originへ合わ
description: "gh pr merge後にjjのローカルmainが更新されない場合はmain@originへ合わせる"
---

# brainbase-gh-pr-merge後にjjのローカルmainが更新されない場合はmain-originへ合わ

## Trigger
- Use when this pattern appears: gh pr merge後にjjのローカルmainが更新されない場合はmain@originへ合わせる

## Steps
- gh pr view <pr> --json state,mergeCommit,mergedAt
- jj git fetch --remote origin
- jj log -r "main@origin" --no-pager -n 3
- jj bookmark set main -r main@origin
- jj log -r "main" --no-pager -n 3
- If a Git worktree has `main` checked out, inspect it after the bookmark update:
  - `git status --short --branch`
  - `git diff --name-status`
  - `git diff --cached --name-status`
  - `git reflog --date=iso -8 HEAD`
  - `git reflog --date=iso -8 main`
- If `main` advanced through `jj export` / bookmark sync but the Git index or worktree still represents the old tree, the dirty state may be a stale reverse diff. Compare:
  - `git diff --stat <old-main> main`
  - `git diff --stat main <old-main>`
  - `git diff --cached --stat`
- Only clean after proving the dirty diff is exactly the inverse of changes already in `main`; otherwise treat it as possible user work.

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.
- Do not use `git stash` as the first dirty cleanup step after JJ bookmark sync. Stash hides whether the dirty state was user work or a stale Git index/worktree view.
- Do not call the Git worktree clean just because `jj log` is clean; confirm Git status and cached diff separately.

## Linked Wiki
- architecture/gh-pr-merge後にjjのローカルmainが更新されない場合はmain-originへ合わ

## Source
- Promoted from explicit_learn / success
