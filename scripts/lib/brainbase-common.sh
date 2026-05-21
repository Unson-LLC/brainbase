#!/bin/bash
# brainbase-common.sh - Shared utility functions for brainbase shell scripts
# Usage: source "$(dirname "$0")/lib/brainbase-common.sh"

# cwd refresh: prevent EPERM uv_cwd on unmounted/remounted drives.
# cd . ではinodeが壊れている場合にcwdを修復できないため、絶対パスにcdする。
cd "${WORKTREE_PATH:-${PWD:-/tmp}}" 2>/dev/null || cd /tmp

# Resolve the brainbase server port by checking (in order):
# 1. BRAINBASE_PORT env var
# 2. ~/.brainbase/active-port file
# 3. ~/.brainbase-port fallback file
# 4. Auto-detect on common ports (31013, 31014)
# 5. BRAINBASE_FALLBACK_PORT or 31013
resolve_brainbase_port() {
  if [ -n "$BRAINBASE_PORT" ]; then
    if curl -s --max-time 0.3 "http://localhost:$BRAINBASE_PORT/api/version" >/dev/null 2>&1; then
      echo "$BRAINBASE_PORT"
      return
    fi
  fi

  local port_file="${BRAINBASE_PORT_FILE:-$HOME/.brainbase/active-port}"
  local port=""

  if [ -f "$port_file" ]; then
    port="$(tr -d '[:space:]' < "$port_file")"
    if [ -n "$port" ] && curl -s --max-time 0.3 "http://localhost:$port/api/version" >/dev/null 2>&1; then
      echo "$port"
      return
    fi
  fi

  local fallback_file="$HOME/.brainbase-port"
  if [ -f "$fallback_file" ]; then
    port="$(tr -d '[:space:]' < "$fallback_file")"
    if [ -n "$port" ] && curl -s --max-time 0.3 "http://localhost:$port/api/version" >/dev/null 2>&1; then
      echo "$port"
      return
    fi
  fi

  for port in 31013 31014; do
    if curl -s --max-time 0.3 "http://localhost:$port/api/version" >/dev/null 2>&1; then
      echo "$port"
      return
    fi
  done

  echo "${BRAINBASE_FALLBACK_PORT:-31013}"
}

# Resolve BRAINBASE_SESSION_ID from tmux environment if not already set
resolve_session_id() {
  if [ -z "$BRAINBASE_SESSION_ID" ] && [ -n "$TMUX" ] && command -v tmux >/dev/null 2>&1; then
    BRAINBASE_SESSION_ID="$(tmux display-message -p '#S' 2>/dev/null)"
    export BRAINBASE_SESSION_ID
  fi
}

# Create and return a temp directory under $TMPDIR/brainbase-<name>
ensure_tmpdir() {
  local name="$1"
  local dir="${TMPDIR:-/tmp}/brainbase-${name}"
  mkdir -p "$dir" >/dev/null 2>&1 || true
  echo "$dir"
}

# Fetch a CSRF token for localhost hook/notify clients.
# The server stores tokens by X-Session-Id, so report_activity posts must use
# the same session id header that was used to fetch the token.
fetch_brainbase_csrf_token() {
  local port="$1"
  local session_id="${2:-${BRAINBASE_SESSION_ID:-default}}"
  local response=""

  if ! command -v curl >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
    return 1
  fi

  response="$(curl -sS --max-time 1 \
    -H "X-Session-Id: ${session_id}" \
    "http://localhost:${port}/api/csrf-token" 2>/dev/null || true)"
  if [ -z "$response" ]; then
    return 1
  fi

  CSRF_RESPONSE="$response" python3 - <<'PY'
import json
import os
import sys

try:
    data = json.loads(os.environ.get("CSRF_RESPONSE", ""))
except Exception:
    sys.exit(1)

token = data.get("token") or data.get("csrfToken")
if not isinstance(token, str) or not token:
    sys.exit(1)
print(token)
PY
}

post_brainbase_activity_json() {
  local port="$1"
  local payload_json="$2"
  local session_id="${BRAINBASE_SESSION_ID:-default}"
  local csrf_token=""

  csrf_token="$(fetch_brainbase_csrf_token "$port" "$session_id" 2>/dev/null || true)"

  if [ -n "$csrf_token" ]; then
    curl -X POST "http://localhost:${port}/api/sessions/report_activity" \
      -H "Content-Type: application/json" \
      -H "X-Session-Id: ${session_id}" \
      -H "X-CSRF-Token: ${csrf_token}" \
      -d "$payload_json" \
      --max-time 1 >/dev/null 2>&1 || true
    return 0
  fi

  curl -X POST "http://localhost:${port}/api/sessions/report_activity" \
    -H "Content-Type: application/json" \
    -H "X-Session-Id: ${session_id}" \
    -d "$payload_json" \
    --max-time 1 >/dev/null 2>&1 || true
}

# Mark a Brainbase-created worktree as trusted for Codex before launching it.
# Codex prompts on first entry to a new worktree; that blocks Brainbase session
# startup. Appending a project trust entry keeps the security decision explicit
# while avoiding a per-session interactive prompt.
ensure_codex_workspace_trusted() {
  local workspace_path="$1"

  if [ -z "$workspace_path" ] || [ ! -d "$workspace_path" ]; then
    return 0
  fi
  if [ -z "$HOME" ] || ! command -v python3 >/dev/null 2>&1; then
    return 0
  fi

  CODEX_TRUST_WORKSPACE_PATH="$workspace_path" python3 - <<'PY'
import os
from pathlib import Path

workspace_path = os.environ.get("CODEX_TRUST_WORKSPACE_PATH", "")
home = os.environ.get("HOME", "")
if not workspace_path or not home:
    raise SystemExit(0)

try:
    workspace_path = os.path.realpath(workspace_path)
except OSError:
    raise SystemExit(0)

config_dir = Path(home) / ".codex"
config_path = config_dir / "config.toml"
config_dir.mkdir(parents=True, exist_ok=True)

try:
    text = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
except OSError:
    raise SystemExit(0)

escaped_path = workspace_path.replace("\\", "\\\\").replace('"', '\\"')
header = f'[projects."{escaped_path}"]'
if header in text:
    raise SystemExit(0)

prefix = "\n" if text and not text.endswith("\n") else ""
entry = f'{prefix}\n{header}\ntrust_level = "trusted"\n'

try:
    with config_path.open("a", encoding="utf-8") as f:
        f.write(entry)
except OSError:
    raise SystemExit(0)
PY
}
