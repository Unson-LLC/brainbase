#!/bin/bash

# Codex start wrapper: report "working" then exec codex.

resolve_brainbase_port() {
  if [ -n "$BRAINBASE_PORT" ]; then
    echo "$BRAINBASE_PORT"
    return
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

  for port in 3001 3000; do
    if curl -s --max-time 0.3 "http://localhost:$port/api/version" >/dev/null 2>&1; then
      echo "$port"
      return
    fi
  done

  echo "${BRAINBASE_FALLBACK_PORT:-3000}"
}

if [ -n "$BRAINBASE_SESSION_ID" ] && command -v curl >/dev/null 2>&1; then
  PORT="$(resolve_brainbase_port)"
  REPORTED_AT=$(($(date +%s) * 1000))
  curl -X POST "http://localhost:${PORT}/api/sessions/report_activity" \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\": \"$BRAINBASE_SESSION_ID\", \"status\": \"working\", \"reportedAt\": $REPORTED_AT}" \
    --max-time 1 >/dev/null 2>&1 || true &
fi

exec codex "$@"
