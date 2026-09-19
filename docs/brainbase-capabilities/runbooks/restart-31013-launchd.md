# Runbook: Restart Brainbase 31013 With launchd

The 60-second updater normally applies merged `develop` automatically. Use this only when an immediate restart is needed.

The source checkout is `/Users/ksato/workspace/repos/brainbase`. The process runs
from the disposable linked worktree selected by both the UI and updater launchd
jobs. Do not edit that runtime directly. The launcher default is
`/Users/ksato/workspace/repos/.runtime/brainbase-31013`, but an approved external
root may be configured through `BRAINBASE_UI_RUNTIME_ROOT`.

## Standard Restart

```bash
set -euo pipefail
SOURCE_REPO=/Users/ksato/workspace/repos/brainbase
UI_PLIST="$HOME/Library/LaunchAgents/com.brainbase.ui.plist"
UPDATER_PLIST="$HOME/Library/LaunchAgents/com.brainbase.runtime-update.plist"
DEFAULT_RUNTIME_ROOT=/Users/ksato/workspace/repos/.runtime/brainbase-31013
ui_root="$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:BRAINBASE_UI_RUNTIME_ROOT' "$UI_PLIST" 2>/dev/null || true)"
updater_root="$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:BRAINBASE_UI_RUNTIME_ROOT' "$UPDATER_PLIST" 2>/dev/null || true)"
if [[ -n "$ui_root" || -n "$updater_root" ]]; then
  [[ -n "$ui_root" && "$ui_root" == "$updater_root" ]]
  RUNTIME_ROOT="$ui_root"
else
  RUNTIME_ROOT="$DEFAULT_RUNTIME_ROOT"
fi
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
cwd = resolved RUNTIME_ROOT selected identically by UI and updater
MCP receipt sha = the same sha
```
