#!/bin/bash
# Codex UserPromptSubmit reminder: route Brainbase work to the repo-native capability map.

set -euo pipefail

payload="${1:-}"
if [ -z "$payload" ]; then
  payload="$(cat || true)"
fi

PAYLOAD="$payload" python3 - <<'PY'
import json
import os
import sys

try:
    data = json.loads(os.environ.get("PAYLOAD", "") or "{}")
except Exception:
    data = {}

event_name = data.get("hook_event_name") or data.get("hookEventName") or "UserPromptSubmit"
if event_name != "UserPromptSubmit":
    sys.exit(0)

message = (
    "Brainbase reminders: use brainbase-capability-map before answering or changing Brainbase capabilities. "
    "For development workflow, read docs/brainbase-capabilities/capabilities/development.workflow.yml and start with `jj status` + `jj diff --stat`; "
    "`git status` is only a secondary compatibility view."
)

print(json.dumps({
    "continue": True,
    "systemMessage": message,
    "suppressOutput": True,
}, ensure_ascii=False))
PY
