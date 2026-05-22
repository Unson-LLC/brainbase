---
spec_id: story-inline-session-creation-spec
title: Inline session creation shell specification
source_story: docs/user_stories/active/story-inline-session-creation.md
source_architecture: docs/architecture/terminal-runtime-architecture.md
status: active
created_at: 2026-05-22
updated_at: 2026-05-22
---

# Spec: Inline session creation planning and network cleanup

## Scope

Current PR scope:

- `docs/user_stories/active/story-inline-session-creation.md`
- `docs/specs/story-inline-session-creation-spec.md`
- `server/routes/brainbase/mana-capture-routes.js`
- `server/scripts/pause-orphan-tmux-missing-sessions.js`
- `tests/server/routes/mana-capture-routes.test.js`
- `tests/server/scripts/pause-orphan-tmux-missing-sessions.test.js`
- `tests/e2e/story-inline-session-creation-pr-gate.spec.ts`

Follow-up implementation planning scope:

- `public/index.html`
- `public/style.css`
- `public/modules/app/session-creation-mixin.js`
- `public/modules/app/session-management-mixin.js`
- `public/modules/app/mobile-navigation-mixin.js`
- `public/modules/domain/session/session-service.js`
- `public/modules/ui/views/session-view.js`
- `tests/ui/session-creation-mixin.test.js`
- `tests/domain/session/session-service.test.js`
- `tests/e2e/story-session-shell-first-startup-ux.spec.js`
- `docs/brainbase-capabilities/capabilities/session.create.yml`
- `docs/brainbase-capabilities/capabilities/project.selector.yml`

## Invariants

- INV-1: This PR must not change the current new-session runtime behavior or claim the inline shell is implemented.
- INV-2: The future inline draft shell must be client-owned before confirmation; it must not be persisted to `state.json`, exposed as a real `SessionService` session, or visible to runtime reconciliation until the user confirms.
- INV-3: Future inline draft shells must not start terminal runtime, ttyd, xterm transport, snapshot loading, or worktree creation before the user confirms the session settings.
- INV-4: Once settings are confirmed in the future implementation, existing shell-first startup semantics remain authoritative for worktree sessions.
- INV-5: Startup prompt queueing, retry, failure preservation, and reload recovery must remain compatible with `story-session-shell-first-startup-ux` in the follow-up implementation.
- INV-6: The same project, engine, workspace, session name, and initial command values must reach `SessionService.createSession()` after confirmation in the follow-up implementation.
- INV-7: Canceling an unconfirmed draft shell must not archive, delete, persist, or mutate any existing session in the follow-up implementation.
- INV-8: A disabled workspace option must explain the project repository constraint inline instead of silently falling back in the follow-up implementation.
- INV-9: `server/routes/brainbase/mana-capture-routes.js` must keep POST `/chat` request/response semantics while building the external Mana Lambda `/api/chat` URL explicitly.
- INV-10: The `pause-orphan-tmux-missing-sessions.js` script may filter `tmux_missing` health issues by explicit `--session` IDs and must keep PATCHing `/api/state/sessions/:id`; this maintenance path is not part of inline session creation.

## Contracts

- CON-1: Current PR acceptance is documentation/spec/network cleanup only; UI modal removal is a follow-up implementation contract.
- CON-2: Future `#add-session-btn` behavior creates/selects a client-owned inline draft shell in app state instead of adding `.active` to `#create-session-modal`.
- CON-3: The future inline shell owns editable controls for `project`, `engine`, `useWorktree`, `sessionName`, and `initialCommand`.
- CON-4: Future worktree confirmation calls the same pending-shell and background-start path used by shell-first startup UX.
- CON-5: Future non-worktree confirmation calls the existing regular session creation path.
- CON-6: Future draft prompt text may reuse startup composer storage only after confirmation; draft-only text must be separately discardable on cancel.
- CON-7: Future project selection uses the existing project option source and worktree availability logic.
- CON-8: Future mobile and desktop new-session entrypoints share the same inline state machine across `session-creation-mixin.js` and `mobile-navigation-mixin.js`.
- CON-9: `server/routes/brainbase/mana-capture-routes.js` builds the external Mana Lambda `/api/chat` URL through `buildManaLambdaUrl`.
- CON-10: `pause-orphan-tmux-missing-sessions.js` builds `/api/health/terminal` and `/api/state/sessions/:id` URLs through explicit helper functions so VibePro can distinguish Brainbase routes from external API calls.

