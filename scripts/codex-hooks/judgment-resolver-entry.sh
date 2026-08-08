#!/bin/bash
# Codex UserPromptSubmit entrypoint: require one Judgment Resolver call per turn.

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

turn_id = data.get("turn_id") or data.get("turnId") or ""
session_id = data.get("session_id") or data.get("sessionId") or ""
cwd = data.get("cwd") or ""

anchor = json.dumps({
    "turn_id": str(turn_id),
    "session_id": str(session_id),
    "cwd": str(cwd),
}, ensure_ascii=False, separators=(",", ":"))

context = (
    "Brainbase Judgment Resolver mandatory Codex turn contract. "
    "Before answering the user or invoking any other tool, call "
    "mcp__brainbase__brainbase_judgment_resolve exactly once for this current turn. "
    f"Use this hook-owned turn anchor: {anchor}. "
    "Use the current user message as request. Propose intent, domains, action_kind, risk, "
    "confidence, and only context-supported signals; on a follow-up include only the prior "
    "conversation context necessary to preserve its meaning. Then execute only the returned "
    "active_node_definitions in active_edges order, not the entire judgment library. "
    "A managed receipt constrains judgment but never authorizes write or external action. "
    "If the tool, binding, or receipt is unavailable, explicitly report unmanaged; continue "
    "only with read-only explanation or diagnosis and do not perform write/external actions."
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
