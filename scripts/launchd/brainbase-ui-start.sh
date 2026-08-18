#!/bin/bash
set -euo pipefail

SOURCE_REPO="${BRAINBASE_SOURCE_REPO:-/Users/ksato/workspace/repos/brainbase}"
RUNTIME_ROOT="${BRAINBASE_UI_RUNTIME_ROOT:-/Users/ksato/workspace/repos/.runtime/brainbase-31013}"
REMOTE="${BRAINBASE_RUNTIME_REMOTE:-origin}"
BRANCH="${BRAINBASE_RUNTIME_BRANCH:-develop}"
TARGET_REF="${BRAINBASE_RUNTIME_TARGET_REF:-refs/brainbase-runtime/origin-develop}"
NODE_BIN="${BRAINBASE_NODE_BIN:-/Users/ksato/.hermes/node/bin/node}"
LOCK_DIR="${BRAINBASE_RUNTIME_LOCK:-/Users/ksato/workspace/var/brainbase-runtime-update.lock}"

fail() { printf '[brainbase-runtime] FAILED: %s\n' "$*" >&2; exit 1; }
[[ -d "$SOURCE_REPO/.git" ]] || fail "source repository not found: $SOURCE_REPO"
mkdir -p "$(dirname "$RUNTIME_ROOT")" "$(dirname "$LOCK_DIR")"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "another runtime update is active"
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

git -C "$SOURCE_REPO" fetch --quiet "$REMOTE" "$BRANCH:$TARGET_REF" || fail "could not fetch $REMOTE/$BRANCH"
TARGET_SHA="$(git -C "$SOURCE_REPO" rev-parse "$TARGET_REF^{commit}")"
if [[ ! -e "$RUNTIME_ROOT/.git" ]]; then
  [[ ! -e "$RUNTIME_ROOT" ]] || fail "runtime path exists but is not a linked worktree: $RUNTIME_ROOT"
  git -C "$SOURCE_REPO" worktree add --force --detach "$RUNTIME_ROOT" "$TARGET_SHA"
fi
[[ -f "$RUNTIME_ROOT/.git" ]] || fail "runtime is not a linked worktree: $RUNTIME_ROOT"
[[ -z "$(git -C "$RUNTIME_ROOT" status --porcelain --untracked-files=no)" ]] || fail "runtime has tracked changes"
git -C "$RUNTIME_ROOT" reset --hard --quiet "$TARGET_SHA"
git -C "$RUNTIME_ROOT" clean -ffdq

INSTALL_STAMP="$RUNTIME_ROOT/node_modules/.brainbase-package-lock.sha256"
LOCK_SHA="$(shasum -a 256 "$RUNTIME_ROOT/package-lock.json" | awk '{print $1}')"
if [[ ! -f "$INSTALL_STAMP" ]] || [[ "$(cat "$INSTALL_STAMP" 2>/dev/null)" != "$LOCK_SHA" ]]; then
  npm --prefix "$RUNTIME_ROOT" ci --ignore-scripts
  mkdir -p "$(dirname "$INSTALL_STAMP")"
  printf '%s\n' "$LOCK_SHA" > "$INSTALL_STAMP"
fi
MCP_INSTALL_STAMP="$RUNTIME_ROOT/mcp/brainbase/node_modules/.brainbase-package-lock.sha256"
MCP_LOCK_SHA="$(shasum -a 256 "$RUNTIME_ROOT/mcp/brainbase/package-lock.json" | awk '{print $1}')"
if [[ ! -f "$MCP_INSTALL_STAMP" ]] || [[ "$(cat "$MCP_INSTALL_STAMP" 2>/dev/null)" != "$MCP_LOCK_SHA" ]]; then
  npm --prefix "$RUNTIME_ROOT/mcp/brainbase" ci --ignore-scripts
  mkdir -p "$(dirname "$MCP_INSTALL_STAMP")"
  printf '%s\n' "$MCP_LOCK_SHA" > "$MCP_INSTALL_STAMP"
fi
npm --prefix "$RUNTIME_ROOT/mcp/brainbase" run build

export BRAINBASE_UI_RUNTIME_ROOT="$RUNTIME_ROOT"
export BRAINBASE_REPO_ROOT="$RUNTIME_ROOT"
export BRAINBASE_RUNTIME_EXPECTED_SHA="$TARGET_SHA"
("$RUNTIME_ROOT/scripts/reconcile-brainbase-mcp-runtime.sh" "$TARGET_SHA" &) >/dev/null 2>&1
cd "$RUNTIME_ROOT"
rmdir "$LOCK_DIR"
trap - EXIT
exec "$NODE_BIN" start.js
