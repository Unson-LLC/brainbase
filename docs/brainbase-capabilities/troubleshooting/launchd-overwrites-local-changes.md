# Troubleshooting: launchd Overwrites Local Changes

## Symptom

A fix works locally, but after restarting Brainbase on port `31013`, the files under `server/` or `public/` revert and the API/UI still behaves like old develop.

## Cause

`/Users/ksato/.local/brainbase/launchd-start.sh` syncs selected paths from `origin/develop` before launching the canonical service.

Synced paths include:

- `server/`
- `scripts/`
- `public/`
- `start.js`
- `.mcp.json`
- `package.json`
- `package-lock.json`

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
