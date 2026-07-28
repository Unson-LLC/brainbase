#!/bin/bash
# Run a command through an allowlisted Infisical target without exposing secrets.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/infisical-target.sh"

usage() {
  cat >&2 <<'EOF'
usage:
  scripts/infisical-target-run.sh --list
  scripts/infisical-target-run.sh [--target|-t TARGET] --json
  scripts/infisical-target-run.sh [--target|-t TARGET] --check
  scripts/infisical-target-run.sh [--target|-t TARGET] -- <command> [args...]
  scripts/infisical-target-run.sh TARGET --check
  scripts/infisical-target-run.sh TARGET -- <command> [args...]
EOF
}

die() {
  echo "INFISICAL_TARGET_UNAVAILABLE: $*" >&2
  exit 78
}

mask_reason() {
  sed -E 's/(client[_ -]?secret|token|secret)[^[:space:]]*/***MASKED***/Ig'
}

TARGET=""
MODE="run"
COMMAND=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target|-t)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      TARGET="$2"
      shift 2
      ;;
    --list)
      MODE="list"
      shift
      ;;
    --json)
      MODE="json"
      shift
      ;;
    --check)
      MODE="check"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      COMMAND=("$@")
      break
      ;;
    -*)
      usage
      exit 2
      ;;
    *)
      if [ -z "$TARGET" ]; then
        TARGET="$1"
        shift
      else
        usage
        exit 2
      fi
      ;;
  esac
done

RESOLVER="$SCRIPT_DIR/lib/resolve-infisical-target.mjs"
if [ "$MODE" = "list" ]; then
  node "$RESOLVER" --list
  exit 0
fi

if [ -z "$TARGET" ]; then
  usage
  exit 2
fi

if [ "$MODE" = "json" ]; then
  node "$RESOLVER" --json "$TARGET"
  exit 0
fi

infisical_resolve_target "$TARGET" || exit $?

if [ "$MODE" = "run" ] && [ "${#COMMAND[@]}" -eq 0 ]; then
  usage
  exit 2
fi

INFISICAL_BIN="${INFISICAL_BIN:-infisical}"
command -v "$INFISICAL_BIN" >/dev/null 2>&1 || die "infisical CLI not found: $INFISICAL_BIN"
DEFAULT_INFISICAL_PROJECT_CONFIG_DIR="$(cd "$SCRIPT_DIR/../config" && pwd)"
INFISICAL_PROJECT_CONFIG_DIR="${INFISICAL_PROJECT_CONFIG_DIR:-$DEFAULT_INFISICAL_PROJECT_CONFIG_DIR}"
[ -d "$INFISICAL_PROJECT_CONFIG_DIR" ] || die "project config directory not found: $INFISICAL_PROJECT_CONFIG_DIR"

INFISICAL_TOKEN_VALUE="${INFISICAL_TOKEN:-}"
TOKEN_FILE="$(infisical_target_token_file || true)"
if [ -z "$INFISICAL_TOKEN_VALUE" ] && [ -n "$TOKEN_FILE" ] && [ -f "$TOKEN_FILE" ]; then
  infisical_require_private_file "$TOKEN_FILE" || die "token file must not be group/world readable: $TOKEN_FILE"
  INFISICAL_TOKEN_VALUE="$(sed -n '1p' "$TOKEN_FILE" | tr -d '\r\n')"
fi

INFISICAL_CLIENT_ID_VALUE="${INFISICAL_UNIVERSAL_AUTH_CLIENT_ID:-${INFISICAL_CLIENT_ID:-}}"
INFISICAL_CLIENT_SECRET_VALUE="${INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET:-${INFISICAL_CLIENT_SECRET:-}}"
AUTH_FILE="$(infisical_first_existing_target_auth_file || true)"
if [ -z "$INFISICAL_TOKEN_VALUE" ] && [ -n "$AUTH_FILE" ]; then
  infisical_require_private_file "$AUTH_FILE" || die "credential file must not be group/world readable: $AUTH_FILE"
  if [ -z "$INFISICAL_CLIENT_ID_VALUE" ]; then
    INFISICAL_CLIENT_ID_VALUE="$(infisical_read_env_file_value "$AUTH_FILE" INFISICAL_UNIVERSAL_AUTH_CLIENT_ID)"
  fi
  if [ -z "$INFISICAL_CLIENT_SECRET_VALUE" ]; then
    INFISICAL_CLIENT_SECRET_VALUE="$(infisical_read_env_file_value "$AUTH_FILE" INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET)"
  fi
fi

if [ -z "$INFISICAL_TOKEN_VALUE" ] && [ -n "$INFISICAL_CLIENT_ID_VALUE" ] && [ -n "$INFISICAL_CLIENT_SECRET_VALUE" ]; then
  login_output="$("$INFISICAL_BIN" login \
    --silent \
    --plain \
    --domain "$INFISICAL_TARGET_DOMAIN" \
    --method universal-auth \
    --client-id "$INFISICAL_CLIENT_ID_VALUE" \
    --client-secret "$INFISICAL_CLIENT_SECRET_VALUE" 2>&1)" || {
      login_reason="$(printf '%s\n' "$login_output" | mask_reason | tail -n 1)"
      die "universal auth login failed for target ${INFISICAL_TARGET_NAME}: ${login_reason:-unknown error}"
    }
  INFISICAL_TOKEN_VALUE="$(printf '%s\n' "$login_output" | awk 'NF { line=$0 } END { print line }' | tr -d '\r\n')"
fi

if [ -z "$INFISICAL_TOKEN_VALUE" ]; then
  die "missing INFISICAL_TOKEN, target token file, or universal auth file for target ${INFISICAL_TARGET_NAME}"
fi

RUN_ARGS=(
  run
  --silent
  --domain "$INFISICAL_TARGET_DOMAIN"
  --project-config-dir "$INFISICAL_PROJECT_CONFIG_DIR"
  --projectId="$INFISICAL_TARGET_PROJECT_ID"
  --env="$INFISICAL_TARGET_ENV"
  --path="$INFISICAL_TARGET_PATH"
)

export INFISICAL_DISABLE_UPDATE_CHECK=true
export INFISICAL_TOKEN="$INFISICAL_TOKEN_VALUE"
INFISICAL_TARGET_REQUIRED_KEYS="$(infisical_target_required_keys_joined)"
export INFISICAL_TARGET_REQUIRED_KEYS

CHECK_SCRIPT='
  set -euo pipefail
  for key in $INFISICAL_TARGET_REQUIRED_KEYS; do
    if [ -z "${!key:-}" ]; then
      echo "INFISICAL_TARGET_UNAVAILABLE: missing required key ${key} for target ${INFISICAL_TARGET_NAME}" >&2
      exit 78
    fi
  done
'

export INFISICAL_TARGET_NAME
if [ "$MODE" = "check" ]; then
  "$INFISICAL_BIN" "${RUN_ARGS[@]}" -- bash -c "$CHECK_SCRIPT"
  echo "INFISICAL_TARGET_AVAILABLE: $INFISICAL_TARGET_NAME" >&2
  exit 0
fi

exec "$INFISICAL_BIN" "${RUN_ARGS[@]}" -- "${COMMAND[@]}"
