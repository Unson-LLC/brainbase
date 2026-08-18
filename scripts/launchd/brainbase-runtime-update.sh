#!/bin/bash
set -euo pipefail

SOURCE_REPO="${BRAINBASE_SOURCE_REPO:-/Users/ksato/workspace/repos/brainbase}"
RUNTIME_ROOT="${BRAINBASE_UI_RUNTIME_ROOT:-/Users/ksato/workspace/repos/.runtime/brainbase-31013}"
REMOTE="${BRAINBASE_RUNTIME_REMOTE:-origin}"
BRANCH="${BRAINBASE_RUNTIME_BRANCH:-develop}"
LABEL="${BRAINBASE_UI_LAUNCHD_LABEL:-com.brainbase.ui}"

git -C "$SOURCE_REPO" fetch --quiet "$REMOTE" "$BRANCH"
TARGET_SHA="$(git -C "$SOURCE_REPO" rev-parse "$REMOTE/$BRANCH^{commit}")"
CURRENT_SHA="$(git -C "$RUNTIME_ROOT" rev-parse HEAD 2>/dev/null || true)"
if [[ "$CURRENT_SHA" != "$TARGET_SHA" ]]; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
fi
