#!/bin/bash
# run-slack-mcp.sh
# 3 ws別 slack-mcp-server を起動するラッパー。
# Infisical (ce20541c prod env) から token を取得し、
# slack-mcp-server が期待する SLACK_MCP_XOXC_TOKEN / SLACK_MCP_XOXD_TOKEN にリネームして exec。
#
# Usage: run-slack-mcp.sh <workspace>
#   workspace: salestailor | unson | techknight
set -euo pipefail

WS="${1:?usage: $0 <salestailor|unson|techknight>}"
WS_UPPER=$(echo "$WS" | tr '[:lower:]' '[:upper:]')

INFISICAL_PROJECT="ce20541c-02b9-4523-bbe0-49d50b2fcc19"
INFISICAL_ENV="prod"

# port 振り分け（衝突防止 — stdio使用時は実害ないが defensive）
case "$WS" in
  salestailor) PORT=13081 ;;
  unson)       PORT=13082 ;;
  techknight)  PORT=13083 ;;
  *) echo "unknown workspace: $WS" >&2; exit 2 ;;
esac

# Slack MCP server binary
# npm版は darwin-arm64 サブパッケージの cpu metadata バグで動かないため
# github release の arm64 binary を直接使う
SLACK_MCP_BIN="${SLACK_MCP_BIN:-/Users/ksato/.local/slack-mcp/bin/slack-mcp-server}"
if [ ! -x "$SLACK_MCP_BIN" ]; then
  echo "ERROR: $SLACK_MCP_BIN not found. Run:" >&2
  echo "  curl -sL -o /Users/ksato/.local/slack-mcp/bin/slack-mcp-server https://github.com/korotovsky/slack-mcp-server/releases/latest/download/slack-mcp-server-darwin-arm64 && chmod +x /Users/ksato/.local/slack-mcp/bin/slack-mcp-server" >&2
  exit 127
fi

# infisical run で SLACK_MCP_XOXC_<WS> / SLACK_MCP_XOXD_<WS> を env注入
# → bash で SLACK_MCP_XOXC_TOKEN / SLACK_MCP_XOXD_TOKEN にリネーム
# → exec slack-mcp-server
exec infisical run \
  --projectId="$INFISICAL_PROJECT" \
  --env="$INFISICAL_ENV" \
  -- bash -c "
    export SLACK_MCP_XOXC_TOKEN=\${SLACK_MCP_XOXC_${WS_UPPER}}
    export SLACK_MCP_XOXD_TOKEN=\${SLACK_MCP_XOXD_${WS_UPPER}}
    export SLACK_MCP_HOST=127.0.0.1
    export SLACK_MCP_PORT=$PORT
    exec $SLACK_MCP_BIN
  "
