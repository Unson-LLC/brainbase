#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CANONICAL_REPO_ROOT="${BRAINBASE_HOOK_REPO_ROOT:-}"
ORIGINAL_CWD="$PWD"

if [ "$#" -lt 1 ]; then
  echo "Usage: .claude/scripts/run-hook.sh <script.ts> [args...]" >&2
  exit 2
fi

HOOK_SCRIPT="$1"
shift

cd "$REPO_ROOT"
export BRAINBASE_HOOK_ORIGINAL_CWD="$ORIGINAL_CWD"

if [[ "$HOOK_SCRIPT" = /* ]]; then
  HOOK_PATH="$HOOK_SCRIPT"
else
  HOOK_PATH="$REPO_ROOT/$HOOK_SCRIPT"
fi

TOOL_ROOTS=("$REPO_ROOT")

if [ -n "$CANONICAL_REPO_ROOT" ]; then
  TOOL_ROOTS+=("$CANONICAL_REPO_ROOT")
fi

if [ -d "/Users/ksato/workspace/code/brainbase" ]; then
  TOOL_ROOTS+=("/Users/ksato/workspace/code/brainbase")
fi

if command -v git >/dev/null 2>&1 && git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  while IFS= read -r worktree_root; do
    TOOL_ROOTS+=("$worktree_root")
  done < <(git -C "$REPO_ROOT" worktree list --porcelain | awk '/^worktree / { sub(/^worktree /, ""); print }')
fi

for tool_root in "${TOOL_ROOTS[@]}"; do
  if [ -x "$tool_root/node_modules/.bin/tsx" ]; then
    export PATH="$tool_root/node_modules/.bin:$PATH"
    exec "$tool_root/node_modules/.bin/tsx" "$HOOK_PATH" "$@"
  fi
done

if command -v tsx >/dev/null 2>&1; then
  exec tsx "$HOOK_PATH" "$@"
fi

echo "tsx is not available. Run npm install in $REPO_ROOT or set BRAINBASE_HOOK_REPO_ROOT to a repo with node_modules." >&2
exit 127
