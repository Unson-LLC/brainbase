#!/bin/bash
# Check Slack MCP prerequisites without starting a long-lived MCP server.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$SCRIPT_DIR/run-slack-mcp.sh"

if [ "$#" -gt 0 ]; then
  WORKSPACES=("$@")
else
  WORKSPACES=(salestailor unson techknight)
fi

status=0
for workspace in "${WORKSPACES[@]}"; do
  if "$RUNNER" "$workspace" --check >/dev/null; then
    echo "ok: $workspace"
  else
    echo "blocked: $workspace" >&2
    status=1
  fi
done

exit "$status"
