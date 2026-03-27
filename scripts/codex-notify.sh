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

build_report_payload() {
  local report_status="$1"
  local report_at="$2"
  local report_lifecycle="$3"
  local report_event_type="$4"
  local report_turn_id="$5"
  local report_activity_kind="$6"
  local report_task_brief="$7"
  local report_current_step="$8"
  local report_latest_evidence="$9"
  local report_assistant_snippet="${10}"

  REPORT_STATUS="$report_status" \
  REPORT_REPORTED_AT="$report_at" \
  REPORT_LIFECYCLE="$report_lifecycle" \
  REPORT_EVENT_TYPE="$report_event_type" \
  REPORT_TURN_ID="$report_turn_id" \
  REPORT_ACTIVITY_KIND="$report_activity_kind" \
  REPORT_TASK_BRIEF="$report_task_brief" \
  REPORT_CURRENT_STEP="$report_current_step" \
  REPORT_LATEST_EVIDENCE="$report_latest_evidence" \
  REPORT_ASSISTANT_SNIPPET="$report_assistant_snippet" \
  BRAINBASE_SESSION_ID="$BRAINBASE_SESSION_ID" \
  python3 - <<'PY'
import json
import os

def clean(name):
    value = os.environ.get(name, "")
    value = " ".join(value.split())
    return value or None

payload = {
    "sessionId": os.environ["BRAINBASE_SESSION_ID"],
    "status": os.environ["REPORT_STATUS"],
    "reportedAt": int(os.environ["REPORT_REPORTED_AT"] or "0"),
}

optional_fields = {
    "lifecycle": clean("REPORT_LIFECYCLE"),
    "eventType": clean("REPORT_EVENT_TYPE"),
    "turnId": clean("REPORT_TURN_ID"),
    "activityKind": clean("REPORT_ACTIVITY_KIND"),
    "taskBrief": clean("REPORT_TASK_BRIEF"),
    "assistantSnippet": clean("REPORT_ASSISTANT_SNIPPET"),
    "currentStep": clean("REPORT_CURRENT_STEP"),
    "latestEvidence": clean("REPORT_LATEST_EVIDENCE"),
}

for key, value in optional_fields.items():
    if value:
        payload[key] = value

print(json.dumps(payload, ensure_ascii=False))
PY
}

post_activity_report() {
  local port="$1"
  local report_status="$2"
  local report_at="$3"
  local report_lifecycle="$4"
  local report_event_type="$5"
  local report_turn_id="$6"
  local report_activity_kind="$7"
  local report_task_brief="$8"
  local report_current_step="$9"
  local report_latest_evidence="${10}"
  local report_assistant_snippet="${11}"
  local payload_json=""

  payload_json="$(build_report_payload "$report_status" "$report_at" "$report_lifecycle" "$report_event_type" "$report_turn_id" "$report_activity_kind" "$report_task_brief" "$report_current_step" "$report_latest_evidence" "$report_assistant_snippet")"
  curl -X POST "http://localhost:${port}/api/sessions/report_activity" \
    -H "Content-Type: application/json" \
    -d "$payload_json" \
    --max-time 1 >/dev/null 2>&1 || true &
}

derive_activity_fields() {
  local raw_payload="$1"
  local raw_event_type="$2"

  PAYLOAD="$raw_payload" EVENT_TYPE="$raw_event_type" python3 - <<'PY'
import json
import os
import re
import sys

payload = os.environ.get("PAYLOAD", "")
event_type = os.environ.get("EVENT_TYPE", "")

def sanitize(value, max_len=120):
    if not isinstance(value, str):
        return ""
    value = re.sub(r"\s+", " ", value).strip()
    if len(value) <= max_len:
        return value
    return value[: max_len - 1] + "…"

def is_japanese_text(value):
    return isinstance(value, str) and bool(re.search(r"[\u3040-\u30ff\u3400-\u9fff]", value))

def load_json(value):
    value = (value or "").strip()
    if not value:
        return {}
    try:
        return json.loads(value)
    except Exception:
        return {}

def first_string(*values):
    for value in values:
        if isinstance(value, str) and value.strip():
            return sanitize(value)
    return ""

def get_nested(obj, *path):
    current = obj
    for key in path:
        if not isinstance(current, dict):
            return ""
        current = current.get(key)
    return current

def extract_text(node):
    if isinstance(node, str):
        return sanitize(node)
    if isinstance(node, dict):
        for key in ("text", "delta", "stdout", "stderr", "message", "summary"):
            value = node.get(key)
            if isinstance(value, str) and value.strip():
                return sanitize(value)
            if isinstance(value, dict):
                nested = extract_text(value)
                if nested:
                    return nested
        content = node.get("content")
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict):
                    text = item.get("text")
                    if isinstance(text, str) and text.strip():
                        parts.append(text)
            if parts:
                return sanitize(" ".join(parts))
    return ""

