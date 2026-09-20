# Runbook: Verify The Local API 31013 Source

This verifies the local API, not Mac Companion. The legacy launchd label is an
installation identifier; see [the runtime boundary](local-api-and-companion-boundary.md).

Use this before saying a fix is live on Brainbase port `31013`.

## Steps

1. Check runtime metadata:

```bash
curl -s http://127.0.0.1:31013/api/version | jq
```

2. Confirm the listening process:

```bash
lsof -nP -iTCP:31013 -sTCP:LISTEN
```

3. Confirm launchd state when the process is managed by launchd:

```bash
launchctl print gui/$(id -u)/com.brainbase.ui
```

4. Resolve the runtime root selected by both launchd jobs. The values must be
identical. If both are absent, use the launcher default shown below.

```bash
set -euo pipefail
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
printf 'canonical runtime root: %s\n' "$RUNTIME_ROOT"
git -C "$RUNTIME_ROOT" rev-parse --is-inside-work-tree
git -C "$RUNTIME_ROOT" status --porcelain
```

5. Confirm the source directory:

Expected:

```text
runtime.cwd = resolved RUNTIME_ROOT
runtime.git.sha = intended origin/develop sha
runtime.git.dirty = false
```

An approved external-storage path is valid when both launchd jobs select it and
the API cwd, linked-worktree metadata, clean state, target SHA, and MCP receipt
all agree. Do not classify a runtime from its path name or the API's
`isWorktree` convenience flag alone.

## Failure Signals

- `dirty: true` means local files differ from the checked commit.
- Local API and updater select different runtime roots, or the API `cwd` differs from the resolved root.
- the resolved root is not a Git linked worktree owned by the source repository.
- `sha` is older than the merged PR.
- the MCP reconciliation receipt SHA differs from the local API SHA.
