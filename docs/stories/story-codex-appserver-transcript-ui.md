# Codex App Server transcript UI

## Story

As a Brainbase user operating a Codex session, I want a native Codex App Server transcript view with a ChatGPT-like message timeline and input composer, so I can work with Codex through structured thread and turn events instead of reading a terminal REPL.

## Background

The current Codex App Server slices persist thread metadata, report activity, derive display-route state, and keep xterm as the default fallback. `story-codex-appserver-display-route-consumer` and `story-codex-appserver-xterm-default-fallback` explicitly leave transcript rendering and browser-side input out of scope. That makes App Server-backed sessions technically available but not the user experience we actually want.

## Acceptance Criteria

- Codex App Server-backed Codex sessions render a structured transcript panel by default when the App Server transcript feature is not explicitly disabled.
- The transcript panel shows user messages, assistant message deltas, reasoning summaries when available, command execution output, file change summaries, tool/input requests, errors, and turn completion state as distinct timeline items.
- The same slice includes the browser registration, HTML host, CSS, and capability-map update required to make the transcript surface reachable and inspectable: `public/app.js`, `public/index.html`, `public/style.css`, and `docs/brainbase-capabilities/capabilities/codex.app-server.yml`.
- Browser input for App Server sessions sends `turn/start` through a server-owned App Server control path rather than ttyd/xterm terminal input.
- App Server notifications update the visible transcript incrementally through the bounded server ledger and browser refresh path without parsing terminal text.
- App Server turn errors are visible in the transcript and do not collapse into an empty prompt redraw.
- A bounded session event ledger stores only the App Server thread, turn, item, and display fields required for active session restore and transcript rendering.
- Session stop, hibernate, and archive flows stop any cached transcript-owned Codex App Server adapter so App Server child processes do not outlive the Brainbase session lifecycle.
- xterm/ttyd fallback remains available for unsupported sessions, stale App Server metadata, App Server startup failure, and explicit fallback actions.
- The UI clearly distinguishes App Server transcript mode from xterm mode using existing session display state, without hiding terminal fallback controls needed for recovery.
- Session switching restores the latest App Server transcript state for the selected session before accepting new App Server input.
- Claude Code sessions continue to use the existing xterm path.
- Mobile behavior is either explicitly supported by the new transcript composer or kept on the current fallback path with a visible reason.

## Out Of Scope

- Writing raw App Server event streams into Graph SSOT.
- Removing xterm, ttyd, or terminal fallback.
- Replacing Claude Code terminal transport.
- Long-term archival policy for full transcripts beyond the bounded session ledger.
