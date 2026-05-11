# Troubleshooting: Route Disappeared After Rebase

## Symptom

An endpoint that worked yesterday now returns `Cannot GET /api/...` or `404`. `git log` shows develop has moved forward with normal feat/fix commits, none of which are titled like a removal.

Common surfaces:
- File viewer: `Cannot GET /api/sessions/<id>/html-preview/<file>.html`
- Terminal: `geometry/repair` endpoint missing
- UI: a feature toggle no longer triggers anything

## Diagnostic flow

1. Find the commit that last touched the route file:
   ```sh
   git log -p server/routes/<file>.js | head -100
   ```
   Look for a `-router.METHOD('/path', ...)` line in a commit whose title does NOT mention that route.

2. If found, that commit is a silent-drop suspect. Verify it's not a deliberate removal by checking the commit body and any associated PR:
   ```sh
   git show <sha> --stat
   gh api repos/Unson-LLC/brainbase-unson/commits/<sha>/pulls
   ```
   If `gh api` returns `[]`, the commit was pushed directly to develop (not via PR) — strong silent-drop signal.

3. Confirm what was lost across the whole commit:
   ```sh
   git show <sha> | grep -E "^-[^-]" | grep -vE "^-\s*//|^-\s*\*|^-\s*$"
   ```
   Filter `-` lines to substantive deletions; cross-reference against the commit's stated purpose. Unrelated deletions = silent drops.

## Cause

The most common pattern (and the one behind the 14e7c58d incident on 2026-05-11): a feature branch was based on an older `develop`, develop moved forward in the meantime adding new routes, and `git rebase origin/develop` resolved a conflict by keeping the branch side — silently dropping the routes added upstream.

Less common but possible:
- a `git merge -s ours <branch>` with a stale tree
- a manual `git checkout <old-sha> -- <file>` that overwrote upstream work
- a Squash merge where the squash collapsed a branch that had reverted upstream additions

## Fix

Follow `../runbooks/revert-and-remerge-silent-drop.md`:

1. Phase 1: `git revert <bad-sha>` on develop via PR (mechanical, no conflicts expected with subsequent commits unless they depend on the bad commit's content).
2. Phase 2: cherry-pick the bad commit on top of restored develop, then surgically re-apply the silently dropped lines from `origin/develop@{1}` (the pre-revert state) via a new PR.

## Do Not

- Cherry-pick the lost lines alone — easy to miss items, produces a noisy PR.
- Force-push develop to "rewind" — destroys subsequent legitimate commits and triggers `git.protected-push` guard (see `../capabilities/git.protected-push.yml`).
- Disable the guard via `BRAINBASE_ALLOW_PROTECTED_PUSH=1` for this — the recovery flow uses normal PRs.

## Related

- `../capabilities/git.protected-push.yml` — guard that blocks the direct-push vector since PR #668.
- `../runbooks/revert-and-remerge-silent-drop.md` — recovery procedure.
- `../capabilities/development.workflow.yml` — why jj-first reduces silent drop risk via mandatory commit descriptions.
