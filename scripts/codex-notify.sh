#!/bin/zsh
# Codex notify hook: report status updates then play a short sound on completion (macOS).

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

event_type=""

if [ -n "$BRAINBASE_SESSION_ID" ] && command -v curl >/dev/null 2>&1; then
  payload="$*"
  if [ -z "$payload" ]; then
    payload="$(cat)"
  fi

  parsed="$(PAYLOAD="$payload" python3 - <<'PY'
import json
import os
import sys

s = os.environ.get("PAYLOAD", "")
if not s:
    s = sys.stdin.read()
s = s.strip()

if not s:
    print("\t")
    sys.exit(0)
try:
    data = json.loads(s)
except Exception:
    print("\t")
    sys.exit(0)

print(f"{data.get('type', '')}\t{data.get('turn-id', '')}")
PY
)"

  event_type="${parsed%%$'\t'*}"
  turn_id="${parsed#*$'\t'}"
  if [ "$turn_id" = "$parsed" ]; then
    turn_id=""
  fi

  PORT="$(resolve_brainbase_port)"
  REPORTED_AT=$(($(date +%s) * 1000))
  TURN_STATE_DIR="${TMPDIR:-/tmp}/brainbase-codex-turns"
  TURN_STATE_FILE=""
  if [ -n "$turn_id" ]; then
    mkdir -p "$TURN_STATE_DIR" >/dev/null 2>&1 || true
    TURN_STATE_FILE="${TURN_STATE_DIR}/${turn_id}.start"
  fi

  if [ "$event_type" = "agent-turn-start" ] || [ "$event_type" = "agent-turn-begin" ] || [ "$event_type" = "user-message" ]; then
    if [ -n "$TURN_STATE_FILE" ]; then
      echo "$REPORTED_AT" > "$TURN_STATE_FILE" 2>/dev/null || true
    fi
    curl -X POST "http://localhost:${PORT}/api/sessions/report_activity" \
      -H "Content-Type: application/json" \
      -d "{\"sessionId\": \"$BRAINBASE_SESSION_ID\", \"status\": \"working\", \"reportedAt\": $REPORTED_AT}" \
      --max-time 1 >/dev/null 2>&1 || true &
  fi

  is_done_event=false
  if [ "$event_type" = "agent-turn-complete" ] || [ "$event_type" = "agent-turn-end" ] || [ "$event_type" = "assistant-message" ] || [ "$event_type" = "assistant-response" ] || [ "$event_type" = "assistant-message-complete" ] || [ "$event_type" = "assistant-response-complete" ]; then
    is_done_event=true
  fi

  if [ "$is_done_event" = true ]; then
    if [ -n "$TURN_STATE_FILE" ] && [ -f "$TURN_STATE_FILE" ]; then
      rm -f "$TURN_STATE_FILE" >/dev/null 2>&1 || true
    fi
    curl -X POST "http://localhost:${PORT}/api/sessions/report_activity" \
      -H "Content-Type: application/json" \
      -d "{\"sessionId\": \"$BRAINBASE_SESSION_ID\", \"status\": \"done\", \"reportedAt\": $REPORTED_AT}" \
      --max-time 1 >/dev/null 2>&1 || true &
  fi
fi

if [ "$is_done_event" = true ] && [ -x /usr/bin/afplay ]; then
  /usr/bin/afplay /System/Library/Sounds/Glass.aiff >/dev/null 2>&1
elif [ "$is_done_event" = true ] && [ -x /usr/bin/say ]; then
  /usr/bin/say "done" >/dev/null 2>&1
fi
