#!/bin/bash
# NocoDB MCP server launcher (Infisical Machine Identity backed).
#
# Pulls NOCODB_URL / NOCODB_TOKEN from Infisical (unson / prod / /mcp/nocodb)
# and execs the MCP server. With MCP_HTTP_PORT set, the server listens on
# Streamable HTTP (one shared process for all sessions); otherwise stdio.
#
# Universal Auth credentials file (chmod 600), same MI as the other MCPs:
#   ~/.brainbase/runtime-env/nocodb-mcp.universal-auth.env
#   fallback: ~/.brainbase/runtime-env/slack-mcp.universal-auth.env

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/infisical-target.sh"

die() {
  echo "NOCODB_MCP_UNAVAILABLE: $*" >&2
  exit 78
}

INFISICAL_BIN="${INFISICAL_BIN:-infisical}"
DEFAULT_INFISICAL_PROJECT_CONFIG_DIR="$(cd "$SCRIPT_DIR/../config" && pwd)"
INFISICAL_PROJECT_CONFIG_DIR="${INFISICAL_PROJECT_CONFIG_DIR:-$DEFAULT_INFISICAL_PROJECT_CONFIG_DIR}"
INFISICAL_TARGET_NAME="${NOCODB_MCP_INFISICAL_TARGET:-${INFISICAL_TARGET:-nocodb-mcp}}"
infisical_resolve_target "$INFISICAL_TARGET_NAME" || exit $?
INFISICAL_DOMAIN="${INFISICAL_DOMAIN:-$INFISICAL_TARGET_DOMAIN}"
INFISICAL_PROJECT="${INFISICAL_PROJECT:-$INFISICAL_TARGET_PROJECT_ID}"
INFISICAL_ENV="${INFISICAL_ENV:-$INFISICAL_TARGET_ENV}"
NOCODB_MCP_INFISICAL_PATH="${NOCODB_MCP_INFISICAL_PATH:-$INFISICAL_TARGET_PATH}"
DEFAULT_NOCODB_MCP_INFISICAL_AUTH_FILE="$HOME/.brainbase/runtime-env/nocodb-mcp.universal-auth.env"
NOCODB_MCP_INFISICAL_AUTH_FILE="${NOCODB_MCP_INFISICAL_AUTH_FILE:-}"
NOCODB_MCP_INFISICAL_AUTH_FALLBACK="${NOCODB_MCP_INFISICAL_AUTH_FALLBACK:-$HOME/.brainbase/runtime-env/slack-mcp.universal-auth.env}"

REPO_ROOT="${BRAINBASE_REPO_ROOT:-/Users/ksato/workspace/repos/brainbase}"
NOCODB_MCP_ENTRY="${NOCODB_MCP_ENTRY:-$REPO_ROOT/mcp/nocodb/src/index.ts}"
NPX_BIN="${NOCODB_MCP_NPX:-npx}"

command -v "$INFISICAL_BIN" >/dev/null 2>&1 || die "infisical CLI not found: $INFISICAL_BIN"
command -v "$NPX_BIN" >/dev/null 2>&1 || die "npx not found: $NPX_BIN"
[ -f "$NOCODB_MCP_ENTRY" ] || die "MCP entry not found: $NOCODB_MCP_ENTRY"

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
      k=parts[1]
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", k)
      if (k != wanted) next
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

CLIENT_ID_VALUE="${INFISICAL_UNIVERSAL_AUTH_CLIENT_ID:-}"
CLIENT_SECRET_VALUE="${INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET:-}"

AUTH_FILE=""
if [ -n "$NOCODB_MCP_INFISICAL_AUTH_FILE" ] && [ -f "$NOCODB_MCP_INFISICAL_AUTH_FILE" ]; then
  AUTH_FILE="$NOCODB_MCP_INFISICAL_AUTH_FILE"
elif TARGET_AUTH_FILE="$(infisical_first_existing_target_auth_file || true)" && [ -n "$TARGET_AUTH_FILE" ]; then
  AUTH_FILE="$TARGET_AUTH_FILE"
elif [ -f "$DEFAULT_NOCODB_MCP_INFISICAL_AUTH_FILE" ]; then
  AUTH_FILE="$DEFAULT_NOCODB_MCP_INFISICAL_AUTH_FILE"
elif [ -f "$NOCODB_MCP_INFISICAL_AUTH_FALLBACK" ]; then
  AUTH_FILE="$NOCODB_MCP_INFISICAL_AUTH_FALLBACK"
fi

if [ -n "$AUTH_FILE" ]; then
  require_private_file "$AUTH_FILE"
  [ -z "$CLIENT_ID_VALUE" ] && CLIENT_ID_VALUE="$(read_env_file_value "$AUTH_FILE" INFISICAL_UNIVERSAL_AUTH_CLIENT_ID)"
  [ -z "$CLIENT_SECRET_VALUE" ] && CLIENT_SECRET_VALUE="$(read_env_file_value "$AUTH_FILE" INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET)"
fi

INFISICAL_TOKEN_VALUE="${INFISICAL_TOKEN:-}"
if [ -z "$INFISICAL_TOKEN_VALUE" ] && [ -n "$CLIENT_ID_VALUE" ] && [ -n "$CLIENT_SECRET_VALUE" ]; then
  login_output="$("$INFISICAL_BIN" login \
    --silent --plain \
    --domain "$INFISICAL_DOMAIN" \
    --method universal-auth \
    --client-id "$CLIENT_ID_VALUE" \
    --client-secret "$CLIENT_SECRET_VALUE" 2>&1)" || {
      login_reason="$(printf '%s\n' "$login_output" | sed -E 's/(client[_ -]?secret|token|secret)[^[:space:]]*/***MASKED***/Ig' | tail -n 1)"
      die "universal auth login failed: ${login_reason:-unknown error}"
    }
  INFISICAL_TOKEN_VALUE="$(printf '%s\n' "$login_output" | awk 'NF { line=$0 } END { print line }' | tr -d '\r\n')"
fi

[ -n "$INFISICAL_TOKEN_VALUE" ] || die "missing Infisical token and universal auth credentials (file: ${NOCODB_MCP_INFISICAL_AUTH_FILE:-$DEFAULT_NOCODB_MCP_INFISICAL_AUTH_FILE} / target ${INFISICAL_TARGET_NAME})"

export INFISICAL_DISABLE_UPDATE_CHECK=true
export INFISICAL_TOKEN="$INFISICAL_TOKEN_VALUE"

exec "$INFISICAL_BIN" run \
  --silent \
  --domain "$INFISICAL_DOMAIN" \
  --project-config-dir "$INFISICAL_PROJECT_CONFIG_DIR" \
  --projectId="$INFISICAL_PROJECT" \
  --env="$INFISICAL_ENV" \
  --path="$NOCODB_MCP_INFISICAL_PATH" \
  -- "$NPX_BIN" tsx "$NOCODB_MCP_ENTRY"
