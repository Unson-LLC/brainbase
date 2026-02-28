#!/bin/bash

# Codex start wrapper: report "working" then exec codex.

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

# If missing, derive session id from tmux session name
if [ -z "$BRAINBASE_SESSION_ID" ] && [ -n "$TMUX" ] && command -v tmux >/dev/null 2>&1; then
  BRAINBASE_SESSION_ID="$(tmux display-message -p '#S' 2>/dev/null)"
  export BRAINBASE_SESSION_ID
fi

if [ -n "$BRAINBASE_SESSION_ID" ] && command -v curl >/dev/null 2>&1; then
  PORT="$(resolve_brainbase_port)"
  REPORTED_AT=$(($(date +%s) * 1000))
  curl -X POST "http://localhost:${PORT}/api/sessions/report_activity" \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\": \"$BRAINBASE_SESSION_ID\", \"status\": \"working\", \"reportedAt\": $REPORTED_AT}" \
    --max-time 1 >/dev/null 2>&1 || true &
fi

# Clean up codex temporary update directories (prevents ENOTEMPTY errors)
if [ -n "$NVM_DIR" ] && [ -d "$NVM_DIR/versions/node" ]; then
  for node_version in "$NVM_DIR/versions/node"/v*/lib/node_modules/@openai; do
    if [ -d "$node_version" ]; then
      rm -rf "$node_version"/.codex-* 2>/dev/null || true
    fi
  done
fi

exec codex "$@"
