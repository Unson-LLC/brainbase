#!/bin/bash

# セッションステータス報告
if [ -n "$BRAINBASE_SESSION_ID" ]; then
  curl -X POST http://localhost:3000/api/sessions/report_activity \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\": \"$BRAINBASE_SESSION_ID\", \"status\": \"working\"}" \
    --max-time 1 >/dev/null 2>&1 || true &
fi

# Inbox未読件数の通知
INBOX_FILE="/Users/ksato/workspace/_inbox/pending.md"
if [ -f "$INBOX_FILE" ]; then
  PENDING_COUNT=$(grep -c "^status: pending$" "$INBOX_FILE" 2>/dev/null || echo "0")
  if [ "$PENDING_COUNT" -gt 0 ]; then
    echo "📬 未対応Slackメンション: ${PENDING_COUNT}件 (_inbox/pending.md)"
  fi
fi
