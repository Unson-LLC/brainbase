#!/bin/bash

# Shared readiness contract for the disposable Brainbase UI/MCP runtime.
# Callers must provide the expected full commit SHA; readiness is accepted only
# when the API and the runtime worktree agree on that SHA in the same attempt.

brainbase_runtime_readiness_validate_positive_seconds() {
  local value="$1"
  local label="$2"

  if [[ ! "$value" =~ ^(0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(\.[0-9]+)?)$ ]]; then
    printf '[brainbase-runtime] %s must be a finite positive number\n' "$label" >&2
    return 1
  fi
}

brainbase_runtime_readiness_api() {
  local url="$1"
  local expected_sha="$2"
  local connect_timeout_seconds="$3"
  local max_timeout_seconds="$4"
  local response
  local api_sha

  if ! brainbase_runtime_readiness_validate_positive_seconds \
    "$connect_timeout_seconds" 'connect timeout'; then
    return 2
  fi
  if ! brainbase_runtime_readiness_validate_positive_seconds \
    "$max_timeout_seconds" 'maximum request time'; then
    return 2
  fi

  if ! response="$(curl -fsS \
    --connect-timeout "$connect_timeout_seconds" \
    --max-time "$max_timeout_seconds" \
    -- "$url" 2>/dev/null)"; then
    printf '[brainbase-runtime] readiness API probe unavailable: %s\n' "$url" >&2
    return 1
  fi

  if ! api_sha="$(printf '%s' "$response" | node -e '
const fs = require("node:fs");
let value;
try {
  value = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(1);
}
const git = value?.runtime?.git;
if (typeof git?.sha !== "string" || git.dirty !== false) process.exit(1);
process.stdout.write(git.sha);
')"; then
    printf '[brainbase-runtime] readiness API reported invalid SHA or dirty runtime\n' >&2
    return 1
  fi

  if [[ "$api_sha" != "$expected_sha" ]]; then
    printf '[brainbase-runtime] readiness API SHA mismatch: expected %s, got %s\n' \
      "$expected_sha" "$api_sha" >&2
    return 1
  fi
}

brainbase_runtime_readiness_worktree() {
  local runtime_root="$1"
  local expected_sha="$2"
  local runtime_head
  local worktree_status

  if ! runtime_head="$(git -C "$runtime_root" rev-parse --verify HEAD 2>/dev/null)"; then
    printf '[brainbase-runtime] runtime worktree HEAD is unavailable: %s\n' "$runtime_root" >&2
    return 1
  fi
  if [[ "$runtime_head" != "$expected_sha" ]]; then
    printf '[brainbase-runtime] runtime worktree HEAD mismatch: expected %s, got %s\n' \
      "$expected_sha" "$runtime_head" >&2
    return 1
  fi

  if ! worktree_status="$(git -C "$runtime_root" status --porcelain --untracked-files=all 2>/dev/null)"; then
    printf '[brainbase-runtime] runtime worktree status is unavailable: %s\n' "$runtime_root" >&2
    return 1
  fi
  if [[ -n "$worktree_status" ]]; then
    printf '[brainbase-runtime] runtime worktree is dirty: %s\n' "$runtime_root" >&2
    return 1
  fi
}

brainbase_wait_for_runtime_ready() {
  if [[ "$#" -ne 7 ]]; then
    printf '[brainbase-runtime] usage: brainbase_wait_for_runtime_ready <runtime-root> <expected-sha> <url> <attempts> <delay-seconds> <connect-timeout-seconds> <max-time-seconds>\n' >&2
    return 2
  fi

  local runtime_root="$1"
  local expected_sha="$2"
  local url="$3"
  local max_attempts="$4"
  local delay_seconds="$5"
  local connect_timeout_seconds="$6"
  local max_timeout_seconds="$7"
  local resolved_runtime_root
  local git_root
  local attempt
  local api_ready
  local worktree_ready

  [[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || {
    printf '[brainbase-runtime] expected runtime SHA must be one full commit SHA\n' >&2
    return 2
  }
  [[ -n "$url" ]] || {
    printf '[brainbase-runtime] readiness API URL is required\n' >&2
    return 2
  }
  [[ "$max_attempts" =~ ^[1-9][0-9]*$ ]] || {
    printf '[brainbase-runtime] readiness attempts must be a finite positive integer\n' >&2
    return 2
  }
  [[ "$delay_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]] || {
    printf '[brainbase-runtime] readiness delay must be a finite non-negative number\n' >&2
    return 2
  }
  if ! brainbase_runtime_readiness_validate_positive_seconds \
    "$connect_timeout_seconds" 'connect timeout'; then
    return 2
  fi
  if ! brainbase_runtime_readiness_validate_positive_seconds \
    "$max_timeout_seconds" 'maximum request time'; then
    return 2
  fi
  [[ -d "$runtime_root" ]] || {
    printf '[brainbase-runtime] runtime worktree is missing: %s\n' "$runtime_root" >&2
    return 1
  }

  if ! resolved_runtime_root="$(cd "$runtime_root" 2>/dev/null && pwd -P)"; then
    printf '[brainbase-runtime] runtime worktree path is unavailable: %s\n' "$runtime_root" >&2
    return 1
  fi
  if [[ "$(git -C "$runtime_root" rev-parse --is-inside-work-tree 2>/dev/null)" != true ]]; then
    printf '[brainbase-runtime] runtime path is not a Git worktree: %s\n' "$runtime_root" >&2
    return 1
  fi
  if ! git_root="$(git -C "$runtime_root" rev-parse --show-toplevel 2>/dev/null)"; then
    printf '[brainbase-runtime] runtime Git root is unavailable: %s\n' "$runtime_root" >&2
    return 1
  fi
  if ! git_root="$(cd "$git_root" 2>/dev/null && pwd -P)"; then
    printf '[brainbase-runtime] runtime Git root cannot be resolved: %s\n' "$runtime_root" >&2
    return 1
  fi
  [[ "$resolved_runtime_root" == "$git_root" ]] || {
    printf '[brainbase-runtime] runtime path is not the Git root: %s\n' "$runtime_root" >&2
    return 1
  }

  for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
    api_ready=0
    worktree_ready=0
    if brainbase_runtime_readiness_api \
      "$url" \
      "$expected_sha" \
      "$connect_timeout_seconds" \
      "$max_timeout_seconds"; then
      api_ready=1
    fi
    if brainbase_runtime_readiness_worktree "$runtime_root" "$expected_sha"; then
      worktree_ready=1
    fi
    if (( api_ready == 1 && worktree_ready == 1 )); then
      return 0
    fi
    if (( attempt < max_attempts )); then
      if ! sleep "$delay_seconds"; then
        printf '[brainbase-runtime] readiness retry delay failed\n' >&2
        return 1
      fi
    fi
  done

  printf '[brainbase-runtime] runtime readiness timed out after %s attempts\n' "$max_attempts" >&2
  return 1
}
