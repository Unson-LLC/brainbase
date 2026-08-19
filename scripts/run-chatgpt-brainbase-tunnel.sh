#!/bin/bash
# OpenAI Secure MCP Tunnel launcher for the Brainbase MCP stdio transport.
#
# Usage:
#   run-chatgpt-brainbase-tunnel.sh init
#   run-chatgpt-brainbase-tunnel.sh doctor
#   run-chatgpt-brainbase-tunnel.sh run
#   run-chatgpt-brainbase-tunnel.sh check
#
# OpenAI tunnel credentials are loaded from a dedicated Infisical target.
# Brainbase credentials are loaded independently by run-brainbase-mcp.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
source "$SCRIPT_DIR/lib/infisical-target.sh"

die() {
  echo "BRAINBASE_CHATGPT_TUNNEL_UNAVAILABLE: $*" >&2
  exit 78
}

usage() {
  cat >&2 <<'EOF'
usage: run-chatgpt-brainbase-tunnel.sh init|doctor|run|check

  init    Create or update the named tunnel-client stdio profile.
  doctor  Validate Brainbase and the tunnel-client profile.
  run     Run the long-lived Secure MCP Tunnel client.
  check   Alias for doctor, intended for automation.
EOF
}

MODE="${1:-}"
INTERNAL="${1:-}"
if [ "$INTERNAL" = "--inside-infisical" ]; then
  MODE="${2:-}"
fi

case "$MODE" in
  init|doctor|run|check) ;;
  *)
    usage
    exit 2
    ;;
esac

REPO_ROOT="${BRAINBASE_REPO_ROOT:-/Users/ksato/workspace/repos/.runtime/brainbase-31013}"
MCP_STDIO_LAUNCHER="${BRAINBASE_CHATGPT_MCP_STDIO_LAUNCHER:-$REPO_ROOT/scripts/run-brainbase-mcp-stdio.sh}"
MCP_COMMAND="${BRAINBASE_CHATGPT_MCP_COMMAND:-/bin/bash $MCP_STDIO_LAUNCHER}"
TUNNEL_PROFILE="${BRAINBASE_CHATGPT_TUNNEL_PROFILE:-brainbase-chatgpt}"
TUNNEL_CLIENT_BIN="${TUNNEL_CLIENT_BIN:-tunnel-client}"

run_inside_infisical() {
  local tunnel_id="${OPENAI_MCP_TUNNEL_ID:-}"

  [ -n "${CONTROL_PLANE_API_KEY:-}" ] || die "missing CONTROL_PLANE_API_KEY"
  command -v "$TUNNEL_CLIENT_BIN" >/dev/null 2>&1 || die "tunnel-client not found: $TUNNEL_CLIENT_BIN"
  [ -f "$MCP_STDIO_LAUNCHER" ] || die "Brainbase stdio launcher not found: $MCP_STDIO_LAUNCHER"

  # The Infisical access token is only needed to materialize this environment.
  # Never keep it in tunnel-client or pass it to the Brainbase MCP child.
  unset INFISICAL_TOKEN
  unset INFISICAL_UNIVERSAL_AUTH_CLIENT_ID INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET
  unset INFISICAL_CLIENT_ID INFISICAL_CLIENT_SECRET
  unset OPENAI_MCP_TUNNEL_ID

  case "$MODE" in
    init)
      case "$tunnel_id" in
        tunnel_*) ;;
        *) die "OPENAI_MCP_TUNNEL_ID must use the tunnel_... format" ;;
      esac
      "$MCP_STDIO_LAUNCHER" --check
      exec "$TUNNEL_CLIENT_BIN" init \
        --sample sample_mcp_stdio_local \
        --profile "$TUNNEL_PROFILE" \
        --tunnel-id "$tunnel_id" \
        --mcp-command "$MCP_COMMAND"
      ;;
    doctor|check)
      "$MCP_STDIO_LAUNCHER" --check
      exec "$TUNNEL_CLIENT_BIN" doctor --profile "$TUNNEL_PROFILE" --explain
      ;;
    run)
      "$MCP_STDIO_LAUNCHER" --check
      exec "$TUNNEL_CLIENT_BIN" run --profile "$TUNNEL_PROFILE"
      ;;
  esac
}

if [ "$INTERNAL" = "--inside-infisical" ]; then
  run_inside_infisical
fi

INFISICAL_BIN="${INFISICAL_BIN:-infisical}"
DEFAULT_INFISICAL_PROJECT_CONFIG_DIR="$(cd "$SCRIPT_DIR/../config" && pwd)"
INFISICAL_PROJECT_CONFIG_DIR="${INFISICAL_PROJECT_CONFIG_DIR:-$DEFAULT_INFISICAL_PROJECT_CONFIG_DIR}"
INFISICAL_TARGET_NAME="${BRAINBASE_CHATGPT_TUNNEL_INFISICAL_TARGET:-${INFISICAL_TARGET:-openai-brainbase-tunnel}}"
infisical_resolve_target "$INFISICAL_TARGET_NAME" || exit $?

