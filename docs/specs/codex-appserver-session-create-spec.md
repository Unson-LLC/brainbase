# Spec: Codex App Server backed session creation

## Requirements

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

## Workflow Scenarios

- **S-1 regular-codex-create**: Browser launch picker -> `SessionService._createRegularSession()` -> `/api/sessions/start` -> `runtimeLifecycle.startTtyd({ engine: "codex", codexAppServer: true })` -> persisted non-stale App Server thread metadata -> success response with `codexAppServer.threadId` -> session switch resolves to the Codex App Server display route.
- **S-2 worktree-codex-create**: Browser launch picker with worktree -> `/api/sessions/create-with-worktree` -> pending startup shell -> `runtimeLifecycle.startTtyd({ engine: "codex", codexAppServer: true })` -> persisted non-stale App Server thread metadata -> ready startup state -> session switch resolves to the Codex App Server display route.
- **S-3 metadata-timeout-cleanup**: `startTtyd()` succeeds but no non-stale App Server thread id is persisted -> controller calls `stopTtyd(sessionId)` -> regular creation returns failure before success; worktree creation marks startup failed and removes the worktree.
- **S-4 claude-fallback**: Browser or server creation with `engine === "claude"` never sets `BRAINBASE_CODEX_APP_SERVER` and keeps the xterm/ttyd display path.
- **S-5 legacy-codex-fallback**: Codex runtime startup without explicit App Server request never sets `BRAINBASE_CODEX_APP_SERVER`; Codex sessions without usable App Server metadata keep terminal fallback.
- **S-6 cache-display-preservation**: Cached or reloaded sessions retain `session.codexAppServer` metadata so display-route derivation remains stable after state reload.

## Verification

- Unit: server start handler passes `codexAppServer` and returns App Server thread metadata.
- Unit: session service sends `codexAppServer: true` for regular Codex creation.
- Unit: session service preserves `codexAppServer` metadata through localStorage cache restore.
- Unit: runtime lifecycle sets `BRAINBASE_CODEX_APP_SERVER=1` for Codex App Server startup.
- Unit: metadata timeout after runtime startup calls `stopTtyd()` before returning failure.
- E2E: regular Codex launch picker creation reaches the Codex App Server display panel with the persisted thread id.
- E2E: worktree Codex launch picker creation uses the worktree route and reaches the Codex App Server display panel with the persisted thread id.
- Contract: Story, spec, runtime, session service, and capability map all mention the creation boundary.
