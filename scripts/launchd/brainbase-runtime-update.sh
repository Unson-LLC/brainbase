#!/bin/bash
set -euo pipefail

SOURCE_REPO="${BRAINBASE_SOURCE_REPO:-/Users/ksato/workspace/repos/brainbase}"
RUNTIME_ROOT="${BRAINBASE_UI_RUNTIME_ROOT:-/Users/ksato/workspace/repos/.runtime/brainbase-31013}"
REMOTE="${BRAINBASE_RUNTIME_REMOTE:-origin}"
BRANCH="${BRAINBASE_RUNTIME_BRANCH:-develop}"
TARGET_REF="${BRAINBASE_RUNTIME_TARGET_REF:-refs/brainbase-runtime/origin-develop}"
PIN_FILE="${BRAINBASE_RUNTIME_PIN_FILE:-/Users/ksato/workspace/var/brainbase-runtime-pinned.sha}"
LABEL="${BRAINBASE_UI_LAUNCHD_LABEL:-com.brainbase.ui}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/brainbase-runtime-target.sh"
TARGET_SHA="$(brainbase_resolve_runtime_target "$SOURCE_REPO" "$REMOTE" "$BRANCH" "$TARGET_REF" "$PIN_FILE")"
CURRENT_SHA="$(git -C "$RUNTIME_ROOT" rev-parse HEAD 2>/dev/null || true)"
if [[ "$CURRENT_SHA" != "$TARGET_SHA" ]]; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
fi
