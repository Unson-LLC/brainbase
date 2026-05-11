#!/bin/bash
# Codex PreToolUse hook: block direct push / force-update of protected branches.
#
# Mirrors scripts/lib/protected-push-guard.js logic. Triggered before any tool
# execution; for Bash tool invocations, denies the call if the command would
# bypass PR review on develop/main/master.
#
# Root cause: 14e7c58d incident on 2026-05-11 where a Codex session executed
# `git branch -f develop <ref> && git push origin develop` from the main
# brainbase repo, silently dropping html-preview routes during rebase
# conflict resolution.

set -euo pipefail

payload="${1:-}"
if [ -z "$payload" ]; then
  payload="$(cat || true)"
fi

if [ -z "$payload" ]; then
  exit 0
fi

PAYLOAD="$payload" python3 - <<'PY'
import json
import os
import re
import sys

try:
    data = json.loads(os.environ.get("PAYLOAD", ""))
except Exception:
    sys.exit(0)

tool_input = data.get("tool_input") or data.get("toolInput") or {}
command = ""
if isinstance(tool_input, dict):
    command = tool_input.get("command") or tool_input.get("cmd") or ""

if not isinstance(command, str) or not command:
    sys.exit(0)

if "BRAINBASE_ALLOW_PROTECTED_PUSH=1" in command:
    sys.exit(0)

PROTECTED = r"develop|main|master"

PATTERNS = [
    (
        rf"\bgit\s+push\b[^&|;]*?(?:^|\s)(?:{PROTECTED})(?=[\s\"'$&|;]|$)",
        "保護ブランチ (develop/main/master) への直 push は禁止です。PR を作成して merge してください。",
    ),
    (
        rf"\bgit\s+push\b[^&|;]*?:(?:{PROTECTED})(?=[\s\"'$&|;]|$)",
        "保護ブランチへの refspec push (HEAD:develop / feat/x:main 等) は禁止です。",
    ),
    (
        r"\bgit\s+push\b[^&|;]*?(?:--force\b|--force-with-lease\b|--mirror\b|(?:^|\s)-[a-zA-Z]*f[a-zA-Z]*(?=\s|$))",
        "force push 系 (--force / --force-with-lease / -f / --mirror) は禁止です。",
    ),
    (
        rf"\bgit\s+branch\s+(?:-[a-zA-Z]*[fDM][a-zA-Z]*|--force|--delete)\s+(?:{PROTECTED})\b",
        "保護ブランチの force-update / delete (git branch -f develop / -D main 等) は禁止です。",
    ),
]

for regex, reason in PATTERNS:
    if re.search(regex, command, re.MULTILINE):
        msg = (
            f"🚨 保護ブランチ違反: {reason}\n"
            f"コマンド: {command}\n"
            f"緊急時のみ `BRAINBASE_ALLOW_PROTECTED_PUSH=1` プレフィックスで override 可。\n"
            f"通常は `gh pr create` → `gh pr merge` 経由で merge してください。"
        )
        print(
            json.dumps(
                {
                    "continue": False,
                    "stopReason": msg,
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": reason,
                    },
                    "suppressOutput": False,
                },
                ensure_ascii=False,
            )
        )
        sys.exit(2)

sys.exit(0)
PY
