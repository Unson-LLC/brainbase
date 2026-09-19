#!/bin/bash

# Retired path tombstone: session and process lifecycle belongs to Codex.
printf '%s\n' \
  'This Brainbase cleanup command is retired.' \
  'Use the Codex app or CLI to manage the owning task, session, and process.' \
  'See docs/architecture/ADR-019-codex-owns-development-runtime.md.' >&2
exit 1
