#!/bin/bash

# Resolve the commit used by the disposable Brainbase UI/MCP runtime.
# A valid pin deliberately wins over origin/develop so an operator can keep a
# known-good rollback active across launchd restarts.

brainbase_resolve_runtime_target() {
  local source_repo="$1"
  local remote="$2"
  local branch="$3"
  local target_ref="$4"
  local pin_file="$5"
  local pinned_sha=""

  [[ -d "$source_repo/.git" ]] || {
    printf '[brainbase-runtime] FAILED: source repository not found: %s\n' "$source_repo" >&2
    return 1
  }
  git -C "$source_repo" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    printf '[brainbase-runtime] FAILED: source path is not a Git worktree: %s\n' "$source_repo" >&2
    return 1
  }
  local source_root
  source_root="$(git -C "$source_repo" rev-parse --show-toplevel 2>/dev/null)" || return 1
  [[ "$(cd "$source_repo" && pwd -P)" == "$(cd "$source_root" && pwd -P)" ]] || {
    printf '[brainbase-runtime] FAILED: source path is not the Git root: %s\n' "$source_repo" >&2
    return 1
  }

  if [[ -e "$pin_file" ]]; then
    [[ -f "$pin_file" ]] || {
      printf '[brainbase-runtime] FAILED: runtime pin is not a regular file: %s\n' "$pin_file" >&2
      return 1
    }
    pinned_sha="$(cat "$pin_file")"
    [[ "$pinned_sha" =~ ^[0-9a-f]{40}$ ]] || {
      printf '[brainbase-runtime] FAILED: runtime pin must contain one full commit SHA: %s\n' "$pin_file" >&2
      return 1
    }
    git -C "$source_repo" cat-file -e "${pinned_sha}^{commit}" 2>/dev/null || {
      printf '[brainbase-runtime] FAILED: pinned runtime commit is unavailable: %s\n' "$pinned_sha" >&2
      return 1
    }
    printf '%s\n' "$pinned_sha"
    return 0
  fi

  git -C "$source_repo" fetch --quiet "$remote" "$branch:$target_ref" || {
    printf '[brainbase-runtime] FAILED: could not fetch %s/%s\n' "$remote" "$branch" >&2
    return 1
  }
  git -C "$source_repo" rev-parse "$target_ref^{commit}"
}
