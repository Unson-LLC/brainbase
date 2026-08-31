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

## Compatibility boundary

This spec covers the residual browser Session Launch Picker as a downstream compatibility consumer during migration; it is not a formal Project Catalog or Project Provisioning entry. Formal registration uses Skill/CLI/API/MCP. The server-side `session.create`/static endpoint is retired. Workspace Setup and Connected-world Onboarding remain separate.

## Invariants

- INV-1: The primary new-session path must not activate `#create-session-modal`.
- INV-2: Session Launch Picker owns only immutable startup settings: project, engine, and useWorktree.
- INV-3: Session name and initial prompt must not block background startup.
- INV-4: Confirming a worktree launch must create a persisted pending shell before worktree/runtime startup proceeds.
- INV-5: Pending or failed startup shells must not start terminal ensure, xterm, ttyd iframe navigation, or snapshot loading against the canonical project path.
- INV-6: Startup Composer prompt state must survive pending, failed, retry, and reload paths.
- INV-7: Queued prompt text must flush through `TerminalInteractionService.sendInput()` at most once after runtime readiness.
- INV-8: Project, engine, and workspace settings shown in Startup Composer are locked metadata, not editable controls.
- INV-9: Project candidates come only from the authenticated runtime Catalog; `/api/config` legacy topology never substitutes for it.
- INV-10: A non-empty grant matches only exact project ID, explicit alias, or GitHub repository name; prefix/parent/hyphenless inference is forbidden.
- INV-11: A selectable project has explicit `local.path`; missing path is disabled as Workspace Setup required and never guessed.
- INV-12: Catalog auth, transport, Registry, or source.status unavailable/error resets to `general`/fail-closed and never re-adds a requested project outside candidates.

## Contracts

- CON-1: `EVENTS.CREATE_SESSION` opens `openSessionLaunchPicker()`.
- CON-2: `openCreateSessionModal()` and `openInlineSessionDraft()` remain compatibility entrypoints, but delegate to Session Launch Picker.
- CON-3: `#session-launch-picker` is the pre-start surface for this residual browser consumer, not a Project Catalog or Project Provisioning entry.
- CON-4: Confirming a worktree picker calls `createSession(project, generatedName, '', true, engine)` so the existing shell-first path creates the pending shell and starts `_continueSessionStartup()`.
- CON-5: `#session-startup-composer` is the canonical initial prompt surface.
- CON-6: Startup Composer renders locked metadata from the selected session: project, engine, and workspace mode.
- CON-7: Non-worktree confirmation may continue through the existing regular session creation path.
- CON-8: Picker project options are sourced from the authenticated runtime Catalog and use exact project ID, explicit alias, or GitHub repository grants only.
- CON-9: Picker options without explicit `local.path` are disabled and labeled as requiring Workspace Setup; no path is guessed.
- CON-10: Auth, transport, Registry, or catalog-source failures expose unavailable/error state, retain only `general`, and never re-add a requested project outside returned candidates.
