#!/bin/bash
# Codex judgment lifecycle entrypoint: open on UserPromptSubmit and record Brainbase
# calls on PostToolUse. Stop verifies the exact assistant answer and is the sole
# finalization boundary for every supported runtime.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
host_script="$script_dir/judgment-resolver-host.mjs"

if [ "$#" -gt 0 ] && [ -n "$1" ]; then
  node --no-warnings "$host_script" <<<"$1"
else
  exec node --no-warnings "$host_script"
fi
