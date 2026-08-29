#!/bin/bash
# Keep the Brainbase MCP runtime on the same merged develop SHA as the UI.
# This is called after the canonical UI has started and /api/version reports
# the target SHA. Secret values are injected by run-brainbase-mcp.sh and are
# never read or logged here.

set -euo pipefail

TARGET_SHA="${1:-}"
UI_API_URL="${BRAINBASE_UI_API_URL:-http://127.0.0.1:31013}"
UI_RUNTIME="${BRAINBASE_UI_RUNTIME_ROOT:-/Users/ksato/workspace/repos/.runtime/brainbase-31013}"
MCP_RUNTIME="${BRAINBASE_MCP_RUNTIME_ROOT:-$UI_RUNTIME}"
MCP_LABEL="${BRAINBASE_MCP_LAUNCHD_LABEL:-com.brainbase.mcp-brainbase}"
CHATGPT_TUNNEL_LABEL="${BRAINBASE_CHATGPT_TUNNEL_LAUNCHD_LABEL:-com.brainbase.chatgpt-mcp-tunnel}"
RECEIPT="${BRAINBASE_MCP_RECONCILE_RECEIPT:-/Users/ksato/workspace/var/brainbase-mcp-reconcile.last}"
LOCK_DIR="${BRAINBASE_MCP_RECONCILE_LOCK:-/Users/ksato/workspace/var/brainbase-mcp-reconcile.lock}"
INFISICAL_BIN="${INFISICAL_BIN:-/Users/ksato/.local/bin/infisical}"
WAIT_ATTEMPTS="${BRAINBASE_MCP_RECONCILE_WAIT_ATTEMPTS:-30}"
CONNECT_TIMEOUT_SECONDS="${BRAINBASE_MCP_RECONCILE_CONNECT_TIMEOUT_SECONDS:-2}"
MAX_TIMEOUT_SECONDS="${BRAINBASE_MCP_RECONCILE_MAX_TIMEOUT_SECONDS:-5}"

log() {
  printf '[mcp-reconcile] %s %s\n' "$(date -u +%FT%TZ)" "$*" >&2
}

fail() {
  log "FAILED: $*"
  exit 1
}

is_finite_positive_timeout() {
  [[ "$1" =~ ^([1-9][0-9]*(\.[0-9]+)?|0\.([0-9]*[1-9][0-9]*))$ ]]
}

