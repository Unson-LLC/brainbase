#!/bin/bash
# 3 workspace 別 slack-mcp-server を起動するラッパー。
# Infisical から workspace 別 token を取得し、slack-mcp-server が期待する
# SLACK_MCP_XOXC_TOKEN / SLACK_MCP_XOXD_TOKEN にリネームして exec する。
#
# Usage:
#   run-slack-mcp.sh <salestailor|unson|techknight>
#   run-slack-mcp.sh <salestailor|unson|techknight> --check
set -euo pipefail

usage() {
  echo "usage: $0 <salestailor|unson|techknight> [--check]" >&2
}

die() {
  echo "SLACK_MCP_UNAVAILABLE: $*" >&2
  exit 78
}

WS="${1:-}"
MODE="${2:-}"
if [ -z "$WS" ]; then
  usage
  exit 2
fi
if [ -n "$MODE" ] && [ "$MODE" != "--check" ]; then
  usage
  exit 2
fi
WS_UPPER=$(printf '%s' "$WS" | tr '[:lower:]' '[:upper:]')

INFISICAL_BIN="${INFISICAL_BIN:-infisical}"
INFISICAL_DOMAIN="${INFISICAL_DOMAIN:-https://infisical.unson.jp}"
INFISICAL_PROJECT="${INFISICAL_PROJECT:-ce20541c-02b9-4523-bbe0-49d50b2fcc19}"
INFISICAL_ENV="${INFISICAL_ENV:-prod}"
SLACK_MCP_INFISICAL_PATH="${SLACK_MCP_INFISICAL_PATH:-/}"
SLACK_MCP_INFISICAL_TOKEN_FILE="${SLACK_MCP_INFISICAL_TOKEN_FILE:-$HOME/.brainbase/runtime-env/slack-mcp.infisical-token}"
SLACK_MCP_INFISICAL_AUTH_FILE="${SLACK_MCP_INFISICAL_AUTH_FILE:-$HOME/.brainbase/runtime-env/slack-mcp.universal-auth.env}"

case "$WS" in
  salestailor) PORT=13081 ;;
  unson)       PORT=13082 ;;
  techknight)  PORT=13083 ;;
  *) die "unknown workspace '$WS'" ;;
esac

# npm版は darwin-arm64 サブパッケージの cpu metadata バグで動かないため、
# GitHub release の arm64 binary を直接使う。
SLACK_MCP_BIN="${SLACK_MCP_BIN:-/Users/ksato/.local/slack-mcp/bin/slack-mcp-server}"
if [ ! -x "$SLACK_MCP_BIN" ]; then
  die "slack-mcp-server binary not executable: $SLACK_MCP_BIN"
fi

if ! command -v "$INFISICAL_BIN" >/dev/null 2>&1; then
  die "infisical CLI not found: $INFISICAL_BIN"
fi

require_private_file() {
  local file="$1"
  local mode
  mode="$(stat -f '%OLp' "$file" 2>/dev/null || stat -c '%a' "$file" 2>/dev/null || true)"
  case "$mode" in
    400|600) ;;
    *) die "credential file must not be group/world readable: $file" ;;
  esac
}

read_env_file_value() {
  local file="$1"
  local key="$2"
  awk -v wanted="$key" '
    $0 ~ "^[[:space:]]*#" || $0 !~ "=" { next }
    {
      line=$0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      split(line, parts, "=")
      key=parts[1]
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      if (key != wanted) next
      sub(/^[^=]*=/, "", line)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      if (line ~ /^".*"$/ || line ~ /^'\''.*'\''$/) {
        line=substr(line, 2, length(line)-2)
      }
      print line
      exit
    }
  ' "$file"
}

INFISICAL_TOKEN_VALUE="${INFISICAL_TOKEN:-}"
if [ -z "$INFISICAL_TOKEN_VALUE" ] && [ -f "$SLACK_MCP_INFISICAL_TOKEN_FILE" ]; then
  require_private_file "$SLACK_MCP_INFISICAL_TOKEN_FILE"
  INFISICAL_TOKEN_VALUE="$(sed -n '1p' "$SLACK_MCP_INFISICAL_TOKEN_FILE" | tr -d '\r\n')"
fi

