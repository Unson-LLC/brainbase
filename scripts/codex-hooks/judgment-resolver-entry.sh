#!/bin/bash
# Codex judgment lifecycle entrypoint: open on UserPromptSubmit and record Brainbase
# calls on PostToolUse. Runtime 2.3 finalizes on Stop; runtime 2.4 may finalize a
# previously rejected continuation on completed-state PostToolUse when Desktop omits Stop.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
host_script="$script_dir/judgment-resolver-host.mjs"

if [ "$#" -gt 0 ] && [ -n "$1" ]; then
  node --no-warnings "$host_script" <<<"$1"
else
  exec node --no-warnings "$host_script"
fi
