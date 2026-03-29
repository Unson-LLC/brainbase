#!/bin/bash
# brainbase-common.sh - Shared utility functions for brainbase shell scripts
# Usage: source "$(dirname "$0")/lib/brainbase-common.sh"

# Resolve the brainbase server port by checking (in order):
# 1. BRAINBASE_PORT env var
# 2. ~/.brainbase/active-port file
# 3. ~/.brainbase-port fallback file
# 4. Auto-detect on common ports (31014, 31013)
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

  for port in 31014 31013; do
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
