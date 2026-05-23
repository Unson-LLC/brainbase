---
spec_id: story-session-switch-performance-spec
title: Session switch xterm readiness specification
source_story: docs/user_stories/active/story-session-switch-performance.md
source_architecture: docs/architecture/terminal-runtime-architecture.md
status: active
created_at: 2026-05-16
updated_at: 2026-05-16
---

# Session switch xterm readiness specification

## Scope

- `public/modules/app/terminal-input-ux-mixin.js`
- `public/modules/ui/views/session-context-bar-view.js`
- `public/modules/core/terminal-transport-client.js`
- `server/controllers/session/runtime-handlers.js`
- `server/services/terminal-input-probe-service.js`
- `server/services/terminal-transport-service.js`
- `tests/e2e/story-terminal-input-render-stability-canary.spec.ts`

## Invariants

- INV-1: Session switch completion is measured by target xterm display and input readiness, not by snapshot visibility alone.
- INV-2: Non-terminal refresh work must not delay the terminal switch critical path.
- INV-3: An already active `interactive_ready` session with passed input probe must not be restarted by `terminal/ensure`.
- INV-4: A connected owner with `inputReady=true` must not call the input probe endpoint again before accepting user input.
- INV-5: Input probe snapshot capture must resolve or fail with `PROBE_TIMEOUT` within the configured timeout.
- INV-6: Archived sessions are not restored or made active as a side effect of this story.

## Contracts

- C-1: `SessionContextBarView._isTerminalSwitchActive()` returns true only while `window.brainbaseApp._pendingTerminalSwitch` targets the current session.
- C-2: `_runDeferredSessionSwitchWork(sessionId, switchToken)` ignores stale switch tokens and sessions that are no longer current.
- C-3: `ensureTerminalRuntime` may return `{ fastPath: true }` only when the session is active, viewer access is not blocked, and runtime is `interactive_ready` with input ready.
- C-4: `TerminalTransportClient.verifyInputReady()` posts to `/terminal/probe-input` only when owner access exists and local connected/inputReady status is not already true.
- C-5: `TerminalInputProbeService` reports `PROBE_TIMEOUT` when snapshot capture exceeds the probe timeout.

## Scenarios

- S-1: Given a session switch is pending, when SessionContextBar tries to refresh context for the target session, then it waits for terminal switch completion before calling `/context`.
- S-2: Given a session switch is pending, when snapshot prefetch is scheduled, then prefetch is delayed and retried after the switch leaves the pending state.
- S-3: Given the user switches to an active session whose observed runtime is `interactive_ready` and input probe has passed, when `/terminal/ensure` is called, then the server returns fast-path status without starting ttyd or ensuring runtime again.
- S-4: Given the browser is already connected as terminal owner with `inputReady=true`, when user input calls `verifyInputReady()`, then no probe API call is made.
- S-5: Given snapshot capture hangs during input probe, when the probe timeout expires, then the response is `inputReady=false` with code `PROBE_TIMEOUT`.
- S-6: Given the target session is archived, when xterm preference or terminal ensure logic runs, then the session is not implicitly restored.
- S-7: Given the E2E canary switches to xterm, when it types a marker, then that marker reaches tmux through the WebSocket input path.

## Anti-patterns

- AP-1: Treating the first snapshot render as session switch completion.
- AP-2: Running `/context` refresh, full session data load, or snapshot prefetch before the target xterm is displayable.
- AP-3: Retrying input probe indefinitely from the browser or server.
- AP-4: Repairing archived session state as part of terminal switch performance work.

## Verification

- Unit: `tests/ui/session-context-bar-view.test.js`
- Unit: `tests/unit/server-session-controller.test.js`
- Unit: `tests/server/services/terminal-transport-service.test.js`
- Unit: `tests/unit/terminal-transport-client.test.js`
- Unit: `tests/server/services/terminal-input-probe-service.test.js`
- E2E: `tests/e2e/story-terminal-input-render-stability-canary.spec.ts`

## Open Questions

- OQ-1: Numeric SLA is not yet fixed. The story currently requires the measurement endpoint to be xterm display plus `inputReady=true`, but does not set a p95 millisecond threshold.
