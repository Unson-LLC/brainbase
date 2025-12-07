#!/bin/bash
echo "[$(date)] notify-stop.sh called, BRAINBASE_SESSION_ID=$BRAINBASE_SESSION_ID" >> /tmp/hook-debug.log
if [ -n "$BRAINBASE_SESSION_ID" ]; then
  curl -X POST http://localhost:3000/api/sessions/report_activity \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\": \"$BRAINBASE_SESSION_ID\", \"status\": \"done\"}" \
    --max-time 1 >> /tmp/hook-debug.log 2>&1 || true &
fi
