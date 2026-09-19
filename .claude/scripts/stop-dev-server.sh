#!/bin/bash

# Retired path tombstone: Codex owns process and terminal lifecycle.
printf '%s\n' \
  'This Brainbase per-worktree stop command is retired.' \
  'Stop the exact task process from its Codex-owned terminal; do not stop by PID or port.' \
  'See docs/architecture/ADR-019-codex-owns-development-runtime.md.' >&2
exit 1
