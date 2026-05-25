---
spec_id: story-session-launch-picker-startup-composer-spec
title: Session Launch Picker and Startup Composer specification
source_story: docs/user_stories/active/story-session-launch-picker-startup-composer.md
status: active
created_at: 2026-05-26
updated_at: 2026-05-26
---

# Spec: Session Launch Picker and Startup Composer

## Scope

- `public/index.html`
- `public/style.css`
- `public/modules/app/event-listeners-mixin.js`
- `public/modules/app/session-creation-mixin.js`
- `tests/ui/session-creation-mixin.test.js`
- `tests/e2e/story-session-shell-first-startup-ux.spec.js`
- `tests/e2e/story-inline-session-creation-ux.spec.ts`
- `docs/brainbase-capabilities/capabilities/session.create.yml`
- `docs/brainbase-capabilities/capabilities/project.selector.yml`

## Invariants

- INV-1: The primary new-session path must not activate `#create-session-modal`.
- INV-2: Session Launch Picker owns only immutable startup settings: project, engine, and useWorktree.
- INV-3: Session name and initial prompt must not block background startup.
- INV-4: Confirming a worktree launch must create a persisted pending shell before worktree/runtime startup proceeds.
- INV-5: Pending or failed startup shells must not start terminal ensure, xterm, ttyd iframe navigation, or snapshot loading against the canonical project path.
- INV-6: Startup Composer prompt state must survive pending, failed, retry, and reload paths.
- INV-7: Queued prompt text must flush through `TerminalInteractionService.sendInput()` at most once after runtime readiness.
- INV-8: Project, engine, and workspace settings shown in Startup Composer are locked metadata, not editable controls.

## Contracts

- CON-1: `EVENTS.CREATE_SESSION` opens `openSessionLaunchPicker()`.
- CON-2: `openCreateSessionModal()` and `openInlineSessionDraft()` remain compatibility entrypoints, but delegate to Session Launch Picker.
- CON-3: `#session-launch-picker` is the canonical pre-start surface.
- CON-4: Confirming a worktree picker calls `createSession(project, generatedName, '', true, engine)` so the existing shell-first path creates the pending shell and starts `_continueSessionStartup()`.
- CON-5: `#session-startup-composer` is the canonical initial prompt surface.
- CON-6: Startup Composer renders locked metadata from the selected session: project, engine, and workspace mode.
- CON-7: Non-worktree confirmation may continue through the existing regular session creation path.
