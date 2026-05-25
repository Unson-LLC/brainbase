# ADR: Codex App Server display route consumer

## Context

Brainbase now derives `session.displayRoute` for Codex App Server thread sessions. The session switching path still treats every desktop active session as xterm-first when `BRAINBASE_TERMINAL_TRANSPORT=xterm`. That blocks incremental migration because display selection is coupled to terminal runtime startup.

## Decision

Add a browser-only Codex App Server display surface and route Codex sessions with non-stale App Server thread metadata to that surface before terminal runtime resolution. The route consumer is intentionally read-only and metadata-driven.

## Design

- Reuse `deriveSessionDisplayRoute(session)` as the display selection source.
- Add a `codex-app-server-display` panel inside `#terminal-stage`.
- Add display helpers in a dedicated mixin so session switching can call `_showCodexAppServerDisplay(session, route)`.
- Treat the mixin import in `public/app.js`, the panel markup in `public/index.html`, and the CSS in `public/style.css` as required route-consumer wiring for this same slice. Splitting any of those files away would leave the runtime helper unreachable or the selected display surface absent/unusable.
- When App Server display is selected:
  - disconnect and hide xterm transport without preserving the previous terminal view;
  - clear the ttyd iframe;
  - hide terminal snapshot;
  - finish the switch with `ready_codex_app_server`;
  - update session UI state as connected/read-only for the current display route.
- While App Server display is active, keep legacy terminal input, reconnect, click-to-focus, and type-to-focus handlers read-only so this slice cannot accidentally post ttyd/xterm input before the App Server transcript/input contract exists.
- Keep terminal fallback as route metadata and do not delete terminal transport logic.

## Consequences

- App Server-routed Codex sessions no longer eagerly start terminal runtime just to display a session.
- Claude Code and Codex sessions without App Server metadata remain on the existing terminal path.
- The panel is not a full transcript renderer; the next story must define transcript read/input contracts.

## Verification

- Unit/integration test `switchSession()` for App Server route selection and terminal fallback.
- Contract E2E checks Story/ADR/Spec/code anchors.
- Visual smoke checks the panel host/style path on the worktree server.
- Existing terminal transport tests remain targeted for fallback safety.
