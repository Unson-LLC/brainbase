# Runbook: Restart Brainbase 31013 With launchd

The 60-second updater normally applies merged `develop` automatically. Use this only when an immediate restart is needed.

The source checkout is `/Users/ksato/workspace/repos/brainbase`. The process runs from the disposable linked worktree `/Users/ksato/workspace/repos/.runtime/brainbase-31013`; do not edit that runtime directly.

## Standard Restart

```bash
launchctl kickstart -k gui/$(id -u)/com.brainbase.ui
sleep 5
curl -s http://127.0.0.1:31013/api/version | jq
```

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
lsof -nP -iTCP:31013 -sTCP:LISTEN
curl -s http://127.0.0.1:31013/api/version | jq '.runtime.git'
cat /Users/ksato/workspace/var/brainbase-mcp-reconcile.last
```

Expected after a clean canonical restart:

```text
dirty = false
sha = latest intended origin/develop commit
cwd = /Users/ksato/workspace/repos/.runtime/brainbase-31013
MCP receipt sha = the same sha
```
