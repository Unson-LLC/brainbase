---
spec_id: story-inline-session-creation-spec
title: Inline session creation shell specification
source_story: docs/user_stories/active/story-inline-session-creation.md
source_architecture: docs/architecture/terminal-runtime-architecture.md
status: active
created_at: 2026-05-22
updated_at: 2026-05-22
---

# Spec: Inline session creation shell

## Scope

- `public/index.html`
- `public/style.css`
- `public/modules/app/session-creation-mixin.js`
- `public/modules/app/session-management-mixin.js`
- `public/modules/domain/session/session-service.js`
- `public/modules/ui/views/session-view.js`
- `tests/ui/session-creation-mixin.test.js`
- `tests/domain/session/session-service.test.js`
- `tests/e2e/story-session-shell-first-startup-ux.spec.js`

## Invariants

- INV-1: The primary new-session action must not require a modal before the user sees the new session surface.
- INV-2: Inline draft shells must not start terminal runtime, ttyd, xterm transport, snapshot loading, or worktree creation before the user confirms the session settings.
- INV-3: Once settings are confirmed, existing shell-first startup semantics remain authoritative for worktree sessions.
- INV-4: Startup prompt queueing, retry, failure preservation, and reload recovery must remain compatible with `story-session-shell-first-startup-ux`.
- INV-5: The same project, engine, workspace, session name, and initial command values must reach `SessionService.createSession()` regardless of whether the old modal fallback exists.
- INV-6: Canceling an unconfirmed draft shell must not archive, delete, or mutate any existing session.
- INV-7: A disabled workspace option must explain the project repository constraint inline instead of silently falling back.

## Contracts

- CON-1: `#add-session-btn` creates/selects an inline draft shell in app state instead of adding `.active` to `#create-session-modal`.
- CON-2: The inline shell owns the editable controls for `project`, `engine`, `useWorktree`, `sessionName`, and `initialCommand`.
- CON-3: Confirming a worktree inline shell calls the same pending-shell and background-start path used by shell-first startup UX.
- CON-4: Confirming a non-worktree inline shell calls the existing regular session creation path.
- CON-5: The inline shell may reuse startup composer storage only after the session is confirmed; draft-only text must be separately discardable on cancel.
- CON-6: Project selection uses the existing project option source and worktree availability logic.
- CON-7: Mobile and desktop new-session entrypoints share the same inline creation state machine.

## Scenarios

- S-1: Given the user clicks `新規セッション`, when no modifier/debug path is used, then the modal stays closed and a new inline draft shell is selected.
- S-2: Given the inline draft shell is visible, when the user changes project, then workspace availability and default session name update without starting runtime.
- S-3: Given the inline draft shell is visible, when the user types an initial prompt and confirms with worktree enabled, then the prompt is passed into the existing background startup flow and is not duplicated through terminal typeahead.
- S-4: Given worktree startup is pending after confirmation, when the user edits or submits the startup composer, then text is queued and flushed once after runtime readiness.
- S-5: Given startup fails after confirmation, when the user returns to the session, then the prompt remains visible and retryable.
- S-6: Given the user cancels an inline draft shell before confirmation, when a previous current session exists, then Brainbase returns to that session and removes only the draft shell.
- S-7: Given the user opens the mobile new-session action, when the action fires, then the same inline draft shell appears instead of the modal.

## Anti-patterns

- AP-1: Keeping the modal as the primary path and merely adding another form to the pending shell.
- AP-2: Creating a worktree or starting runtime as soon as the draft shell appears.
- AP-3: Treating draft prompt text as a queued terminal prompt before the user confirms session settings.
- AP-4: Silently converting a requested worktree session into a regular session when the project has no repository.
- AP-5: Duplicating project/engine/worktree logic between modal code and inline shell code without a shared state model.
- AP-6: Removing the old modal code before tests prove mobile and desktop paths use the inline state machine.

## Verification

- V-1: Unit test that `#add-session-btn` opens inline draft shell and does not activate `#create-session-modal`.
- V-2: Unit test that confirming worktree draft shell calls `createPendingSessionShell` first, then background `createSession`.
- V-3: Unit test that canceling draft shell removes only the draft and restores previous selection.
- V-4: Unit test that project change updates workspace disabled state and explanatory text.
- V-5: E2E test that new-session flow shows inline shell, confirms settings, shows pending startup composer, queues prompt, and flushes once.
- V-6: VibePro UI check for clickable controls: project selector, engine segmented control, workspace toggle, start, cancel, startup composer send/retry.

## Open Questions

- OQ-1: Should the old modal remain reachable behind a debug shortcut for one release, or should it be removed in the same PR?
- OQ-2: Should `general` remain the default project for inline draft shells, or should Brainbase default to the currently active project context?
