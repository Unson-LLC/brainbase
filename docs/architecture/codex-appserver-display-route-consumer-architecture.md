# ADR: Codex App Server display route consumer

## Context

Brainbase now derives `session.displayRoute` for Codex App Server thread sessions. The session switching path still treats every desktop active session as xterm-first when `BRAINBASE_TERMINAL_TRANSPORT=xterm`. That blocks incremental migration because display selection is coupled to terminal runtime startup.

## Decision

Add a browser-only Codex App Server display surface, but keep Codex sessions with non-stale App Server thread metadata on the interactive xterm fallback by default. The App Server display surface is intentionally read-only, metadata-driven, and diagnostic-only until a separate transcript/input story owns browser interaction.

## Design

- Reuse `deriveSessionDisplayRoute(session)` as the display selection source.
- Add a `codex-app-server-display` panel inside `#terminal-stage`.
- Add display helpers in a dedicated mixin so session switching can call `_showCodexAppServerDisplay(session, route)`.
- Treat the mixin import in `public/app.js`, the panel markup in `public/index.html`, and the CSS in `public/style.css` as required route-consumer wiring for this same slice. Splitting any of those files away would leave the runtime helper unreachable or the selected display surface absent/unusable.
- When App Server display is explicitly enabled:
  - disconnect and hide xterm transport without preserving the previous terminal view;
  - clear the ttyd iframe;
  - hide terminal snapshot;
  - finish the switch with `ready_codex_app_server`;
  - update session UI state as connected/read-only for the current display route.
- While App Server display is active, keep legacy terminal input, reconnect, click-to-focus, and type-to-focus handlers read-only so this slice cannot accidentally post ttyd/xterm input before the App Server transcript/input contract exists.
- Without the diagnostic display flag, `_shouldUseCodexAppServerDisplay()` returns false and the regular desktop terminal path remains the user-facing route.
- Keep terminal fallback as route metadata and do not delete terminal transport logic.

## Consequences

- App Server-routed Codex sessions remain interactive because they use xterm unless the diagnostic read-only panel is explicitly enabled.
- Claude Code and Codex sessions without App Server metadata remain on the existing terminal path.
- The panel is not a full transcript renderer; the next story must define transcript read/input contracts.

## Verification

- Unit/integration test `switchSession()` for App Server route selection and terminal fallback.
- Contract E2E checks Story/ADR/Spec/code anchors.
- Visual smoke checks the panel host/style path on the worktree server.
- Existing terminal transport tests remain targeted for fallback safety.
