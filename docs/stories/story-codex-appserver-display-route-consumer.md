# Codex App Server display route consumer

## Story

As a Brainbase user switching between sessions, I want Codex sessions that already have Codex App Server thread metadata to keep an interactive xterm fallback by default, while an explicit diagnostic flag can still open the read-only App Server display surface for route inspection.

## Background

`story-codex-appserver-thread-session-foundation` added a read-only `displayRoute` derived from `session.codexAppServer` metadata. The route consumer initially exposed a read-only App Server panel, but that panel cannot accept input yet. Until the App Server transcript/input path exists, operator sessions must default to xterm so the user can keep working.

## Acceptance Criteria

- Codex sessions whose display route is `codex_app_server` keep the existing xterm/ttyd terminal path by default so the session remains interactive.
- A dedicated Codex App Server display panel can be enabled only through an explicit diagnostic browser flag.
- The route consumer includes the required UI wiring: `public/app.js` registers the display mixin, `public/index.html` provides the panel host, and `public/style.css` makes that host usable in the terminal stage.
- Diagnostic App Server display sessions do not call `_resolveSessionRuntime()`, `_ensureDesktopTerminalRuntime()`, `_connectXtermTransport()`, or ttyd proxy resolution during the route switch.
- The App Server display panel exposes the Brainbase session id and Codex App Server thread id for inspection.
- The App Server display is read-only in this slice; when the diagnostic panel is active, legacy terminal input, reconnect, and fallback controls must not send terminal input or start terminal runtime.
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
