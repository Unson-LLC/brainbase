#!/bin/bash
if [ -n "$BRAINBASE_SESSION_ID" ]; then
  curl -X POST http://localhost:3000/api/sessions/report_activity        -H "Content-Type: application/json"        -d "{\"sessionId\": \"$BRAINBASE_SESSION_ID\", \"status\": \"working\"}"        --max-time 1 >/dev/null 2>&1 || true &
fi
