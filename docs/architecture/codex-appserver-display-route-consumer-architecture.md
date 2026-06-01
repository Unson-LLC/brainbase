# ADR: Codex App Server display route consumer

## Context

Brainbase now derives `session.displayRoute` for Codex App Server thread sessions. The session switching path still treats every desktop active session as xterm-first when `BRAINBASE_TERMINAL_TRANSPORT=xterm`. That blocks incremental migration because display selection is coupled to terminal runtime startup.

## Decision

Add a browser-side Codex App Server display surface driven by route metadata. `story-codex-appserver-transcript-ui` now owns native transcript rendering and browser interaction, so non-stale App Server thread metadata may route to the transcript panel by default. The route consumer must still preserve xterm/ttyd fallback for unsupported sessions, stale metadata, transcript load failure, mobile fallback, and explicit user recovery.

## Design

- Reuse `deriveSessionDisplayRoute(session)` as the display selection source.
- Add a `codex-app-server-display` panel inside `#terminal-stage`.
- Add display helpers in a dedicated mixin so session switching can call `_showCodexAppServerDisplay(session, route)`.
- Treat the mixin import in `public/app.js`, the panel markup in `public/index.html`, and the CSS in `public/style.css` as required route-consumer wiring for this same slice. Splitting any of those files away would leave the runtime helper unreachable or the selected display surface absent/unusable.
- When App Server transcript display is selected:
  - disconnect and hide xterm transport without preserving the previous terminal view;
  - clear the ttyd iframe;
  - hide terminal snapshot;
  - load the transcript before accepting browser input;
  - finish the switch with `ready_codex_app_server`;
  - update session UI state as connected for the current display route.
- While App Server transcript display is active, keep legacy terminal input, click-to-focus, and type-to-focus handlers read-only so the transcript composer is the only App Server input path.
- The transport switcher may explicitly leave transcript mode and re-enter xterm/ttyd fallback.
- Keep terminal fallback as route metadata and do not delete terminal transport logic.

## Consequences

- App Server-routed Codex sessions are interactive through the native transcript composer when the transcript route is healthy, with xterm/ttyd still available for recovery.
- Claude Code and Codex sessions without App Server metadata remain on the existing terminal path.
- The old read-only diagnostic panel is superseded by the transcript renderer/input contract.

## Verification

- Unit/integration test `switchSession()` for App Server route selection and terminal fallback.
- Contract E2E checks Story/ADR/Spec/code anchors.
- Visual smoke checks the panel host/style path on the worktree server.
- Existing terminal transport tests remain targeted for fallback safety.
