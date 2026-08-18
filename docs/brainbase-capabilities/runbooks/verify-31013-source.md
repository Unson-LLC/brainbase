# Runbook: Verify The 31013 Source

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

4. Confirm the source directory:

Expected:

```text
runtime.cwd = /Users/ksato/workspace/repos/.runtime/brainbase-31013
runtime.git.sha = intended origin/develop sha
runtime.git.dirty = false
```

## Failure Signals

- `dirty: true` means local files differ from the checked commit.
- `cwd` points anywhere other than the managed runtime worktree, so port 31013 is not canonical.
- `sha` is older than the merged PR.
- the MCP reconciliation receipt SHA differs from the UI SHA.
