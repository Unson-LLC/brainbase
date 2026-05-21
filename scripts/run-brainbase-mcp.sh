#!/bin/bash
# brainbase MCP server launcher.
# Infisical から BRAINBASE_API_URL (および BRAINBASE_* 認証関連) を取得し、
# MCP server (node dist/index.js) が期待する BRAINBASE_GRAPH_API_URL として
# export してから exec する。
#
# Usage:
#   run-brainbase-mcp.sh           # 起動
#   run-brainbase-mcp.sh --check   # 取得可能か確認するだけ
#
# 必要環境:
#   - infisical CLI (https://infisical.com)
#   - $HOME/.brainbase/runtime-env/brainbase-mcp.universal-auth.env
#       INFISICAL_UNIVERSAL_AUTH_CLIENT_ID=...
#       INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET=...
#     ない場合は $HOME/.brainbase/runtime-env/slack-mcp.universal-auth.env に
#     fallback する（同じ Infisical project を参照しているため）。
set -euo pipefail

MODE="${1:-}"
if [ -n "$MODE" ] && [ "$MODE" != "--check" ]; then
  echo "usage: $0 [--check]" >&2
  exit 2
fi

die() {
  echo "BRAINBASE_MCP_UNAVAILABLE: $*" >&2
  exit 78
}

REPO_ROOT="${BRAINBASE_REPO_ROOT:-/Users/ksato/workspace/code/brainbase}"
MCP_ENTRY="${BRAINBASE_MCP_ENTRY:-$REPO_ROOT/mcp/brainbase/dist/index.js}"

INFISICAL_BIN="${INFISICAL_BIN:-infisical}"
INFISICAL_DOMAIN="${INFISICAL_DOMAIN:-https://infisical.unson.jp}"
INFISICAL_PROJECT="${INFISICAL_PROJECT:-ce20541c-02b9-4523-bbe0-49d50b2fcc19}"
INFISICAL_ENV="${INFISICAL_ENV:-prod}"
BRAINBASE_MCP_INFISICAL_PATH="${BRAINBASE_MCP_INFISICAL_PATH:-/}"
BRAINBASE_MCP_INFISICAL_AUTH_FILE="${BRAINBASE_MCP_INFISICAL_AUTH_FILE:-$HOME/.brainbase/runtime-env/brainbase-mcp.universal-auth.env}"
SLACK_MCP_INFISICAL_AUTH_FILE="${SLACK_MCP_INFISICAL_AUTH_FILE:-$HOME/.brainbase/runtime-env/slack-mcp.universal-auth.env}"

if [ ! -x "$(command -v "$INFISICAL_BIN")" ]; then
  die "infisical CLI not found: $INFISICAL_BIN"
fi
if [ ! -f "$MCP_ENTRY" ]; then
  die "MCP entry not found: $MCP_ENTRY (run 'cd $REPO_ROOT/mcp/brainbase && npm run build')"
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

AUTH_FILE=""
if [ -f "$BRAINBASE_MCP_INFISICAL_AUTH_FILE" ]; then
  AUTH_FILE="$BRAINBASE_MCP_INFISICAL_AUTH_FILE"
elif [ -f "$SLACK_MCP_INFISICAL_AUTH_FILE" ]; then
  AUTH_FILE="$SLACK_MCP_INFISICAL_AUTH_FILE"
fi

INFISICAL_CLIENT_ID_VALUE="${INFISICAL_UNIVERSAL_AUTH_CLIENT_ID:-${INFISICAL_CLIENT_ID:-}}"
INFISICAL_CLIENT_SECRET_VALUE="${INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET:-${INFISICAL_CLIENT_SECRET:-}}"
if [ -z "$INFISICAL_TOKEN_VALUE" ] && [ -n "$AUTH_FILE" ]; then
  require_private_file "$AUTH_FILE"
  if [ -z "$INFISICAL_CLIENT_ID_VALUE" ]; then
    INFISICAL_CLIENT_ID_VALUE="$(read_env_file_value "$AUTH_FILE" INFISICAL_UNIVERSAL_AUTH_CLIENT_ID)"
  fi
  if [ -z "$INFISICAL_CLIENT_SECRET_VALUE" ]; then
    INFISICAL_CLIENT_SECRET_VALUE="$(read_env_file_value "$AUTH_FILE" INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET)"
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
  if [ "${BRAINBASE_MCP_ALLOW_USER_INFISICAL:-0}" = "1" ]; then
    echo "BRAINBASE_MCP_WARNING: using logged-in Infisical user because BRAINBASE_MCP_ALLOW_USER_INFISICAL=1" >&2
  else
    die "missing INFISICAL_TOKEN or universal auth file ($BRAINBASE_MCP_INFISICAL_AUTH_FILE / $SLACK_MCP_INFISICAL_AUTH_FILE)"
  fi
fi

INFISICAL_RUN_ARGS=(
  run
  --silent
  --domain "$INFISICAL_DOMAIN"
  --projectId="$INFISICAL_PROJECT"
  --env="$INFISICAL_ENV"
  --path="$BRAINBASE_MCP_INFISICAL_PATH"
)

CHECK_SCRIPT='
  set -euo pipefail
  unset INFISICAL_TOKEN
  if [ -z "${BRAINBASE_API_URL:-}" ] && [ -z "${BRAINBASE_GRAPH_API_URL:-}" ]; then
    echo "BRAINBASE_MCP_UNAVAILABLE: missing BRAINBASE_API_URL in Infisical project ${INFISICAL_PROJECT} (env ${INFISICAL_ENV}, path ${BRAINBASE_MCP_INFISICAL_PATH})" >&2
    exit 78
  fi
'

RUN_SCRIPT="$CHECK_SCRIPT"'
  # BRAINBASE_API_URL を MCP server が期待する BRAINBASE_GRAPH_API_URL として export
  if [ -z "${BRAINBASE_GRAPH_API_URL:-}" ] && [ -n "${BRAINBASE_API_URL:-}" ]; then
    export BRAINBASE_GRAPH_API_URL="${BRAINBASE_API_URL}"
  fi
  cd "${REPO_ROOT}"
  exec node "${MCP_ENTRY}"
'

export REPO_ROOT MCP_ENTRY INFISICAL_PROJECT INFISICAL_ENV BRAINBASE_MCP_INFISICAL_PATH INFISICAL_DISABLE_UPDATE_CHECK=true
if [ -n "$INFISICAL_TOKEN_VALUE" ]; then
  export INFISICAL_TOKEN="$INFISICAL_TOKEN_VALUE"
else
  unset INFISICAL_TOKEN
fi

if [ "$MODE" = "--check" ]; then
  "$INFISICAL_BIN" "${INFISICAL_RUN_ARGS[@]}" -- bash -c "$CHECK_SCRIPT"
  echo "BRAINBASE_MCP_AVAILABLE" >&2
  exit 0
fi

exec "$INFISICAL_BIN" "${INFISICAL_RUN_ARGS[@]}" -- bash -c "$RUN_SCRIPT"
