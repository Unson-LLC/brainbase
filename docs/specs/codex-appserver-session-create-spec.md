---
spec_id: codex-appserver-session-create-spec
title: Retired Codex App Server backed session creation specification
source_story: docs/stories/story-codex-appserver-session-create.md
source_architecture: docs/architecture/codex-appserver-session-create-architecture.md
status: retired
retired_reason: Brainbase-owned Session Launch Picker and session-creation APIs were retired; Codex app/CLI owns task and worktree creation.
historical_lineage:
  capability: codex.app-server
  current_boundary: project.provisioning
  successor_owner: Codex app/CLI
updated_at: 2026-09-01
---

# Retired spec: Codex App Server backed session creation

> Retired historical specification. REQ-* and scenario entries below preserve
> the former Brainbase session-creation contract as historical evidence only;
> they are not current MUST requirements. Project Provisioning is the current
> project-registration boundary. The Session Launch Picker and Brainbase
> `/api/sessions` creation APIs are retired and unreachable, while Codex
> app/CLI owns task and worktree creation.

## Current contract

This retired spec defines no current Brainbase session-creation contract.

- Project Provisioning owns project identity, Registry/Graph registration, and
  explicit access grants.
- The server-side `session.create`/static endpoint and browser Session Launch
  Picker are retired and unreachable; neither is a Project Provisioning entry
  point or acceptance-evidence surface. No current flow calls the former
  `/api/sessions` creation APIs.
- Codex app/CLI owns task and worktree creation and ownership.
- Workspace Setup only consumes the authenticated Project Catalog for a user's
  local path.

## Historical requirements (retired)

All requirements in this section are historical MUST requirements from the
retired implementation slice. They must not be read as current runtime
requirements or as permission to restore the retired picker/API path.

- **REQ-1**: `SessionService._createRegularSession()` MUST send `codexAppServer: true` to `/api/sessions/start` when `engine === "codex"`.
- **REQ-2**: `SessionController.start()` MUST pass `codexAppServer: true` to `runtimeLifecycle.startTtyd()` only when `engine === "codex"` and the request explicitly asks for Codex App Server.
- **REQ-3**: `createWithWorktree` MUST pass `codexAppServer: true` to `runtimeLifecycle.startTtyd()` for Codex worktree sessions.
- **REQ-4**: `runtimeLifecycle.ensureSessionRuntime()` and `runtimeLifecycle.startTtyd()` MUST set `BRAINBASE_CODEX_APP_SERVER=1` only when `engine === "codex"` and `codexAppServer === true`.
- **REQ-5**: App Server-requested Codex creation MUST wait for a non-stale App Server thread id in `session.codexAppServer.threadId` or `session.codexAppServer.restore.threadId`.
- **REQ-6**: Claude Code startup MUST remain unchanged and MUST NOT set `BRAINBASE_CODEX_APP_SERVER`.
- **REQ-7**: Existing Codex terminal fallback MUST remain available for sessions without App Server metadata.
- **REQ-8**: Client session cache persistence MUST retain `session.codexAppServer` metadata when restoring cached sessions.
- **REQ-9**: Existing client-side session selection, stopped-to-paused migration, previous-session patch comparison, session filtering, and current-session fallback behavior MUST remain unchanged.
- **REQ-10**: Existing runtime binary resolution MUST remain unchanged, including Windows `USERPROFILE`, `fs.existsSync(userGit)`, Git Bash, and ttyd lookup branches.
- **REQ-11**: If Codex App Server metadata is not persisted after runtime startup, the controller MUST stop the just-started runtime before reporting failure.
- **REQ-12**: Codex App Server metadata wait defaults MUST tolerate cold startup latency; the timeout and polling interval MUST be configurable by environment variables for local operations.

## Historical workflow scenarios (retired)

- **S-1 regular-codex-create**: Browser launch picker -> `SessionService._createRegularSession()` -> `/api/sessions/start` -> `runtimeLifecycle.startTtyd({ engine: "codex", codexAppServer: true })` -> persisted non-stale App Server thread metadata -> success response with `codexAppServer.threadId` -> session switch keeps the interactive terminal route by default.
- **S-2 worktree-codex-create**: Browser launch picker with worktree -> `/api/sessions/create-with-worktree` -> pending startup shell -> `runtimeLifecycle.startTtyd({ engine: "codex", codexAppServer: true })` -> persisted non-stale App Server thread metadata -> ready startup state -> session switch keeps the interactive terminal route by default.
- **S-3 metadata-timeout-cleanup**: `startTtyd()` succeeds but no non-stale App Server thread id is persisted -> controller calls `stopTtyd(sessionId)` -> regular creation returns failure before success; worktree creation marks startup failed and removes the worktree.
- **S-4 claude-fallback**: Browser or server creation with `engine === "claude"` never sets `BRAINBASE_CODEX_APP_SERVER` and keeps the xterm/ttyd display path.
- **S-5 legacy-codex-fallback**: Codex runtime startup without explicit App Server request never sets `BRAINBASE_CODEX_APP_SERVER`; Codex sessions without usable App Server metadata keep terminal fallback.
- **S-6 cache-display-preservation**: Cached or reloaded sessions retain `session.codexAppServer` metadata so display-route derivation remains stable after state reload.
- **S-7 cold-start-wait**: A requested Codex App Server session may take longer than five seconds to emit `thread/started`; controller defaults wait 45 seconds and polls every 250ms before treating metadata as failed.

## Historical verification record (retired)

- Unit: server start handler passes `codexAppServer` and returns App Server thread metadata.
- Unit: session service sends `codexAppServer: true` for regular Codex creation.
- Unit: session service preserves `codexAppServer` metadata through localStorage cache restore.
- Unit: runtime lifecycle sets `BRAINBASE_CODEX_APP_SERVER=1` for Codex App Server startup.
- Unit: metadata timeout after runtime startup calls `stopTtyd()` before returning failure.
- Unit: controller metadata wait defaults and env overrides are stable.
- E2E: regular Codex launch picker creation persists the App Server thread id and keeps the user-facing terminal interactive.
- E2E: worktree Codex launch picker creation uses the worktree route, persists the App Server thread id, and keeps the user-facing terminal interactive.
- Contract: Story, spec, runtime, session service, and capability map all mention the creation boundary.
