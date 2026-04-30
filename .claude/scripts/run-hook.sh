#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ "$#" -lt 1 ]; then
  echo "Usage: .claude/scripts/run-hook.sh <script.ts> [args...]" >&2
  exit 2
fi

HOOK_SCRIPT="$1"
shift

cd "$REPO_ROOT"

if [ -x "$REPO_ROOT/node_modules/.bin/tsx" ]; then
  exec "$REPO_ROOT/node_modules/.bin/tsx" "$HOOK_SCRIPT" "$@"
fi

if command -v tsx >/dev/null 2>&1; then
  exec tsx "$HOOK_SCRIPT" "$@"
fi

echo "tsx is not available. Run npm install before starting Claude hooks." >&2
exit 127
