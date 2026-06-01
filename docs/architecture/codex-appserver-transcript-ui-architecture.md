# ADR: Codex App Server transcript UI

## Context

Codex App Server exposes structured thread, turn, item, command, reasoning, and error notifications. Brainbase currently starts the App Server REPL inside ttyd, so the browser only sees terminal stdout. That preserves operability but loses the main benefit of App Server: structured UI state.

## Decision

Introduce a native App Server transcript path with three boundaries:

- Server-owned App Server connection and turn control.
- Bounded session event ledger for restore and rendering.
- Browser transcript panel and composer that consume structured events.

The existing xterm route remains the recovery and compatibility path.

## Design

- Add a server-side App Server session controller that owns the JSON-RPC connection for a Brainbase session.
- Route browser App Server input to a dedicated API, for example `POST /api/sessions/:id/codex-app-server/turns`, instead of ttyd terminal input.
- Keep browser registration, DOM host markup, CSS styling, and capability-map updates in this same slice. Without `public/app.js`, `public/index.html`, `public/style.css`, and `docs/brainbase-capabilities/capabilities/codex.app-server.yml`, the transcript control path is either unreachable, invisible, unstyled, or missing from Brainbase's capability source of truth.
- Maintain bounded transcript state under session-owned server runtime, not Graph SSOT:
  - thread id
  - active and completed turn ids
  - timeline item envelopes
  - assistant text deltas merged into display messages
  - command output chunks with truncation metadata
  - error notifications
  - timestamps
- Refresh the active browser from the transcript API; a future push channel can replace polling without changing the browser renderer contract.
- Mount the polished transcript renderer as an assistant-ui React island so the rest of the Brainbase shell and terminal fallback remain unchanged.
- Render App Server transcript mode in the existing terminal stage only when the session has non-stale App Server metadata and the server App Server control path is ready.
- Keep xterm fallback as an explicit mode switch and automatic fallback when App Server control is unavailable.
- Keep mobile App Server sessions on the snapshot fallback path until the desktop transcript composer is explicitly supported on mobile, and show a visible reason that the transcript panel is desktop-only on mobile.
- Do not let legacy terminal input handlers send text while App Server transcript mode is active.
- Preserve execution policy: the browser turn API does not inject `never` approval or `danger-full-access` sandbox defaults; it only forwards explicit session App Server policy metadata when present.
- Persist failed browser turn starts into the bounded server ledger so polling does not erase visible errors.
- Bind the transcript service to session lifecycle cleanup. Stop, hibernate, and archive routes must dispose the cached App Server adapter for that Brainbase session so a transcript-owned child process cannot survive after the session is paused, hibernated, or archived.

## Consequences

- App Server sessions become usable without a terminal REPL.
- The UI can render assistant output, command output, errors, and turn state from first-class events.
- Browser-side input must move from terminal transport to App Server turn APIs for these sessions.
- Additional restore and retention rules are required because transcript state is now owned by Brainbase, not only Codex JSONL files.

## Verification

- Unit tests for event normalization and bounded ledger updates.
- API/service tests for App Server turn creation, route wiring, visible errors, persisted failed-turn errors, and fallback responses.
- Lifecycle tests for stop, hibernate, and archive cleanup of transcript-owned App Server adapters.
- UI integration tests for transcript rendering, composer availability, refresh startup, and xterm fallback.
- Playwright runtime smoke proving a Codex App Server session loads the transcript route, submits composer input through the turn route, renders assistant/error timeline items, and never calls ttyd terminal input/ensure APIs.
- Port 31013 live Codex CLI smoke remains an optional operational check because the contract is covered by the browser/API route smoke and server service tests.