[[ "$TARGET_SHA" =~ ^[0-9a-f]{7,40}$ ]] || fail "target SHA is missing or invalid"
mkdir -p "$(dirname "$RECEIPT")"
rm -f -- "$RECEIPT"
[[ "$WAIT_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || fail "wait attempts must be a positive integer"
is_finite_positive_timeout "$CONNECT_TIMEOUT_SECONDS" || \
  fail "connect timeout must be finite positive seconds"
is_finite_positive_timeout "$MAX_TIMEOUT_SECONDS" || \
  fail "maximum timeout must be finite positive seconds"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "another reconciliation is already running"
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

ui_sha=""
for ((attempt = 1; attempt <= WAIT_ATTEMPTS; attempt += 1)); do
  ui_sha="$(curl -fsS \
    --connect-timeout "$CONNECT_TIMEOUT_SECONDS" \
    --max-time "$MAX_TIMEOUT_SECONDS" \
    -- "${UI_API_URL%/}/api/version" 2>/dev/null | \
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j?.runtime?.git?.sha||j?.git?.sha||j?.sha||"")}catch{}})' \
    2>/dev/null || true)"
  if [[ "$ui_sha" == "$TARGET_SHA" ]]; then
    break
  fi
  sleep 2
done

[[ "$ui_sha" == "$TARGET_SHA" ]] || \
  fail "UI did not become ready on target SHA ${TARGET_SHA:0:12}"

[[ -d "$MCP_RUNTIME/.git" || -f "$MCP_RUNTIME/.git" ]] || \
  fail "MCP runtime checkout not found: $MCP_RUNTIME"
[[ -d "$UI_RUNTIME/.git" || -f "$UI_RUNTIME/.git" ]] || \
  fail "UI runtime checkout not found: $UI_RUNTIME"

ui_checkout_sha="$(git -C "$UI_RUNTIME" rev-parse HEAD 2>/dev/null || true)"
[[ "$ui_checkout_sha" == "$TARGET_SHA" ]] || \
  fail "UI runtime checkout does not match target SHA ${TARGET_SHA:0:12}"
[[ -f "$UI_RUNTIME/scripts/run-brainbase-mcp.sh" ]] || \
  fail "candidate MCP launcher not found at target SHA: $UI_RUNTIME/scripts/run-brainbase-mcp.sh"

# Prove that the candidate launcher can authenticate and obtain a signed
# Judgment receipt before changing the currently runnable MCP checkout. This
# preserves the deployment hold when a merged UI commit is started by launchd
# before the shared binding secret has been provisioned.
log "preflighting candidate MCP runtime before mutation"
BRAINBASE_REPO_ROOT="$UI_RUNTIME" \
  INFISICAL_BIN="$INFISICAL_BIN" \
  bash "$UI_RUNTIME/scripts/run-brainbase-mcp.sh" --check >&2 || \
  fail "MCP candidate authentication preflight failed before runtime mutation"

cd "$MCP_RUNTIME"

tracked_dirty="$(git status --porcelain --untracked-files=no 2>/dev/null || true)"
[[ -z "$tracked_dirty" ]] || \
  fail "MCP runtime has tracked local changes; refusing to overwrite"

runtime_sha="$(git rev-parse HEAD 2>/dev/null || true)"
[[ "$runtime_sha" == "$TARGET_SHA" ]] || \
  fail "shared UI/MCP runtime does not match target SHA ${TARGET_SHA:0:12}"

npm --prefix mcp/brainbase run build >&2 || fail "MCP build failed"
BRAINBASE_REPO_ROOT="$MCP_RUNTIME" INFISICAL_BIN="$INFISICAL_BIN" scripts/run-brainbase-mcp.sh --check >&2 || \
  fail "MCP authentication preflight failed"

launchctl kickstart -k "gui/$(id -u)/${MCP_LABEL}" || fail "MCP launchd restart failed"

running=0
for ((attempt = 1; attempt <= 10; attempt += 1)); do
  if launchctl print "gui/$(id -u)/${MCP_LABEL}" 2>/dev/null | grep -q 'state = running'; then
    running=1
    break
  fi
  sleep 1
done
[[ "$running" == "1" ]] || fail "MCP launchd did not reach running state"

BRAINBASE_REPO_ROOT="$MCP_RUNTIME" INFISICAL_BIN="$INFISICAL_BIN" scripts/run-brainbase-mcp.sh --check >&2 || \
  fail "MCP post-restart authentication check failed"

# The ChatGPT tunnel owns a long-lived stdio child. Restart it after the MCP
# build changes so ChatGPT observes the same runtime SHA. Tunnel availability
# is an external integration and must not roll back an otherwise healthy
# Brainbase deployment; record and warn instead.
CHATGPT_TUNNEL_STATUS="not_loaded"
if launchctl print "gui/$(id -u)/${CHATGPT_TUNNEL_LABEL}" >/dev/null 2>&1; then
  CHATGPT_TUNNEL_STATUS="restart_failed"
  log "restarting installed ChatGPT Secure MCP Tunnel"
  if launchctl kickstart -k "gui/$(id -u)/${CHATGPT_TUNNEL_LABEL}"; then
    CHATGPT_TUNNEL_STATUS="unhealthy"
    for ((attempt = 1; attempt <= 10; attempt += 1)); do
      if launchctl print "gui/$(id -u)/${CHATGPT_TUNNEL_LABEL}" 2>/dev/null | grep -q 'state = running'; then
        CHATGPT_TUNNEL_STATUS="running"
        break
      fi
      sleep 1
    done
  fi

  if [ "$CHATGPT_TUNNEL_STATUS" != "running" ]; then
    log "WARNING: ChatGPT Secure MCP Tunnel status is ${CHATGPT_TUNNEL_STATUS}; core deployment remains active"
  fi
fi

printf 'sha=%s\ncompleted_at=%s\nchatgpt_tunnel=%s\n' \
  "$TARGET_SHA" \
  "$(date -u +%FT%TZ)" \
  "$CHATGPT_TUNNEL_STATUS" > "$RECEIPT"
log "complete: UI and MCP are on ${TARGET_SHA:0:12}, task API authentication is healthy, ChatGPT tunnel=${CHATGPT_TUNNEL_STATUS}"
