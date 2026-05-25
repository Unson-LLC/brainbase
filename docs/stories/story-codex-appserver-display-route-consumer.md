# Codex App Server display route consumer

## Story

As a Brainbase user switching between sessions, I want Codex sessions that already have Codex App Server thread metadata to open on an App Server display surface instead of immediately attaching xterm, while Claude Code and Codex sessions without usable App Server metadata continue to use the existing terminal route.

## Background

`story-codex-appserver-thread-session-foundation` added a read-only `displayRoute` derived from `session.codexAppServer` metadata. The next slice consumes that route in the session switching/display path. This must not remove terminal fallback because the App Server transcript/input path is not complete yet.

## Acceptance Criteria

- Codex sessions whose display route is `codex_app_server` show a dedicated Codex App Server display panel during `switchSession()`.
- The route consumer includes the required UI wiring: `public/app.js` registers the display mixin, `public/index.html` provides the panel host, and `public/style.css` makes that host usable in the terminal stage.
- App Server display sessions do not call `_resolveSessionRuntime()`, `_ensureDesktopTerminalRuntime()`, `_connectXtermTransport()`, or ttyd proxy resolution during the route switch.
- The App Server display panel exposes the Brainbase session id and Codex App Server thread id for inspection.
- The App Server display is read-only in this slice; legacy terminal input, reconnect, and fallback controls must not send terminal input or start terminal runtime while that panel is active.
- The terminal fallback remains available in route metadata and can be used by later UI controls.
- Claude Code sessions still use the existing xterm/ttyd terminal path.
- Codex sessions without usable App Server thread metadata still use the existing xterm/ttyd terminal path.
- Mobile snapshot behavior remains unchanged in this slice.
- Graphify Impact Review is recorded because `session-ui-state` and session switching are graph-sensitive UI state paths.

## Out Of Scope

- Starting App Server turns from the browser.
- Rendering full App Server transcript items.
- Persisting App Server event ledgers.
- Removing xterm, ttyd, or terminal fallback.
