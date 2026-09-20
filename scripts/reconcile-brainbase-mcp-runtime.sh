#!/bin/bash
# Keep the Brainbase MCP runtime on the same merged develop SHA as the UI.
# This is called after the canonical UI has started. It serializes concurrent
# reconciliations, then converges on the SHA shared by /api/version and the UI
# checkout. Secret values are injected by run-brainbase-mcp.sh and are never
# read or logged here.

set -euo pipefail

REQUESTED_SHA="${1:-}"
TARGET_SHA=""
UI_API_URL="${BRAINBASE_UI_API_URL:-http://127.0.0.1:31013}"
UI_RUNTIME="${BRAINBASE_UI_RUNTIME_ROOT:-/Users/ksato/workspace/repos/.runtime/brainbase-31013}"
MCP_RUNTIME="${BRAINBASE_MCP_RUNTIME_ROOT:-$UI_RUNTIME}"
MCP_LABEL="${BRAINBASE_MCP_LAUNCHD_LABEL:-com.brainbase.mcp-brainbase}"
CHATGPT_TUNNEL_LABEL="${BRAINBASE_CHATGPT_TUNNEL_LAUNCHD_LABEL:-com.brainbase.chatgpt-mcp-tunnel}"
RECEIPT="${BRAINBASE_MCP_RECONCILE_RECEIPT:-/Users/ksato/workspace/var/brainbase-mcp-reconcile.last}"
LOCK_FILE="${BRAINBASE_MCP_RECONCILE_LOCK:-/Users/ksato/workspace/var/brainbase-mcp-reconcile.lock}"
RUNTIME_LOCK_DIR="${BRAINBASE_RUNTIME_LOCK:-/Users/ksato/workspace/var/brainbase-runtime-update.lock}"
SHLOCK_BIN="${BRAINBASE_SHLOCK_BIN:-/usr/bin/shlock}"
INFISICAL_BIN="${INFISICAL_BIN:-/Users/ksato/.local/bin/infisical}"
WAIT_ATTEMPTS="${BRAINBASE_MCP_RECONCILE_WAIT_ATTEMPTS:-30}"
LOCK_WAIT_SECONDS="${BRAINBASE_MCP_RECONCILE_LOCK_WAIT_SECONDS:-600}"
RUNTIME_LOCK_WAIT_SECONDS="${BRAINBASE_RUNTIME_LOCK_WAIT_SECONDS:-600}"
LAUNCHD_WAIT_ATTEMPTS="${BRAINBASE_MCP_RECONCILE_LAUNCHD_WAIT_ATTEMPTS:-60}"
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

