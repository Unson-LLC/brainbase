#!/bin/zsh
# Codex notify hook: report "done" then play a short sound on completion (macOS).

if [ -n "$BRAINBASE_SESSION_ID" ] && command -v curl >/dev/null 2>&1; then
  REPORTED_AT=$(($(date +%s) * 1000))
  curl -X POST http://localhost:3000/api/sessions/report_activity \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\": \"$BRAINBASE_SESSION_ID\", \"status\": \"done\", \"reportedAt\": $REPORTED_AT}" \
    --max-time 1 >/dev/null 2>&1 || true &
fi

if [ -x /usr/bin/afplay ]; then
  /usr/bin/afplay /System/Library/Sounds/Glass.aiff >/dev/null 2>&1
elif [ -x /usr/bin/say ]; then
  /usr/bin/say "done" >/dev/null 2>&1
fi
