#!/bin/bash

# Retired path tombstone: Codex owns worktree and terminal lifecycle.
printf '%s\n' \
  'This Brainbase per-worktree server command is retired.' \
  'If a server is required, first follow worktree-dev-server to confirm the port and data/auth isolation, then start it from the Codex-owned terminal.' \
  'See docs/architecture/ADR-019-codex-owns-development-runtime.md.' >&2
exit 1
