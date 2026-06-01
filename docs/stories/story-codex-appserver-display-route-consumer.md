# Codex App Server display route consumer

## Story

As a Brainbase user switching between sessions, I want Codex sessions that already have Codex App Server thread metadata to route to the native transcript surface when available while keeping xterm/ttyd fallback explicit and recoverable.

## Background

`story-codex-appserver-thread-session-foundation` added a read-only `displayRoute` derived from `session.codexAppServer` metadata. The route consumer initially exposed a read-only App Server panel and kept xterm as default. `story-codex-appserver-transcript-ui` supersedes that temporary diagnostic-only constraint by adding native transcript rendering and browser turn input. The route consumer contract now preserves metadata routing while requiring xterm/ttyd fallback for unsupported, stale, failed, mobile, and explicit recovery paths.

## Acceptance Criteria

- Codex sessions whose display route is `codex_app_server` may open the native App Server transcript panel by default when `story-codex-appserver-transcript-ui` is present.
- xterm/ttyd remains available through explicit terminal transport fallback and automatic unsupported, stale, failed transcript, and mobile fallback paths.
- The route consumer includes the required UI wiring: `public/app.js` registers the display mixin, `public/index.html` provides the panel host, and `public/style.css` makes that host usable in the terminal stage.
- Successful App Server transcript display sessions do not call `_resolveSessionRuntime()`, `_ensureDesktopTerminalRuntime()`, `_connectXtermTransport()`, or ttyd proxy resolution during the route switch.
- The App Server display panel exposes the Brainbase session id and Codex App Server thread id for inspection.
- When the App Server transcript panel is active, legacy terminal input must not send terminal input unless the user explicitly switches to xterm/ttyd fallback.
- The terminal fallback remains available in route metadata and through current UI controls.
- Claude Code sessions still use the existing xterm/ttyd terminal path.
- Codex sessions without usable App Server thread metadata still use the existing xterm/ttyd terminal path.
- Mobile snapshot behavior remains unchanged in this slice.
- Graphify Impact Review is recorded because `session-ui-state` and session switching are graph-sensitive UI state paths.

## Out Of Scope

- Removing xterm, ttyd, or terminal fallback.
