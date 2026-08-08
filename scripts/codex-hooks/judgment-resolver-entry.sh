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
anchor = json.dumps({
    "turn_id": str(turn_id),
}, ensure_ascii=False, separators=(",", ":"))

context = (
    "Brainbase Judgment Resolver mandatory Codex turn contract. "
    "Before answering the user or invoking any other tool, call "
    "mcp__brainbase__brainbase_judgment_resolve exactly once for this current turn. "
    f"Use this hook-owned turn anchor: {anchor}. "
    "Send only arguments allowed by the MCP tool schema: request, turn_id, optional project_code, "
    "classification_proposal, optional conversation_context, and optional knowledge_context. "
    "classification_proposal must be one nested object containing exactly intent, domains, "
    "action_kind, risk, confidence, and optional signals. Never send session_id, cwd, flat "
    "proposed_* fields, or any other top-level argument. Use the current user message as request, "
    "and use the hook-owned turn_id as turn_id. Classify the requested effect, not negated words: "
    "a read-only or no-action request that says not to write or act externally is none or read, "
    "never write or external for that wording alone. Use only these exact lowercase enum tokens: "
    "intent=answer|investigate|diagnose|design|implement|review|operate; "
    "domains=one or more of general|knowledge|personal_judgment|engineering|organization|operations "
    "with general used alone; action_kind=none|read|write|external; "
    "risk=low|medium|high|critical; confidence=confirmed|inferred|unknown, never a number; "
    "optional signals=cumulative_effect|complexity_growth|threshold_proposal|parallel_exploration|"
    "authority_boundary|problem_frame_uncertain|external_outcome. Never invent or translate enum "
    "values. Validate the complete argument object against the tool schema before calling. "
    "Propose only context-supported classification values and "
    "signals; on a follow-up include only the prior conversation context necessary to preserve its "
    "meaning. Then execute only the returned "
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
