---
story_id: story-codex-appserver-thread-session-foundation
title: Codex App Server thread session foundation
source_requirement:
  nocodb_table: none
  requirement_id: none
  requirement_title: User-approved staged Codex App Server session migration
architecture_docs:
  - path: docs/architecture/codex-appserver-thread-session-foundation-architecture.md
    status: created
related_tasks:
  - task_source: VibePro
    task_ids: []
status: draft
created_at: 2026-05-25
updated_at: 2026-05-25
---

# story-codex-appserver-thread-session-foundation: Codex App Server thread session foundation

## Background

Brainbase now has a Codex App Server adapter, an activity bridge, and durable `session.codexAppServer` metadata for thread and turn identity. The next migration step is to let Brainbase recognize Codex sessions that can be displayed as App Server thread sessions while preserving the existing xterm terminal route.

## Change

- Add a narrow session display-route contract.
- Classify only Codex sessions with non-stale App Server thread metadata as App Server-display eligible.
- Keep Codex sessions without App Server metadata on the xterm fallback route.
- Keep Claude Code sessions on the xterm route even if malformed App Server metadata exists.
- Expose the route as read-only UI state for later session switching and panel work.

## Acceptance Criteria

- [ ] Codex sessions with `session.codexAppServer.threadId` resolve to `codex_app_server`.
- [ ] Codex sessions with `session.codexAppServer.restore.threadId` resolve to `codex_app_server`.
- [ ] Codex sessions without App Server thread metadata resolve to `terminal_xterm`.
- [ ] Stale App Server metadata resolves to `terminal_xterm`.
- [ ] Claude Code sessions never resolve to `codex_app_server`.
- [ ] `deriveSessionUiState()` exposes the display route without changing terminal transport behavior.
- [ ] Terminal transport files remain unchanged in this slice.
- [ ] Capability Map documents the staged App Server display boundary and fallback.

## Out Of Scope

- Rendering an App Server transcript panel.
- Sending user input through `turn/start`.
- Replacing xterm/tmux transport.
- Changing Claude Code session behavior.
- Persisting full App Server item timelines.
