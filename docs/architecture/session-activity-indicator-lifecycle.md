# Session Activity Indicator Lifecycle

The source of truth is [../session-activity-indicator-lifecycle.md](../session-activity-indicator-lifecycle.md).

Do not maintain a second lifecycle definition in this architecture directory. Active indicator state must be designed and reviewed against the root SSOT document.

## Current Slice

Story: [story-active-indicator-event-flicker](../stories/story-active-indicator-event-flicker.md)

The architecture rule for this slice is:

- Activity truth comes from explicit lifecycle events first: Brainbase input submit, Codex hooks/PTY shim, Claude hooks, terminal done, and clear-done.
- tmux pane title spinner is a fallback signal only. It may recover activity for legacy Codex sessions, but static titles such as `Claude Code` or an empty pane title are not sufficient evidence of working state.
- Client `sessionUi.byId[sessionId].hookStatus` must be hydrated from `/api/sessions/status` on startup and periodically reconciled while WebSocket push is active, because WebSocket full/update messages and browser initialization can race.
- `transport-connected` means the terminal is reachable. It does not imply agent activity.
