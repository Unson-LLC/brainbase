---
story_id: story-codex-app-server-adapter
title: Codex App Server adapter first slice
source_requirement:
  nocodb_table: none
  requirement_id: none
  requirement_title: User-requested VibePro implementation
architecture_docs:
  - path: docs/architecture/codex-app-server-adapter-architecture.md
    status: created
related_tasks:
  - task_source: VibePro
    task_ids: []
status: draft
created_at: 2026-05-22
updated_at: 2026-05-22
---

# story-codex-app-server-adapter: Codex App Server adapter first slice

## 背景

Brainbase currently treats Codex sessions primarily as terminal-backed runtime sessions. That gives users a familiar xterm workflow, but it also forces Brainbase to infer agent state from terminal snapshots, PTY input, focus reports, and rendered text.

OpenAI Codex App Server exposes Codex as a JSON-RPC protocol for rich clients. It provides first-class concepts such as threads, turns, streamed items, command execution, file changes, approvals, and review events. Brainbase can use this protocol as the foundation for a more structured AI work OS while keeping the existing terminal path available.

## 現状

- Brainbase session creation can launch Codex through existing session and terminal runtime paths.
- Terminal transport is responsible for user input, snapshots, readiness, local echo, paste behavior, focus-report filtering, and xterm redraws.
- Brainbase has a context layer made of Graph SSOT, Philosophy Context, candidate-store promotion, ACL-aware retrieval, and MCP/API access.
- Codex App Server exists locally as `codex app-server` and supports stdio JSON-RPC.

## 変更内容

### 誰が

- Brainbase backend services
- Future Brainbase UI session surfaces
- Agents using Brainbase as the control plane

### 何を

- Add a backend adapter that starts `codex app-server` over stdio.
- Initialize the app-server connection using Brainbase client metadata.
- Provide request/notification primitives for JSON-RPC messages.
- Provide minimal thread and turn helpers for the first slice.
- Emit app-server notifications as structured Brainbase-side events.
- Keep existing terminal transport unchanged in this story.

### なぜ

- Brainbase can represent Codex work as structured execution state instead of terminal text.
- Future UI can show plans, diffs, file changes, approvals, and command runs as first-class workflow items.
- Brainbase context layer can later be injected into Codex turns without relying on prompt-only terminal interaction.

## 受け入れ基準

- [ ] A backend service can spawn `codex app-server` with stdio transport.
- [ ] The service sends `initialize` and `initialized` before normal requests.
- [ ] The service can send `thread/start` and `turn/start` JSON-RPC requests.
- [ ] JSON-RPC responses resolve or reject the matching pending request by id.
- [ ] Notifications without ids are emitted as structured events.
- [ ] Process exit rejects pending requests and marks the adapter stopped.
- [ ] Unit tests cover initialization handshake, request/response, notifications, thread/turn helpers, helper validation, interruption, malformed stdout, request rejection before initialization, timeout cleanup, stop cleanup, start idempotency, child process errors, initialization failure cleanup, and process exit.
- [ ] Capability Map documents the new adapter boundary and verification command.
- [ ] Existing xterm/tmux terminal transport files are not modified by this slice.

## スコープ外

- Replacing the existing xterm/tmux Codex session UI.
- Exposing a public API route for App Server sessions.
- Persisting Codex threads into Brainbase state.
- Rendering App Server events in the browser UI.
- Wiring Graph SSOT or Philosophy Context into turn input.
- Remote WebSocket transport, bearer token auth, or non-loopback exposure.

---

**ガードレール**: This first slice creates a tested backend adapter only. It must not remove or weaken the existing terminal transport.