INFISICAL_CLIENT_ID_VALUE="${INFISICAL_UNIVERSAL_AUTH_CLIENT_ID:-${INFISICAL_CLIENT_ID:-${SLACK_MCP_INFISICAL_CLIENT_ID:-}}}"
INFISICAL_CLIENT_SECRET_VALUE="${INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET:-${INFISICAL_CLIENT_SECRET:-${SLACK_MCP_INFISICAL_CLIENT_SECRET:-}}}"
if [ -z "$INFISICAL_TOKEN_VALUE" ] && [ -f "$SLACK_MCP_INFISICAL_AUTH_FILE" ]; then
  require_private_file "$SLACK_MCP_INFISICAL_AUTH_FILE"
  if [ -z "$INFISICAL_CLIENT_ID_VALUE" ]; then
    INFISICAL_CLIENT_ID_VALUE="$(read_env_file_value "$SLACK_MCP_INFISICAL_AUTH_FILE" INFISICAL_UNIVERSAL_AUTH_CLIENT_ID)"
  fi
  if [ -z "$INFISICAL_CLIENT_SECRET_VALUE" ]; then
    INFISICAL_CLIENT_SECRET_VALUE="$(read_env_file_value "$SLACK_MCP_INFISICAL_AUTH_FILE" INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET)"
  fi
fi

if [ -z "$INFISICAL_TOKEN_VALUE" ] && [ -n "$INFISICAL_CLIENT_ID_VALUE" ] && [ -n "$INFISICAL_CLIENT_SECRET_VALUE" ]; then
  login_output="$("$INFISICAL_BIN" login \
    --silent \
    --plain \
    --domain "$INFISICAL_DOMAIN" \
    --method universal-auth \
    --client-id "$INFISICAL_CLIENT_ID_VALUE" \
    --client-secret "$INFISICAL_CLIENT_SECRET_VALUE" 2>&1)" || {
      login_reason="$(printf '%s\n' "$login_output" | sed -E 's/(client[_ -]?secret|token|secret)[^[:space:]]*/***MASKED***/Ig' | tail -n 1)"
      die "universal auth login failed: ${login_reason:-unknown error}"
    }
  INFISICAL_TOKEN_VALUE="$(printf '%s\n' "$login_output" | awk 'NF { line=$0 } END { print line }' | tr -d '\r\n')"
fi

if [ -z "$INFISICAL_TOKEN_VALUE" ]; then
  if [ "${SLACK_MCP_ALLOW_USER_INFISICAL:-0}" = "1" ]; then
    echo "SLACK_MCP_WARNING: using logged-in Infisical user because SLACK_MCP_ALLOW_USER_INFISICAL=1" >&2
  else
    die "missing INFISICAL_TOKEN, token file ($SLACK_MCP_INFISICAL_TOKEN_FILE), or universal auth file ($SLACK_MCP_INFISICAL_AUTH_FILE)"
  fi
fi

INFISICAL_RUN_ARGS=(
  run
  --silent
  --domain "$INFISICAL_DOMAIN"
  --projectId="$INFISICAL_PROJECT"
  --env="$INFISICAL_ENV"
  --path="$SLACK_MCP_INFISICAL_PATH"
)

CHECK_SCRIPT='
  set -euo pipefail
  unset INFISICAL_TOKEN
  xoxc_key="SLACK_MCP_XOXC_${WS_UPPER}"
  xoxd_key="SLACK_MCP_XOXD_${WS_UPPER}"
  if [ -z "${!xoxc_key:-}" ]; then
    echo "SLACK_MCP_UNAVAILABLE: missing secret key ${xoxc_key}" >&2
    exit 78
  fi
  if [ -z "${!xoxd_key:-}" ]; then
    echo "SLACK_MCP_UNAVAILABLE: missing secret key ${xoxd_key}" >&2
    exit 78
  fi
'

RUN_SCRIPT="$CHECK_SCRIPT"'
  export SLACK_MCP_XOXC_TOKEN="${!xoxc_key}"
  export SLACK_MCP_XOXD_TOKEN="${!xoxd_key}"
  export SLACK_MCP_HOST=127.0.0.1
  export SLACK_MCP_PORT="${PORT}"
  exec "${SLACK_MCP_BIN}"
'

export WS_UPPER PORT SLACK_MCP_BIN INFISICAL_DISABLE_UPDATE_CHECK=true
if [ -n "$INFISICAL_TOKEN_VALUE" ]; then
  export INFISICAL_TOKEN="$INFISICAL_TOKEN_VALUE"
else
  unset INFISICAL_TOKEN
fi

if [ "$MODE" = "--check" ]; then
  "$INFISICAL_BIN" "${INFISICAL_RUN_ARGS[@]}" -- bash -c "$CHECK_SCRIPT"
  echo "SLACK_MCP_AVAILABLE: $WS" >&2
  exit 0
fi

exec "$INFISICAL_BIN" "${INFISICAL_RUN_ARGS[@]}" -- bash -c "$RUN_SCRIPT"
