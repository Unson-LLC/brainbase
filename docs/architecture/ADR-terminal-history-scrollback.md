---
adr_id: ADR-terminal-history-scrollback
title: Terminal snapshot polling rebuilds history to preserve scrollback
status: accepted
date: 2026-05-14
related_stories:
  - story-terminal-history-scrollback
related_specs:
  - docs/specs/terminal-history-scrollback.md
related_docs:
  - docs/architecture/terminal-runtime-architecture.md
---

# ADR: Terminal Snapshot Polling Rebuilds History

## Context

Brainbase desktop terminal uses xterm.js through the Terminal Gateway. The gateway currently uses snapshot polling instead of tmux control-mode streaming to avoid cursor/status drift.

The previous steady-state polling path sent only the visible tmux pane with `screenOnly: true`. That kept the current screen fresh, but it intentionally preserved xterm scrollback. As a result, users could see correct current output, then scroll upward and cross into stale scrollback captured at connection time.

The scroll input path also has two different owners. Normal buffer history belongs to xterm/ttyd native scrollback. Alternate buffer content belongs to tmux/TUI state, so wheel/touch must be translated into tmux copy-mode scroll.

## Decision

Steady-state snapshot polling sends a history snapshot, not a visible-pane-only snapshot.

- Polling calls tmux capture with `visibleOnly: false`.
- Polling uses the history snapshot line budget.
- Polling sends `screenOnly: false`.
- The client therefore clears and rebuilds xterm scrollback from one coherent tmux capture.

`screenOnly: true` remains available for explicit screen-only updates, but it is not the desktop steady-state polling contract.

Wheel/touch routing follows the active terminal buffer:

- normal buffer: do not intercept; native xterm/ttyd scrollback handles history.
- alternate buffer: intercept and send tmux scroll through the terminal transport.

## Consequences

- Current screen and scrollback come from the same capture boundary.
- The user should not see older terminal content suddenly appear while scrolling upward after new output has arrived.
- Capture payloads are larger than visible-pane polling. Existing `TmuxCaptureCache` TTL and de-duplication reduce repeated captures and duplicate WebSocket sends.
- TUI sessions regain scroll behavior without breaking normal scrollback sessions.

## Alternatives Considered

- Keep visible-pane polling and clear scrollback on every poll: avoids stale history but removes the user's ability to inspect history.
- Restore control-mode streaming: potentially better long-term, but this path was previously disabled because cursor/status rows drifted.
- Add a separate scroll-triggered full refresh: reduces payload size but still allows stale content until the user scrolls.

## Verification

- `npm test -- tests/server/services/terminal-transport-service.test.js tests/unit/terminal-transport-client.test.js tests/server/services/tmux-capture-cache.test.js`
