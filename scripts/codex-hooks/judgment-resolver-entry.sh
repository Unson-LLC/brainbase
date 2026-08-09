#!/bin/bash
# Codex judgment lifecycle entrypoint: open on UserPromptSubmit, record Brainbase
# calls on PostToolUse, and finalize once on Stop.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
host_script="$script_dir/judgment-resolver-host.mjs"

if [ "$#" -gt 0 ] && [ -n "$1" ]; then
  node "$host_script" <<<"$1"
else
  exec node "$host_script"
fi
