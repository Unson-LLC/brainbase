#!/bin/bash

# Codex start wrapper: send a lightweight heartbeat before exec codex.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/brainbase-common.sh"

resolve_session_id

if [ -n "$BRAINBASE_SESSION_ID" ] && command -v curl >/dev/null 2>&1; then
  PORT="$(resolve_brainbase_port)"
  REPORTED_AT=$(($(date +%s) * 1000))
  curl -X POST "http://localhost:${PORT}/api/sessions/report_activity" \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\": \"$BRAINBASE_SESSION_ID\", \"status\": \"working\", \"reportedAt\": $REPORTED_AT, \"lifecycle\": \"heartbeat\", \"eventType\": \"codex-wrapper-start\"}" \
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
