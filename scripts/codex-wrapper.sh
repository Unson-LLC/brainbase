#!/bin/bash

# Codex start wrapper: report "working" then exec codex.

if [ -n "$BRAINBASE_SESSION_ID" ] && command -v curl >/dev/null 2>&1; then
  REPORTED_AT=$(($(date +%s) * 1000))
  curl -X POST http://localhost:3000/api/sessions/report_activity \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\": \"$BRAINBASE_SESSION_ID\", \"status\": \"working\", \"reportedAt\": $REPORTED_AT}" \
    --max-time 1 >/dev/null 2>&1 || true &
fi

exec codex "$@"