INFISICAL_DOMAIN="${INFISICAL_DOMAIN:-$INFISICAL_TARGET_DOMAIN}"
INFISICAL_PROJECT="${INFISICAL_PROJECT:-$INFISICAL_TARGET_PROJECT_ID}"
INFISICAL_ENV="${INFISICAL_ENV:-$INFISICAL_TARGET_ENV}"
INFISICAL_PATH="${BRAINBASE_CHATGPT_TUNNEL_INFISICAL_PATH:-$INFISICAL_TARGET_PATH}"
DEFAULT_AUTH_FILE="$HOME/.brainbase/runtime-env/openai-mcp-tunnel.universal-auth.env"
EXPLICIT_AUTH_FILE="${BRAINBASE_CHATGPT_TUNNEL_INFISICAL_AUTH_FILE:-}"
if [ -n "$EXPLICIT_AUTH_FILE" ]; then
  EXPLICIT_AUTH_FILE="$(infisical_expand_user_path "$EXPLICIT_AUTH_FILE")"
fi

command -v "$INFISICAL_BIN" >/dev/null 2>&1 || die "infisical CLI not found: $INFISICAL_BIN"
command -v "$TUNNEL_CLIENT_BIN" >/dev/null 2>&1 || die "tunnel-client not found: $TUNNEL_CLIENT_BIN"
[ -f "$MCP_STDIO_LAUNCHER" ] || die "Brainbase stdio launcher not found: $MCP_STDIO_LAUNCHER"

AUTH_FILE=""
if [ -n "$EXPLICIT_AUTH_FILE" ] && [ -f "$EXPLICIT_AUTH_FILE" ]; then
  AUTH_FILE="$EXPLICIT_AUTH_FILE"
elif TARGET_AUTH_FILE="$(infisical_first_existing_target_auth_file || true)" && [ -n "$TARGET_AUTH_FILE" ]; then
  AUTH_FILE="$TARGET_AUTH_FILE"
elif [ -f "$DEFAULT_AUTH_FILE" ]; then
  AUTH_FILE="$DEFAULT_AUTH_FILE"
fi

INFISICAL_TOKEN_VALUE="${INFISICAL_TOKEN:-}"
CLIENT_ID_VALUE="${INFISICAL_UNIVERSAL_AUTH_CLIENT_ID:-${INFISICAL_CLIENT_ID:-}}"
CLIENT_SECRET_VALUE="${INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET:-${INFISICAL_CLIENT_SECRET:-}}"

if [ -z "$INFISICAL_TOKEN_VALUE" ] && [ -n "$AUTH_FILE" ]; then
  infisical_require_private_file "$AUTH_FILE" || die "credential file must be chmod 400 or 600: $AUTH_FILE"
  if [ -z "$CLIENT_ID_VALUE" ]; then
    CLIENT_ID_VALUE="$(infisical_read_env_file_value "$AUTH_FILE" INFISICAL_UNIVERSAL_AUTH_CLIENT_ID)"
  fi
  if [ -z "$CLIENT_SECRET_VALUE" ]; then
    CLIENT_SECRET_VALUE="$(infisical_read_env_file_value "$AUTH_FILE" INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET)"
  fi
fi

if [ -z "$INFISICAL_TOKEN_VALUE" ] && [ -n "$CLIENT_ID_VALUE" ] && [ -n "$CLIENT_SECRET_VALUE" ]; then
  login_output="$("$INFISICAL_BIN" login \
    --silent \
    --plain \
    --domain "$INFISICAL_DOMAIN" \
    --method universal-auth \
    --client-id "$CLIENT_ID_VALUE" \
    --client-secret "$CLIENT_SECRET_VALUE" 2>&1)" || {
      login_reason="$(printf '%s\n' "$login_output" | sed -E 's/(client[_ -]?secret|token|secret)[^[:space:]]*/***MASKED***/Ig' | tail -n 1)"
      die "universal auth login failed: ${login_reason:-unknown error}"
    }
  INFISICAL_TOKEN_VALUE="$(printf '%s\n' "$login_output" | awk 'NF { line=$0 } END { print line }' | tr -d '\r\n')"
fi

[ -n "$INFISICAL_TOKEN_VALUE" ] || \
  die "missing INFISICAL_TOKEN or universal auth credentials (target: $INFISICAL_TARGET_NAME)"

export INFISICAL_TOKEN="$INFISICAL_TOKEN_VALUE"
export INFISICAL_DISABLE_UPDATE_CHECK=true
export BRAINBASE_REPO_ROOT="$REPO_ROOT"
export BRAINBASE_CHATGPT_MCP_STDIO_LAUNCHER="$MCP_STDIO_LAUNCHER"
export BRAINBASE_CHATGPT_MCP_COMMAND="$MCP_COMMAND"
export BRAINBASE_CHATGPT_TUNNEL_PROFILE="$TUNNEL_PROFILE"
export TUNNEL_CLIENT_BIN

exec "$INFISICAL_BIN" run \
  --silent \
  --domain "$INFISICAL_DOMAIN" \
  --project-config-dir "$INFISICAL_PROJECT_CONFIG_DIR" \
  --projectId="$INFISICAL_PROJECT" \
  --env="$INFISICAL_ENV" \
  --path="$INFISICAL_PATH" \
  -- /bin/bash "$SELF" --inside-infisical "$MODE"
