---
story_id: story-codex-appserver-session-create
title: Retired Codex App Server backed session creation
status: retired
retired_reason: Brainbase-owned Session Launch Picker and session-creation APIs were retired; Codex app/CLI owns task and worktree creation.
historical_lineage:
  capability: codex.app-server
  current_boundary: project.provisioning
  successor_owner: Codex app/CLI
updated_at: 2026-09-01
---

# Retired story: Codex App Server backed session creation

> Retired historical lineage. This document records a former Brainbase-owned
> session-creation proposal and its implementation evidence. It is not a
> current production path or requirement. The Session Launch Picker and
> Brainbase session-creation APIs are retired and unreachable; Project
> Provisioning is the current project-registration boundary, and Codex app/CLI
> owns task and worktree creation.

## Current ownership boundary

- Project Provisioning owns canonical project identity, Registry/Graph
  registration, and explicit access grants; it does not create Codex sessions.
- The server-side `session.create`/static endpoint and browser Session Launch
  Picker are retired and unreachable; neither is a Project Provisioning entry
  point or acceptance-evidence surface. The former `/api/sessions` creation
  endpoints are therefore not reachable.
- Codex app/CLI owns task and worktree creation and ownership.
- Workspace Setup is only a browser Project Catalog consumer for each user's
  local path; it does not create projects, tasks, or sessions.
- The sections below preserve the former path as historical evidence only.

## Historical context (retired)

At the time this story was drafted, Brainbase could persist
`session.codexAppServer` metadata and derive a Codex App Server display route
for Codex sessions with non-stale App Server thread metadata. A live check of
the then-current `OSS化` Codex session on port 31013 showed that normal session
creation still started the legacy `codex/pty-shim-heartbeat` path and left
`session.codexAppServer` unset. That observation and the proposed remedy are
historical; they do not authorize restoring the retired picker or APIs.

## Historical user story (retired)

As a Brainbase user creating a new Codex session, I want the session creation path to start Codex through the App Server REPL and persist App Server thread metadata before creation is reported successful, so App Server identity and activity are available while the interactive xterm route remains usable until native App Server input exists.

## Historical scope (retired)

- Make normal Codex session creation request the App Server REPL path.
- Make Codex worktree session creation request the App Server REPL path.
- Preserve Claude Code session creation and terminal/xterm fallback.
- Fail loudly when a requested Codex App Server session starts but does not persist thread metadata.
- Update the capability map so `session.create` and `codex.app-server` describe the new creation boundary.

## Historical acceptance criteria (retired)

The following criteria belonged to the retired Brainbase session-creation
slice. Checked items are historical evidence, not current acceptance criteria.

- [x] AC-1: `POST /api/sessions/start` accepts a Codex App Server creation request and passes `BRAINBASE_CODEX_APP_SERVER=1` to the runtime startup path.
- [x] AC-2: Regular new Codex sessions request Codex App Server startup from the browser session service.
- [x] AC-3: Worktree new Codex sessions request Codex App Server startup from the server-side worktree creation path.
- [x] AC-4: Codex App Server creation waits until `session.codexAppServer.threadId` or `session.codexAppServer.restore.threadId` is persisted before returning success.
- [x] AC-5: Claude Code sessions do not set `BRAINBASE_CODEX_APP_SERVER` and keep the existing terminal path.
- [x] AC-6: Existing Codex sessions without App Server metadata keep terminal fallback unless they are explicitly started through this creation request.
- [x] AC-7: If App Server metadata is not persisted after runtime startup, the just-started runtime is stopped before creation failure is reported.
- [x] AC-8: Regular and worktree Codex creation paths have browser evidence that the persisted App Server thread id is stored while the user-facing terminal remains interactive.
- [x] AC-9: Cold Codex App Server startup is allowed enough time to persist `thread/started` metadata before the controller reports metadata failure.

## Historical verification mapping (retired)

- AC-1: `tests/server/session-manager-env.test.js`, `tests/unit/server-session-controller.test.js`, and `tests/e2e/story-codex-appserver-session-create-contract.spec.ts`.
- AC-2: `tests/domain/session/session-service.test.js` and `tests/e2e/story-codex-appserver-session-create-contract.spec.ts`.
- AC-3: `tests/unit/server-session-controller.test.js` and `tests/e2e/story-codex-appserver-session-create-contract.spec.ts`.
- AC-4: `tests/server/controllers/codex-app-server-startup.test.js`, `tests/unit/server-session-controller.test.js`, and `tests/e2e/story-codex-appserver-session-create-contract.spec.ts`.
- AC-5: `tests/server/session-manager-env.test.js` and `tests/e2e/story-codex-appserver-session-create-contract.spec.ts`.
- AC-6: `tests/server/session-manager-env.test.js`, `tests/server/controllers/codex-app-server-startup.test.js`, and `tests/e2e/story-codex-appserver-session-create-contract.spec.ts`.
- AC-7: `tests/unit/server-session-controller.test.js`.
- AC-8: `tests/e2e/story-codex-appserver-session-create-contract.spec.ts`.
- AC-9: `tests/unit/server-session-controller.test.js` verifies the controller metadata wait defaults and env overrides.

## Historical production-path record (retired)

The following matrix describes the former implementation path and is retained
only to explain the historical lineage.

- Former regular Codex creation: the retired launch picker called
  `/api/sessions/start` with `codexAppServer: true`; the server waited for
  thread metadata; the browser kept the interactive terminal path while App
  Server metadata was stored.
- Former worktree Codex creation: the retired launch picker called
  `/api/sessions/create-with-worktree`; the server started the pending shell,
  waited for thread metadata, marked startup ready, and the browser kept the
  interactive terminal path while App Server metadata was stored.
- Former metadata timeout behavior: regular and worktree controllers stopped
  the started runtime before surfacing failure; worktree cleanup also removed
  the created worktree and marked startup failed.
- Former cold App Server startup behavior: the controller defaulted to waiting
  up to 45 seconds for metadata, with
  `BRAINBASE_CODEX_APP_SERVER_METADATA_TIMEOUT_MS` and
  `BRAINBASE_CODEX_APP_SERVER_METADATA_INTERVAL_MS` as operational overrides.
- Former Claude Code behavior: no App Server environment flag or display route
  change.
- Former legacy Codex fallback: startup without explicit App Server opt-in and
  sessions without usable metadata remained on terminal/xterm fallback.

## Historical out of scope (retired)

- Rendering full Codex App Server transcript items in the browser.
- Replacing all terminal/xterm fallback behavior.
- Migrating legacy Codex sessions automatically.
- Changing Claude Code startup, resume, or xterm behavior.

## Historical preserved behavior (retired)

- `restoreFromCache()` continues to restore `currentSessionId` when present; this story only preserves `codexAppServer` metadata inside cached sessions.
- Existing `intendedState === 'stopped'` migration to `paused` remains unchanged.
- Existing previous-session comparison and session patch behavior remains unchanged except for retaining App Server metadata.
- Existing `sessionFilter` and current-session fallback behavior remains unchanged.
- Existing startup, archive, and ordering flows remain unchanged unless they explicitly create a new Codex App Server session.
- Existing platform-specific runtime binary resolution remains unchanged, including Windows `USERPROFILE`, `fs.existsSync(userGit)`, Git Bash, and ttyd lookup branches.
