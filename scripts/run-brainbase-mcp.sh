#!/bin/zsh
set -euo pipefail

REPO_ROOT="/Users/ksato/workspace/code/brainbase"

cd "$REPO_ROOT"
exec node "$REPO_ROOT/mcp/brainbase/dist/index.js"
