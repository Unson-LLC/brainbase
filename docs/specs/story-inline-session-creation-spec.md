---
spec_id: story-inline-session-creation-spec
title: Inline session creation shell specification
source_story: docs/user_stories/active/story-inline-session-creation.md
source_architecture: docs/architecture/terminal-runtime-architecture.md
status: active
created_at: 2026-05-22
updated_at: 2026-05-23
---

# Spec: Inline session creation implementation

## Scope

Current PR scope:

- `docs/user_stories/active/story-inline-session-creation.md`
- `docs/specs/story-inline-session-creation-spec.md`
- `public/index.html`
- `public/style.css`
- `public/modules/app/session-creation-mixin.js`
- `public/modules/app/event-listeners-mixin.js`
- `tests/ui/session-creation-mixin.test.js`
- `tests/e2e/story-inline-session-creation-pr-gate.spec.ts`
- `tests/e2e/story-session-shell-first-startup-ux.spec.js`
- `docs/brainbase-capabilities/capabilities/session.create.yml`
- `docs/brainbase-capabilities/capabilities/project.selector.yml`

## Invariants

- INV-1: The primary new-session path must not activate `#create-session-modal`.
- INV-2: The inline draft shell must be client-owned before confirmation; it must not be persisted to `state.json`, exposed as a real `SessionService` session, or visible to runtime reconciliation until the user confirms.
- INV-3: Inline draft shells must not start terminal runtime, ttyd, xterm transport, snapshot loading, or worktree creation before the user confirms the session settings.
- INV-4: Once settings are confirmed, existing shell-first startup semantics remain authoritative for worktree sessions.
- INV-5: Startup prompt queueing, retry, failure preservation, and reload recovery must remain compatible with `story-session-shell-first-startup-ux` in this implementation.
- INV-6: The same project, engine, workspace, session name, and initial command values must reach `SessionService.createSession()` after confirmation.
- INV-7: Canceling an unconfirmed draft shell must not archive, delete, persist, or mutate any existing session.
- INV-8: A disabled workspace option must explain the project repository constraint inline instead of silently falling back.
- INV-9: `openCreateSessionModal()` may remain as a compatibility method name, but it must delegate to inline creation rather than opening the modal.
- INV-10: Agent-facing capability artifacts must not make `#create-session-modal` the canonical surface for session creation or project selection.

## Contracts

- CON-1: `EVENTS.CREATE_SESSION` opens the inline draft shell through `openInlineSessionDraft()`.
- CON-2: `#add-session-btn` creates/selects a client-owned inline draft shell instead of adding `.active` to `#create-session-modal`.
- CON-3: The inline shell owns editable controls for `project`, `engine`, `useWorktree`, `sessionName`, and `initialCommand`.
- CON-4: Worktree confirmation calls the same pending-shell and background-start path used by shell-first startup UX.
- CON-5: Non-worktree confirmation calls the existing regular session creation path.
- CON-6: Draft prompt text may reuse startup composer storage only after confirmation; draft-only text must be separately discardable on cancel.
- CON-7: Project selection uses the existing project option source and worktree availability logic.
- CON-8: Mobile and desktop new-session entrypoints share the same inline state machine through `EVENTS.CREATE_SESSION`.
- CON-9: `#inline-session-draft` is the canonical UI surface for session creation controls.
- CON-10: `session.create.yml` and `project.selector.yml` use inline draft selectors for agent-facing discovery.

## Scenarios

- S-1: Given this PR is reviewed, when the Story and Spec are read, then they identify inline session creation as implemented in the current PR.
- S-2: Given desktop `#add-session-btn` is clicked, when the create session event is handled, then `#inline-session-draft` becomes visible and `#create-session-modal` remains inactive.
- S-3: Given mobile new-session entrypoints emit `EVENTS.CREATE_SESSION`, when the event is handled, then the same inline draft path is used.
- S-4: Given a user edits an inline draft, when no confirmation has happened, then `createSession()` and `createPendingSessionShell()` have not been called.
- S-5: Given a user cancels an inline draft, when the draft closes, then the current session and session list remain unchanged.
- S-6: Given a project has no Git repository, when it is selected in the draft, then the workspace checkbox is disabled and the repository constraint is visible.
- S-7: Given a user confirms the draft, when `useWorktree` is true, then the existing pending shell path starts; otherwise the existing regular create path starts.

## Anti-patterns

- AP-1: Keeping planning-only acceptance criteria after the implementation PR changes public UI code.
- AP-2: Leaving changed runtime/API paths out of Story, Spec, or test surfaces.
- AP-3: Keeping planning-only contracts as current PR Acceptance Criteria after public UI code changes.
- AP-4: Keeping the modal as the primary path and merely adding another form to the pending shell.
- AP-5: Creating a worktree or starting runtime as soon as the draft shell appears.
- AP-6: Persisting an unconfirmed draft as a real session before confirmation.
- AP-7: Silently converting a requested worktree session into a regular session when the project has no repository.

## Verification

- V-1: `tests/e2e/story-inline-session-creation-pr-gate.spec.ts` covers this PR's Story/Spec acceptance criteria.
- V-2: `tests/ui/session-creation-mixin.test.js` covers inline draft opening without modal activation.
- V-3: `tests/ui/session-creation-mixin.test.js` covers cancel without session creation or state mutation.
- V-4: `tests/ui/session-creation-mixin.test.js` covers confirmed draft values reaching `createSession()`.
- V-5: `tests/ui/session-creation-mixin.test.js` covers disabled workspace explanation for projects without repositories.
- V-6: `tests/e2e/story-session-shell-first-startup-ux.spec.js` covers the inline shell path into pending startup behavior.
- V-7: `docs/brainbase-capabilities/capabilities/session.create.yml` and `docs/brainbase-capabilities/capabilities/project.selector.yml` no longer point at the removed modal path.
- V-8: `vibepro pr prepare . --base origin/develop --story-id story-inline-session-creation` validates the PR evidence graph for this implementation surface.

## Open Questions

- OQ-1: Should the legacy modal markup be removed in a later cleanup once external references have aged out?
- OQ-2: Should `general` remain the default project for inline draft shells, or should Brainbase default to the currently active project context?
