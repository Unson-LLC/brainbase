#!/bin/bash

# Retired path tombstone: scheduled session cleanup belongs to Codex.
printf '%s\n' \
  'This Brainbase scheduled cleanup command is retired.' \
  'Use the Codex app or CLI to manage the owning task, session, and process.' \
  'See docs/architecture/ADR-019-codex-owns-development-runtime.md.' >&2
exit 1
