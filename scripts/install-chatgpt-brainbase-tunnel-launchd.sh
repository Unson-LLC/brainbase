#!/bin/bash
# Install the canonical ChatGPT -> Secure MCP Tunnel -> Brainbase stdio job.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: install-chatgpt-brainbase-tunnel-launchd.sh [--init]

  --init  Initialize the tunnel-client profile before installing launchd.
          Use this once after the OpenAI tunnel ID and runtime key are stored
          in Infisical. Subsequent installs can omit the flag.
EOF
}

INIT_PROFILE=0
case "${1:-}" in
  "") ;;
  --init) INIT_PROFILE=1 ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage
    exit 2
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_ROOT="${BRAINBASE_UI_RUNTIME_ROOT:-/Users/ksato/workspace/repos/.runtime/brainbase-31013}"
AGENTS_DIR="${BRAINBASE_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
PLIST_TEMPLATE="$REPO_ROOT/config/com.brainbase.chatgpt-mcp-tunnel.plist"
PLIST="$AGENTS_DIR/com.brainbase.chatgpt-mcp-tunnel.plist"
RUNNER="$RUNTIME_ROOT/scripts/run-chatgpt-brainbase-tunnel.sh"
LABEL="com.brainbase.chatgpt-mcp-tunnel"
DOMAIN="gui/$(id -u)"

INFISICAL_BIN="${INFISICAL_BIN:-$(command -v infisical || true)}"
TUNNEL_CLIENT_BIN="${TUNNEL_CLIENT_BIN:-$(command -v tunnel-client || true)}"

[ -n "$INFISICAL_BIN" ] && [ -x "$INFISICAL_BIN" ] || {
  echo "infisical CLI not found" >&2
  exit 78
}
[ -n "$TUNNEL_CLIENT_BIN" ] && [ -x "$TUNNEL_CLIENT_BIN" ] || {
  echo "tunnel-client not found; install the latest official release first" >&2
  exit 78
}
[ -f "$PLIST_TEMPLATE" ] || {
  echo "launchd template not found: $PLIST_TEMPLATE" >&2
  exit 78
}
[ -f "$RUNNER" ] || {
  echo "managed runtime is not deployed with the tunnel runner: $RUNNER" >&2
  exit 78
}

mkdir -p "$AGENTS_DIR" "$HOME/Library/Logs"

sed \
  -e "s|__HOME__|$HOME|g" \
  -e "s|__RUNTIME_ROOT__|$RUNTIME_ROOT|g" \
  "$PLIST_TEMPLATE" > "$PLIST"

plutil -replace EnvironmentVariables.INFISICAL_BIN -string "$INFISICAL_BIN" "$PLIST"
plutil -replace EnvironmentVariables.TUNNEL_CLIENT_BIN -string "$TUNNEL_CLIENT_BIN" "$PLIST"
plutil -lint "$PLIST"

if [ "$INIT_PROFILE" = "1" ]; then
  BRAINBASE_REPO_ROOT="$RUNTIME_ROOT" \
    INFISICAL_BIN="$INFISICAL_BIN" \
    TUNNEL_CLIENT_BIN="$TUNNEL_CLIENT_BIN" \
    /bin/bash "$RUNNER" init
fi

BRAINBASE_REPO_ROOT="$RUNTIME_ROOT" \
  INFISICAL_BIN="$INFISICAL_BIN" \
  TUNNEL_CLIENT_BIN="$TUNNEL_CLIENT_BIN" \
  /bin/bash "$RUNNER" doctor

wait_until_unloaded() {
  local label="$1"
  for _ in {1..30}; do
    if ! launchctl print "$DOMAIN/$label" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  printf 'launchd job did not unload: %s\n' "$label" >&2
  return 1
}

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
wait_until_unloaded "$LABEL"
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL"
launchctl kickstart -k "$DOMAIN/$LABEL"

for _ in {1..20}; do
  if launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -q 'state = running'; then
    printf 'Brainbase ChatGPT Secure MCP Tunnel is running (%s).\n' "$LABEL"
    exit 0
  fi
  sleep 0.5
done

echo "Secure MCP Tunnel launchd job did not reach running state" >&2
exit 1
