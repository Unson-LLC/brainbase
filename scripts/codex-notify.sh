#!/bin/zsh
# Codex notify hook: report status updates then play a short sound on completion (macOS).

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

should_auto_handover() {
  # Opt-in to avoid surprise token usage (auto-handover calls `claude -p` when available).
  case "${BRAINBASE_AUTO_HANDOVER:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

schedule_auto_handover() {
  if ! should_auto_handover; then
    return 0
  fi

  local delay="${BRAINBASE_AUTO_HANDOVER_DELAY_SEC:-90}"
  case "$delay" in
    ''|*[!0-9]*) delay=90 ;;
  esac

  local self="${BASH_SOURCE[0]:-$0}"
  local script_dir repo_root hook
  script_dir="$(cd "$(dirname "$self")" && pwd)"
  repo_root="$(cd "$script_dir/.." && pwd)"
  hook="$repo_root/.claude/hooks/auto-handover.sh"

  if [ ! -f "$hook" ]; then
    return 0
  fi

  local key="${BRAINBASE_SESSION_ID:-$repo_root}"
  local state_dir="${TMPDIR:-/tmp}/brainbase-auto-handover"
  mkdir -p "$state_dir" >/dev/null 2>&1 || true

  local key_hash=""
  if command -v python3 >/dev/null 2>&1; then
    key_hash="$(python3 - "$key" <<'PY'
import hashlib
import sys

s = sys.argv[1].encode("utf-8", errors="replace")
sys.stdout.write(hashlib.sha1(s).hexdigest())
PY
)" || key_hash=""
  fi

  if [ -z "$key_hash" ]; then
    # Fallback: sanitize key into a safe-ish filename.
    key_hash="$(printf '%s' "$key" | tr '/: ' '___' | tr -cd 'A-Za-z0-9_.-' | cut -c1-60)"
  fi

  local stamp_file="${state_dir}/${key_hash}.last"
  local stamp
  stamp="$(date +%s)"
  printf '%s' "$stamp" > "$stamp_file" 2>/dev/null || true

  (
    local start="$stamp"
    sleep "$delay"
    local latest=""
    latest="$(cat "$stamp_file" 2>/dev/null || true)"
    if [ -n "$latest" ] && [ "$latest" = "$start" ]; then
      ( cd "$repo_root" && bash "$hook" ) >/dev/null 2>&1 || true
    fi
  ) >/dev/null 2>&1 &
}

event_type=""
is_done_event=false

# If missing, derive session id from tmux session name
if [ -z "$BRAINBASE_SESSION_ID" ] && [ -n "$TMUX" ] && command -v tmux >/dev/null 2>&1; then
  BRAINBASE_SESSION_ID="$(tmux display-message -p '#S' 2>/dev/null)"
  export BRAINBASE_SESSION_ID
fi

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
    print("\t\t")
    sys.exit(0)
try:
    data = json.loads(s)
except Exception:
    print("\t\t")
    sys.exit(0)

print(f"{data.get('type', '')}\t{data.get('turn-id', '')}\t{data.get('thread-id', '')}")
PY
)"

  event_type="${parsed%%$'\t'*}"
  rest="${parsed#*$'\t'}"
  turn_id="${rest%%$'\t'*}"
  if [ "$turn_id" = "$rest" ]; then
    turn_id=""
  fi
  thread_id="${rest#*$'\t'}"
  if [ "$thread_id" = "$rest" ]; then
    thread_id=""
  fi

  # Keep Codex thread id in tmux session env for status-right.
  if [ -n "$thread_id" ] && [ -n "$BRAINBASE_SESSION_ID" ] && command -v tmux >/dev/null 2>&1; then
    tmux set-environment -t "$BRAINBASE_SESSION_ID" CODEX_THREAD_ID "$thread_id" >/dev/null 2>&1 || true
  fi

  PORT="$(resolve_brainbase_port)"
  REPORTED_AT=$(($(date +%s) * 1000))
  TURN_STATE_DIR="${TMPDIR:-/tmp}/brainbase-codex-turns"
  TURN_STATE_FILE=""
  if [ -n "$turn_id" ]; then
    mkdir -p "$TURN_STATE_DIR" >/dev/null 2>&1 || true
    TURN_STATE_FILE="${TURN_STATE_DIR}/${turn_id}.start"
  fi

  if [ "$event_type" = "agent-turn-start" ] || [ "$event_type" = "agent-turn-begin" ]; then
    if [ -n "$TURN_STATE_FILE" ]; then
      echo "$REPORTED_AT" > "$TURN_STATE_FILE" 2>/dev/null || true
    fi
    curl -X POST "http://localhost:${PORT}/api/sessions/report_activity" \
      -H "Content-Type: application/json" \
      -d "{\"sessionId\": \"$BRAINBASE_SESSION_ID\", \"status\": \"working\", \"reportedAt\": $REPORTED_AT}" \
      --max-time 1 >/dev/null 2>&1 || true &
  fi

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

if [ "$is_done_event" = true ]; then
  schedule_auto_handover
fi

if [ "$is_done_event" = true ] && [ -x /usr/bin/afplay ]; then
  /usr/bin/afplay /System/Library/Sounds/Glass.aiff >/dev/null 2>&1
elif [ "$is_done_event" = true ] && [ -x /usr/bin/say ]; then
  /usr/bin/say "done" >/dev/null 2>&1
fi
