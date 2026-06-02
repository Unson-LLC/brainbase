# Codex App Server assistant-ui transcript panel

## Story

As a Brainbase user working in a Codex App Server-backed session, I want the transcript surface to use a polished assistant-ui style thread and composer, so the session reads like a structured assistant conversation instead of a raw terminal log.

## Acceptance Criteria

- The Codex App Server transcript panel is mounted as a React island inside the existing terminal stage.
- The island uses assistant-ui runtime/thread/composer primitives for the chat surface while preserving Brainbase's existing App Server transcript and turn APIs.
- User, assistant, reasoning, command, file change, tool, input request, turn, and error timeline items remain visually distinguishable.
- Browser input still posts to `POST /api/sessions/:id/codex-app-server/turns` and never sends terminal input in transcript mode.
- The panel handles loading, empty, sending, refresh, and error states with explicit visible UI.
- The xterm/ttyd fallback, mobile fallback, and Claude Code terminal route remain unchanged.
- assistant-ui is a build-time dependency for the browser island bundle and does not add production Node dependency audit surface.
- If the transcript island mount root or session id is unavailable, the shell must leave the existing terminal/fallback surface intact instead of partially mounting transcript UI.

## Out Of Scope

- Replacing the full Brainbase shell with React.
- Removing terminal fallback.
- Persisting full transcript history outside the bounded session ledger.
