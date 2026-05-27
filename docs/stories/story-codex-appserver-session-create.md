# story-codex-appserver-session-create: Codex App Server backed session creation

## Context

Brainbase can already persist `session.codexAppServer` metadata and derive a Codex App Server display route for Codex sessions with non-stale App Server thread metadata. A live check of the new `OSS化` Codex session on port 31013 showed that normal session creation still starts the legacy `codex/pty-shim-heartbeat` path and leaves `session.codexAppServer` unset.

## User Story

As a Brainbase user creating a new Codex session, I want the session creation path to start Codex through the App Server REPL and persist App Server thread metadata before creation is reported successful, so App Server identity and activity are available while the interactive xterm route remains usable until native App Server input exists.

## Scope

- Make normal Codex session creation request the App Server REPL path.
- Make Codex worktree session creation request the App Server REPL path.
- Preserve Claude Code session creation and terminal/xterm fallback.
- Fail loudly when a requested Codex App Server session starts but does not persist thread metadata.
- Update the capability map so `session.create` and `codex.app-server` describe the new creation boundary.

## Acceptance Criteria

- [x] AC-1: `POST /api/sessions/start` accepts a Codex App Server creation request and passes `BRAINBASE_CODEX_APP_SERVER=1` to the runtime startup path.
- [x] AC-2: Regular new Codex sessions request Codex App Server startup from the browser session service.
- [x] AC-3: Worktree new Codex sessions request Codex App Server startup from the server-side worktree creation path.
- [x] AC-4: Codex App Server creation waits until `session.codexAppServer.threadId` or `session.codexAppServer.restore.threadId` is persisted before returning success.
- [x] AC-5: Claude Code sessions do not set `BRAINBASE_CODEX_APP_SERVER` and keep the existing terminal path.
- [x] AC-6: Existing Codex sessions without App Server metadata keep terminal fallback unless they are explicitly started through this creation request.
- [x] AC-7: If App Server metadata is not persisted after runtime startup, the just-started runtime is stopped before creation failure is reported.
- [x] AC-8: Regular and worktree Codex creation paths have browser evidence that the persisted App Server thread id is stored while the user-facing terminal remains interactive.
- [x] AC-9: Cold Codex App Server startup is allowed enough time to persist `thread/started` metadata before the controller reports metadata failure.

## Verification Mapping

- AC-1: `tests/server/session-manager-env.test.js`, `tests/unit/server-session-controller.test.js`, and `tests/e2e/story-codex-appserver-session-create-contract.spec.ts`.
- AC-2: `tests/domain/session/session-service.test.js` and `tests/e2e/story-codex-appserver-session-create-contract.spec.ts`.
- AC-3: `tests/unit/server-session-controller.test.js` and `tests/e2e/story-codex-appserver-session-create-contract.spec.ts`.
- AC-4: `tests/server/controllers/codex-app-server-startup.test.js`, `tests/unit/server-session-controller.test.js`, and `tests/e2e/story-codex-appserver-session-create-contract.spec.ts`.
- AC-5: `tests/server/session-manager-env.test.js` and `tests/e2e/story-codex-appserver-session-create-contract.spec.ts`.
- AC-6: `tests/server/session-manager-env.test.js`, `tests/server/controllers/codex-app-server-startup.test.js`, and `tests/e2e/story-codex-appserver-session-create-contract.spec.ts`.
- AC-7: `tests/unit/server-session-controller.test.js`.
- AC-8: `tests/e2e/story-codex-appserver-session-create-contract.spec.ts`.
- AC-9: `tests/unit/server-session-controller.test.js` verifies the controller metadata wait defaults and env overrides.

## Production Path Matrix

- Regular Codex creation: launch picker calls `/api/sessions/start` with `codexAppServer: true`; server waits for thread metadata; browser keeps the interactive terminal path while App Server metadata is stored.
- Worktree Codex creation: launch picker calls `/api/sessions/create-with-worktree`; server starts the pending shell, waits for thread metadata, marks startup ready, and browser keeps the interactive terminal path while App Server metadata is stored.
- Metadata timeout: regular and worktree controllers stop the started runtime before surfacing failure; worktree cleanup also removes the created worktree and marks startup failed.
- Cold App Server startup: controller defaults wait up to 45 seconds for metadata, with `BRAINBASE_CODEX_APP_SERVER_METADATA_TIMEOUT_MS` and `BRAINBASE_CODEX_APP_SERVER_METADATA_INTERVAL_MS` available for operations tuning.
- Claude Code creation: no App Server env flag or display route change.
- Legacy Codex fallback: Codex startup without explicit App Server opt-in and Codex sessions without usable metadata remain on terminal/xterm fallback.

## Out Of Scope

- Rendering full Codex App Server transcript items in the browser.
- Replacing all terminal/xterm fallback behavior.
- Migrating legacy Codex sessions automatically.
- Changing Claude Code startup, resume, or xterm behavior.

## Preserved Existing Behavior

- `restoreFromCache()` continues to restore `currentSessionId` when present; this story only preserves `codexAppServer` metadata inside cached sessions.
- Existing `intendedState === 'stopped'` migration to `paused` remains unchanged.
- Existing previous-session comparison and session patch behavior remains unchanged except for retaining App Server metadata.
- Existing `sessionFilter` and current-session fallback behavior remains unchanged.
- Existing startup, archive, and ordering flows remain unchanged unless they explicitly create a new Codex App Server session.
- Existing platform-specific runtime binary resolution remains unchanged, including Windows `USERPROFILE`, `fs.existsSync(userGit)`, Git Bash, and ttyd lookup branches.
