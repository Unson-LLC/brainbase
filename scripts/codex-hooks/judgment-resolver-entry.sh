#!/bin/bash
# Codex judgment lifecycle entrypoint: open on UserPromptSubmit and record Brainbase
# calls on PostToolUse. Stop verifies the exact assistant answer and is the sole
# finalization boundary for every supported runtime.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
host_script="$script_dir/judgment-resolver-host.mjs"
if [ "${BRAINBASE_JUDGMENT_HOOK_MODE:-}" = "record_only" ]; then
  host_script="$script_dir/judgment-hook-observe.mjs"
fi

# A missing Node runtime or a module-load failure happens before the Host's
# `main()` catch can create a safe start diagnostic. Judgment is an audit plane,
# not an action-authorization plane, so its loader failure must not stop Codex.
# `{}` returns control to the platform's ordinary permission boundary.
safe_entrypoint_failure() {
  printf '{}\n'
  if [ "${BRAINBASE_JUDGMENT_HOOK_MODE:-}" = "record_only" ]; then
    printf '%s\n' '{"schema_version":"brainbase-judgment-hook-entrypoint-failure-v1","mode":"record_only","reason":"entrypoint_runtime_unavailable","audit_status":"incomplete","action_authorized":false,"diagnostic_persisted":false}' >&2
  else
    printf '%s\n' '{"schema_version":"brainbase-judgment-hook-entrypoint-failure-v1","reason":"judgment_entrypoint_runtime_unavailable","audit_status":"incomplete","action_authorized":false,"diagnostic_persisted":false}' >&2
  fi
}

if ! command -v node >/dev/null 2>&1; then
  safe_entrypoint_failure
  exit 0
fi

if [ "${BRAINBASE_JUDGMENT_HOOK_MODE:-}" = "record_only" ]; then
  # record-only has executable top-level observation code, so use syntax/load
  # checks that do not import it a second time and create a duplicate record.
  if ! node --no-warnings --check "$host_script" >/dev/null 2>&1; then
    safe_entrypoint_failure
    exit 0
  fi
else
  # Import the normal Host without argv[1], so its executable main guard does
  # not run.  This catches static dependency/native-module failures before the
  # real invocation while keeping all loader output out of user-visible stderr.
  if ! BRAINBASE_ENTRYPOINT_PREFLIGHT_SCRIPT="$host_script" \
    node --no-warnings --input-type=module --eval \
    'await import(process.env.BRAINBASE_ENTRYPOINT_PREFLIGHT_SCRIPT)' >/dev/null 2>&1; then
    safe_entrypoint_failure
    exit 0
  fi
fi

if [ "$#" -gt 0 ] && [ -n "$1" ]; then
  node --no-warnings "$host_script" <<<"$1"
else
  exec node --no-warnings "$host_script"
fi
