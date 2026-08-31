# Runbook: Restart Brainbase 31013 With launchd

The 60-second updater normally applies merged `develop` automatically. Use this only when an immediate restart is needed.

The source checkout is `/Users/ksato/workspace/repos/brainbase`. The process runs from the disposable linked worktree `/Users/ksato/workspace/repos/.runtime/brainbase-31013`; do not edit that runtime directly.

## Standard Restart

```bash
set -euo pipefail
SOURCE_REPO=/Users/ksato/workspace/repos/brainbase
RUNTIME_ROOT=/Users/ksato/workspace/repos/.runtime/brainbase-31013
PIN_FILE=/Users/ksato/workspace/var/brainbase-runtime-pinned.sha
source "$SOURCE_REPO/scripts/launchd/brainbase-runtime-target.sh"
source "$SOURCE_REPO/scripts/launchd/brainbase-runtime-readiness.sh"
TARGET_SHA="$(brainbase_resolve_runtime_target \
  "$SOURCE_REPO" origin develop refs/brainbase-runtime/origin-develop "$PIN_FILE")"
CONNECT_TIMEOUT_SECONDS="${BRAINBASE_RUNTIME_READINESS_CONNECT_TIMEOUT_SECONDS:-5}"
MAX_TIMEOUT_SECONDS="${BRAINBASE_RUNTIME_READINESS_MAX_TIMEOUT_SECONDS:-10}"
brainbase_runtime_readiness_validate_positive_seconds "$CONNECT_TIMEOUT_SECONDS" 'connect timeout'
brainbase_runtime_readiness_validate_positive_seconds "$MAX_TIMEOUT_SECONDS" 'maximum request time'
launchctl kickstart -k gui/$(id -u)/com.brainbase.ui
brainbase_wait_for_runtime_ready \
  "$RUNTIME_ROOT" \
  "$TARGET_SHA" \
  http://127.0.0.1:31013/api/version \
  "${BRAINBASE_RUNTIME_READINESS_ATTEMPTS:-30}" \
  "${BRAINBASE_RUNTIME_READINESS_DELAY_SECONDS:-2}" \
  "$CONNECT_TIMEOUT_SECONDS" \
  "$MAX_TIMEOUT_SECONDS"
```

The bounded wait accepts the restart only when the API and disposable runtime
worktree both report the exact target commit and a clean state. A timeout exits
non-zero; every API probe has a finite positive connect and total request
timeout, and do not continue to MCP or Hook restoration until it passes.

## If The Job Is Not Loaded

```bash
launchctl bootstrap gui/$(id -u) /Users/ksato/Library/LaunchAgents/com.brainbase.ui.plist
```

If bootstrap returns `Input/output error`, inspect current state first:

```bash
launchctl print gui/$(id -u)/com.brainbase.ui
```

It may already be loaded or restarting.

## Verify

```bash
set -euo pipefail
SOURCE_REPO=/Users/ksato/workspace/repos/brainbase
source "$SOURCE_REPO/scripts/launchd/brainbase-runtime-readiness.sh"
CONNECT_TIMEOUT_SECONDS="${BRAINBASE_RUNTIME_READINESS_CONNECT_TIMEOUT_SECONDS:-5}"
MAX_TIMEOUT_SECONDS="${BRAINBASE_RUNTIME_READINESS_MAX_TIMEOUT_SECONDS:-10}"
brainbase_runtime_readiness_validate_positive_seconds "$CONNECT_TIMEOUT_SECONDS" 'connect timeout'
brainbase_runtime_readiness_validate_positive_seconds "$MAX_TIMEOUT_SECONDS" 'maximum request time'
lsof -nP -iTCP:31013 -sTCP:LISTEN
curl -fsS \
  --connect-timeout "$CONNECT_TIMEOUT_SECONDS" \
  --max-time "$MAX_TIMEOUT_SECONDS" \
  -- http://127.0.0.1:31013/api/version | jq '.runtime.git'
cat /Users/ksato/workspace/var/brainbase-mcp-reconcile.last
```

Expected after a clean canonical restart:

```text
dirty = false
sha = latest intended origin/develop commit
cwd = /Users/ksato/workspace/repos/.runtime/brainbase-31013
MCP receipt sha = the same sha
```
