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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/infisical-target.sh"

MODE="${1:-}"
if [ -n "$MODE" ] && [ "$MODE" != "--check" ]; then
  echo "usage: $0 [--check]" >&2
  exit 2
fi

die() {
  echo "BRAINBASE_MCP_UNAVAILABLE: $*" >&2
  exit 78
}

REPO_ROOT="${BRAINBASE_REPO_ROOT:-/Users/ksato/workspace/repos/.runtime/brainbase-31013}"
MCP_ENTRY="${BRAINBASE_MCP_ENTRY:-$REPO_ROOT/mcp/brainbase/dist/index.js}"

INFISICAL_BIN="${INFISICAL_BIN:-infisical}"
DEFAULT_INFISICAL_PROJECT_CONFIG_DIR="$(cd "$SCRIPT_DIR/../config" && pwd)"
INFISICAL_PROJECT_CONFIG_DIR="${INFISICAL_PROJECT_CONFIG_DIR:-$DEFAULT_INFISICAL_PROJECT_CONFIG_DIR}"
INFISICAL_TARGET_NAME="${BRAINBASE_MCP_INFISICAL_TARGET:-${INFISICAL_TARGET:-brainbase-mcp}}"
infisical_resolve_target "$INFISICAL_TARGET_NAME" || exit $?
INFISICAL_DOMAIN="${INFISICAL_DOMAIN:-$INFISICAL_TARGET_DOMAIN}"
INFISICAL_PROJECT="${INFISICAL_PROJECT:-$INFISICAL_TARGET_PROJECT_ID}"
INFISICAL_ENV="${INFISICAL_ENV:-$INFISICAL_TARGET_ENV}"
BRAINBASE_MCP_INFISICAL_PATH="${BRAINBASE_MCP_INFISICAL_PATH:-$INFISICAL_TARGET_PATH}"
DEFAULT_BRAINBASE_MCP_INFISICAL_AUTH_FILE="$HOME/.brainbase/runtime-env/brainbase-mcp.universal-auth.env"
BRAINBASE_MCP_INFISICAL_AUTH_FILE="${BRAINBASE_MCP_INFISICAL_AUTH_FILE:-}"
SLACK_MCP_INFISICAL_AUTH_FILE="${SLACK_MCP_INFISICAL_AUTH_FILE:-$HOME/.brainbase/runtime-env/slack-mcp.universal-auth.env}"

if [ ! -x "$(command -v "$INFISICAL_BIN")" ]; then
  die "infisical CLI not found: $INFISICAL_BIN"
fi
if [ "$MODE" != "--check" ] && [ ! -f "$MCP_ENTRY" ]; then
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
if [ -n "$BRAINBASE_MCP_INFISICAL_AUTH_FILE" ] && [ -f "$BRAINBASE_MCP_INFISICAL_AUTH_FILE" ]; then
  AUTH_FILE="$BRAINBASE_MCP_INFISICAL_AUTH_FILE"
elif TARGET_AUTH_FILE="$(infisical_first_existing_target_auth_file || true)" && [ -n "$TARGET_AUTH_FILE" ]; then
  AUTH_FILE="$TARGET_AUTH_FILE"
elif [ -f "$DEFAULT_BRAINBASE_MCP_INFISICAL_AUTH_FILE" ]; then
  AUTH_FILE="$DEFAULT_BRAINBASE_MCP_INFISICAL_AUTH_FILE"
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
    die "missing INFISICAL_TOKEN or universal auth file (${BRAINBASE_MCP_INFISICAL_AUTH_FILE:-$DEFAULT_BRAINBASE_MCP_INFISICAL_AUTH_FILE} / target ${INFISICAL_TARGET_NAME} / $SLACK_MCP_INFISICAL_AUTH_FILE)"
  fi
fi

INFISICAL_RUN_ARGS=(
  run
  --silent
  --domain "$INFISICAL_DOMAIN"
  --project-config-dir "$INFISICAL_PROJECT_CONFIG_DIR"
  --projectId="$INFISICAL_PROJECT"
  --env="$INFISICAL_ENV"
  --path="$BRAINBASE_MCP_INFISICAL_PATH"
)

CHECK_SCRIPT='
  set -euo pipefail
  unset INFISICAL_TOKEN
  resolved_api_url="${BRAINBASE_GRAPH_API_URL:-${BRAINBASE_API_URL:-${BRAINBASE_API_BASE_URL:-}}}"
  if [ -z "$resolved_api_url" ]; then
    echo "BRAINBASE_MCP_UNAVAILABLE: missing Brainbase API URL in Infisical project ${INFISICAL_PROJECT} (env ${INFISICAL_ENV}, path ${BRAINBASE_MCP_INFISICAL_PATH})" >&2
    exit 78
  fi
  export BRAINBASE_RESOLVED_API_URL="$resolved_api_url"
  if [ -z "${BRAINBASE_TASK_API_TOKEN:-}" ]; then
    echo "BRAINBASE_MCP_UNAVAILABLE: missing BRAINBASE_TASK_API_TOKEN in Infisical project ${INFISICAL_PROJECT} (env ${INFISICAL_ENV}, path ${BRAINBASE_MCP_INFISICAL_PATH})" >&2
    exit 78
  fi
  case "$BRAINBASE_TASK_API_TOKEN" in
    bbsvc_*) ;;
    *)
      echo "BRAINBASE_MCP_UNAVAILABLE: BRAINBASE_TASK_API_TOKEN must use the bbsvc_ service-token format" >&2
      exit 78
      ;;
  esac
  if [ -z "${BRAINBASE_JUDGMENT_BINDING_SECRET:-}" ]; then
    echo "BRAINBASE_MCP_UNAVAILABLE: missing BRAINBASE_JUDGMENT_BINDING_SECRET in Infisical project ${INFISICAL_PROJECT} (env ${INFISICAL_ENV}, path ${BRAINBASE_MCP_INFISICAL_PATH})" >&2
    exit 78
  fi
  if [ "${#BRAINBASE_JUDGMENT_BINDING_SECRET}" -lt 32 ]; then
    echo "BRAINBASE_MCP_UNAVAILABLE: BRAINBASE_JUDGMENT_BINDING_SECRET must be at least 32 characters" >&2
    exit 78
  fi
  export BRAINBASE_JUDGMENT_ADAPTER_ID="${BRAINBASE_JUDGMENT_ADAPTER_ID:-brainbase-mcp}"
  export BRAINBASE_JUDGMENT_ADAPTER_VERSION="${BRAINBASE_JUDGMENT_ADAPTER_VERSION:-1}"
  task_api_base="$BRAINBASE_RESOLVED_API_URL"
  task_api_status="$(curl -sS -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${BRAINBASE_TASK_API_TOKEN}" \
    "${task_api_base%/}/api/companion/tasks?limit=1")" || {
      echo "BRAINBASE_MCP_UNAVAILABLE: canonical task API preflight could not connect" >&2
      exit 69
    }
  if [ "$task_api_status" != "200" ]; then
    echo "BRAINBASE_MCP_UNAVAILABLE: canonical task API preflight returned HTTP ${task_api_status}" >&2
    exit 77
  fi
  node "${REPO_ROOT}/scripts/preflight-judgment-binding.js"
'

RUN_SCRIPT="$CHECK_SCRIPT"'
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