## Scenarios

- S-1: Given this PR is reviewed, when the Story and Spec are read, then they clearly identify inline session creation as follow-up implementation work.
- S-2: Given Mana Lambda URL has or lacks a trailing slash, when POST `/chat` calls the external Lambda, then the route fetches exactly one `/api/chat` path and preserves successful reply semantics.
- S-3: Given the `pause-orphan` script receives a terminal health response, when `--session` is provided, then only matching `tmux_missing` session IDs are patched through `/api/state/sessions/:id`.
- S-4: Given the `pause-orphan` script runs in dry-run mode, when tmux-missing sessions are present, then no PATCH request is sent.
- S-5: Given future inline creation implementation starts, when desktop or mobile entrypoints are touched, then the tests must be updated from modal-opening expectations to inline-shell expectations in that implementation PR.
- S-6: Given this PR does not change public UI code, when UI/E2E review is performed, then browser journey evidence is explicitly non-applicable for current behavior and existing modal-opening coverage remains unchanged until the follow-up implementation PR.
- S-7: Given the follow-up implementation removes the modal primary path, when capability artifacts are updated, then `session.create.yml` and `project.selector.yml` must stop presenting `#create-session-modal` as the canonical creation surface.

## Anti-patterns

- AP-1: Claiming modal removal is complete in a PR that only defines Story/Spec and network cleanup.
- AP-2: Leaving changed runtime/API paths out of Story, Spec, or test surfaces.
- AP-3: Keeping future implementation contracts as current PR Acceptance Criteria.
- AP-4: In the follow-up implementation, keeping the modal as the primary path and merely adding another form to the pending shell.
- AP-5: In the follow-up implementation, creating a worktree or starting runtime as soon as the draft shell appears.
- AP-6: In the follow-up implementation, persisting an unconfirmed draft as a real session before confirmation.
- AP-7: In the follow-up implementation, silently converting a requested worktree session into a regular session when the project has no repository.

## Verification

- V-1: `tests/e2e/story-inline-session-creation-pr-gate.spec.ts` covers this PR's Story/Spec acceptance criteria.
- V-2: `tests/server/routes/mana-capture-routes.test.js` covers Mana Lambda `/api/chat` URL construction and success response semantics.
- V-3: `tests/server/scripts/pause-orphan-tmux-missing-sessions.test.js` covers dry-run/apply, `--session` filtering, URL encoding, and PATCH payload semantics.
- V-4: `tests/server/routes/mana-capture-routes.test.js` covers empty-message validation, non-ok Lambda fallback, and thrown fetch fallback so POST `/chat` request/response semantics remain stable.
- V-5: `tests/e2e/story-inline-session-creation-pr-gate.spec.ts` records that browser UI journeys are non-applicable in this PR because no public UI source is changed.
- V-6: Follow-up implementation must add unit tests for desktop add-session, cancel restore, project/worktree disabled explanation, and worktree/non-worktree confirmation paths.
- V-7: Follow-up implementation must update `tests/e2e/story-session-shell-first-startup-ux.spec.js` or add a replacement behavioral E2E for inline shell, pending startup, retry, mobile entrypoint, and hard-reload recovery.
- V-8: Follow-up implementation must update `docs/brainbase-capabilities/capabilities/session.create.yml` and `docs/brainbase-capabilities/capabilities/project.selector.yml` so agent-facing capability surfaces no longer point at the removed modal path.

## Open Questions

- OQ-1: Should the old modal remain reachable behind a debug shortcut for one release, or should it be removed in the same PR?
- OQ-2: Should `general` remain the default project for inline draft shells, or should Brainbase default to the currently active project context?
