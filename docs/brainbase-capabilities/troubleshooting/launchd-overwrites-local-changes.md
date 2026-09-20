# Troubleshooting: launchd Overwrites Local Changes

## Symptom

A fix works locally, but after restarting the Brainbase local API on port `31013`, the runtime files revert and the API still behaves like old develop.

## Cause

`/Users/ksato/.local/brainbase/launchd-start.sh` aligns the disposable managed
runtime worktree with its resolved target commit before launching the canonical
local API. This is not a selected-path copy into the developer checkout.
Do not edit the managed runtime directly or reproduce its reset procedure in a
developer checkout. The old `com.brainbase.ui` label does not mean the retired
browser UI is active; see [the runtime boundary](../runbooks/local-api-and-companion-boundary.md).

## Fix

1. Commit the change on a branch.
2. Open and merge a PR into `develop`.
3. Fetch `origin/develop`.
4. Restart launchd.
5. Verify `/api/version` shows the merged SHA and `dirty:false`.

## Do Not

- Rely on a local unmerged patch for canonical 31013.
- Start a second manual server and assume it replaced launchd.
- Claim a fix is live without checking `/api/version`.
