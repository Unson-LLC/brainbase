#!/bin/bash
# Codex hooks activity bridge: translate Codex lifecycle hooks to brainbase session activity.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/brainbase-common.sh"

resolve_session_id

payload="${1:-}"
if [ -z "$payload" ]; then
  payload="$(cat || true)"
fi

if [ -z "$payload" ]; then
  exit 0
fi

event_name="$(
  PAYLOAD="$payload" python3 - <<'PY'
import json
import os

try:
    data = json.loads(os.environ.get("PAYLOAD", "") or "{}")
except Exception:
    data = {}

print(data.get("hook_event_name") or data.get("hookEventName") or "")
PY
)" || event_name=""

capability_context_json=""
if [ "$event_name" = "UserPromptSubmit" ]; then
  capability_context_json="$(
    python3 - <<'PY'
import json

context = (
    "Brainbaseケイパビリティ確認リマインダー: Brainbaseの機能、UI/API/コード/データの責務、"
    "プロジェクト/セッション作成、auth grant、31013 runtime、xterm/terminal transport、"
    "表示されない/動かない問題、検証、復旧に触れる依頼では、まずbrainbase-capability-mapを入口にする。"
    "docs/brainbase-capabilities/README.mdを読み、次にdocs/brainbase-capabilities/capabilities/配下の"
    "最小の関連ファイルを確認する。機能が動いていると主張するときは、確認に使ったファイル/API/プロセス/ログを明示する。"
)

print(json.dumps({
    "continue": True,
    "hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": context,
    },
    "suppressOutput": True,
}, ensure_ascii=False))
PY
  )" || capability_context_json=""
fi

payload_json=""
if [ -n "${BRAINBASE_SESSION_ID:-}" ] && command -v curl >/dev/null 2>&1; then
  PORT="$(resolve_brainbase_port)"
  REPORTED_AT=$(($(date +%s) * 1000))

  payload_json="$(
    PAYLOAD="$payload" BRAINBASE_SESSION_ID="$BRAINBASE_SESSION_ID" REPORTED_AT="$REPORTED_AT" python3 - <<'PY'
import json
import os
import re
import sys

def sanitize(value, max_len=160):
    if not isinstance(value, str):
        return ""
    value = re.sub(r"\s+", " ", value).strip()
    if len(value) <= max_len:
        return value
    return value[: max_len - 1] + "…"

try:
    data = json.loads(os.environ.get("PAYLOAD", ""))
except Exception:
    sys.exit(0)

session_id = os.environ.get("BRAINBASE_SESSION_ID", "").strip()
reported_at = int(os.environ.get("REPORTED_AT", "0") or "0")
event_name = sanitize(data.get("hook_event_name") or data.get("hookEventName"), 60)
turn_id = sanitize(data.get("turn_id") or data.get("turnId"), 120)
tool_name = sanitize(data.get("tool_name") or data.get("toolName"), 80)
prompt = sanitize(data.get("prompt"), 120)
assistant = sanitize(data.get("last_assistant_message") or data.get("lastAssistantMessage"), 120)

tool_input = data.get("tool_input") or data.get("toolInput") or {}
tool_response = data.get("tool_response") or data.get("toolResponse") or {}

command = ""
if isinstance(tool_input, dict):
    command = sanitize(tool_input.get("command"), 120)

evidence = command or tool_name or assistant or prompt

report = None

if event_name == "SessionStart":
    report = {
        "status": "done",
        "lifecycle": "turn_completed",
        "eventType": f"codex/hook/{event_name}",
        "activityKind": "waiting_input",
        "currentStep": "入力待ち",
    }
elif event_name == "UserPromptSubmit":
    report = {
        "status": "working",
        "lifecycle": "turn_started",
        "eventType": f"codex/hook/{event_name}",
        "turnId": turn_id,
        "activityKind": "task_started",
        "currentStep": "依頼を受けて作業開始",
        "latestEvidence": prompt,
    }
elif event_name == "PreToolUse":
    step = "コマンドを実行中" if tool_name == "Bash" or command else "ツールを実行中"
    kind = "running_command" if tool_name == "Bash" or command else "working"
    report = {
        "status": "working",
        "lifecycle": "heartbeat",
        "eventType": f"codex/hook/{event_name}",
        "turnId": turn_id,
        "activityKind": kind,
        "currentStep": step,
        "latestEvidence": evidence,
    }
elif event_name == "PostToolUse":
    step = "コマンド結果を確認中" if tool_name == "Bash" or command else "ツール結果を確認中"
    kind = "running_command" if tool_name == "Bash" or command else "working"
    if isinstance(tool_response, dict):
        evidence = sanitize(tool_response.get("stdout") or tool_response.get("stderr") or evidence, 120)
    report = {
        "status": "working",
        "lifecycle": "heartbeat",
        "eventType": f"codex/hook/{event_name}",
        "turnId": turn_id,
        "activityKind": kind,
        "currentStep": step,
        "latestEvidence": evidence,
    }
elif event_name == "Stop":
    report = {
        "status": "done",
        "lifecycle": "turn_completed",
        "eventType": f"codex/hook/{event_name}",
        "turnId": turn_id,
        "activityKind": "task_completed",
        "currentStep": "作業が一区切り完了",
        "assistantSnippet": assistant,
    }
else:
    sys.exit(0)

if not report or not session_id:
    sys.exit(0)

output = {
    "sessionId": session_id,
    "status": report.pop("status"),
    "reportedAt": reported_at,
}
for key, value in report.items():
    if isinstance(value, str):
        value = " ".join(value.split())
    if value:
        output[key] = value

print(json.dumps(output, ensure_ascii=False))
PY
  )" || payload_json=""
fi

if [ -n "$payload_json" ]; then
  post_brainbase_activity_json "$PORT" "$payload_json" >/dev/null 2>&1 || true
fi

if [ -n "$capability_context_json" ]; then
  printf '%s\n' "$capability_context_json"
fi
