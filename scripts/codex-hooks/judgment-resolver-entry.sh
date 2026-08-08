#!/bin/bash
# Codex UserPromptSubmit entrypoint: require one Judgment Resolver call per turn.

set -euo pipefail

payload="${1:-}"
if [ -z "$payload" ]; then
  payload="$(cat || true)"
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
manifest_path="$script_dir/../../config/judgment-runtime-manifest.json"

PAYLOAD="$payload" MANIFEST_PATH="$manifest_path" python3 - <<'PY'
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

with open(os.environ["MANIFEST_PATH"], encoding="utf-8") as manifest_file:
    manifest = json.load(manifest_file)
semantic_matchers = manifest["semantic_matchers"]
matcher_contract = json.dumps({
    "domains": semantic_matchers["domains"],
    "signals": semantic_matchers["signals"],
    "safe_general": semantic_matchers["safe_general"],
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
    "values. Domain and signal support is lexical and server-owned, not broad conceptual inference. "
    "Include a non-general domain or signal only when the current request plus explicitly supplied "
    "conversation_context contains one of its matcher strings from this exact runtime map: "
    f"{matcher_contract}. Every proposed domain and signal must have a matching term; omit inferred "
    "extras. Include every matched domain and signal, but use general alone only when a safe_general "
    "term matches and no domain or signal term matches. Generic ideas such as judgment, approval, "
    "user preference, or authority do not select personal_judgment or organization unless an exact "
    "listed domain matcher is present; an exact authority signal selects authority_boundary instead. "
    "Validate the complete argument object against the tool schema before calling. "
    "Propose only context-supported classification values and "
    "signals; on a follow-up include only the prior conversation context necessary to preserve its "
    "meaning. Then execute only the returned "
    "active_node_definitions in active_edges order, not the entire judgment library. "
    "A managed receipt constrains judgment but never authorizes write or external action. "
    "Managed or resolved status alone is not a stop condition. "
    "An answer-only design request is context-complete when its goal and constraints are explicit, "
    "required_capabilities and unresolved are empty, and the selected node instructions directly "
    "determine the answer. For a context-complete request, treat the receipt as the project judgment "
    "context and answer without loading project workflow skills, repo files, or memory merely because "
    "a project name appears. Retrieve more context only when the user explicitly requests current "
    "repository or history evidence, or an active node, required capability, or unresolved item requires it. "
    "When selected nodes and required capabilities are complete, the user's requested answer or "
    "work is complete, and no unresolved item remains, emit the completed final response immediately. "
    "Do not begin self-initiated repo, memory, search, shell, or additional-tool exploration afterward. "
    "Continue while an active node, required capability, or explicitly requested investigation, "
    "implementation, or operation remains unfinished. "
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