data = load_json(payload)
kind = ""
step = ""
evidence = ""
assistant_snippet = ""

if event_type == "item/fileChange/outputDelta":
    kind = "editing_file"
    step = "ファイルを更新中"
    evidence = first_string(
        get_nested(data, "params", "item", "path"),
        get_nested(data, "params", "path"),
        get_nested(data, "item", "path"),
        get_nested(data, "path"),
        extract_text(data),
    )
elif event_type in {"item/commandExecution/outputDelta", "exec_command_output_delta"}:
    kind = "running_command"
    step = "コマンドを実行中"
    evidence = first_string(
        get_nested(data, "params", "item", "command"),
        get_nested(data, "params", "command"),
        get_nested(data, "item", "command"),
        get_nested(data, "command"),
        extract_text(data),
    )
elif event_type in {
    "assistant-message",
    "assistant-response",
    "assistant-message-complete",
    "assistant-response-complete",
    "item/agentMessage/delta",
    "item/assistantMessage/delta",
    "agent_message_delta",
}:
    kind = "reasoning"
    assistant_snippet = extract_text(data)
    step = assistant_snippet if is_japanese_text(assistant_snippet) else ""
    evidence = ""
elif event_type in {
    "user-input-requested",
    "user_input_requested",
    "request-user-input",
    "request_input",
    "waiting-for-user-input",
    "waiting_for_user_input",
}:
    kind = "waiting_input"
    step = "入力待ち"
elif event_type in {"agent-turn-start", "agent-turn-begin", "turn/started", "task_started"}:
    kind = "task_started"
    step = "依頼を受けて作業開始"
elif event_type in {"agent-turn-complete", "task_complete", "codex/event/task_complete", "turn/completed"}:
    kind = "task_completed"
    step = "作業が一区切り完了"
else:
    kind = "working"
    step = "作業中"
    evidence = extract_text(data)

assistant_snippet = sanitize(assistant_snippet, 120) if is_japanese_text(assistant_snippet) else ""
print(f"{sanitize(kind, 40)}\t{sanitize(step, 80)}\t{sanitize(evidence, 120)}\t{assistant_snippet}")
PY
}

event_type=""
is_done_event=false
lifecycle=""

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
    print("\t\t\t0")
    sys.exit(0)
try:
    data = json.loads(s)
except Exception:
    print("\t\t\t0")
    sys.exit(0)

def first_string(*values):
    for value in values:
        if isinstance(value, str) and value:
            return value
    return ''

def get_nested(obj, *path):
    current = obj
    for key in path:
        if not isinstance(current, dict):
            return ''
        current = current.get(key)
    return current if isinstance(current, str) else ''

def contains_commit_command(value):
    if isinstance(value, str):
        return "/commit" in value
    if isinstance(value, dict):
        return any(contains_commit_command(v) for v in value.values())
    if isinstance(value, list):
        return any(contains_commit_command(v) for v in value)
    return False

