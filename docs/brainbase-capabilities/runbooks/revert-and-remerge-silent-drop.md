# Revert and Re-merge Silent Drop

Use this runbook when a commit on `develop` / `main` is suspected to have silently dropped functionality (e.g., a route 404 appears that worked yesterday, or a UI feature disappears without explanation), AND the commit looks like a single normal feat/fix commit but actually contains unrelated deletions hidden inside an intended refactor.

Reference incident: commit `14e7c58d feat: add mana memory promotion pipeline` (2026-05-11) silently dropped `html-preview` + `terminal/geometry/repair` routes during rebase conflict resolution. Recovered via PRs #666 (revert) and #667 (clean re-merge).

## When to use

- Endpoint suddenly returns 404 or "Cannot GET ..." for a path that worked before.
- A UI feature loses behavior that was previously present, with no related fix/feat commit on develop touching that area.
- `git log -p <path>` shows lines disappearing as part of an unrelated feat commit.
- `git show <suspect-sha>` contains both `+` lines that match the commit's stated purpose AND `-` lines that look unrelated (different subsystem, different concern).

Do NOT use this runbook for intentional removals reviewed via PR — those are normal commits and can be reverted by the original author.

## Why "revert + re-merge" over "cherry-pick the lost lines"

Cherry-picking lost lines requires identifying every silent deletion, which is easy to miss and produces a noisy PR mixing recovery with unrelated edits. Reverting first restores a clean baseline, then re-merging the intended feature on top makes the conflicts EXPLICIT (rebase surfaces them as merge conflicts the operator must consciously resolve), preventing the same silent-drop pattern from recurring.

## Phase 1: Revert on develop

Goal: roll develop back to the state immediately before the silent-drop commit landed.

```sh
git fetch origin develop --quiet
git worktree add /Volumes/UNSON-DRIVE/brainbase-worktrees/revert-<sha-short> \
    -b fix/revert-<sha-short> origin/develop
cd /Volumes/UNSON-DRIVE/brainbase-worktrees/revert-<sha-short>
git revert --no-edit <bad-sha>
```

If `revert` reports conflicts, STOP and investigate — there are likely intervening commits that depend on `<bad-sha>`'s changes. Resolving those requires per-commit analysis, not a blanket revert.

Verify the silent drops are restored:

```sh
# Replace the grep patterns with the specific identifiers from your incident.
grep -nE "<route-pattern-1>|<route-pattern-2>" server/routes/<file>.js
grep -nE "<helper-function>|<constant>" server/controllers/<file>.js
```

Run the full test suite and compare failure count to the baseline (current `origin/develop`):

```sh
ln -s /Users/ksato/workspace/code/brainbase/node_modules ./node_modules
npm run test -- --run 2>&1 | tail -7
```

If revert worktree fails MORE tests than baseline, investigate before pushing — the revert may have orphaned dependent code.

```sh
git push -u origin fix/revert-<sha-short>
gh pr create --base develop --title "Revert: <bad-commit-title> (silent dropped <feature>)" \
    --body "$(cat <<'EOF'
<explain what was silently dropped and why revert is the right first step>
EOF
)"
gh pr merge <pr-num> --merge --admin
```

`--admin` is appropriate here because:
- the change is mechanical (`git revert`)
- the alternative (leaving develop broken) is worse than skipping the Graphify gate
- Phase 2 will re-introduce the legitimate parts under normal gates

After merge, cleanup:

```sh
cd /Users/ksato/workspace/code/brainbase
git worktree remove /Volumes/UNSON-DRIVE/brainbase-worktrees/revert-<sha-short> --force
git branch -d fix/revert-<sha-short>
```

## Phase 2: Re-merge the intended feature

Goal: re-apply the intended additions from `<bad-sha>` on top of the now-restored develop, WITHOUT the silent drops.

```sh
git fetch origin develop --quiet
git worktree add /Volumes/UNSON-DRIVE/brainbase-worktrees/redo-<feature> \
    -b fix/redo-<feature> origin/develop
cd /Volumes/UNSON-DRIVE/brainbase-worktrees/redo-<feature>
git cherry-pick --no-commit <bad-sha>
```

Because develop now contains both:
- the revert (= silent drops restored)
- the bad commit's deletions if you cherry-pick blindly,

cherry-pick will REINTRODUCE the silent drops. Verify and surgically repair:

```sh
git status --short
# Confirm the silent-dropped files are back to "modified" but with the unwanted deletions.
grep -nE "<silent-dropped-pattern>" <each-affected-file>
# If grep finds nothing, manually patch the silent drops back from origin/develop:
git show origin/develop:<file> > /tmp/develop-version.<basename>
# Compare and edit the working tree until the file contains BOTH the cherry-picked
# intended adds AND the previously silent-dropped lines.
```

Useful technique for files with many sections:

```sh
diff -u /tmp/develop-version.<basename> <file> | less
```

Run tests:

```sh
ln -s /Users/ksato/workspace/code/brainbase/node_modules ./node_modules
npm run test -- --run 2>&1 | tail -7
```

Expected: failure count ≤ baseline (because intended adds restore some integration tests).

Stage and commit:

```sh
git add <list-of-files>
git commit -m "$(cat <<'EOF'
feat: <intended-feature-title> (without silent drops)

PR #<revert-pr> で develop を silent drop 前に戻したうえで、
<intended-feature> を最新 develop に clean rebase した再 PR。

silent drop されていた箇所を手動で復元:
- <file-1>: <items>
- <file-2>: <items>

intended adds（<bad-sha> 由来）:
- <list>
EOF
)"
git push -u origin fix/redo-<feature>
gh pr create --base develop --title "<intended-feature-title> (without silent drops)" \
    --body "<explain the redo>"
gh pr merge <pr-num> --merge --admin
```

Cleanup:

```sh
cd /Users/ksato/workspace/code/brainbase
git worktree remove /Volumes/UNSON-DRIVE/brainbase-worktrees/redo-<feature> --force
git branch -d fix/redo-<feature>
```

## Why this can't happen again the same way

Since `feat(security): block direct push / force-update to protected branches` (PR #668), Claude Code and Codex PreToolUse hooks deny `git push origin develop` / `git branch -f develop` / `git push --force`. So the *direct push* vector is closed.

Silent drops can still occur via PR merges (Squash / Rebase merge can drop lines if the PR base diverged from develop in subtle ways). For that residual risk, prefer:
- create-merge (preserves history; conflicts surface)
- pre-merge `git diff <base>...<head>` review with explicit eyes on `server/routes/`, `server/controllers/session/`, and other route-defining files

## See also

- `../capabilities/git.protected-push.yml` — the guard that blocks the most common vector.
- `../troubleshooting/route-disappeared-after-rebase.md` — diagnosing the symptom.
- `../capabilities/development.workflow.yml` — jj-first workflow rules.
