#!/bin/bash
# Codex UserPromptSubmit reminder: inject the Brainbase capability map entrypoint.

set -euo pipefail

# Drain stdin so Codex can pass the normal hook payload without blocking this hook.
cat >/dev/null 2>&1 || true

python3 - <<'PY'
import json

context = (
    "Brainbase capability reminder: If the request touches Brainbase capabilities, "
    "UI/API/code/data ownership, project/session creation, auth grants, port 31013 "
    "runtime, xterm/terminal transport, visibility issues, verification, or recovery, "
    "first use the brainbase-capability-map entrypoint. Read "
    "docs/brainbase-capabilities/README.md, then the smallest relevant file under "
    "docs/brainbase-capabilities/capabilities/, and cite the file/API/process/log used "
    "when claiming the capability is working."
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
