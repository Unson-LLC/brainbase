---
adr_id: ADR-codex-appserver-thread-session-foundation
title: Codex App Server thread session display-route boundary
source_story:
  story_id: story-codex-appserver-thread-session-foundation
  story_path: docs/stories/story-codex-appserver-thread-session-foundation.md
status: proposed
created_at: 2026-05-25
updated_at: 2026-05-25
---

# ADR-codex-appserver-thread-session-foundation: Codex App Server thread session display-route boundary

## Context

Codex App Server state is now persisted as Codex-only session metadata. Browser UI still uses terminal-oriented session switching and xterm rendering. Moving all display and input behavior at once would mix App Server protocol work with the fragile terminal transport invariants.

## Decision

Create a pure display-route contract before changing UI rendering:

- `codex_app_server`: a Codex session has non-stale App Server thread metadata.
- `terminal_xterm`: the existing fallback for Claude Code, legacy Codex, stale metadata, and missing metadata.
- Fallback reasons stay distinguishable: stale Codex App Server metadata reports `codex_app_server_thread_stale`, while absent metadata reports `codex_app_server_thread_missing`.

`deriveSessionUiState()` may expose the route for consumers, but this story does not attach a new renderer or input path.

## Boundaries

- `public/modules/domain/session/session-display-route.js` owns route derivation.
- `public/modules/session-ui-state.js` exposes the route as read-only state.
- `terminal.transport` remains the only interactive terminal IO path in this slice.
- Claude Code is explicitly excluded from the App Server route.

## Alternatives

- Replace xterm immediately: rejected because terminal transport has separate focus, paste, local echo, snapshot, and startup-shell invariants.
- Infer App Server display from activity status: rejected because activity can be present without a durable thread identity.
- Treat all Codex sessions as App Server sessions: rejected because legacy Codex sessions still require terminal fallback.

## Consequences

- Later UI stories can switch display surfaces using a tested route contract.
- The first PR is small enough to merge before adding transcript rendering or `turn/start` input.
- Existing Claude Code and terminal behavior stays unchanged.
