# Spec: Session shell-first startup UX

## Invariants

- INV-1: Session creation UI must not block on worktree creation or terminal runtime startup before showing the selected session shell.
- INV-2: A session with `startupStatus: pending` must never start ttyd, xterm transport, terminal ensure, or terminal snapshot loading from its temporary canonical repo path.
- INV-3: A queued startup prompt must be sent at most once and only after the background startup call returns a usable session runtime.
- INV-4: Startup failure must preserve the user's prompt draft or queued prompt in the visible composer.
- INV-5: Existing non-startup terminal input paths must continue to use `TerminalInteractionService`.
- INV-6: Reloading a browser with a pending startup shell must not issue a duplicate worktree create request for the same session ID.
- INV-7: A persisted queued startup prompt must survive reload and flush once when the existing startup later becomes ready.
- INV-8: A pending startup shell whose background job never completes must become retryable instead of remaining pending indefinitely.
- INV-9: Existing `sessionFilter` and `showArchivedSessions` semantics must continue to determine visible sessions and next-session selection after delete; startup shell lifecycle changes must not broaden or bypass those filters.

## Contracts

- CON-1: `SessionService.createPendingSessionShell()` persists and inserts an active session shell with `startupStatus: pending` before the slow worktree startup call begins.
- CON-2: `App.createSession()` for worktree sessions returns after creating and selecting the shell; it continues the slow startup in the background.
- CON-3: `switchSession()` treats `startupStatus: pending` and `startupStatus: failed` as terminal-surface placeholder states, not as runtime-ready sessions.
- CON-4: The startup composer queues text in client state while pending and flushes through `terminalInteractionService.sendInput(sessionId, prompt)` after startup succeeds.
- CON-5: Runtime, snapshot, legacy terminal IO, and xterm WebSocket endpoints reject pending/failed startup shells.
- CON-6: Worktree startup failure waits for worktree cleanup before returning failure to the client.
- CON-7: Background startup completion must not steal the user's current session selection if they switched away while startup was running.

## Scenarios

- S-1: User creates a Codex worktree session and startup takes 60 seconds. The modal closes immediately, the new session row is selected, and the terminal area shows startup progress plus an editable composer.
- S-2: User types a prompt and presses send while startup is pending. No terminal input API is called until the worktree/runtime startup request succeeds.
- S-3: Startup succeeds after a prompt was queued. The prompt is sent once, the composer clears, and the terminal switches to live/snapshot startup handling.
- S-4: Startup fails after the user typed a prompt. The session remains selected with a failed startup state and the prompt remains available.
- S-5: User switches to a pending session later. Brainbase shows the startup placeholder and does not call runtime ensure or snapshot endpoints for that shell.
- S-6: User reloads while a session is pending. Brainbase resumes watching the persisted shell, does not create a duplicate worktree, and flushes the restored queued prompt once when the session becomes ready.
- S-7: User switches to another session before startup finishes. The queued prompt may flush in the background, but the selected session stays unchanged.
- S-8: A pending shell is abandoned because the browser died before the background request could finish. Brainbase marks it failed after the resume watch timeout so the user can retry.
- S-9: User has a session search filter or archived visibility setting active while startup shells are created, failed, deleted, or selected. Brainbase keeps filtering by session name, project, path, and archive state using the existing session filter rules.

## Anti-patterns

- AP-1: Showing the blocking progress modal as the only state until the backend finishes.
- AP-2: Reusing the canonical project path as a temporary terminal cwd for a worktree session before the worktree path exists.
- AP-3: Sending queued startup text via ad hoc fetch calls instead of the normal terminal input service.
- AP-4: Clearing user-entered prompt text when background startup fails.
- AP-5: Retrying create-with-worktree automatically on reload for an already persisted pending shell.
- AP-6: Emitting a session switch for a startup completion when the user has moved to another session.

## Verification

- V-1: `npm test -- tests/ui/session-creation-mixin.test.js`
- V-2: `npm test -- tests/domain/session/session-service.test.js`
- V-3: `npm test -- tests/ui/integration/app-switch-session-runtime.test.js`
- V-4: `npm test -- tests/unit/server-session-controller.test.js tests/server/services/terminal-transport-service.test.js`
- V-5: `BRAINBASE_E2E_PORT=31016 BRAINBASE_PORT=31016 PORT=31016 npm run test:e2e -- tests/e2e/story-session-shell-first-startup-ux.spec.js --project=chromium`
- V-6: `vibepro pr prepare . --base origin/develop --story-id story-session-shell-first-startup-ux`