event_type = first_string(
    data.get('type'),
    data.get('method'),
    get_nested(data, 'event', 'type'),
    get_nested(data, 'notification', 'type'),
    get_nested(data, 'params', 'type'),
    get_nested(data, 'params', 'method')
)
turn_id = first_string(
    data.get('turn-id'),
    data.get('turnId'),
    get_nested(data, 'turn', 'id'),
    get_nested(data, 'params', 'turnId'),
    get_nested(data, 'params', 'turn', 'id')
)
thread_id = first_string(
    data.get('thread-id'),
    data.get('threadId'),
    get_nested(data, 'thread', 'id'),
    get_nested(data, 'params', 'threadId'),
    get_nested(data, 'params', 'thread', 'id')
)
print(f"{event_type}\t{turn_id}\t{thread_id}\t{1 if contains_commit_command(data) else 0}")
PY
)"

  event_type=""
  turn_id=""
  thread_id=""
  is_commit_event="0"
  IFS=$'\t' read -r event_type turn_id thread_id is_commit_event <<< "$parsed"
  if [ -z "$is_commit_event" ]; then
    is_commit_event="0"
  fi
  activity_kind=""
  current_step=""
  latest_evidence=""
  assistant_snippet=""
  IFS=$'\t' read -r activity_kind current_step latest_evidence assistant_snippet <<< "$(derive_activity_fields "$payload" "$event_type")"

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

  case "$event_type" in
    agent-turn-start|agent-turn-begin|turn/started|task_started)
    lifecycle="turn_started"
    if [ -n "$TURN_STATE_FILE" ]; then
      echo "$REPORTED_AT" > "$TURN_STATE_FILE" 2>/dev/null || true
    fi
    post_activity_report "$PORT" "working" "$REPORTED_AT" "$lifecycle" "$event_type" "$turn_id" "$activity_kind" "" "$current_step" "$latest_evidence" "$assistant_snippet"
    ;;
  esac

  COMMIT_STATE_DIR="${TMPDIR:-/tmp}/brainbase-codex-commit"
  COMMIT_STATE_FILE="${COMMIT_STATE_DIR}/${BRAINBASE_SESSION_ID}.pending"
  mkdir -p "$COMMIT_STATE_DIR" >/dev/null 2>&1 || true
  if [ "$is_commit_event" = "1" ]; then
    echo "$REPORTED_AT" > "$COMMIT_STATE_FILE" 2>/dev/null || true
  fi

  case "$event_type" in
    assistant-message|assistant-response|assistant-message-complete|assistant-response-complete|item/agentMessage/delta|item/assistantMessage/delta|agent_message_delta|item/commandExecution/outputDelta|exec_command_output_delta|item/fileChange/outputDelta|item/completed)
    lifecycle="heartbeat"
    if [ -z "$turn_id" ] || [ -f "$TURN_STATE_FILE" ]; then
      post_activity_report "$PORT" "working" "$REPORTED_AT" "$lifecycle" "$event_type" "$turn_id" "$activity_kind" "" "$current_step" "$latest_evidence" "$assistant_snippet"
    fi
    ;;
  esac

  case "$event_type" in
    agent-turn-complete|user-input-requested|user_input_requested|request-user-input|request_input|waiting-for-user-input|waiting_for_user_input|task_complete|codex/event/task_complete|turn/failed|turn/interrupted)
    lifecycle="turn_completed"
    is_done_event=true
    ;;
  esac

  if [ "$is_done_event" = true ]; then
    if [ -n "$TURN_STATE_FILE" ] && [ -f "$TURN_STATE_FILE" ]; then
      rm -f "$TURN_STATE_FILE" >/dev/null 2>&1 || true
    fi
    # codexはagent-turn-startを送らないため、doneの前にworkingを報告してlastWorkingAtを確保
    WORKING_AT=$(( REPORTED_AT - 1000 ))
    post_activity_report "$PORT" "working" "$WORKING_AT" "turn_started" "${event_type}-synthetic" "$turn_id" "task_started" "" "依頼を受けて作業開始" "$latest_evidence" "$assistant_snippet"
    post_activity_report "$PORT" "done" "$REPORTED_AT" "$lifecycle" "$event_type" "$turn_id" "$activity_kind" "" "$current_step" "$latest_evidence" "$assistant_snippet"

    if [ -f "$COMMIT_STATE_FILE" ]; then
      curl -X POST "http://localhost:${PORT}/api/sessions/${BRAINBASE_SESSION_ID}/commit-notify" \
        -H "Content-Type: application/json" \
        -d "{\"reportedAt\": $REPORTED_AT}" \
        --max-time 1 >/dev/null 2>&1 || true &
      rm -f "$COMMIT_STATE_FILE" >/dev/null 2>&1 || true
    fi
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
