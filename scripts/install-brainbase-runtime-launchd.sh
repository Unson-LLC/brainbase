#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DIR="${BRAINBASE_LAUNCHD_LOCAL_DIR:-$HOME/.local/brainbase}"
AGENTS_DIR="${BRAINBASE_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
RUNTIME_ROOT="${BRAINBASE_UI_RUNTIME_ROOT:-/Users/ksato/workspace/repos/.runtime/brainbase-31013}"
mkdir -p "$LOCAL_DIR" "$AGENTS_DIR"
install -m 755 "$REPO_ROOT/scripts/launchd/brainbase-ui-start.sh" "$LOCAL_DIR/launchd-start.sh"
install -m 755 "$REPO_ROOT/scripts/launchd/brainbase-runtime-update.sh" "$LOCAL_DIR/runtime-update.sh"

sed "s|__HOME__|$HOME|g" "$REPO_ROOT/config/com.brainbase.runtime-update.plist" > "$AGENTS_DIR/com.brainbase.runtime-update.plist"
plutil -lint "$AGENTS_DIR/com.brainbase.runtime-update.plist"

# Preserve locally provisioned MCP environment values while moving only its
# executable checkout to the managed runtime. A fresh install may use the
# tracked template; an existing installation keeps Graph/Infisical settings.
MCP_PLIST="$AGENTS_DIR/com.brainbase.mcp-brainbase.plist"
if [[ ! -f "$MCP_PLIST" ]]; then
  install -m 644 "$REPO_ROOT/config/com.brainbase.mcp-brainbase.plist" "$MCP_PLIST"
fi
plutil -replace ProgramArguments.1 -string "$RUNTIME_ROOT/scripts/run-brainbase-mcp.sh" "$MCP_PLIST"
plutil -replace EnvironmentVariables.BRAINBASE_REPO_ROOT -string "$RUNTIME_ROOT" "$MCP_PLIST"
plutil -remove EnvironmentVariables.BRAINBASE_MCP_ENTRY "$MCP_PLIST" 2>/dev/null || true
plutil -lint "$MCP_PLIST"

DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN/com.brainbase.runtime-update" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$AGENTS_DIR/com.brainbase.runtime-update.plist"
launchctl enable "$DOMAIN/com.brainbase.runtime-update"

# Existing UI plist owns environment-specific settings and secrets. Its stable
# ProgramArguments path is updated by replacing the installed launcher above.
launchctl kickstart -k "$DOMAIN/com.brainbase.ui"
launchctl bootout "$DOMAIN/com.brainbase.mcp-brainbase" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$MCP_PLIST"
launchctl enable "$DOMAIN/com.brainbase.mcp-brainbase"