[[ "$REQUESTED_SHA" =~ ^[0-9a-f]{7,40}$ ]] || fail "target SHA is missing or invalid"
[[ "$LOCK_WAIT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail "lock wait seconds must be a positive integer"
[[ "$RUNTIME_LOCK_WAIT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail "runtime lock wait seconds must be a positive integer"
mkdir -p "$(dirname "$RECEIPT")" "$(dirname "$LOCK_FILE")" "$(dirname "$RUNTIME_LOCK_DIR")"
LOCK_ACQUIRED=0
RUNTIME_LOCK_ACQUIRED=0
RECEIPT_TMP=""

release_reconcile_lock() {
  if [[ "$LOCK_ACQUIRED" == "1" ]]; then
    local owner_pid=""
    owner_pid="$(cat "$LOCK_FILE" 2>/dev/null || true)"
    if [[ "$owner_pid" == "$$" ]]; then
      rm -f -- "$LOCK_FILE" 2>/dev/null || true
    fi
    LOCK_ACQUIRED=0
  fi
}

release_runtime_lock() {
  if [[ "$RUNTIME_LOCK_ACQUIRED" == "1" ]]; then
    rmdir "$RUNTIME_LOCK_DIR" 2>/dev/null || true
    RUNTIME_LOCK_ACQUIRED=0
  fi
}

cleanup() {
  if [[ -n "$RECEIPT_TMP" ]]; then
    rm -f -- "$RECEIPT_TMP" 2>/dev/null || true
  fi
  release_runtime_lock
  release_reconcile_lock
}
trap cleanup EXIT

waited_seconds=0
while ! "$SHLOCK_BIN" -p "$$" -f "$LOCK_FILE" >/dev/null 2>&1; do
  if ((waited_seconds >= LOCK_WAIT_SECONDS)); then
    fail "another reconciliation is already running after ${LOCK_WAIT_SECONDS} seconds"
  fi
  sleep 1
  waited_seconds=$((waited_seconds + 1))
done
LOCK_ACQUIRED=1
log "acquired reconcile lock; requested SHA ${REQUESTED_SHA:0:12}"

runtime_lock_waited_seconds=0
while ! mkdir "$RUNTIME_LOCK_DIR" 2>/dev/null; do
  if ((runtime_lock_waited_seconds >= RUNTIME_LOCK_WAIT_SECONDS)); then
    fail "UI runtime update lock is still held after ${RUNTIME_LOCK_WAIT_SECONDS} seconds"
  fi
  sleep 1
  runtime_lock_waited_seconds=$((runtime_lock_waited_seconds + 1))
done
RUNTIME_LOCK_ACQUIRED=1
log "acquired UI runtime update lock; resolving current UI API/checkout SHA"

[[ "$WAIT_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || fail "wait attempts must be a positive integer"
[[ "$LAUNCHD_WAIT_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || fail "launchd wait attempts must be a positive integer"
is_finite_positive_timeout "$CONNECT_TIMEOUT_SECONDS" || \
  fail "connect timeout must be finite positive seconds"
is_finite_positive_timeout "$MAX_TIMEOUT_SECONDS" || \
  fail "maximum timeout must be finite positive seconds"

[[ -d "$MCP_RUNTIME/.git" || -f "$MCP_RUNTIME/.git" ]] || \
  fail "MCP runtime checkout not found: $MCP_RUNTIME"
[[ -d "$UI_RUNTIME/.git" || -f "$UI_RUNTIME/.git" ]] || \
  fail "UI runtime checkout not found: $UI_RUNTIME"

ui_sha=""
ui_checkout_sha=""
for ((attempt = 1; attempt <= WAIT_ATTEMPTS; attempt += 1)); do
  ui_checkout_sha_before="$(git -C "$UI_RUNTIME" rev-parse HEAD 2>/dev/null || true)"
  ui_sha="$(curl -fsS \
    --connect-timeout "$CONNECT_TIMEOUT_SECONDS" \
    --max-time "$MAX_TIMEOUT_SECONDS" \
    -- "${UI_API_URL%/}/api/version" 2>/dev/null | \
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j?.runtime?.git?.sha||j?.git?.sha||j?.sha||"")}catch{}})' \
    2>/dev/null || true)"
  ui_checkout_sha="$(git -C "$UI_RUNTIME" rev-parse HEAD 2>/dev/null || true)"
  if [[ "$ui_checkout_sha_before" =~ ^[0-9a-f]{40}$ && \
    "$ui_checkout_sha" == "$ui_checkout_sha_before" && \
    "$ui_sha" == "$ui_checkout_sha" ]]; then
    TARGET_SHA="$ui_sha"
    break
  fi
  sleep 2
done

[[ -n "$TARGET_SHA" ]] || \
  fail "UI API and checkout did not converge on one SHA after ${WAIT_ATTEMPTS} attempts"
log "UI API and checkout agree on ${TARGET_SHA:0:12}"

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
for ((attempt = 1; attempt <= LAUNCHD_WAIT_ATTEMPTS; attempt += 1)); do
  if launchctl print "gui/$(id -u)/${MCP_LABEL}" 2>/dev/null | grep 'state = running' >/dev/null; then
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
      if launchctl print "gui/$(id -u)/${CHATGPT_TUNNEL_LABEL}" 2>/dev/null | grep 'state = running' >/dev/null; then
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

RECEIPT_TMP="$(mktemp "${RECEIPT}.tmp.XXXXXX")" || \
  fail "could not create temporary reconciliation receipt"
printf 'sha=%s\ncompleted_at=%s\nchatgpt_tunnel=%s\n' \
  "$TARGET_SHA" \
  "$(date -u +%FT%TZ)" \
  "$CHATGPT_TUNNEL_STATUS" > "$RECEIPT_TMP" || \
  fail "could not write temporary reconciliation receipt"
mv -f -- "$RECEIPT_TMP" "$RECEIPT" || \
  fail "could not atomically replace reconciliation receipt"
RECEIPT_TMP=""
log "complete: UI and MCP are on ${TARGET_SHA:0:12}, task API authentication is healthy, ChatGPT tunnel=${CHATGPT_TUNNEL_STATUS}"
